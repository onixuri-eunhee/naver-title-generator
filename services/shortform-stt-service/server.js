import http from 'node:http';
import { URL } from 'node:url';
import { Redis } from '@upstash/redis';
import {
  STT_VERSION,
  handleShortformSttRequest,
  normalizeError,
  readIncomingBody,
} from '../shortform-stt-core.js';

const PORT = Number(process.env.PORT || 8080);
const SERVICE_SECRET = (process.env.STT_SERVICE_SHARED_SECRET || '').trim();
const ALLOWED_ORIGINS = [
  'https://ddukddaktool.co.kr',
  'https://www.ddukddaktool.co.kr',
];

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
  } else {
    res.setHeader('Access-Control-Allow-Origin', 'https://ddukddaktool.co.kr');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Audio-Mime-Type, X-Stt-Probe, X-Stt-Service-Secret');
  res.setHeader('Access-Control-Expose-Headers', 'X-Shortform-Stt-Version');
}

function writeJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('X-Shortform-Stt-Version', STT_VERSION);
  res.end(JSON.stringify(body));
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
      service: 'shortform-stt',
      version: STT_VERSION,
      hasOpenAIKey: !!((process.env.OPENAI_API_KEY || '').trim()),
      maxAudioMb: Number(process.env.SHORTFORM_STT_MAX_AUDIO_MB || 20),
    });
    return;
  }

  if (reqUrl.pathname !== '/api/shortform-stt') {
    writeJson(res, 404, { error: 'Not found' });
    return;
  }

  if (!(await isAuthorized(reqUrl, req))) {
    writeJson(res, 401, { error: 'Unauthorized' });
    return;
  }

  try {
    const rawBody = req.method === 'GET' ? Buffer.alloc(0) : await readIncomingBody(req);
    const result = await handleShortformSttRequest({
      method: req.method,
      headers: req.headers,
      query: getQueryObject(reqUrl.searchParams),
      rawBody,
    });
    writeJson(res, result.status, result.body);
  } catch (error) {
    const normalized = normalizeError(error);
    console.error('[railway-shortform-stt] error:', normalized.message);
    writeJson(res, normalized.status, { error: normalized.message, version: STT_VERSION });
  }
});

server.listen(PORT, function() {
  console.log(`[railway-shortform-stt] listening on :${PORT}`);
});
