import { extractToken, resolveAdmin, resolveSessionEmail, setCorsHeaders, getClientIp } from './_helpers.js';
import { logUsage } from './_db.js';
import {
  STT_VERSION,
  handleShortformSttRequest,
  normalizeError,
  readIncomingBody,
} from '../services/shortform-stt-core.js';

export const config = {
  maxDuration: 300,
  api: { bodyParser: false },
};

const REMOTE_STT_BASE_URL = (process.env.SHORTFORM_STT_SERVICE_URL || '').trim().replace(/\/+$/, '');
const REMOTE_STT_SECRET = (process.env.STT_SERVICE_SHARED_SECRET || '').trim();

function getProbeMode(req) {
  const fromHeader = req.headers['x-stt-probe'] || '';
  if (typeof fromHeader === 'string' && fromHeader.trim()) return fromHeader.trim().toLowerCase();
  const fromQuery = req.query?.probe;
  return typeof fromQuery === 'string' ? fromQuery.trim().toLowerCase() : '';
}

function buildProxyUrl(req) {
  const url = new URL(`${REMOTE_STT_BASE_URL}/api/shortform-stt`);
  if (typeof req.query?.probe === 'string' && req.query.probe.trim()) {
    url.searchParams.set('probe', req.query.probe.trim());
  }
  return url;
}

async function proxyToRailway(req, rawBody) {
  const headers = {
    'X-Stt-Service-Secret': REMOTE_STT_SECRET,
  };
  const contentType = req.headers['content-type'];
  const audioMimeType = req.headers['x-audio-mime-type'];
  const probeMode = req.headers['x-stt-probe'];

  if (contentType) headers['Content-Type'] = contentType;
  if (audioMimeType) headers['X-Audio-Mime-Type'] = audioMimeType;
  if (probeMode) headers['X-Stt-Probe'] = probeMode;

  const response = await fetch(buildProxyUrl(req), {
    method: req.method,
    headers,
    body: req.method === 'GET' ? undefined : rawBody,
  });

  return {
    status: response.status,
    text: await response.text(),
    contentType: response.headers.get('content-type') || 'application/json; charset=utf-8',
    version: response.headers.get('x-shortform-stt-version') || STT_VERSION,
  };
}

function writeProxyResponse(res, proxied) {
  res.statusCode = proxied.status;
  res.setHeader('Content-Type', proxied.contentType);
  res.setHeader('X-Shortform-Stt-Version', proxied.version);
  res.end(proxied.text);
}

export default async function handler(req, res) {
  setCorsHeaders(res, req);
  res.setHeader('X-Shortform-Stt-Version', STT_VERSION);

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    if (req.method === 'GET') {
      if (REMOTE_STT_BASE_URL && REMOTE_STT_SECRET) {
        const proxied = await proxyToRailway(req, Buffer.alloc(0));
        return writeProxyResponse(res, proxied);
      }

      const localGet = await handleShortformSttRequest({
        method: 'GET',
        headers: req.headers,
        query: req.query || {},
        rawBody: Buffer.alloc(0),
      });
      return res.status(localGet.status).json(localGet.body);
    }

    const isAdmin = await resolveAdmin(req);
    const token = extractToken(req);
    const email = await resolveSessionEmail(token);

    if (!isAdmin && !email) {
      return res.status(401).json({ error: '로그인이 필요합니다.' });
    }

    const rawBody = await readIncomingBody(req);

    if (REMOTE_STT_BASE_URL && REMOTE_STT_SECRET) {
      const proxied = await proxyToRailway(req, rawBody);

      if (proxied.status >= 200 && proxied.status < 300 && !getProbeMode(req)) {
        await logUsage(email, 'shortform-stt', null, getClientIp(req));
      }

      return writeProxyResponse(res, proxied);
    }

    const localPost = await handleShortformSttRequest({
      method: 'POST',
      headers: req.headers,
      query: req.query || {},
      rawBody,
    });

    if (!getProbeMode(req)) {
      await logUsage(email, 'shortform-stt', null, getClientIp(req));
    }

    return res.status(localPost.status).json(localPost.body);
  } catch (error) {
    const normalized = normalizeError(error);
    console.error('[shortform-stt] API error:', normalized.message);
    return res.status(normalized.status).json({ error: normalized.message, version: STT_VERSION });
  }
}
