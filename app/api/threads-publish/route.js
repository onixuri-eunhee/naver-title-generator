import { Client as QStashClient } from '@upstash/qstash';
import {
  getRedis,
  resolveAdmin,
  extractToken,
  resolveSessionEmail,
  resolveCallbackBaseUrl,
  jsonResponse,
  handleOptions,
} from '@/lib/api-helpers';
import {
  publishSingleThread,
  splitMainAndReply,
  resolveThreadsCredentials,
  REPLY_DELAY_SEC,
} from '@/lib/threads';

export async function OPTIONS(request) {
  return handleOptions(request);
}

async function scheduleReply({ parentThreadId, replyText, email, isAdmin }) {
  const qstash = new QStashClient({ token: process.env.QSTASH_TOKEN });
  return qstash.publishJSON({
    url: `${resolveCallbackBaseUrl()}/api/threads-publish-reply`,
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

  const isAdmin = await resolveAdmin(request);
  let email = null;

  if (!isAdmin) {
    const token = extractToken(request);
    email = await resolveSessionEmail(token);
    if (!email) {
      return jsonResponse(request, { error: '로그인이 필요합니다.' }, { status: 401 });
    }
  }

  const credentials = await resolveThreadsCredentials({ email });
  if (!credentials) {
    if (email) {
      return jsonResponse(request, { error: 'Threads 계정을 먼저 연결해주세요. 마이페이지에서 연결할 수 있습니다.' }, { status: 403 });
    }
    return jsonResponse(request, { error: 'Threads API 설정이 누락되었습니다.' }, { status: 500 });
  }

  let mainThreadId;
  try {
    mainThreadId = await publishSingleThread(mainText, credentials.userId, credentials.accessToken);
  } catch (err) {
    console.error('Threads main publish error:', err);
    if (err.message && err.message.includes('Invalid OAuth') && email) {
      await getRedis().del(`threads:user:${email}`);
      return jsonResponse(request, { error: 'Threads 연결이 만료되었습니다. 마이페이지에서 다시 연결해주세요.' }, { status: 401 });
    }
    return jsonResponse(request, { error: 'Threads 발행 중 오류가 발생했습니다.' }, { status: 500 });
  }

  if (!replyText) {
    return jsonResponse(request, { success: true, threadId: mainThreadId });
  }

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
    return jsonResponse(request, {
      success: true,
      threadId: mainThreadId,
      replyFailed: true,
      replyError: '답글 자동 등록에 실패했어요. 잠시 후 직접 답글을 달아주세요.',
    });
  }
}
