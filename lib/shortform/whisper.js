/**
 * Phase F — OpenAI Whisper(whisper-1) 호출 + 응답 정규화
 *
 * Whisper 응답의 words 배열을 ElevenLabs와 동일한 wordTimestamps shape으로 정규화.
 * 순수 함수(normalizeWhisperResponse)와 fetch 호출(transcribeAudio)을 분리.
 */

const WHISPER_ENDPOINT = 'https://api.openai.com/v1/audio/transcriptions';
const WHISPER_MODEL = 'whisper-1';

/**
 * Whisper API 호출
 * @param {Buffer} audioBuffer
 * @param {string} filename - 확장자 포함 (예: 'upload.mp3')
 * @param {string} mimeType
 * @returns {Promise<object>} raw Whisper response
 */
export async function transcribeAudio(audioBuffer, filename, mimeType) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is missing');

  const formData = new FormData();
  const blob = new Blob([audioBuffer], { type: mimeType });
  formData.append('file', blob, filename);
  formData.append('model', WHISPER_MODEL);
  formData.append('response_format', 'verbose_json');
  formData.append('timestamp_granularities[]', 'word');
  formData.append('language', 'ko');

  const res = await fetch(WHISPER_ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: formData,
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Whisper failed: ${res.status} ${errText.slice(0, 200)}`);
  }

  return res.json();
}

/**
 * Whisper 응답을 ElevenLabs와 동일 shape으로 정규화
 * @param {object} raw
 * @returns {{ duration: number, text: string, wordTimestamps: Array<{word,start,end}> }}
 */
export function normalizeWhisperResponse(raw) {
  const duration = Number(raw?.duration) || 0;
  const text = String(raw?.text || '');
  const words = Array.isArray(raw?.words) ? raw.words : [];

  const wordTimestamps = words
    .filter((w) => w && typeof w.word === 'string' && Number.isFinite(w.start) && Number.isFinite(w.end))
    .map((w) => ({ word: w.word, start: w.start, end: w.end }));

  return { duration, text, wordTimestamps };
}
