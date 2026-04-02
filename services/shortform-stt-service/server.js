import http from 'node:http';
import fs from 'node:fs/promises';
import { URL } from 'node:url';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Redis } from '@upstash/redis';
import {
  STT_VERSION,
  handleShortformSttRequest,
  normalizeError,
  readIncomingBody,
} from '../shortform-stt-core.js';
import {
  BROLL_VERSION,
  handleShortformBrollRequest,
  normalizeBrollError,
} from '../shortform-broll-core.js';
import {
  SHORTFORM_REMOTION_VERSION,
  renderShortformRemotion,
} from '../shortform-remotion-render.mjs';

const PORT = Number(process.env.PORT || 8080);
const SERVICE_SECRET = (process.env.STT_SERVICE_SHARED_SECRET || '').trim();
const ALLOWED_ORIGINS = [
  'https://ddukddaktool.co.kr',
  'https://www.ddukddaktool.co.kr',
];
const tempAudioStore = new Map();

let redis;
function getRedis() {
  if (!redis) {
    redis = new Redis({
      url: process.env.KV_REST_API_URL,
      token: process.env.KV_REST_API_TOKEN,
    });
  }
  return redis;
}

function setCorsHeaders(req, res) {
  const origin = req.headers.origin || '';
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else {
    res.setHeader('Access-Control-Allow-Origin', 'https://ddukddaktool.co.kr');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Audio-Mime-Type, X-Audio-File-Name, X-Stt-Probe, X-Stt-Service-Secret');
  res.setHeader('Access-Control-Expose-Headers', 'X-Shortform-Stt-Version');
}

function writeJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (!res.hasHeader('X-Shortform-Stt-Version')) {
    res.setHeader('X-Shortform-Stt-Version', STT_VERSION);
  }
  res.end(JSON.stringify(body));
}

function getVersionHeader(pathname) {
  if (pathname === '/api/shortform-broll') return BROLL_VERSION;
  if (pathname === '/api/shortform-remotion-render') return SHORTFORM_REMOTION_VERSION;
  return STT_VERSION;
}

function extractBearerToken(req) {
  const auth = req.headers.authorization || req.headers.Authorization || '';
  return auth.startsWith('Bearer ') ? auth.slice(7) : '';
}

async function resolveSessionEmail(token) {
  if (!token) return null;
  try {
    const session = await getRedis().get(`session:${token}`);
    return session && session.email ? session.email : null;
  } catch (_) {
    return null;
  }
}

async function isAuthorized(reqUrl, req) {
  if (reqUrl.pathname === '/health') return true;
  if (SERVICE_SECRET && (req.headers['x-stt-service-secret'] || '') === SERVICE_SECRET) return true;

  const email = await resolveSessionEmail(extractBearerToken(req));
  return !!email;
}

function getQueryObject(searchParams) {
  const query = {};
  searchParams.forEach(function(value, key) {
    query[key] = value;
  });
  return query;
}

function parseJsonBody(rawBody) {
  if (!rawBody?.length) return {};
  try {
    return JSON.parse(rawBody.toString('utf8'));
  } catch (_) {
    return {};
  }
}

function decodeAudioPayload(audioBase64, mimeType) {
  if (!audioBase64 || typeof audioBase64 !== 'string') return { buffer: null, mimeType };

  const dataUrlMatch = audioBase64.match(/^data:([^;]+);base64,(.+)$/);
  const resolvedMimeType = dataUrlMatch?.[1] || mimeType || 'application/octet-stream';
  const rawBase64 = (dataUrlMatch?.[2] || audioBase64).replace(/\s+/g, '');
  const normalizedBase64 = rawBase64.replace(/-/g, '+').replace(/_/g, '/');
  const buffer = Buffer.from(normalizedBase64, 'base64');
  return { buffer, mimeType: resolvedMimeType };
}

function normalizeAudioFileName(fileName, mimeType) {
  const safe = String(fileName || '').trim().replace(/[^a-zA-Z0-9._-]+/g, '_');
  if (safe) return safe;
  const extension = ({
    'audio/mpeg': 'mp3',
    'audio/mp3': 'mp3',
    'audio/mp4': 'm4a',
    'audio/m4a': 'm4a',
    'audio/wav': 'wav',
    'audio/x-wav': 'wav',
    'audio/webm': 'webm',
    'audio/ogg': 'ogg',
  })[String(mimeType || '').toLowerCase()] || 'webm';
  return `audio.${extension}`;
}

