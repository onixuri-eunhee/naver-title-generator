/**
 * 숏폼 취소 시 크레딧 환불 정책.
 *
 * Step 1~6 (대본 생성 전): 100% 환불 — 아직 차감되지 않음 (차감 시점 Step 7)
 * Step 7 진입 (영상 렌더 시작): 진행률 기반 부분 환불
 *   - scene 0~30%: 100% 환불
 *   - scene 30~70%: 50% 환불
 *   - scene 70~100%: 환불 없음
 * Step 7 완료 후: 환불 없음 (결과물 이미 생성됨)
 *
 * @see docs/superpowers/plans/2026-04-14-shortform-phase-i-sse-progress.md §Task I8
 */

/**
 * 환불 크레딧 수량 계산.
 *
 * @param {object} params
 * @param {string} [params.checkpoint] - 취소 시점의 체크포인트 문자열
 * @param {number} [params.chargedCredits] - 이미 차감된 크레딧 (없으면 0 반환)
 * @param {number} [params.renderProgress] - 영상 렌더 진행률 (0~100)
 * @returns {number} 환불 크레딧 수
 */
export function calculateRefund({ checkpoint, chargedCredits, renderProgress }) {
  if (!chargedCredits) return 0;

  if (!checkpoint || checkpoint.startsWith('pre-render')) {
    return chargedCredits; // 100%
  }

  if (checkpoint.startsWith('video-render')) {
    const progress = Number(renderProgress ?? 0);
    if (progress < 30) return chargedCredits;
    if (progress < 70) return Math.floor(chargedCredits / 2);
    return 0;
  }

  return 0;
}

/**
 * 환불 사유 한국어 라벨.
 *
 * @param {string} [checkpoint]
 * @param {number} [renderProgress]
 * @returns {string}
 */
export function refundReasonLabel(checkpoint, renderProgress) {
  if (!checkpoint || checkpoint.startsWith('pre-render')) {
    return '영상 생성 전 취소 → 전액 환불';
  }
  if (checkpoint.startsWith('video-render')) {
    const progress = Number(renderProgress ?? 0);
    if (progress < 30) return '영상 렌더 초기 취소 → 전액 환불';
    if (progress < 70) return '영상 렌더 중간 취소 → 50% 환불';
    return '영상 렌더 후반 → 환불 없음';
  }
  return '환불 대상 아님';
}
