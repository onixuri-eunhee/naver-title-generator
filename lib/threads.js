/**
 * Threads API 공용 발행 모듈
 *
 * 메타 Threads API는 부모 게시물 인덱싱이 끝나기 전(보통 60초)에 reply_to_id로
 * 답글을 거는 걸 거부한다. 그래서 본문/답글을 분리해 호출하고, 답글은 QStash
 * 지연 큐(REPLY_DELAY_SEC) 통해 별도로 발행한다.
 */

import { Client as QStashClient } from '@upstash/qstash';
import { getRedis, resolveCallbackBaseUrl } from '@/lib/api-helpers';

export const REPLY_SEPARATOR = '[답글]';
export const REPLY_DELAY_SEC = 60;
export const REPLY_RESERVED_TTL_SEC = 10 * 60;
export const REPLY_SENT_TTL_SEC = 60 * 60 * 24;
export const MAX_THREAD_LENGTH = 500;

export function splitMainAndReply(text) {
  if (!text) return { mainText: '', replyText: null };
  if (text.includes(REPLY_SEPARATOR)) {
    const [head, ...tail] = text.split(REPLY_SEPARATOR);
    return { mainText: head.trim(), replyText: tail.join(REPLY_SEPARATOR).trim() || null };
  }
  return { mainText: text.trim(), replyText: null };
}

export function validateThreadCounts(mainText, replyText) {
  if (mainText && mainText.length > MAX_THREAD_LENGTH) {
    return { ok: false, error: `${MAX_THREAD_LENGTH}자를 초과하는 본문은 발행할 수 없습니다.` };
  }
  if (replyText && replyText.length > MAX_THREAD_LENGTH) {
    return { ok: false, error: `${MAX_THREAD_LENGTH}자를 초과하는 답글은 발행할 수 없습니다.` };
  }
  return { ok: true };
}

// email=null → admin 흐름 (환경변수 토큰), email 값 있음 → 회원 OAuth 토큰
export async function resolveThreadsCredentials({ email } = {}) {
  if (email) {
    const raw = await getRedis().get(`threads:user:${email}`);
    if (!raw) return null;
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!parsed?.userId || !parsed?.accessToken) return null;
    return { userId: parsed.userId, accessToken: parsed.accessToken };
  }
  const userId = process.env.THREADS_USER_ID;
  const accessToken = process.env.THREADS_ACCESS_TOKEN;
  if (!userId || !accessToken) return null;
  return { userId, accessToken };
}

// 본문 발행 후 답글을 60초 지연 큐에 등록한다. email=null 이면 admin 흐름으로 처리됨.
export async function enqueueReplyJob({ parentThreadId, replyText, email }) {
  const qstash = new QStashClient({ token: process.env.QSTASH_TOKEN });
  return qstash.publishJSON({
    url: `${resolveCallbackBaseUrl()}/api/threads-publish-reply`,
    body: { parentThreadId, replyText, email: email || null },
    delay: REPLY_DELAY_SEC,
    retries: 3,
  });
}

export async function publishSingleThread(text, credentials, { replyToId } = {}) {
  const { userId, accessToken } = credentials;

  const createBody = {
    media_type: 'TEXT',
    text,
    access_token: accessToken,
  };
  if (replyToId) {
    createBody.reply_to_id = replyToId;
  }

  const createRes = await fetch(
    `https://graph.threads.net/v1.0/${userId}/threads`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(createBody),
    },
  );
  const createData = await createRes.json();
  if (!createRes.ok || createData.error) {
    throw new Error(createData.error?.message || 'Media container 생성 실패');
  }

  const publishRes = await fetch(
    `https://graph.threads.net/v1.0/${userId}/threads_publish`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        creation_id: createData.id,
        access_token: accessToken,
      }),
    },
  );
  const publishData = await publishRes.json();
  if (!publishRes.ok || publishData.error) {
    throw new Error(publishData.error?.message || 'Threads 발행 실패');
  }
  return publishData.id;
}
