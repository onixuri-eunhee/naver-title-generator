import http from 'node:http';
import { URL } from 'node:url';
import {
  STT_VERSION,
  handleShortformSttRequest,
  normalizeError,
  readIncomingBody,
} from '../shortform-stt-core.js';

const PORT = Number(process.env.PORT || 8080);
const SERVICE_SECRET = (process.env.STT_SERVICE_SHARED_SECRET || '').trim();

function writeJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('X-Shortform-Stt-Version', STT_VERSION);
  res.end(JSON.stringify(body));
}

function isAuthorized(reqUrl, req) {
  if (reqUrl.pathname === '/health') return true;
  if (!SERVICE_SECRET) return false;
  return (req.headers['x-stt-service-secret'] || '') === SERVICE_SECRET;
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

  if (!isAuthorized(reqUrl, req)) {
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
