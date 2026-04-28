/**
 * Threads API 공용 발행 모듈
 *
 * 메타 Threads API는 부모 게시물 인덱싱이 끝나기 전(보통 60초)에 reply_to_id로
 * 답글을 거는 걸 거부한다. 그래서 본문/답글을 분리해 호출하고, 답글은 QStash
 * 지연 큐(REPLY_DELAY_SEC) 통해 별도로 발행한다.
 */

import { getRedis } from '@/lib/api-helpers';

export const REPLY_SEPARATOR = '[답글]';
export const REPLY_DELAY_SEC = 60;

export function splitMainAndReply(text) {
  if (!text) return { mainText: '', replyText: null };
  if (text.includes(REPLY_SEPARATOR)) {
    const [head, ...tail] = text.split(REPLY_SEPARATOR);
    return { mainText: head.trim(), replyText: tail.join(REPLY_SEPARATOR).trim() || null };
  }
  return { mainText: text.trim(), replyText: null };
}

// admin 은 환경변수, 일반 회원은 Redis에 저장된 OAuth 토큰을 사용.
// email 이 null/undefined 면 admin 흐름 (env 기반).
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

export async function publishSingleThread(text, userId, accessToken, replyToId) {
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
    }
  );

  const createData = await createRes.json();

  if (!createRes.ok || createData.error) {
    throw new Error(createData.error?.message || 'Media container 생성 실패');
  }

  const containerId = createData.id;

  const publishRes = await fetch(
    `https://graph.threads.net/v1.0/${userId}/threads_publish`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        creation_id: containerId,
        access_token: accessToken,
      }),
    }
  );

  const publishData = await publishRes.json();

  if (!publishRes.ok || publishData.error) {
    throw new Error(publishData.error?.message || 'Threads 발행 실패');
  }

  return publishData.id;
}
