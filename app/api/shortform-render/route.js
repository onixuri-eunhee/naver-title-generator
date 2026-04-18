import {
  extractToken,
  resolveSessionEmail,
  jsonResponse,
  handleOptions,
} from '@/lib/api-helpers';
import { publishProgress, createJobId } from '@/lib/job-progress';

export const maxDuration = 300;

/**
 * POST /api/shortform-render
 *
 * Vercel → Railway Remotion 렌더 서버 프록시.
 * Railway 서버가 렌더링 완료 후 R2에 업로드한 CDN URL을 반환한다.
 *
 * Body: { jobId, inputProps }
 * Headers: Authorization: Bearer <token>
 *
 * 환경변수:
 *   RAILWAY_RENDER_URL — Railway 렌더 서버 베이스 URL (예: https://remotion-render.up.railway.app)
 *   RENDER_SECRET — Railway 서버 인증용 시크릿
 */
export async function POST(request) {
  // CORS preflight
  if (request.method === 'OPTIONS') return handleOptions();

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

  const { jobId: clientJobId, inputProps } = body;
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

  // 4. 진행률 업데이트: 렌더링 시작
  await publishProgress(jobId, {
    type: 'step',
    step: 'video-render',
    status: 'busy',
    message: '영상 렌더링 시작...',
  });

  try {
    // 5. Railway 렌더 서버 호출
    const startTime = Date.now();
    const renderRes = await fetch(`${railwayUrl}/render`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(renderSecret ? { 'x-render-secret': renderSecret } : {}),
      },
      body: JSON.stringify({
        jobId,
        userId: email,
        inputProps,
        // Phase 2 (2026-04-18): Railway 렌더 서버가 outputFilename 필수 요구.
        // jobId 기반 고유 파일명으로 R2 업로드 충돌 방지.
        outputFilename: `shortform-${jobId}.mp4`,
      }),
    });

    if (!renderRes.ok) {
      const errText = await renderRes.text().catch(() => 'unknown');
      console.error(`[shortform-render] Railway 응답 에러: ${renderRes.status} ${errText}`);

      await publishProgress(jobId, {
        type: 'error',
        step: 'video-render',
        message: '렌더링 실패',
      });

      return jsonResponse(
        request,
        { error: '렌더링에 실패했습니다. 잠시 후 다시 시도해주세요.' },
        { status: 502 },
      );
    }

    const result = await renderRes.json();
    const durationMs = Date.now() - startTime;

    // 6. 진행률 업데이트: 완료
    await publishProgress(jobId, {
      type: 'complete',
      step: 'video-render',
      status: 'done',
      message: '렌더링 완료',
    });

    // Railway 서버가 { url: 'https://cdn.ddukddaktool.co.kr/...' } 형태로 반환
    return jsonResponse(request, {
      url: result.url,
      duration: Math.round(durationMs / 1000),
      jobId,
    });
  } catch (err) {
    console.error('[shortform-render] 렌더 호출 실패:', err?.message);

    await publishProgress(jobId, {
      type: 'error',
      step: 'video-render',
      message: '렌더링 실패',
    });

    return jsonResponse(
      request,
      { error: '렌더 서버에 연결할 수 없습니다.' },
      { status: 502 },
    );
  }
}
