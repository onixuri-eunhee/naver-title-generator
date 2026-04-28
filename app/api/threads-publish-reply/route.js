import { Receiver } from '@upstash/qstash';
import { NextResponse } from 'next/server';
import { getRedis } from '@/lib/api-helpers';
import {
  publishSingleThread,
  resolveThreadsCredentials,
  REPLY_RESERVED_TTL_SEC,
  REPLY_SENT_TTL_SEC,
} from '@/lib/threads';

/**
 * QStash 콜백 — 본문 발행 60초 후 답글을 실제로 발행한다.
 *
 * 메타 Threads API가 부모 게시물 인덱싱 전에는 reply_to_id 거는 걸 거부해서
 * 본문/답글 발행을 분리했다.
 *
 * Idempotency: SET NX 로 슬롯을 먼저 예약한 후 발행한다. 동시 retry 가 와도
 * 두 번째는 NX 실패로 스킵 → 답글 중복 게시 차단. 발행 실패 시엔 슬롯을 풀어서
 * QStash 다음 retry가 정상 동작하게 한다.
 */

export async function POST(request) {
  const rawBody = await request.text();

  try {
    const receiver = new Receiver({
      currentSigningKey: process.env.QSTASH_CURRENT_SIGNING_KEY,
      nextSigningKey: process.env.QSTASH_NEXT_SIGNING_KEY,
    });
    await receiver.verify({
      signature: request.headers.get('upstash-signature'),
      body: rawBody,
    });
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

  const sentKey = `threads:reply-sent:${parentThreadId}`;

  // 슬롯 원자 예약. 다른 retry/요청이 이미 진행 중이거나 완료했다면 NX 실패로 스킵.
  let reserved;
  try {
    reserved = await getRedis().set(sentKey, 'pending', { nx: true, ex: REPLY_RESERVED_TTL_SEC });
  } catch (err) {
    console.warn('[threads-publish-reply] reservation set failed (continuing without idempotency):', err?.message);
  }
  if (reserved === null) {
    return NextResponse.json({ ok: true, skipped: 'already-claimed' });
  }

  const credentials = await resolveThreadsCredentials({ email });
  if (!credentials) {
    try { await getRedis().del(sentKey); } catch {}
    if (email) {
      console.error(`[threads-publish-reply] threads token not found for ${email}`);
      return NextResponse.json({ error: 'Threads connection missing' }, { status: 400 });
    }
    console.error('[threads-publish-reply] missing admin credentials');
    return NextResponse.json({ error: 'credentials missing' }, { status: 500 });
  }

  try {
    const replyId = await publishSingleThread(replyText.trim(), credentials, { replyToId: parentThreadId });
    try {
      await getRedis().set(sentKey, replyId, { ex: REPLY_SENT_TTL_SEC });
    } catch (err) {
      console.warn('[threads-publish-reply] sent-marker set failed (non-fatal):', err?.message);
    }
    return NextResponse.json({ success: true, parentThreadId, replyId });
  } catch (err) {
    console.error('[threads-publish-reply] publish failed:', err?.message);
    try { await getRedis().del(sentKey); } catch {}
    return NextResponse.json({ error: 'reply publish failed', details: err.message }, { status: 500 });
  }
}
