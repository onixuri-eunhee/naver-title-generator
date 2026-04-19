// app/api/card-news-callback/route.js
//
// Railway → Vercel webhook 수신. pure handler(lib/cardnews/callback-handler.js)에
// 실 Redis(@upstash/redis) + refundCredits 주입.

import { handleOptions, jsonResponse, getRedis } from '@/lib/api-helpers';
import { publishProgress, readHistoryTail } from '@/lib/job-progress';
import { refundCredits } from '@/lib/db';
import { handleCardnewsCallback } from '@/lib/cardnews/callback-handler';

export const maxDuration = 10;
export const runtime = 'nodejs';

/**
 * POST /api/card-news-callback
 *
 * Railway가 complete/error/progress 이벤트를 통지하는 webhook.
 * 인증: x-render-secret 헤더 == RENDER_SECRET.
 *
 * error 수신 시 job:meta:{jobId} 조회 → 자동 환불 + meta 삭제.
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

  const redisClient = getRedis();

  const redisAdapter = {
    readHistoryTail,
    publishProgress,
    async getJobMeta(jobId) {
      if (!jobId) return null;
      try {
        const raw = await redisClient.get(`job:meta:${jobId}`);
        if (!raw) return null;
        if (typeof raw === 'object') return raw;
        try {
          return JSON.parse(raw);
        } catch {
          return null;
        }
      } catch (err) {
        console.warn('[cardnews-callback] getJobMeta failed:', err?.message);
        return null;
      }
    },
    async deleteJobMeta(jobId) {
      if (!jobId) return;
      try {
        await redisClient.del(`job:meta:${jobId}`);
      } catch (err) {
        console.warn('[cardnews-callback] deleteJobMeta failed:', err?.message);
      }
    },
  };

  const result = await handleCardnewsCallback({
    headers,
    body,
    expectedSecret: process.env.RENDER_SECRET,
    redis: redisAdapter,
    refundFn: refundCredits,
  });

  return jsonResponse(request, result.body, { status: result.status });
}
