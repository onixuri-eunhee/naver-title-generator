import { Client as QStashClient, Receiver } from '@upstash/qstash';
import { NextResponse } from 'next/server';
import { getRedis, resolveCallbackBaseUrl } from '@/lib/api-helpers';
import {
  publishSingleThread,
  splitMainAndReply,
  resolveThreadsCredentials,
  REPLY_DELAY_SEC,
} from '@/lib/threads';

export async function POST(request) {
  // QStash는 raw body로 서명 검증하므로 request.text()로 읽는다
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
    console.error('QStash signature verification failed:', err);
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  let parsed;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { text, email } = parsed;
  if (!text) {
    return NextResponse.json({ error: 'No text provided' }, { status: 400 });
  }

  const { mainText, replyText } = splitMainAndReply(text);
  if (!mainText) {
    return NextResponse.json({ error: 'Main text is empty' }, { status: 400 });
  }

  const credentials = await resolveThreadsCredentials({ email });
  if (!credentials) {
    if (email) {
      console.error(`Threads token not found for ${email}`);
      return NextResponse.json({ error: 'Threads 연결이 만료되었습니다.' }, { status: 400 });
    }
    return NextResponse.json({ error: 'Threads API 설정이 누락되었습니다.' }, { status: 500 });
  }

  let mainThreadId;
  try {
    mainThreadId = await publishSingleThread(mainText, credentials.userId, credentials.accessToken);
  } catch (err) {
    console.error('Threads Callback Publish Error:', err);
    return NextResponse.json({ error: 'Threads 발행 중 오류가 발생했습니다.' }, { status: 500 });
  }

  const messageId = request.headers.get('upstash-message-id');
  if (messageId) {
    const key = `schedule:threads:${messageId}`;
    const existing = await getRedis().get(key);
    if (existing) {
      const data = typeof existing === 'string' ? JSON.parse(existing) : existing;
      data.status = 'published';
      data.threadId = mainThreadId;
      data.publishedAt = new Date().toISOString();
      if (replyText) data.replyPending = true;
      await getRedis().set(key, JSON.stringify(data), { ex: 86400 });
    }
  }

  if (!replyText) {
    return NextResponse.json({ success: true, threadId: mainThreadId });
  }

  try {
    const qstash = new QStashClient({ token: process.env.QSTASH_TOKEN });
    await qstash.publishJSON({
      url: `${resolveCallbackBaseUrl()}/api/threads-publish-reply`,
      body: {
        parentThreadId: mainThreadId,
        replyText,
        email: email || null,
      },
      delay: REPLY_DELAY_SEC,
      retries: 3,
    });
    return NextResponse.json({ success: true, threadId: mainThreadId, replyPending: true });
  } catch (err) {
    console.error('[threads-callback] reply schedule failed (main already published):', err?.message);
    return NextResponse.json({ success: true, threadId: mainThreadId, replyFailed: true });
  }
}
