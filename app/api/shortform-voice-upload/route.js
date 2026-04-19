import { uploadToR2, r2Delete } from '@/lib/r2';
import { hashEmail } from '@/lib/user-images';
import { transcribeAudio, normalizeWhisperResponse } from '@/lib/shortform/whisper';
import { remapScenesToAudio } from '@/lib/shortform/voice-upload-remap';
import {
  extractToken,
  resolveSessionEmail,
  jsonResponse,
  handleOptions,
} from '@/lib/api-helpers';

export const maxDuration = 60;

const R2_AUDIO_PREFIX = 'shortform-audio';
const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB (Whisper API 상한)
const MAX_DURATION_SEC = 100; // 숏폼 최대 90초 + 여유 10초
const MIN_DURATION_SEC = 5;

const ACCEPTED_MIME_TYPES = new Set([
  'audio/mpeg',       // mp3
  'audio/mp3',        // mp3 alt
  'audio/mp4',        // m4a (일부 브라우저)
  'audio/x-m4a',      // m4a
  'audio/wav',        // wav
  'audio/wave',       // wav alt
  'audio/x-wav',      // wav alt
  'audio/webm',       // webm
]);

const MIME_TO_EXT = {
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/wav': 'wav',
  'audio/wave': 'wav',
  'audio/x-wav': 'wav',
  'audio/webm': 'webm',
};

export async function OPTIONS(request) {
  return handleOptions(request);
}

export async function POST(request) {
  let r2Key = null;
  try {
    // 1. 인증
    const token = extractToken(request);
    const email = await resolveSessionEmail(token);
    if (!email) {
      return jsonResponse(request, { error: '로그인이 필요합니다.' }, { status: 401 });
    }

    // 2. multipart 파싱
    const formData = await request.formData();
    const audioFile = formData.get('audio');
    const scriptRaw = formData.get('script');

    if (!audioFile || typeof audioFile === 'string') {
      return jsonResponse(request, { error: 'audio 파일이 필요합니다.' }, { status: 400 });
    }

    // 3. MIME 검증
    const mimeType = audioFile.type || '';
    if (!ACCEPTED_MIME_TYPES.has(mimeType)) {
      return jsonResponse(
        request,
        { error: 'mp3/m4a/wav/webm 형식만 업로드 가능합니다.' },
        { status: 400 }
      );
    }

    // 4. 크기 검증
    if (audioFile.size > MAX_FILE_SIZE) {
      return jsonResponse(
        request,
        { error: `파일이 너무 큽니다 (${(audioFile.size / 1024 / 1024).toFixed(1)}MB). 25MB 이하만 가능.` },
        { status: 400 }
      );
    }

    // 5. script JSON 파싱
    let script;
    try {
      script = JSON.parse(String(scriptRaw || ''));
    } catch (e) {
      return jsonResponse(request, { error: 'script 데이터가 유효하지 않습니다.' }, { status: 400 });
    }
    if (!script || !Array.isArray(script.scenes)) {
      return jsonResponse(request, { error: 'script.scenes 가 없습니다.' }, { status: 400 });
    }

    // 6. Buffer 변환
    const arrayBuffer = await audioFile.arrayBuffer();
    const audioBuffer = Buffer.from(arrayBuffer);

    // 7. R2 업로드
    const ext = MIME_TO_EXT[mimeType] || 'mp3';
    const userKey = hashEmail(email);
    r2Key = `${R2_AUDIO_PREFIX}/${userKey}/upload-${Date.now()}.${ext}`;
    let audioUrl;
    try {
      audioUrl = await uploadToR2(r2Key, audioBuffer, mimeType);
    } catch (uploadErr) {
      console.error('[voice-upload] R2 업로드 실패:', uploadErr.message);
      return jsonResponse(
        request,
        { error: '파일 저장 실패: ' + uploadErr.message },
        { status: 502 }
      );
    }

    // 8. Whisper 전사
    let whisperResult;
    try {
      const raw = await transcribeAudio(audioBuffer, `upload.${ext}`, mimeType);
      whisperResult = normalizeWhisperResponse(raw);
    } catch (whisperErr) {
      console.error('[voice-upload] Whisper 실패:', whisperErr.message);
      await r2Delete(r2Key);
      return jsonResponse(
        request,
        { error: '음성 전사 실패: ' + whisperErr.message },
        { status: 502 }
      );
    }

    // 9. 길이 사후 검증 (Whisper duration 기준)
    if (whisperResult.duration > MAX_DURATION_SEC) {
      await r2Delete(r2Key);
      return jsonResponse(
        request,
        { error: `오디오가 너무 깁니다 (${whisperResult.duration.toFixed(1)}초). ${MAX_DURATION_SEC}초 이하만 가능.` },
        { status: 400 }
      );
    }
    if (whisperResult.duration < MIN_DURATION_SEC) {
      await r2Delete(r2Key);
      return jsonResponse(
        request,
        { error: `오디오가 너무 짧습니다 (${whisperResult.duration.toFixed(1)}초). 최소 ${MIN_DURATION_SEC}초 필요.` },
        { status: 400 }
      );
    }

    // 10. scene 시간축 재분배
    const oldTotalDuration = Number(script.totalDuration) || 0;
    const remappedScenes = remapScenesToAudio(
      script.scenes,
      oldTotalDuration,
      whisperResult.duration
    );

    // 11. 응답
    return jsonResponse(request, {
      audioUrl,
      wordTimestamps: whisperResult.wordTimestamps,
      charAlignment: null,
      totalDuration: whisperResult.duration,
      remappedScenes,
      provider: 'whisper',
    });
  } catch (error) {
    console.error('[voice-upload] Unexpected error:', error.message, error.stack);
    if (r2Key) await r2Delete(r2Key).catch(() => {});
    return jsonResponse(
      request,
      { error: '음성 업로드 중 오류: ' + (error.message || 'unknown') },
      { status: 500 }
    );
  }
}
