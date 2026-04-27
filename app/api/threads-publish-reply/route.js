import { Receiver } from '@upstash/qstash';
import { NextResponse } from 'next/server';
import { getRedis } from '@/lib/api-helpers';
import { publishSingleThread } from '@/lib/threads';

/**
 * QStash 콜백 — /api/threads-publish 와 /api/threads-callback 이 본문 발행 직후
 * 60초 지연으로 enqueue 한 답글을 실제로 발행한다.
 *
 * 메타 Threads API 가 부모 게시물 인덱싱 전에 reply_to_id 거는 걸 거부하기 때문에
 * 본문 발행 후 60초 대기 → 이 라우트에서 답글 발행하는 흐름.
 *
 * Idempotency: parentThreadId 단위로 Redis 플래그(threads:reply-sent:<id>)를 사용해
 * QStash 재시도 시에도 답글이 중복 게시되지 않도록 보호.
 */

const REPLY_SENT_TTL_SEC = 60 * 60 * 24; // 24h

export async function POST(request) {
  const rawBody = await request.text();

  try {
    const receiver = new Receiver({
      currentSigningKey: process.env.QSTASH_CURRENT_SIGNING_KEY,
      nextSigningKey: process.env.QSTASH_NEXT_SIGNING_KEY,
    });
    const signature = request.headers.get('upstash-signature');
    await receiver.verify({ signature, body: rawBody });
  } catch (err) {
    console.error('[threads-publish-reply] QStash signature verification failed:', err?.message);
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  let parsed;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { parentThreadId, replyText, email } = parsed || {};

  if (!parentThreadId || typeof parentThreadId !== 'string') {
    return NextResponse.json({ error: 'parentThreadId required' }, { status: 400 });
  }
  if (!replyText || typeof replyText !== 'string' || !replyText.trim()) {
    return NextResponse.json({ error: 'replyText required' }, { status: 400 });
  }

  // Idempotency 체크 — 같은 parentThreadId 답글이 이미 게시됐다면 스킵
  const sentKey = `threads:reply-sent:${parentThreadId}`;
  try {
    const already = await getRedis().get(sentKey);
    if (already) {
      return NextResponse.json({ ok: true, skipped: 'already-sent' });
    }
  } catch (err) {
    console.warn('[threads-publish-reply] idempotency check failed (continuing):', err?.message);
  }

  // 자격 증명 해석 (admin: 환경변수, user: Redis 토큰)
  let userId, accessToken;
  if (email) {
    try {
      const threadsData = await getRedis().get(`threads:user:${email}`);
      if (!threadsData) {
        console.error(`[threads-publish-reply] threads token not found for ${email}`);
        return NextResponse.json({ error: 'Threads connection missing' }, { status: 400 });
      }
      const data = typeof threadsData === 'string' ? JSON.parse(threadsData) : threadsData;
      userId = data.userId;
      accessToken = data.accessToken;
    } catch (err) {
      console.error('[threads-publish-reply] redis read failed:', err?.message);
      return NextResponse.json({ error: 'redis read failed' }, { status: 500 });
    }
  } else {
    userId = process.env.THREADS_USER_ID;
    accessToken = process.env.THREADS_ACCESS_TOKEN;
  }

  if (!userId || !accessToken) {
    console.error('[threads-publish-reply] missing credentials');
    return NextResponse.json({ error: 'credentials missing' }, { status: 500 });
  }

  try {
    const replyId = await publishSingleThread(replyText.trim(), userId, accessToken, parentThreadId);

    // Idempotency 마킹
    try {
      await getRedis().set(sentKey, replyId, { ex: REPLY_SENT_TTL_SEC });
    } catch (err) {
      console.warn('[threads-publish-reply] idempotency set failed (non-fatal):', err?.message);
    }

    return NextResponse.json({ success: true, parentThreadId, replyId });
  } catch (err) {
    console.error('[threads-publish-reply] publish failed:', err?.message);
    // QStash 가 retries=3 정책으로 재시도. 메타 인덱싱이 60초로 부족했다면 다음 retry 에서 풀릴 가능성.
    return NextResponse.json({ error: 'reply publish failed', details: err.message }, { status: 500 });
  }
}
