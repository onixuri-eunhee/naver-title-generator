import { NextResponse } from 'next/server';
import {
  extractToken,
  getClientIp,
  getRedis,
  isCreditsActive,
  resolveAdmin,
  resolveSessionEmail,
  corsHeaders,
  handleOptions,
  jsonResponse,
} from '@/lib/api-helpers';
import { logUsage, getDb, refundCredits } from '@/lib/db';
import {
  BROLL_VERSION,
  handleShortformBrollRequest,
  normalizeBrollError,
} from '../../../services/shortform-broll-core.js';

export const maxDuration = 180;

const SHORTFORM_CREDIT_COSTS = { 30: 7, 45: 10, 60: 14, 90: 18 };

const REMOTE_MEDIA_BASE_URL = (process.env.SHORTFORM_STT_SERVICE_URL || '').trim().replace(/\/+$/, '');
const REMOTE_MEDIA_SECRET = (process.env.STT_SERVICE_SHARED_SECRET || '').trim();

async function readRawBody(request) {
  const arrayBuffer = await request.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

function getQueryObject(request) {
  return Object.fromEntries(new URL(request.url).searchParams.entries());
}

function buildProxyUrl(request) {
  const url = new URL(`${REMOTE_MEDIA_BASE_URL}/api/shortform-broll`);
  const params = new URL(request.url).searchParams;
  params.forEach((value, key) => {
    if (value.trim()) url.searchParams.set(key, value.trim());
  });
  return url;
}

async function proxyToRailway(request, rawBody) {
  const headers = {
    'X-Stt-Service-Secret': REMOTE_MEDIA_SECRET,
    'Content-Type': 'application/json',
  };

  const response = await fetch(buildProxyUrl(request), {
    method: request.method,
    headers,
    body: request.method === 'GET' ? undefined : rawBody,
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
 */
async function chargeBrollCredits(email, isAdmin, targetDurationSec) {
  if (isAdmin) return { charged: false, wasFree: false };
  if (!isCreditsActive()) return { charged: false, wasFree: false };

  const creditCost = SHORTFORM_CREDIT_COSTS[targetDurationSec] || SHORTFORM_CREDIT_COSTS[30];

  const freeKey = `shortform-free:${email}`;
  const freeUsed = await getRedis().get(freeKey);

  if (!freeUsed && targetDurationSec === 30) {
    await getRedis().set(freeKey, '1');
    return { charged: false, wasFree: true };
  }

  const sql = getDb();
  const result = await sql`UPDATE users SET credits = credits - ${creditCost}, updated_at = NOW()
    WHERE email = ${email} AND credits >= ${creditCost}
    RETURNING credits`;

  if (result.length === 0) {
    return { charged: false, wasFree: false, error: 'INSUFFICIENT_CREDITS', required: creditCost };
  }

  await sql`INSERT INTO credit_ledger (user_email, amount, type, reason)
    VALUES (${email}, ${-creditCost}, 'usage', ${'shortform-broll-' + targetDurationSec + 's'})`;

  return { charged: true, wasFree: false, creditCost };
}

function proxyResponse(request, proxied) {
  return new NextResponse(proxied.text, {
    status: proxied.status,
    headers: {
      ...corsHeaders(request),
      'Content-Type': proxied.contentType,
      'X-Shortform-Broll-Version': proxied.version,
    },
  });
}

function withVersion(request, body, init = {}) {
  return jsonResponse(request, body, {
    ...init,
    headers: { 'X-Shortform-Broll-Version': BROLL_VERSION, ...(init.headers || {}) },
  });
}

export async function OPTIONS(request) {
  return handleOptions(request);
}

export async function GET(request) {
  try {
    if (REMOTE_MEDIA_BASE_URL && REMOTE_MEDIA_SECRET) {
      const proxied = await proxyToRailway(request, Buffer.alloc(0));
      return proxyResponse(request, proxied);
    }

    const localGet = await handleShortformBrollRequest({
      method: 'GET',
      rawBody: Buffer.alloc(0),
      userEmail: null,
      ip: getClientIp(request),
      query: getQueryObject(request),
    });
    return withVersion(request, localGet.body, { status: localGet.status });
  } catch (error) {
    const normalized = normalizeBrollError(error);
    console.error('[shortform-broll] API error:', normalized.message);
    return withVersion(request, { error: normalized.message, version: BROLL_VERSION }, { status: normalized.status });
  }
}

export async function POST(request) {
  let chargeResult = null;
  let email = null;

  try {
    const isAdmin = await resolveAdmin(request);
    const token = extractToken(request);
    email = await resolveSessionEmail(token);
    if (!isAdmin && !email) {
      return withVersion(request, { error: '로그인이 필요합니다.' }, { status: 401 });
    }

    const rawBody = await readRawBody(request);

    let targetDurationSec = 30;
    try {
      const parsed = JSON.parse(rawBody.toString('utf8'));
      if ([30, 45, 60, 90].includes(Number(parsed.targetDurationSec))) {
        targetDurationSec = Number(parsed.targetDurationSec);
      }
    } catch (_) {}

    chargeResult = await chargeBrollCredits(email, isAdmin, targetDurationSec);
    if (chargeResult.error === 'INSUFFICIENT_CREDITS') {
      return withVersion(request, {
        error: '크레딧이 부족합니다. 충전 후 이용해주세요.',
        required: chargeResult.required,
        code: 'INSUFFICIENT_CREDITS',
      }, { status: 402 });
    }

    if (REMOTE_MEDIA_BASE_URL && REMOTE_MEDIA_SECRET) {
      const proxied = await proxyToRailway(request, rawBody);
      if (proxied.status >= 200 && proxied.status < 300) {
        await logUsage(email, 'shortform-broll', null, getClientIp(request));
      } else if (chargeResult.charged) {
        await refundCredits(email, chargeResult.creditCost, 'shortform-broll-error-refund');
      }
      return proxyResponse(request, proxied);
    }

    const localPost = await handleShortformBrollRequest({
      method: 'POST',
      rawBody,
      userEmail: email,
      ip: getClientIp(request),
      query: getQueryObject(request),
    });

    await logUsage(email, 'shortform-broll', null, getClientIp(request));
    return withVersion(request, localPost.body, { status: localPost.status });
  } catch (error) {
    if (chargeResult?.charged && email) {
      try {
        await refundCredits(email, chargeResult.creditCost, 'shortform-broll-error-refund');
      } catch (_) {}
    }
    const normalized = normalizeBrollError(error);
    console.error('[shortform-broll] API error:', normalized.message);
    return withVersion(request, { error: normalized.message, version: BROLL_VERSION }, { status: normalized.status });
  }
}
