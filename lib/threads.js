/**
 * Threads API 공용 발행 모듈
 * /api/threads-publish, /api/threads-callback, /api/threads-publish-reply 에서 공유
 *
 * 2026-04-27: [답글] 발행 버그 수정 — 본문 직후 답글 시도 시 메타 인덱싱 지연으로 매번 실패.
 * 신규 호출 흐름은 본문/답글을 분리해 호출하고, 답글은 QStash 60s 지연 큐를 거친다.
 * publishToThreads(레거시 단일 호출)는 더 이상 사용 안 함 — 대신 publishSingleThread 직접 호출.
 */

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
