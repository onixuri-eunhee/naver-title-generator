/**
 * GET /api/shortform-progress/snapshot?jobId=xxx
 *
 * 단발 스냅샷 조회용. SSE 스트림 열지 않고 현재까지의 이력만 JSON 으로 반환.
 * 클라이언트가 페이지 진입 시 stale localStorage jobId 를 판별하는 용도.
 */
import { readHistoryTail } from '@/lib/job-progress';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  const url = new URL(request.url);
  const jobId = url.searchParams.get('jobId');
  if (!jobId) {
    return Response.json({ error: 'jobId required' }, { status: 400 });
  }
  try {
    const events = await readHistoryTail(jobId, 0);
    return Response.json({ jobId, events }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (err) {
    return Response.json(
      { error: err?.message || 'snapshot read failed' },
      { status: 500 },
    );
  }
}
