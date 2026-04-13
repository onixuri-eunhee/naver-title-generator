import { extractToken, resolveSessionEmail, jsonResponse, handleOptions } from '@/lib/api-helpers';
import { refundCredits } from '@/lib/db';

export const maxDuration = 10;

const SHORTFORM_CREDIT_COSTS = { 30: 7, 45: 10, 60: 14, 90: 18 };

export async function OPTIONS(request) {
  return handleOptions(request);
}

export async function POST(request) {
  const token = extractToken(request);
  const email = await resolveSessionEmail(token);
  if (!email) return jsonResponse(request, { error: '로그인이 필요합니다.' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const targetDurationSec = Number(body.targetDurationSec) || 30;
  const reason = typeof body.reason === 'string' ? body.reason.slice(0, 100) : 'shortform-broll-failure';
  const creditCost = SHORTFORM_CREDIT_COSTS[targetDurationSec] || SHORTFORM_CREDIT_COSTS[30];

  try {
    await refundCredits(email, creditCost, reason);
    return jsonResponse(request, { refunded: true, refundedCredits: creditCost });
  } catch (error) {
    console.error('[SHORTFORM-REFUND] error:', error.message);
    return jsonResponse(request, { error: '환불 처리 중 오류가 발생했습니다.', refunded: false }, { status: 500 });
  }
}
