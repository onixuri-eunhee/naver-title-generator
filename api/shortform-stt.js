import { extractToken, resolveAdmin, resolveSessionEmail, setCorsHeaders, getClientIp } from './_helpers.js';
import { logUsage } from './_db.js';
import FormData from 'form-data';

export const config = {
  maxDuration: 120,
  api: { bodyParser: false },
};

const STT_VERSION = 'v3-probe-formdata';
const MAX_AUDIO_SIZE = 4 * 1024 * 1024;

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

function getHeaderValue(req, key) {
  if (!req || !req.headers) return '';
  return req.headers[key] || req.headers[key.toLowerCase()] || '';
}

function getProbeMode(req) {
  const fromHeader = getHeaderValue(req, 'x-stt-probe');
  if (fromHeader && typeof fromHeader === 'string') return fromHeader.trim().toLowerCase();
  const fromQuery = req?.query?.probe;
  if (typeof fromQuery === 'string') return fromQuery.trim().toLowerCase();
  return '';
}

function getRequestMimeType(req) {
  const explicit = getHeaderValue(req, 'x-audio-mime-type');
  if (explicit && typeof explicit === 'string') return explicit.trim();
  const contentType = getHeaderValue(req, 'content-type');
  if (!contentType || typeof contentType !== 'string') return '';
  return contentType.split(';')[0].trim();
}

async function readRawRequestBody(req) {
  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string') return Buffer.from(req.body);
  if (req.body && typeof req.body === 'object' && !(req.body instanceof Uint8Array)) {
    return Buffer.from(JSON.stringify(req.body));
  }

  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return chunks.length ? Buffer.concat(chunks) : Buffer.alloc(0);
}

async function parseIncomingAudio(req) {
  const contentType = getHeaderValue(req, 'content-type');
  const normalizedContentType = typeof contentType === 'string' ? contentType.toLowerCase() : '';
  const rawBody = await readRawRequestBody(req);

  if (!rawBody.length) {
    return { buffer: null, mimeType: getRequestMimeType(req) || 'application/octet-stream' };
  }

  if (normalizedContentType.includes('application/json')) {
    const bodyText = rawBody.toString('utf8');
    const body = parseRequestBody(bodyText);
    const { audioBase64, mimeType } = body;
    return decodeAudioPayload(audioBase64, mimeType);
  }

  return {
    buffer: rawBody,
    mimeType: getRequestMimeType(req) || 'audio/webm',
  };
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

function getOpenAIApiKey() {
  const apiKey = (process.env.OPENAI_API_KEY || '').replace(/\n/g, '').trim();
  if (!apiKey) throw new Error('OPENAI_API_KEY not configured');
  return apiKey;
}

function buildTranscriptionForm(buffer, mimeType) {
  const filename = getFilename(mimeType);
  const resolvedType = mimeType || 'audio/webm';
  const form = new FormData();
  form.append('file', buffer, { filename, contentType: resolvedType });
  form.append('model', 'whisper-1');
  form.append('response_format', 'verbose_json');
  form.append('timestamp_granularities[]', 'word');
  form.append('language', 'ko');
  return form;
}

function getFormBuffer(form) {
  try {
    return form.getBuffer();
  } catch (error) {
    throw new Error('multipart buffer build failed: ' + (error?.message || error));
  }
}

function getFormLength(form) {
  return new Promise(function(resolve, reject) {
    form.getLength(function(error, length) {
      if (error) return reject(error);
      resolve(length);
    });
  });
}

async function transcribeAudio(buffer, mimeType) {
  const apiKey = getOpenAIApiKey();
  const form = buildTranscriptionForm(buffer, mimeType);
  const multipartBuffer = getFormBuffer(form);
  const controller = new AbortController();
  const timeout = setTimeout(function() {
    controller.abort();
  }, 90000);

  try {
    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        ...form.getHeaders(),
        'Content-Length': String(multipartBuffer.length),
      },
      body: multipartBuffer,
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
      console.error('[shortform-stt] Whisper HTTP error:', response.status, text.slice(0, 500));
      throw new Error(message + ' (HTTP ' + response.status + ')');
    }

    return data;
  } catch (error) {
    if (error && error.name === 'AbortError') {
      throw new Error('Whisper transcription timed out');
    }
    var message = error && error.message ? error.message : 'Whisper transcription failed';
    console.error('[shortform-stt] Whisper upload error:', message);
    throw new Error(message);
  } finally {
    clearTimeout(timeout);
  }
}

export default async function handler(req, res) {
  setCorsHeaders(res, req);
  res.setHeader('X-Shortform-Stt-Version', STT_VERSION);

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method === 'GET') {
    if (getProbeMode(req) === 'ping') {
      return res.status(200).json({
        ok: true,
        stage: 'ping',
        version: STT_VERSION,
        hasOpenAIKey: !!((process.env.OPENAI_API_KEY || '').trim()),
      });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const isAdmin = await resolveAdmin(req);
    const token = extractToken(req);
    const email = await resolveSessionEmail(token);

    if (!isAdmin && !email) {
      return res.status(401).json({ error: '로그인이 필요합니다.' });
    }

    const { buffer, mimeType: resolvedMimeType } = await parseIncomingAudio(req);

    if (!buffer) {
      return res.status(400).json({ error: '오디오 데이터가 필요합니다.' });
    }

    if (buffer.length > MAX_AUDIO_SIZE) {
      return res.status(413).json({ error: '오디오 파일은 4MB 이하여야 합니다.' });
    }

    if (!process.env.OPENAI_API_KEY) {
      console.error('[shortform-stt] OPENAI_API_KEY is missing');
      return res.status(500).json({ error: '서버 설정 오류가 발생했습니다.' });
    }

    const probeMode = getProbeMode(req);
    if (probeMode === 'raw') {
      return res.status(200).json({
        ok: true,
        stage: 'raw',
        version: STT_VERSION,
        bytes: buffer.length,
        mimeType: resolvedMimeType,
        hasOpenAIKey: true,
      });
    }
    if (probeMode === 'form') {
      const probeForm = buildTranscriptionForm(buffer, resolvedMimeType);
      let length = null;
      let bufferLength = null;
      try {
        length = await getFormLength(probeForm);
      } catch (error) {
        length = null;
      }
      try {
        bufferLength = getFormBuffer(probeForm).length;
      } catch (error) {
        bufferLength = null;
      }
      return res.status(200).json({
        ok: true,
        stage: 'form',
        version: STT_VERSION,
        bytes: buffer.length,
        mimeType: resolvedMimeType,
        multipartLength: length,
        multipartBufferLength: bufferLength,
        headerKeys: Object.keys(probeForm.getHeaders()),
      });
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
