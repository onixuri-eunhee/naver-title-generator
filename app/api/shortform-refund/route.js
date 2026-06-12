import { jsonResponse, handleOptions } from '@/lib/api-helpers';

export const maxDuration = 10;

// ── 폐쇄된 라우트 (2026-06-13) ──
//
// 숏폼 렌더 크레딧 차감(Step 7)이 아직 구현되지 않았고
// (shortform-script/route.js::chargeShortformCredits가 0 차감 no-op),
// 이 라우트를 호출하는 클라이언트 코드도 없다.
// 차감 없이 환불만 가능한 상태라 악용 시 무료 크레딧 적립 구멍이 됨 →
// Step 7 차감 구현 전까지 410 Gone으로 폐쇄.
//
// 정상 환불 경로는 /api/shortform-cancel (서버에 기록된 chargedCredits 기준,
// lib/shortform-refund.js::calculateRefund)를 사용한다.

export async function OPTIONS(request) {
  return handleOptions(request);
}

export async function POST(request) {
  console.warn('[SHORTFORM-REFUND] closed route called');
  return jsonResponse(
    request,
    { error: '이 환불 경로는 더 이상 사용되지 않습니다.', refunded: false },
    { status: 410 },
  );
}
