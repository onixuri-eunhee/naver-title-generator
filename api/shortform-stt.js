import { extractToken, resolveAdmin, resolveSessionEmail, setCorsHeaders, getClientIp } from './_helpers.js';
import { logUsage } from './_db.js';

export const config = {
  maxDuration: 120,
  api: { bodyParser: { sizeLimit: '15mb' } },
};

const MAX_AUDIO_SIZE = 10 * 1024 * 1024;

function parseRequestBody(body) {
  if (!body) return {};
  if (typeof body === 'string') {
    try {
      return JSON.parse(body);
    } catch (_) {
      return {};
    }
  }
  return body;
}

function decodeAudioPayload(audioBase64, mimeType) {
  if (!audioBase64 || typeof audioBase64 !== 'string') return { buffer: null, mimeType };

  const dataUrlMatch = audioBase64.match(/^data:([^;]+);base64,(.+)$/);
  const resolvedMimeType = dataUrlMatch?.[1] || mimeType || 'application/octet-stream';
  const rawBase64 = (dataUrlMatch?.[2] || audioBase64).replace(/\s+/g, '');
  const normalizedBase64 = rawBase64.replace(/-/g, '+').replace(/_/g, '/');
  const buffer = Buffer.from(normalizedBase64, 'base64');

  if (!buffer.length) return { buffer: null, mimeType: resolvedMimeType };
  return { buffer, mimeType: resolvedMimeType };
}

function getFilename(mimeType) {
  const extension = ({
    'audio/mpeg': 'mp3',
    'audio/mp3': 'mp3',
    'audio/mp4': 'm4a',
    'audio/m4a': 'm4a',
    'audio/wav': 'wav',
    'audio/x-wav': 'wav',
    'audio/webm': 'webm',
    'audio/ogg': 'ogg',
    'audio/aac': 'aac',
    'audio/flac': 'flac',
    'video/mp4': 'mp4',
    'video/webm': 'webm',
  })[mimeType] || 'webm';

  return `audio.${extension}`;
}

function normalizeWords(words) {
  if (!Array.isArray(words)) return [];

  return words
    .filter(item => item && typeof item.word === 'string' && Number.isFinite(item.start) && Number.isFinite(item.end))
    .map(item => ({ word: item.word, start: item.start, end: item.end }));
}

async function transcribeAudio(buffer, mimeType) {
  const apiKey = (process.env.OPENAI_API_KEY || '').replace(/\n/g, '').trim();
  if (!apiKey) throw new Error('OPENAI_API_KEY not configured');

  const filename = getFilename(mimeType);
  const resolvedType = mimeType || 'audio/webm';

  // Node.js File API (20+) — Blob보다 안정적인 multipart 직렬화
  const file = new File([buffer], filename, { type: resolvedType });

  const formData = new FormData();
  formData.append('file', file);
  formData.append('model', 'whisper-1');
  formData.append('response_format', 'verbose_json');
  formData.append('timestamp_granularities[]', 'word');
  formData.append('language', 'ko');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90000);

  try {
    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: formData,
      signal: controller.signal,
    });

    const text = await response.text();
    let data = {};

    try {
      data = text ? JSON.parse(text) : {};
    } catch (_) {
      data = { error: { message: text || 'Invalid Whisper response' } };
    }

    if (!response.ok) {
      const message = data?.error?.message || 'Whisper transcription failed';
      console.error('[shortform-stt] Whisper API responded:', response.status, text.slice(0, 500));
      throw new Error(message);
    }

    return data;
  } finally {
    clearTimeout(timeout);
  }
}

export default async function handler(req, res) {
  setCorsHeaders(res, req);

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = parseRequestBody(req.body);
    if (body !== req.body) req.body = body;

    const isAdmin = await resolveAdmin(req);
    const token = extractToken(req);
    const email = await resolveSessionEmail(token);

    if (!isAdmin && !email) {
      return res.status(401).json({ error: '로그인이 필요합니다.' });
    }

    const { audioBase64, mimeType } = body;
    const { buffer, mimeType: resolvedMimeType } = decodeAudioPayload(audioBase64, mimeType);

    if (!buffer) {
      return res.status(400).json({ error: 'audioBase64가 필요합니다.' });
    }

    if (buffer.length > MAX_AUDIO_SIZE) {
      return res.status(413).json({ error: '오디오 파일은 10MB 이하여야 합니다.' });
    }

    if (!process.env.OPENAI_API_KEY) {
      console.error('[shortform-stt] OPENAI_API_KEY is missing');
      return res.status(500).json({ error: '서버 설정 오류가 발생했습니다.' });
    }

    let whisperData;
    try {
      whisperData = await transcribeAudio(buffer, resolvedMimeType);
    } catch (error) {
      console.error('[shortform-stt] Whisper API error:', error?.message || error);
      return res.status(502).json({ error: '음성 전사 중 오류: ' + (error?.message || '알 수 없는 오류') });
    }

    const segments = normalizeWords(
      whisperData.words || whisperData.segments?.flatMap(segment => segment?.words || []) || []
    );
    const duration = segments.length ? segments[segments.length - 1].end : whisperData.duration || 0;

    await logUsage(email, 'shortform-stt', null, getClientIp(req));

    return res.status(200).json({
      segments,
      fullText: whisperData.text || '',
      duration,
    });
  } catch (error) {
    console.error('[shortform-stt] API error:', error);
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
}
