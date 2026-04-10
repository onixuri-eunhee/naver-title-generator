import {
  extractToken,
  getClientIp,
  getRedis,
  isCreditsActive,
  resolveAdmin,
  resolveSessionEmail,
  setCorsHeaders,
} from './_helpers.js';
import {logUsage, getDb} from './_db.js';
import {
  BROLL_VERSION,
  handleShortformBrollRequest,
  normalizeBrollError,
} from '../services/shortform-broll-core.js';

export const config = {
  maxDuration: 180,
  api: {bodyParser: false},
};

const SHORTFORM_CREDIT_COSTS = { 30: 7, 45: 10, 60: 14, 90: 18 };

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

/**
 * B-roll 성공 시 크레딧 차감. 무료 체험(30초 1회)이면 차감하지 않음.
 * @returns {{ charged: boolean, wasFree: boolean, error?: string }}
 */
async function chargeBrollCredits(email, isAdmin, targetDurationSec) {
  if (isAdmin) return { charged: false, wasFree: false };
  if (!isCreditsActive()) return { charged: false, wasFree: false };

  const creditCost = SHORTFORM_CREDIT_COSTS[targetDurationSec] || SHORTFORM_CREDIT_COSTS[30];

  // 30초 무료 체험 1회 확인
  const freeKey = `shortform-free:${email}`;
  const freeUsed = await getRedis().get(freeKey);

  if (!freeUsed && targetDurationSec === 30) {
    await getRedis().set(freeKey, '1');
    return { charged: false, wasFree: true };
  }

  // 크레딧 차감 (원자적)
  const sql = getDb();
  const result = await sql`UPDATE users SET credits = credits - ${creditCost}, updated_at = NOW()
    WHERE email = ${email} AND credits >= ${creditCost}
    RETURNING credits`;

  if (result.length === 0) {
    return { charged: false, wasFree: false, error: 'INSUFFICIENT_CREDITS', required: creditCost };
  }

  // credit_ledger 기록
  await sql`INSERT INTO credit_ledger (user_email, amount, type, reason)
    VALUES (${email}, ${-creditCost}, 'usage', ${'shortform-broll-' + targetDurationSec + 's'})`;

  return { charged: true, wasFree: false, creditCost };
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

  let chargeResult = null;
  let email = null;

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
    email = await resolveSessionEmail(token);
    if (!isAdmin && !email) {
      return res.status(401).json({error: '로그인이 필요합니다.'});
    }

    const rawBody = await readIncomingBody(req);

    // targetDurationSec 파싱 (크레딧 비용 결정용)
    let targetDurationSec = 30;
    try {
      const parsed = JSON.parse(rawBody.toString('utf8'));
      if ([30, 45, 60, 90].includes(Number(parsed.targetDurationSec))) {
        targetDurationSec = Number(parsed.targetDurationSec);
      }
    } catch (_) {}

    // 크레딧 선차감 (B-roll 생성 전)
    chargeResult = await chargeBrollCredits(email, isAdmin, targetDurationSec);
    if (chargeResult.error === 'INSUFFICIENT_CREDITS') {
      return res.status(402).json({
        error: '크레딧이 부족합니다. 충전 후 이용해주세요.',
        required: chargeResult.required,
        code: 'INSUFFICIENT_CREDITS',
      });
    }

    if (REMOTE_MEDIA_BASE_URL && REMOTE_MEDIA_SECRET) {
      const proxied = await proxyToRailway(req, rawBody);
      if (proxied.status >= 200 && proxied.status < 300) {
        await logUsage(email, 'shortform-broll', null, getClientIp(req));
      } else if (chargeResult.charged) {
        // B-roll 실패 시 크레딧 환불
        const { refundShortformCredits } = await import('./shortform-script.js');
        await refundShortformCredits(email, chargeResult.creditCost, 'shortform-broll-error-refund');
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
    // B-roll 실패 시 크레딧 환불
    if (chargeResult?.charged && email) {
      try {
        const { refundShortformCredits } = await import('./shortform-script.js');
        await refundShortformCredits(email, chargeResult.creditCost, 'shortform-broll-error-refund');
      } catch (_) {}
    }
    const normalized = normalizeBrollError(error);
    console.error('[shortform-broll] API error:', normalized.message);
    return res.status(normalized.status).json({error: normalized.message, version: BROLL_VERSION});
  }
}
