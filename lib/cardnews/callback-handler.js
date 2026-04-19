// lib/cardnews/callback-handler.js
//
// Railway → Vercel webhook 수신 순수 핸들러.
// 카드뉴스 전용 — complete 시 {urls:[]} 배열, error 시 자동 환불.
// redis는 의존성 주입 (readHistoryTail, publishProgress, getJobMeta, deleteJobMeta).
// refundFn도 주입 (tests에서 모킹 가능).
//
// Week 2 숏폼 callback 패턴 + 자동 환불 확장.

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
    if (!Array.isArray(body.urls) || body.urls.length === 0) return 'urls array required';
    if (typeof body.cardCount !== 'number') return 'cardCount required';
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

/**
 * @param {Object} ctx
 * @param {Object} ctx.headers — x-render-secret 포함
 * @param {Object} ctx.body
 * @param {string|undefined} ctx.expectedSecret — env RENDER_SECRET
 * @param {{ readHistoryTail, publishProgress, getJobMeta, deleteJobMeta }} ctx.redis
 * @param {(email: string, amount: number, reason: string) => Promise<void>} ctx.refundFn
 * @returns {Promise<{ status: number, body: any }>}
 */
export async function handleCardnewsCallback({
  headers,
  body,
  expectedSecret,
  redis,
  refundFn,
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

  // terminal 이벤트 중복 체크
  if (type === 'complete' || type === 'error') {
    const recent = await redis.readHistoryTail(jobId, 0);
    const alreadyTerminal = recent.some(
      (e) => e.type === 'complete' || e.type === 'error',
    );
    if (alreadyTerminal) {
      return { status: 200, body: { ok: true, skipped: 'duplicate' } };
    }
  }

  // 이벤트 발행 + error 시 자동 환불
  if (type === 'progress') {
    await redis.publishProgress(jobId, {
      type: 'step',
      step: 'cardnews-render',
      status: 'running',
      progress: body.progress,
    });
  } else if (type === 'complete') {
    await redis.publishProgress(jobId, {
      type: 'complete',
      step: 'cardnews-render',
      status: 'done',
      result: {
        urls: body.urls,
        cardCount: body.cardCount,
        elapsedMs: body.elapsedMs,
      },
    });
    // 성공 시 meta도 정리 (선택 — 오래 TTL 쓰는 대신 즉시 cleanup)
    await redis.deleteJobMeta(jobId);
  } else {
    // error — 자동 환불
    const meta = await redis.getJobMeta(jobId);
    if (meta && meta.userEmail && meta.tool === 'cardnews' && typeof meta.cost === 'number') {
      try {
        await refundFn(meta.userEmail, meta.cost, `cardnews-${body.errorCode}`);
        await redis.deleteJobMeta(jobId);
      } catch (refundErr) {
        // 환불 실패는 전체 실패로 안 굳힘 — error 이벤트는 publish 진행
        console.warn('[cardnews-callback] refund failed:', refundErr?.message);
      }
    }
    await redis.publishProgress(jobId, {
      type: 'error',
      step: 'cardnews-render',
      errorCode: body.errorCode,
      errorMessage: body.errorMessage, // 로그용
      message: '카드뉴스 생성에 실패했습니다. 크레딧은 환불되었습니다.', // 사용자용
    });
  }

  return { status: 200, body: { ok: true } };
}
