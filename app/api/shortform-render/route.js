import {
  extractToken,
  resolveSessionEmail,
  jsonResponse,
  handleOptions,
} from '@/lib/api-helpers';
import { publishProgress, createJobId } from '@/lib/job-progress';

export const maxDuration = 30;

/**
 * POST /api/shortform-render
 *
 * Railway 렌더 서버에 fire-and-forget dispatch 후 즉시 202 반환.
 * 실제 렌더 결과는 Railway가 /api/shortform-render-callback 에 보고하고
 * 클라는 /api/shortform-progress SSE로 수신.
 *
 * Body: { jobId, parentJobId?, inputProps }
 * Headers: Authorization: Bearer <token>
 *
 * Response: 202 { jobId, accepted: true }
 *
 * 환경변수:
 *   RAILWAY_RENDER_URL — Railway 렌더 서버 베이스 URL
 *   RENDER_SECRET — Railway 서버 인증용 시크릿
 */
export async function OPTIONS(request) {
  return handleOptions(request);
}

export async function POST(request) {
  // 1. 인증
  const token = extractToken(request);
  const email = await resolveSessionEmail(token);
  if (!email) {
    return jsonResponse(request, { error: '로그인이 필요합니다.' }, { status: 401 });
  }

  // 2. Body 파싱
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse(request, { error: '잘못된 요청입니다.' }, { status: 400 });
  }

  const { jobId: clientJobId, parentJobId, inputProps } = body;
  if (!inputProps || typeof inputProps !== 'object') {
    return jsonResponse(request, { error: 'inputProps가 필요합니다.' }, { status: 400 });
  }

  const jobId = clientJobId || createJobId();

  // 3. 환경변수 확인
  const railwayUrl = process.env.RAILWAY_RENDER_URL;
  const renderSecret = process.env.RENDER_SECRET;

  if (!railwayUrl) {
    console.error('[shortform-render] RAILWAY_RENDER_URL 미설정');
    return jsonResponse(request, { error: '렌더 서버가 아직 준비되지 않았습니다.' }, { status: 503 });
  }

  if (!renderSecret) {
    console.error('[shortform-render] RENDER_SECRET 미설정 — webhook callback 인증 불가');
    return jsonResponse(request, { error: '렌더 서버가 아직 준비되지 않았습니다.' }, { status: 503 });
  }

  // 4. 진행률: 렌더링 시작
  await publishProgress(jobId, {
    type: 'step',
    step: 'video-render',
    status: 'running',
    message: '영상 렌더링 시작...',
    progress: 0,
  });

  // 5. Railway dispatch (202 확인만, 완료는 기다리지 않음)
  try {
    const dispatchRes = await fetch(`${railwayUrl}/render`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-render-secret': renderSecret,
      },
      body: JSON.stringify({
        jobId,
        parentJobId: parentJobId ?? null,
        userId: email,
        inputProps,
        outputFilename: `shortform-${jobId}`,
      }),
    });

    if (dispatchRes.status !== 202) {
      const errText = await dispatchRes.text().catch(() => 'unknown');
      console.error(
        `[shortform-render] Railway dispatch 실패: ${dispatchRes.status} ${errText}`,
      );
      await publishProgress(jobId, {
        type: 'error',
        step: 'video-render',
        errorCode: 'DISPATCH_FAILED',
        message: '렌더 서버에 작업을 전달하지 못했습니다.',
      });
      return jsonResponse(
        request,
        { error: '렌더 서버가 작업을 받지 못했습니다. 잠시 후 다시 시도해주세요.' },
        { status: 502 },
      );
    }

    // 6. 202: Railway가 작업을 받음 → 클라에 즉시 응답
    return jsonResponse(request, { jobId, accepted: true }, { status: 202 });
  } catch (err) {
    console.error('[shortform-render] Railway 호출 실패:', err?.message);
    await publishProgress(jobId, {
      type: 'error',
      step: 'video-render',
      errorCode: 'DISPATCH_NETWORK_ERROR',
      message: '렌더 서버에 연결할 수 없습니다.',
    });
    return jsonResponse(
      request,
      { error: '렌더 서버에 연결할 수 없습니다.' },
      { status: 502 },
    );
  }
}
