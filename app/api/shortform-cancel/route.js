/**
 * POST /api/shortform-cancel?jobId=xxx
 *
 * 사용자가 "취소" 버튼을 눌렀을 때 호출.
 * 1. 로그인 검증
 * 2. job:cancel:{jobId} Redis 플래그 설정
 * 3. SSE 구독자에게 cancelled 이벤트 즉시 발행 (파이프라인은 다음 checkpoint에서 실제 throw)
 * 4. 환불 정책(lib/shortform-refund.js) 적용 — 실제 DB 환불은 Phase L에서 연결
 */
import {
  extractToken,
  resolveSessionEmail,
  resolveAdmin,
  jsonResponse,
  handleOptions,
} from '@/lib/api-helpers';
import { requestCancel, publishProgress } from '@/lib/job-progress';
import { calculateRefund, refundReasonLabel } from '@/lib/shortform-refund';

export const runtime = 'nodejs';

export async function OPTIONS(request) {
  return handleOptions(request);
}

export async function POST(request) {
  const isAdmin = await resolveAdmin(request);
  const token = extractToken(request);
  const email = await resolveSessionEmail(token);
  if (!isAdmin && !email) {
    return jsonResponse(request, { error: '로그인이 필요합니다.' }, { status: 401 });
  }

  const url = new URL(request.url);
  const jobId = url.searchParams.get('jobId');
  if (!jobId) {
    return jsonResponse(request, { error: 'jobId required' }, { status: 400 });
  }

  const body = await request.json().catch(() => ({}));

  const ok = await requestCancel(jobId);

  // 즉시 cancelled 이벤트 발행 (클라이언트가 바로 반응할 수 있게)
  await publishProgress(jobId, {
    type: 'cancelled',
    cancelledAt: body?.checkpoint || 'user-request',
    note: '사용자 취소 요청 수신',
  });

  // 환불 계산 (실제 DB 반영은 Phase L에서 통합)
  const refund = calculateRefund({
    checkpoint: body?.checkpoint,
    chargedCredits: body?.chargedCredits,
    renderProgress: body?.renderProgress,
  });

  return jsonResponse(request, {
    success: ok,
    refundCredits: refund,
    reason: refundReasonLabel(body?.checkpoint, body?.renderProgress),
  });
}
