import { Client as QStashClient } from '@upstash/qstash';
import {
  getRedis,
  resolveAdmin,
  extractToken,
  resolveSessionEmail,
  jsonResponse,
  handleOptions,
} from '@/lib/api-helpers';
import { publishSingleThread } from '@/lib/threads';

const REPLY_DELAY_SEC = 60;

export async function OPTIONS(request) {
  return handleOptions(request);
}

function splitMainAndReply(text) {
  if (text.includes('[답글]')) {
    const parts = text.split('[답글]');
    return { mainText: parts[0].trim(), replyText: (parts[1] || '').trim() || null };
  }
  return { mainText: text.trim(), replyText: null };
}

function resolveBaseUrl() {
  // 2026-04-28: VERCEL_URL은 deployment-specific URL을 가리키는데, 이 URL은
  // Vercel deployment protection 때문에 auth wall에 막혀 QStash 콜백이 401을 받음.
  // 항상 production 도메인을 사용해야 QStash → 콜백 흐름이 정상 동작함.
  return process.env.NEXT_PUBLIC_SITE_URL || 'https://ddukddaktool.co.kr';
}

async function scheduleReply({ parentThreadId, replyText, email, isAdmin }) {
  const qstash = new QStashClient({ token: process.env.QSTASH_TOKEN });
  const baseUrl = resolveBaseUrl();
  return qstash.publishJSON({
    url: `${baseUrl}/api/threads-publish-reply`,
    body: {
      parentThreadId,
      replyText,
      email: isAdmin ? null : email,
    },
    delay: REPLY_DELAY_SEC,
    retries: 3,
  });
}

export async function POST(request) {
  const body = await request.json().catch(() => ({}));
  const { text } = body;

  if (!text || !text.trim()) {
    return jsonResponse(request, { error: '발행할 텍스트가 없습니다.' }, { status: 400 });
  }

  const { mainText, replyText } = splitMainAndReply(text);
  if (!mainText) {
    return jsonResponse(request, { error: '본문이 비어있습니다.' }, { status: 400 });
  }
  if (mainText.length > 500) {
    return jsonResponse(request, { error: '500자를 초과하는 본문은 발행할 수 없습니다.' }, { status: 400 });
  }
  if (replyText && replyText.length > 500) {
    return jsonResponse(request, { error: '500자를 초과하는 답글은 발행할 수 없습니다.' }, { status: 400 });
  }

  // 인증/토큰 해석
  const isAdmin = await resolveAdmin(request);
  let userId, accessToken, email = null;

  if (isAdmin && process.env.THREADS_USER_ID && process.env.THREADS_ACCESS_TOKEN) {
    userId = process.env.THREADS_USER_ID;
    accessToken = process.env.THREADS_ACCESS_TOKEN;
  } else {
    const token = extractToken(request);
    email = await resolveSessionEmail(token);
    if (!email) {
      return jsonResponse(request, { error: '로그인이 필요합니다.' }, { status: 401 });
    }
    const threadsData = await getRedis().get(`threads:user:${email}`);
    if (!threadsData) {
      return jsonResponse(request, { error: 'Threads 계정을 먼저 연결해주세요. 마이페이지에서 연결할 수 있습니다.' }, { status: 403 });
    }
    const parsed = typeof threadsData === 'string' ? JSON.parse(threadsData) : threadsData;
    userId = parsed.userId;
    accessToken = parsed.accessToken;
  }

  // 1단계: 본문 발행
  let mainThreadId;
  try {
    mainThreadId = await publishSingleThread(mainText, userId, accessToken);
  } catch (err) {
    console.error('Threads main publish error:', err);
    if (err.message && err.message.includes('Invalid OAuth') && email) {
      await getRedis().del(`threads:user:${email}`);
      return jsonResponse(request, { error: 'Threads 연결이 만료되었습니다. 마이페이지에서 다시 연결해주세요.' }, { status: 401 });
    }
    return jsonResponse(request, { error: 'Threads 발행 중 오류가 발생했습니다.' }, { status: 500 });
  }

  // 답글이 없으면 여기서 끝
  if (!replyText) {
    return jsonResponse(request, { success: true, threadId: mainThreadId });
  }

  // 2단계: 답글은 60초 지연 큐에 등록 (메타 인덱싱 대기)
  try {
    await scheduleReply({ parentThreadId: mainThreadId, replyText, email, isAdmin });
    return jsonResponse(request, {
      success: true,
      threadId: mainThreadId,
      replyPending: true,
      replyDelaySec: REPLY_DELAY_SEC,
    });
  } catch (err) {
    console.error('Threads reply schedule error:', err);
    // 본문은 이미 발행됨 — 답글 예약 실패만 사용자에게 알림
    return jsonResponse(request, {
      success: true,
      threadId: mainThreadId,
      replyFailed: true,
      replyError: '답글 자동 등록에 실패했어요. 잠시 후 직접 답글을 달아주세요.',
    });
  }
}
