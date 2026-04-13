/**
 * Threads API 공용 발행 모듈
 * /api/threads-publish, /api/threads-callback에서 공유
 */

export async function publishToThreads(text, userId, accessToken) {
  if (!userId || !accessToken) {
    throw new Error('Threads API 설정이 완료되지 않았습니다.');
  }

  let mainText = text;
  let replyText = null;
  if (text.includes('[답글]')) {
    const parts = text.split('[답글]');
    mainText = parts[0].trim();
    replyText = parts[1] ? parts[1].trim() : null;
  }

  const mainThreadId = await publishSingleThread(mainText, userId, accessToken);

  if (replyText) {
    try {
      await publishSingleThread(replyText, userId, accessToken, mainThreadId);
    } catch (err) {
      console.error('Reply publish failed (main succeeded):', err);
      throw new Error('본문은 발행되었으나 답글 발행에 실패했습니다: ' + err.message);
    }
  }

  return mainThreadId;
}

async function publishSingleThread(text, userId, accessToken, replyToId) {
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
