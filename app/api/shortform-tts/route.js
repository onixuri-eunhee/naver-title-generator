import { getGoogleAccessToken } from '@/lib/vertex-auth';
import { NextResponse } from 'next/server';
import {
  getRedis,
  resolveAdmin,
  extractToken,
  resolveSessionEmail,
  corsHeaders,
  jsonResponse,
  handleOptions,
} from '@/lib/api-helpers';

const PREVIEW_SAMPLE_TEXT = '안녕하세요. 저는 이 목소리를 담당하고 있어요';
const PREVIEW_CACHE_TTL = 60 * 60 * 24 * 30; // 30일

export const maxDuration = 30;

// ── ElevenLabs (메인 — 유일한 외부 TTS) ──
const ELEVENLABS_API_BASE = 'https://api.elevenlabs.io/v1';
const ELEVENLABS_MODEL = 'eleven_multilingual_v2';

const ELEVENLABS_VOICES = {
  '21m00Tcm4TlvDq8ikWAM': { name: 'Rachel', gender: 'female' },
  'EXAVITQu4vr4xnSDxMaL': { name: 'Sarah', gender: 'female' },
  'XB0fDUnXU5powFXDhCwa': { name: 'Charlotte', gender: 'female' },
  'pNInz6obpgDQGcFmaJgB': { name: 'Adam', gender: 'male' },
  'ErXwobaYiN019PkySvjV': { name: 'Antoni', gender: 'male' },
  'TxGEqnHWrfWFTfGW9XjX': { name: 'Josh', gender: 'male' },
};

async function callElevenLabs(text, voiceId, speed = 1.0) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error('ELEVENLABS_API_KEY is missing');

  // ElevenLabs voice_settings.speed — 신형 모델에서만 반영, 구형 모델은 무시.
  // Phase A-bis Q5: 숏폼 1.12, 롱폼 1.05. 한국어는 1.15+ 부터 발음 뭉개짐 → 1.2 상한 clamp.
  const safeSpeed = Math.min(Math.max(Number(speed) || 1.0, 0.7), 1.2);

  const res = await fetch(`${ELEVENLABS_API_BASE}/text-to-speech/${voiceId}/with-timestamps`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'xi-api-key': apiKey,
      'Accept': 'application/json',
    },
    body: JSON.stringify({
      text,
      model_id: ELEVENLABS_MODEL,
      voice_settings: { stability: 0.5, similarity_boost: 0.75, speed: safeSpeed },
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`ElevenLabs TTS failed: ${res.status} ${errText.slice(0, 200)}`);
  }

  const data = await res.json();
  const audioBase64 = data.audio_base64 || data.audioBase64;
  if (!audioBase64) throw new Error('ElevenLabs: audio_base64 missing');

  const alignment = data.alignment || data.normalized_alignment || null;
  return {
    audioBuffer: Buffer.from(audioBase64, 'base64'),
    wordTimestamps: alignment ? charsToWordTimestamps(alignment) : [],
    charAlignment: alignment ? {
      characters: alignment.characters || [],
      starts: alignment.character_start_times_seconds || [],
      ends: alignment.character_end_times_seconds || [],
    } : null,
  };
}

function charsToWordTimestamps(alignment) {
  const chars = alignment.characters || [];
  const starts = alignment.character_start_times_seconds || [];
  const ends = alignment.character_end_times_seconds || [];
  if (!chars.length || chars.length !== starts.length) return [];

  const words = [];
  let buf = '';
  let wordStart = null;
  let lastEnd = 0;

  const flush = () => {
    if (buf) {
      words.push({ word: buf, start: wordStart ?? lastEnd, end: lastEnd });
      buf = '';
      wordStart = null;
    }
  };

  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (/\s/.test(ch)) {
      flush();
      lastEnd = ends[i];
      continue;
    }
    if (wordStart === null) wordStart = starts[i];
    buf += ch;
    lastEnd = ends[i];
  }
  flush();
  return words;
}

// ── Google Cloud TTS (폴백) ──
const GOOGLE_TTS_URL = 'https://texttospeech.googleapis.com/v1/text:synthesize';

