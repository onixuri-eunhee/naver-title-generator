import {
  extractToken,
  getClientIp,
  resolveAdmin,
  resolveSessionEmail,
  setCorsHeaders,
} from './_helpers.js';
import {logUsage} from './_db.js';
import {
  BROLL_VERSION,
  handleShortformBrollRequest,
  normalizeBrollError,
} from '../services/shortform-broll-core.js';

export const config = {
  maxDuration: 180,
  api: {bodyParser: false},
};

const REMOTE_MEDIA_BASE_URL = (process.env.SHORTFORM_STT_SERVICE_URL || '').trim().replace(/\/+$/, '');
const REMOTE_MEDIA_SECRET = (process.env.STT_SERVICE_SHARED_SECRET || '').trim();

async function readIncomingBody(req) {
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

function buildProxyUrl(req) {
  const url = new URL(`${REMOTE_MEDIA_BASE_URL}/api/shortform-broll`);
  Object.entries(req.query || {}).forEach(([key, value]) => {
    if (typeof value === 'string' && value.trim()) {
      url.searchParams.set(key, value.trim());
    }
  });
  return url;
}

async function proxyToRailway(req, rawBody) {
  const headers = {
    'X-Stt-Service-Secret': REMOTE_MEDIA_SECRET,
    'Content-Type': 'application/json',
  };

  const response = await fetch(buildProxyUrl(req), {
    method: req.method,
    headers,
    body: req.method === 'GET' ? undefined : rawBody,
  });

  return {
    status: response.status,
    text: await response.text(),
    contentType: response.headers.get('content-type') || 'application/json; charset=utf-8',
    version: response.headers.get('x-shortform-stt-version') || BROLL_VERSION,
  };
}

function writeProxyResponse(res, proxied) {
  res.statusCode = proxied.status;
  res.setHeader('Content-Type', proxied.contentType);
  res.setHeader('X-Shortform-Broll-Version', proxied.version);
  res.end(proxied.text);
}

export default async function handler(req, res) {
  setCorsHeaders(res, req);
  res.setHeader('X-Shortform-Broll-Version', BROLL_VERSION);

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({error: 'Method not allowed'});
  }

  try {
    if (req.method === 'GET') {
      if (REMOTE_MEDIA_BASE_URL && REMOTE_MEDIA_SECRET) {
        const proxied = await proxyToRailway(req, Buffer.alloc(0));
        return writeProxyResponse(res, proxied);
      }

      const localGet = await handleShortformBrollRequest({
        method: 'GET',
        rawBody: Buffer.alloc(0),
        userEmail: null,
        ip: getClientIp(req),
        query: req.query || {},
      });
      return res.status(localGet.status).json(localGet.body);
    }

    const isAdmin = await resolveAdmin(req);
    const token = extractToken(req);
    const email = await resolveSessionEmail(token);
    if (!isAdmin && !email) {
      return res.status(401).json({error: '로그인이 필요합니다.'});
    }

    const rawBody = await readIncomingBody(req);

    if (REMOTE_MEDIA_BASE_URL && REMOTE_MEDIA_SECRET) {
      const proxied = await proxyToRailway(req, rawBody);
      if (proxied.status >= 200 && proxied.status < 300) {
        await logUsage(email, 'shortform-broll', null, getClientIp(req));
      }
      return writeProxyResponse(res, proxied);
    }

    const localPost = await handleShortformBrollRequest({
      method: 'POST',
      rawBody,
      userEmail: email,
      ip: getClientIp(req),
      query: req.query || {},
    });

    await logUsage(email, 'shortform-broll', null, getClientIp(req));
    return res.status(localPost.status).json(localPost.body);
  } catch (error) {
    const normalized = normalizeBrollError(error);
    console.error('[shortform-broll] API error:', normalized.message);
    return res.status(normalized.status).json({error: normalized.message, version: BROLL_VERSION});
  }
}
