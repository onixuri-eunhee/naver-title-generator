import { Client as QStashClient, Receiver } from '@upstash/qstash';
import { NextResponse } from 'next/server';
import { getRedis } from '@/lib/api-helpers';
import { publishSingleThread } from '@/lib/threads';

const REPLY_DELAY_SEC = 60;

function splitMainAndReply(text) {
  if (text.includes('[답글]')) {
    const parts = text.split('[답글]');
    return { mainText: parts[0].trim(), replyText: (parts[1] || '').trim() || null };
  }
  return { mainText: text.trim(), replyText: null };
}

function resolveBaseUrl() {
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return 'https://ddukddaktool.co.kr';
}

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

  const { mainText, replyText } = splitMainAndReply(text);
  if (!mainText) {
    return NextResponse.json({ error: 'Main text is empty' }, { status: 400 });
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

    // 1단계: 본문 발행
    const mainThreadId = await publishSingleThread(mainText, userId, accessToken);

    // schedule 메타 데이터 업데이트
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

    // 2단계: 답글이 있으면 60초 지연 큐에 등록 (메타 인덱싱 대기)
    if (replyText) {
      try {
        const qstash = new QStashClient({ token: process.env.QSTASH_TOKEN });
        await qstash.publishJSON({
          url: `${resolveBaseUrl()}/api/threads-publish-reply`,
          body: {
            parentThreadId: mainThreadId,
            replyText,
            email: email || null,
          },
          delay: REPLY_DELAY_SEC,
          retries: 3,
        });
      } catch (err) {
        console.error('[threads-callback] reply schedule failed (main already published):', err?.message);
        // 본문은 이미 게시됨 — 답글 예약 실패는 로그만 남기고 200 반환
        return NextResponse.json({ success: true, threadId: mainThreadId, replyFailed: true });
      }
      return NextResponse.json({ success: true, threadId: mainThreadId, replyPending: true });
    }

    return NextResponse.json({ success: true, threadId: mainThreadId });
  } catch (err) {
    console.error('Threads Callback Publish Error:', err);
    return NextResponse.json({ error: 'Threads 발행 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