const GOOGLE_VOICES = {
  'ko-KR-Neural2-A': { name: '서연', gender: 'FEMALE' },
  'ko-KR-Neural2-B': { name: '민지', gender: 'FEMALE' },
  'ko-KR-Wavenet-A': { name: '하은', gender: 'FEMALE' },
  'ko-KR-Wavenet-B': { name: '지수', gender: 'FEMALE' },
  'ko-KR-Standard-A': { name: '유나', gender: 'FEMALE' },
  'ko-KR-Neural2-C': { name: '도윤', gender: 'MALE' },
  'ko-KR-Wavenet-C': { name: '준서', gender: 'MALE' },
  'ko-KR-Wavenet-D': { name: '시우', gender: 'MALE' },
  'ko-KR-Standard-C': { name: '건우', gender: 'MALE' },
  'ko-KR-Standard-D': { name: '현우', gender: 'MALE' },
};

const DEFAULT_ELEVENLABS_VOICE = '21m00Tcm4TlvDq8ikWAM'; // Rachel

// ── Google Cloud TTS (폴백) ──
// 인증은 @/lib/vertex-auth.js의 getGoogleAccessToken() 사용

async function callGoogleTTS(text, voiceName, voiceGender, speakingRate = 1.1) {
  const accessToken = await getGoogleAccessToken();
  // Google TTS speakingRate 유효 범위 0.25 ~ 4.0. Phase A-bis 기준 0.7~1.2 clamp.
  const safeRate = Math.min(Math.max(Number(speakingRate) || 1.1, 0.7), 1.2);
  const res = await fetch(GOOGLE_TTS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({
      input: { text },
      voice: { languageCode: 'ko-KR', name: voiceName, ssmlGender: voiceGender },
      audioConfig: { audioEncoding: 'MP3', speakingRate: safeRate, pitch: 0 },
    }),
  });
  if (!res.ok) throw new Error(`Google TTS failed: ${res.status}`);
  const data = await res.json();
  return Buffer.from(data.audioContent, 'base64');
}

function audioResponse(request, buffer, provider) {
  return new NextResponse(buffer, {
    status: 200,
    headers: {
      ...corsHeaders(request),
      'Content-Type': 'audio/mpeg',
      'Content-Length': String(buffer.length),
      'X-TTS-Provider': provider,
    },
  });
}

export async function OPTIONS(request) {
  return handleOptions(request);
}

