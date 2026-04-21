import {
  extractToken,
  resolveSessionEmail,
  jsonResponse,
  handleOptions,
  getRedis,
  isCreditsActive,
} from '@/lib/api-helpers';
import { refundCredits } from '@/lib/db';

export const maxDuration = 10;

const SHORTFORM_CREDIT_COSTS = { 30: 7, 45: 10, 60: 14, 90: 18 };
const VALID_DURATIONS = new Set([30, 45, 60, 90]);
const REFUND_HOURLY_LIMIT = 3;

export async function OPTIONS(request) {
  return handleOptions(request);
}

export async function POST(request) {
  const token = extractToken(request);
  const email = await resolveSessionEmail(token);
  if (!email) return jsonResponse(request, { error: '로그인이 필요합니다.' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const targetDurationSec = Number(body.targetDurationSec);
  const reason = typeof body.reason === 'string' ? body.reason.slice(0, 100) : 'shortform-broll-failure';

  if (!VALID_DURATIONS.has(targetDurationSec)) {
    return jsonResponse(
      request,
      { error: '유효하지 않은 영상 길이입니다.' },
      { status: 400 },
    );
  }

  // 크레딧 시스템 활성화(4/25) 전에는 실환불 no-op. 클라이언트는 200만 받고 UI 정상 동작.
  if (!isCreditsActive()) {
    console.warn('[SHORTFORM-REFUND] pre-launch no-op', { email, targetDurationSec, reason });
    return jsonResponse(request, {
      refunded: false,
      refundedCredits: 0,
      reason: 'credits-system-inactive',
    });
  }

  // 간이 rate limit — 유저당 시간당 3회 (H2 임시 방어, idempotent 전환 시 제거)
  try {
    const rateKey = `ratelimit:refund:shortform:${email}`;
    const count = await getRedis().incr(rateKey);
    if (count === 1) await getRedis().expire(rateKey, 3600);
    if (count > REFUND_HOURLY_LIMIT) {
      console.warn('[SHORTFORM-REFUND] rate limited', { email, count });
      return jsonResponse(
        request,
        { error: '환불 요청 한도를 초과했습니다. 잠시 후 다시 시도해주세요.' },
        { status: 429 },
      );
    }
  } catch (err) {
    // Redis 장애 시 fail-closed — 환불 거부
    console.error('[SHORTFORM-REFUND] rate limit check failed (fail-closed):', err.message);
    return jsonResponse(
      request,
      { error: '환불 처리 중 일시적 오류가 발생했습니다.' },
      { status: 503 },
    );
  }

  const creditCost = SHORTFORM_CREDIT_COSTS[targetDurationSec];

  try {
    await refundCredits(email, creditCost, reason);
    console.log('[SHORTFORM-REFUND] refunded', { email, creditCost, reason });
    return jsonResponse(request, { refunded: true, refundedCredits: creditCost });
  } catch (error) {
    console.error('[SHORTFORM-REFUND] error:', error.message);
    return jsonResponse(
      request,
      { error: '환불 처리 중 오류가 발생했습니다.', refunded: false },
      { status: 500 },
    );
  }
}
