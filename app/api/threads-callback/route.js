import { Receiver } from '@upstash/qstash';
import { NextResponse } from 'next/server';
import { getRedis } from '@/lib/api-helpers';
import { publishToThreads } from '@/lib/threads';

export async function POST(request) {
  // QStash는 raw body로 서명 검증하므로 request.text()로 읽는다
  const rawBody = await request.text();

  try {
    const receiver = new Receiver({
      currentSigningKey: process.env.QSTASH_CURRENT_SIGNING_KEY,
      nextSigningKey: process.env.QSTASH_NEXT_SIGNING_KEY,
    });

    const signature = request.headers.get('upstash-signature');

    await receiver.verify({
      signature,
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

  try {
    let userId, accessToken;

    if (email) {
      const threadsData = await getRedis().get(`threads:user:${email}`);
      if (!threadsData) {
        console.error(`Threads token not found for ${email}`);
        return NextResponse.json({ error: 'Threads 연결이 만료되었습니다.' }, { status: 400 });
      }
      const data = typeof threadsData === 'string' ? JSON.parse(threadsData) : threadsData;
      userId = data.userId;
      accessToken = data.accessToken;
    } else {
      userId = process.env.THREADS_USER_ID;
      accessToken = process.env.THREADS_ACCESS_TOKEN;
    }

    const threadId = await publishToThreads(text, userId, accessToken);

    const messageId = request.headers.get('upstash-message-id');
    if (messageId) {
      const key = `schedule:threads:${messageId}`;
      const existing = await getRedis().get(key);
      if (existing) {
        const data = typeof existing === 'string' ? JSON.parse(existing) : existing;
        data.status = 'published';
        data.threadId = threadId;
        data.publishedAt = new Date().toISOString();
        await getRedis().set(key, JSON.stringify(data), { ex: 86400 });
      }
    }

    return NextResponse.json({ success: true, threadId });
  } catch (err) {
    console.error('Threads Callback Publish Error:', err);
    return NextResponse.json({ error: 'Threads 발행 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