export async function GET(request) {
  const hasEleven = !!process.env.ELEVENLABS_API_KEY;
  const voices = [];
  if (hasEleven) {
    for (const [id, v] of Object.entries(ELEVENLABS_VOICES)) {
      voices.push({ id, name: v.name, gender: v.gender, provider: 'elevenlabs' });
    }
  }
  if (!voices.length) {
    for (const [id, v] of Object.entries(GOOGLE_VOICES)) {
      voices.push({ id, name: v.name, gender: v.gender, provider: 'google' });
    }
  }
  return jsonResponse(request, { voices, provider: hasEleven ? 'elevenlabs' : 'google' });
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const isPreview = body.preview === true || body.preview === 'true';

    if (!isPreview) {
      const token = extractToken(request);
      const email = await resolveSessionEmail(token);
      const isAdmin = await resolveAdmin(request);
      if (!isAdmin && !email) return jsonResponse(request, { error: '로그인이 필요합니다.' }, { status: 401 });
    }

    const text = isPreview ? PREVIEW_SAMPLE_TEXT : String(body.text || '').trim();
    if (!text) return jsonResponse(request, { error: 'text가 필요합니다.' }, { status: 400 });
    if (text.length > 5000) return jsonResponse(request, { error: '텍스트가 너무 깁니다. (최대 5000자)' }, { status: 400 });

    const voiceId = body.voiceId || '';

    // Phase A-bis Q5 — contentType 기반 TTS speed.
    // settings.voiceSpeed는 숏폼 Step 3 칩에서 조정(1.05~1.20, 기본 1.12),
    // 롱폼은 고정 1.05(발음 품질 우선). 프리뷰는 1.0(샘플링 목적).
    // ElevenLabs voice_settings.speed + Google speakingRate 양쪽에 전달.
    const contentType = body.contentType === 'long' ? 'long' : 'short';
    const userVoiceSpeed = Number(body.settings?.voiceSpeed);
    const ttsSpeed = isPreview
      ? 1.0
      : contentType === 'short'
        ? (Number.isFinite(userVoiceSpeed) ? userVoiceSpeed : 1.12)
        : 1.05;

    if (isPreview) {
      const redis = getRedis();
      const cacheKey = `tts-preview:${voiceId || 'default'}`;
      if (redis) {
        try {
          const cached = await redis.get(cacheKey);
          if (cached && typeof cached === 'string') {
            const cachedBuf = Buffer.from(cached, 'base64');
            return audioResponse(request, cachedBuf, 'cache');
          }
        } catch (_) {}
      }
    }
    let audioBuffer;
    let wordTimestamps = null;
    let charAlignment = null;
    let provider;

    const isElevenVoice = !!ELEVENLABS_VOICES[voiceId];
    const isGoogleVoice = !!GOOGLE_VOICES[voiceId];

    console.log(`[TTS] 요청 — voiceId=${voiceId}, text=${text.length}자, eleven=${isElevenVoice}, google=${isGoogleVoice}`);

    const tryEleven = async (vId) => {
      if (!process.env.ELEVENLABS_API_KEY) {
        throw new Error('ELEVENLABS_API_KEY가 설정되지 않았습니다. 관리자에게 문의하세요.');
      }
      console.log(`[TTS] → ElevenLabs: voice=${vId} speed=${ttsSpeed}`);
      const result = await callElevenLabs(text, vId, ttsSpeed);
      audioBuffer = result.audioBuffer;
      wordTimestamps = result.wordTimestamps;
      charAlignment = result.charAlignment;
      provider = 'elevenlabs';
      console.log(`[TTS] ✅ ElevenLabs success: ${audioBuffer.length} bytes, ${wordTimestamps.length} words, ${charAlignment?.characters?.length || 0} chars`);
    };

    if (isElevenVoice) {
      try {
        await tryEleven(voiceId);
      } catch (elError) {
        console.error('[TTS] ❌ ElevenLabs FAILED:', elError.message);
        return jsonResponse(request, { error: 'ElevenLabs 음성 생성 실패: ' + elError.message }, { status: 502 });
      }
    } else if (isGoogleVoice) {
      try {
        console.log(`[TTS] → Google: voice=${voiceId} speakingRate=${ttsSpeed}`);
        audioBuffer = await callGoogleTTS(text, voiceId, GOOGLE_VOICES[voiceId].gender, ttsSpeed);
        provider = 'google';
        console.log(`[TTS] ✅ Google success: ${audioBuffer.length} bytes`);
      } catch (gError) {
        console.error('[TTS] ❌ Google FAILED:', gError.message);
        return jsonResponse(request, { error: 'Google TTS 음성 생성 실패: ' + gError.message }, { status: 502 });
      }
    } else {
      console.warn(`[TTS] 알 수 없는 voiceId: ${voiceId} — 기본 ElevenLabs Rachel로 fallback`);
      try {
        await tryEleven(DEFAULT_ELEVENLABS_VOICE);
        provider = 'elevenlabs-default';
      } catch (err) {
        return jsonResponse(request, { error: '기본 음성 생성 실패: ' + err.message }, { status: 502 });
      }
    }

    if (isPreview) {
      const redis = getRedis();
      if (redis) {
        try {
          await redis.set(`tts-preview:${voiceId || 'default'}`, audioBuffer.toString('base64'), { ex: PREVIEW_CACHE_TTL });
        } catch (_) {}
      }
    }

    if (provider === 'elevenlabs' && !isPreview) {
      return jsonResponse(request, {
        provider,
        skipWhisper: true,
        audioBase64: audioBuffer.toString('base64'),
        wordTimestamps: wordTimestamps || [],
        charAlignment: charAlignment || null,
      });
    }

    return audioResponse(request, audioBuffer, provider);
  } catch (error) {
    console.error('[TTS] Unexpected error:', error.message, error.stack);
    return jsonResponse(
      request,
      { error: '음성 생성 중 오류가 발생했습니다: ' + (error.message || 'unknown') },
      { status: 500 }
    );
  }
}
