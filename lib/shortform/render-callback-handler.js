// lib/shortform/render-callback-handler.js
//
// Railway → Vercel webhook의 순수 핸들러 로직.
// Next.js Request wrapping 없이 테스트 가능한 shape.

import { timingSafeEqual } from 'node:crypto';

function secretsMatch(a, b) {
  if (!a || !b) return false;
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

function validateBody(body) {
  if (!body || typeof body !== 'object') return 'invalid body';
  if (!body.jobId || typeof body.jobId !== 'string') return 'jobId required';
  if (!['progress', 'complete', 'error'].includes(body.type)) return 'unknown type';

  if (body.type === 'complete') {
    if (typeof body.url !== 'string' || !body.url) return 'url required';
    if (typeof body.durationSec !== 'number') return 'durationSec required';
    if (typeof body.elapsedMs !== 'number') return 'elapsedMs required';
  }
  if (body.type === 'progress') {
    if (typeof body.progress !== 'number') return 'progress required';
  }
  if (body.type === 'error') {
    if (typeof body.errorCode !== 'string') return 'errorCode required';
  }
  return null;
}

export async function handleRenderCallback({
  headers,
  body,
  expectedSecret,
  redis,
}) {
  const secret = headers?.['x-render-secret'];
  if (!secretsMatch(secret, expectedSecret)) {
    return { status: 401, body: { error: 'unauthorized' } };
  }

  const err = validateBody(body);
  if (err) {
    return { status: 400, body: { error: err } };
  }

  const { jobId, type } = body;

  if (type === 'complete' || type === 'error') {
    // TODO: 히스토리 200건 캡에 근접하면 tail N개만 읽도록 최적화. 현재 스케일(~10 events/job)에선 무시 가능.
    const recent = await redis.readHistoryTail(jobId, 0);
    const alreadyTerminal = recent.some(
      (e) => e.type === 'complete' || e.type === 'error',
    );
    if (alreadyTerminal) {
      return { status: 200, body: { ok: true, skipped: 'duplicate' } };
    }
  }

  if (type === 'progress') {
    await redis.publishProgress(jobId, {
      type: 'step',
      step: 'video-render',
      status: 'running',
      progress: body.progress,
      framesRendered: body.framesRendered,
      framesTotal: body.framesTotal,
    });
  } else if (type === 'complete') {
    await redis.publishProgress(jobId, {
      type: 'complete',
      step: 'video-render',
      status: 'done',
      result: {
        url: body.url,
        durationSec: body.durationSec,
        elapsedMs: body.elapsedMs,
      },
    });
  } else {
    // error
    await redis.publishProgress(jobId, {
      type: 'error',
      step: 'video-render',
      errorCode: body.errorCode,
      errorMessage: body.errorMessage, // 로그용
      message: '렌더링에 실패했습니다.', // 사용자용
    });
  }

  return { status: 200, body: { ok: true } };
}