function getBaseUrl(req) {
  const proto = (req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
  const host = (req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  return `${proto}://${host}`;
}

function cleanupExpiredAudioEntries() {
  const now = Date.now();
  for (const [token, entry] of tempAudioStore.entries()) {
    if (entry.expiresAt <= now) tempAudioStore.delete(token);
  }
}

function storeTempAudio({ buffer, mimeType, fileName }) {
  cleanupExpiredAudioEntries();
  const token = randomUUID();
  tempAudioStore.set(token, {
    buffer,
    mimeType,
    fileName,
    expiresAt: Date.now() + 20 * 60 * 1000,
  });
  return token;
}

function writeBufferResponse(res, status, body, contentType, extraHeaders = {}) {
  res.statusCode = status;
  res.setHeader('Content-Type', contentType);
  Object.entries(extraHeaders).forEach(([key, value]) => {
    res.setHeader(key, value);
  });
  res.end(body);
}

function serveTempAudio(req, res, token) {
  cleanupExpiredAudioEntries();
  const entry = tempAudioStore.get(token);
  if (!entry) {
    writeJson(res, 404, { error: 'Audio not found' });
    return;
  }

  const total = entry.buffer.length;
  const range = req.headers.range;
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/i.exec(range);
    if (match) {
      const start = match[1] ? Number(match[1]) : 0;
      const end = match[2] ? Number(match[2]) : total - 1;
      const safeStart = Math.max(0, Math.min(start, total - 1));
      const safeEnd = Math.max(safeStart, Math.min(end, total - 1));
      writeBufferResponse(
        res,
        206,
        entry.buffer.subarray(safeStart, safeEnd + 1),
        entry.mimeType || 'application/octet-stream',
        {
          'Accept-Ranges': 'bytes',
          'Content-Length': String(safeEnd - safeStart + 1),
          'Content-Range': `bytes ${safeStart}-${safeEnd}/${total}`,
          'Cache-Control': 'no-store',
        }
      );
      return;
    }
  }

  writeBufferResponse(res, 200, entry.buffer, entry.mimeType || 'application/octet-stream', {
    'Content-Length': String(total),
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-store',
    'Content-Disposition': `inline; filename="${entry.fileName}"`,
  });
}

async function handleRemotionRenderRequest({ rawBody, req }) {
  const body = parseJsonBody(rawBody);
  const audio = decodeAudioPayload(body.audioBase64, body.audioMimeType);
  if (!audio.buffer?.length) {
    return { status: 400, body: { error: 'audioBase64가 필요합니다.' } };
  }

  if (!body.script || typeof body.script !== 'object') {
    return { status: 400, body: { error: 'script가 필요합니다.' } };
  }

  const visuals = Array.isArray(body.visuals) ? body.visuals : [];
  if (!visuals.length) {
    return { status: 400, body: { error: 'visuals가 필요합니다.' } };
  }

  const audioToken = storeTempAudio({
    buffer: audio.buffer,
    mimeType: audio.mimeType || 'audio/webm',
    fileName: normalizeAudioFileName(body.audioFileName, audio.mimeType),
  });
  const baseUrl = getBaseUrl(req);
  const outputLocation = path.join('/tmp', `shortform-remotion-${randomUUID()}.mp4`);

  try {
    await renderShortformRemotion({
      inputProps: {
        script: body.script,
        visuals,
        estimatedSeconds: Number(body.estimatedSeconds) || 30,
        audioDurationSec: Number(body.audioDurationSec) || Number(body.estimatedSeconds) || 30,
        trimStartSec: Math.max(0, Number(body.trimStartSec) || 0),
        trimEndSec: body.trimEndSec === null || body.trimEndSec === undefined || body.trimEndSec === ''
          ? null
          : Math.max(0, Number(body.trimEndSec)),
        audioSrc: `${baseUrl}/internal/remotion-audio/${audioToken}`,
      },
      outputLocation,
    });

    const videoBuffer = await fs.readFile(outputLocation);
    return {
      status: 200,
      body: videoBuffer,
      contentType: 'video/mp4',
      isBinary: true,
      extraHeaders: {
        'Content-Disposition': 'attachment; filename="shortform-remotion.mp4"',
        'X-Shortform-Render-Version': SHORTFORM_REMOTION_VERSION,
      },
    };
  } finally {
    tempAudioStore.delete(audioToken);
    await fs.rm(outputLocation, { force: true }).catch(() => {});
  }
}

const server = http.createServer(async function(req, res) {
  const reqUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  setCorsHeaders(req, res);

  if (req.method === 'OPTIONS') {
    res.statusCode = 200;
    res.end();
    return;
  }

  if (reqUrl.pathname === '/health') {
    writeJson(res, 200, {
      ok: true,
      service: 'shortform-media',
      sttVersion: STT_VERSION,
      brollVersion: BROLL_VERSION,
      remotionVersion: SHORTFORM_REMOTION_VERSION,
      hasOpenAIKey: !!((process.env.OPENAI_API_KEY || '').trim()),
      hasFalKey: !!((process.env.FAL_KEY || '').trim()),
      hasSeedanceKey: !!((process.env.SEEDANCE_API_KEY || '').trim()),
      hasVeoProject: !!((process.env.GOOGLE_VERTEX_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || '').trim()),
      hasVeoServiceAccount: !!((process.env.GOOGLE_VERTEX_SERVICE_ACCOUNT_JSON || process.env.GOOGLE_SERVICE_ACCOUNT_JSON || process.env.GOOGLE_VERTEX_SERVICE_ACCOUNT_JSON_BASE64 || process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 || '').trim()),
      veoLocation: (process.env.GOOGLE_VERTEX_LOCATION || 'us-central1').trim(),
      veoModelId: (process.env.GOOGLE_VERTEX_VEO_MODEL || 'veo-3.0-fast-generate-001').trim(),
      maxAudioMb: Number(process.env.SHORTFORM_STT_MAX_AUDIO_MB || 20),
    });
    return;
  }

  if (reqUrl.pathname.startsWith('/internal/remotion-audio/')) {
    const token = reqUrl.pathname.split('/').pop();
    serveTempAudio(req, res, token);
    return;
  }

  if (!['/api/shortform-stt', '/api/shortform-broll', '/api/shortform-remotion-render'].includes(reqUrl.pathname)) {
    writeJson(res, 404, { error: 'Not found' });
    return;
  }

  if (!(await isAuthorized(reqUrl, req))) {
    writeJson(res, 401, { error: 'Unauthorized' });
    return;
  }

  try {
    const rawBody = req.method === 'GET' ? Buffer.alloc(0) : await readIncomingBody(req);
    let result;
    if (reqUrl.pathname === '/api/shortform-broll') {
      result = await handleShortformBrollRequest({
        method: req.method,
        rawBody,
        query: getQueryObject(reqUrl.searchParams),
        userEmail: await resolveSessionEmail(extractBearerToken(req)),
        ip: req.headers['x-real-ip'] || req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown',
      });
    } else if (reqUrl.pathname === '/api/shortform-remotion-render') {
      result = await handleRemotionRenderRequest({
        rawBody,
        req,
      });
    } else {
      result = await handleShortformSttRequest({
        method: req.method,
        headers: req.headers,
        query: getQueryObject(reqUrl.searchParams),
        rawBody,
      });
    }
    if (result.isBinary) {
      writeBufferResponse(
        res,
        result.status,
        result.body,
        result.contentType || 'application/octet-stream',
        result.extraHeaders || {}
      );
      return;
    }
    res.setHeader('X-Shortform-Stt-Version', getVersionHeader(reqUrl.pathname));
    writeJson(res, result.status, result.body);
  } catch (error) {
    const normalized = reqUrl.pathname === '/api/shortform-broll'
      ? normalizeBrollError(error)
      : normalizeError(error);
    console.error('[railway-shortform-media] error:', normalized.message);
    writeJson(res, normalized.status, { error: normalized.message, version: getVersionHeader(reqUrl.pathname) });
  }
});

server.listen(PORT, function() {
  console.log(`[railway-shortform-stt] listening on :${PORT}`);
});
