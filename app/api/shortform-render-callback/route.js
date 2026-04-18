import { handleOptions, jsonResponse } from '@/lib/api-helpers';
import { publishProgress, readHistoryTail } from '@/lib/job-progress';
import { handleRenderCallback } from '@/lib/shortform/render-callback-handler';

export const maxDuration = 10;
export const runtime = 'nodejs';

/**
 * POST /api/shortform-render-callback
 *
 * Railway 렌더 서버가 완료/진행률/에러를 통지하는 webhook.
 * 인증: x-render-secret 헤더 == RENDER_SECRET 환경변수.
 */
export async function OPTIONS(request) {
  return handleOptions(request);
}

export async function POST(request) {
  const headers = Object.fromEntries(request.headers);

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse(request, { error: 'invalid json' }, { status: 400 });
  }

  const result = await handleRenderCallback({
    headers,
    body,
    expectedSecret: process.env.RENDER_SECRET,
    redis: {
      readHistoryTail,
      publishProgress,
    },
  });

  return jsonResponse(request, result.body, { status: result.status });
}
