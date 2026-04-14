/**
 * GET /api/shortform-progress?jobId=xxx
 *
 * Server-Sent Events 로 진행 상태를 push.
 *
 * 구조:
 * 1. 연결 직후: 히스토리(replay) 플러시
 * 2. 이후: 800ms short-polling 으로 job:history:{jobId} tail 읽기
 *    (Upstash Redis REST는 SUBSCRIBE 미지원)
 * 3. 15초마다 heartbeat comment 로 프록시 timeout 회피
 * 4. complete/error/cancelled 이벤트 수신 시 스트림 종료
 * 5. 클라이언트가 연결을 끊으면(request.signal) 즉시 정리
 */
import { readHistoryTail } from '@/lib/job-progress';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  const url = new URL(request.url);
  const jobId = url.searchParams.get('jobId');

  if (!jobId) {
    return new Response('jobId required', { status: 400 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      let poller = null;
      let heartbeat = null;

      const cleanup = () => {
        if (closed) return;
        closed = true;
        if (poller) clearInterval(poller);
        if (heartbeat) clearInterval(heartbeat);
        try {
          controller.close();
        } catch {}
      };

      const send = (event, data) => {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
          );
        } catch {
          cleanup();
        }
      };

      // 0. heartbeat (프록시 timeout 방지)
      heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`: heartbeat ${Date.now()}\n\n`));
        } catch {
          cleanup();
        }
      }, 15000);

      // 1. 초기 replay + polling 커서 설정
      let cursor = 0;
      try {
        const history = await readHistoryTail(jobId, 0);
        cursor = history.length;
        for (const item of history) {
          const type = item.type || 'step';
          send(type, item);
          if (type === 'complete' || type === 'error' || type === 'cancelled') {
            cleanup();
            return;
          }
        }
      } catch (err) {
        console.error('[sse] replay 실패:', err?.message);
      }

      // 2. short-polling (800ms)
      poller = setInterval(async () => {
        if (closed) return;
        try {
          const items = await readHistoryTail(jobId, cursor);
          if (items && items.length > 0) {
            for (const parsed of items) {
              const type = parsed.type || 'step';
              send(type, parsed);
              if (type === 'complete' || type === 'error' || type === 'cancelled') {
                cleanup();
                return;
              }
            }
            cursor += items.length;
          }
        } catch (err) {
          console.error('[sse] poll 실패:', err?.message);
        }
      }, 800);

      // 3. 클라이언트 연결 종료 감지
      if (request.signal) {
        if (request.signal.aborted) {
          cleanup();
        } else {
          request.signal.addEventListener('abort', cleanup);
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
