import https from 'node:https';
import FormData from 'form-data';

export const STT_VERSION = 'v6-word-timestamps';
export const MAX_AUDIO_SIZE = Math.max(
  1,
  Number(process.env.SHORTFORM_STT_MAX_AUDIO_MB || 20)
) * 1024 * 1024;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

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

export async function readIncomingBody(req) {
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

function getHeaderValue(headers, key) {
  if (!headers) return '';
  return headers[key] || headers[key.toLowerCase()] || '';
}

function normalizeMimeType(mimeType) {
  if (!mimeType || typeof mimeType !== 'string') return '';
  return mimeType.split(';')[0].trim().toLowerCase();
}

function getProbeMode(headers, query) {
  const fromHeader = getHeaderValue(headers, 'x-stt-probe');
  if (typeof fromHeader === 'string' && fromHeader.trim()) return fromHeader.trim().toLowerCase();
  const fromQuery = query && typeof query.probe === 'string' ? query.probe : '';
  return fromQuery.trim().toLowerCase();
}

function getRequestMimeType(headers) {
  const explicit = normalizeMimeType(getHeaderValue(headers, 'x-audio-mime-type'));
  if (explicit) return explicit;
  const contentType = getHeaderValue(headers, 'content-type');
  return normalizeMimeType(contentType);
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

function parseIncomingAudio(rawBody, headers) {
  const contentType = getHeaderValue(headers, 'content-type');
  const normalizedContentType = typeof contentType === 'string' ? contentType.toLowerCase() : '';

  if (!rawBody.length) {
    return { buffer: null, mimeType: getRequestMimeType(headers) || 'application/octet-stream' };
  }

  if (normalizedContentType.includes('application/json')) {
    const bodyText = rawBody.toString('utf8');
    const body = parseRequestBody(bodyText);
    return decodeAudioPayload(body.audioBase64, body.mimeType);
  }

  return {
    buffer: rawBody,
    mimeType: getRequestMimeType(headers) || 'audio/webm',
  };
}

function getRequestedFilename(headers, mimeType) {
  const fromHeader = getHeaderValue(headers, 'x-audio-file-name');
  if (typeof fromHeader === 'string' && fromHeader.trim()) {
    const safe = fromHeader.trim().replace(/[^a-zA-Z0-9._-]+/g, '_');
    if (/\.(flac|m4a|mp3|mp4|mpeg|mpga|oga|ogg|wav|webm)$/i.test(safe)) return safe;
  }
  return getFilename(mimeType);
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
    .map(item => ({ word: item.word, text: item.word, start: item.start, end: item.end }));
}

function normalizeSegments(segments) {
  if (!Array.isArray(segments)) return [];

  return segments
    .filter(item => item && typeof item.text === 'string' && Number.isFinite(item.start))
    .map(item => ({
      text: item.text,
      start: item.start,
      end: Number.isFinite(item.end) ? item.end : item.start,
    }));
}

function getOpenAIApiKey() {
  const apiKey = (process.env.OPENAI_API_KEY || '').replace(/\n/g, '').trim();
  if (!apiKey) throw new HttpError(500, 'OPENAI_API_KEY not configured');
  return apiKey;
}

function buildTranscriptionForm(buffer, mimeType, requestedFilename) {
  const resolvedType = normalizeMimeType(mimeType) || 'audio/webm';
  const filename = requestedFilename || getFilename(resolvedType);
  const form = new FormData();
  form.append('file', buffer, { filename, contentType: resolvedType });
  form.append('model', 'whisper-1');
  form.append('response_format', 'verbose_json');
  form.append('timestamp_granularities[]', 'segment');
  form.append('timestamp_granularities[]', 'word');
  form.append('language', 'ko');
  return form;
}

function getFormBuffer(form) {
  try {
    return form.getBuffer();
  } catch (error) {
    throw new HttpError(500, 'multipart buffer build failed: ' + (error?.message || error));
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

function buildTinyWavBuffer() {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(16000, 24);
  header.writeUInt32LE(32000, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(0, 40);
  return header;
}

async function probeOpenAIModels(apiKey) {
  return await new Promise(function(resolve, reject) {
    const request = https.request('https://api.openai.com/v1/models', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    }, function(res) {
      const chunks = [];
      res.on('data', function(chunk) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
      res.on('end', function() {
        resolve({
          status: res.statusCode || 0,
          text: Buffer.concat(chunks).toString('utf8'),
        });
      });
    });

    request.setTimeout(30000, function() {
      request.destroy(new Error('OpenAI models probe timed out'));
    });
    request.on('error', reject);
    request.end();
  });
}

async function callTranscriptionsEndpoint(buffer, mimeType, requestedFilename) {
  const apiKey = getOpenAIApiKey();
  const form = buildTranscriptionForm(buffer, mimeType, requestedFilename);
  const multipartBuffer = getFormBuffer(form);

  return await new Promise(function(resolve, reject) {
    const request = https.request('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        ...form.getHeaders(),
        'Content-Length': String(multipartBuffer.length),
      },
    }, function(res) {
      const chunks = [];
      res.on('data', function(chunk) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
      res.on('end', function() {
        resolve({
          status: res.statusCode || 0,
          text: Buffer.concat(chunks).toString('utf8'),
        });
      });
    });

    request.setTimeout(300000, function() {
      request.destroy(new Error('Whisper transcription timed out'));
    });
    request.on('error', reject);
    request.write(multipartBuffer);
    request.end();
  });
}

async function transcribeAudio(buffer, mimeType, requestedFilename) {
  const response = await callTranscriptionsEndpoint(buffer, mimeType, requestedFilename);
  const text = response.text;
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch (_) {
    data = { error: { message: text || 'Invalid Whisper response' } };
  }

  if (response.status < 200 || response.status >= 300) {
    const message = data?.error?.message || 'Whisper transcription failed';
    throw new HttpError(502, message + ' (HTTP ' + response.status + ')');
  }

  return data;
}

export async function handleShortformSttRequest(params) {
  const method = params.method || 'GET';
  const headers = params.headers || {};
  const query = params.query || {};
  const rawBody = params.rawBody || Buffer.alloc(0);
  const probeMode = getProbeMode(headers, query);

  if (method === 'GET') {
    if (probeMode === 'ping') {
      return {
        status: 200,
        body: {
          ok: true,
          stage: 'ping',
          version: STT_VERSION,
          hasOpenAIKey: !!((process.env.OPENAI_API_KEY || '').trim()),
        },
      };
    }
    if (probeMode === 'models') {
      const modelsResponse = await probeOpenAIModels(getOpenAIApiKey());
      return {
        status: 200,
        body: {
          ok: true,
          stage: 'models',
          version: STT_VERSION,
          status: modelsResponse.status,
          bodyPreview: modelsResponse.text.slice(0, 300),
        },
      };
    }
    if (probeMode === 'transcribe-dry') {
      const dryResponse = await callTranscriptionsEndpoint(buildTinyWavBuffer(), 'audio/wav');
      return {
        status: 200,
        body: {
          ok: true,
          stage: 'transcribe-dry',
          version: STT_VERSION,
          upstreamStatus: dryResponse.status,
          bodyPreview: dryResponse.text.slice(0, 300),
        },
      };
    }
    throw new HttpError(405, 'Method not allowed');
  }

  if (method !== 'POST') {
    throw new HttpError(405, 'Method not allowed');
  }

  const { buffer, mimeType } = parseIncomingAudio(rawBody, headers);
  const requestedFilename = getRequestedFilename(headers, mimeType);
  if (!buffer) {
    throw new HttpError(400, '오디오 데이터가 필요합니다.');
  }

  if (buffer.length > MAX_AUDIO_SIZE) {
    throw new HttpError(413, `오디오 파일은 ${Math.round(MAX_AUDIO_SIZE / 1024 / 1024)}MB 이하여야 합니다.`);
  }

  if (probeMode === 'raw') {
    return {
      status: 200,
      body: {
        ok: true,
        stage: 'raw',
        version: STT_VERSION,
        bytes: buffer.length,
        mimeType,
        filename: requestedFilename,
        hasOpenAIKey: !!((process.env.OPENAI_API_KEY || '').trim()),
      },
    };
  }

  if (probeMode === 'form') {
    const probeForm = buildTranscriptionForm(buffer, mimeType, requestedFilename);
    let length = null;
    let bufferLength = null;
    try {
      length = await getFormLength(probeForm);
    } catch (_) {}
    try {
      bufferLength = getFormBuffer(probeForm).length;
    } catch (_) {}

    return {
      status: 200,
      body: {
        ok: true,
        stage: 'form',
        version: STT_VERSION,
        bytes: buffer.length,
        mimeType,
        filename: requestedFilename,
        multipartLength: length,
        multipartBufferLength: bufferLength,
        headerKeys: Object.keys(probeForm.getHeaders()),
      },
    };
  }

  if (probeMode === 'models') {
    const modelsResponse = await probeOpenAIModels(getOpenAIApiKey());
    return {
      status: 200,
      body: {
        ok: true,
        stage: 'models',
        version: STT_VERSION,
        status: modelsResponse.status,
        bodyPreview: modelsResponse.text.slice(0, 300),
      },
    };
  }

  const whisperData = await transcribeAudio(buffer, mimeType, requestedFilename);
  const words = normalizeWords(
    whisperData.words || whisperData.segments?.flatMap(segment => segment?.words || []) || []
  );
  const segments = normalizeSegments(whisperData.segments || []);
  const timelineSegments = segments.length ? segments : words.map(function(item) {
    return {
      text: item.text,
      start: item.start,
      end: item.end,
    };
  });
  const duration = timelineSegments.length ? timelineSegments[timelineSegments.length - 1].end : whisperData.duration || 0;

  return {
    status: 200,
    body: {
      segments: timelineSegments,
      words,
      fullText: whisperData.text || '',
      duration,
    },
  };
}

export function normalizeError(error) {
  if (error instanceof HttpError) {
    return { status: error.status, message: error.message };
  }
  return { status: 500, message: error?.message || '서버 오류가 발생했습니다.' };
}
