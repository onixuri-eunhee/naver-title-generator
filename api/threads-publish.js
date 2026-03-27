import { resolveAdmin, setCorsHeaders } from './_helpers.js';

export default async function handler(req, res) {
  setCorsHeaders(res, req);

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const isAdmin = await resolveAdmin(req);
  if (!isAdmin) {
    return res.status(403).json({ error: '관리자 인증 실패' });
  }

  const { text } = req.body || {};

  if (!text || !text.trim()) {
    return res.status(400).json({ error: '발행할 텍스트가 없습니다.' });
  }

  if (text.length > 500) {
    return res.status(400).json({ error: '500자를 초과하는 글은 발행할 수 없습니다.' });
  }

  try {
    const threadId = await publishToThreads(text.trim());
    return res.status(200).json({ success: true, threadId });
  } catch (err) {
    console.error('Threads Publish Error:', err);
    return res.status(500).json({ error: 'Threads 발행 중 오류가 발생했습니다.' });
  }
}

export async function publishToThreads(text) {
  const userId = process.env.THREADS_USER_ID;
  const accessToken = process.env.THREADS_ACCESS_TOKEN;

  if (!userId || !accessToken) {
    throw new Error('Threads API 설정이 완료되지 않았습니다.');
  }

  // Step 1: Create media container
  const createRes = await fetch(
    `https://graph.threads.net/v1.0/${userId}/threads`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        media_type: 'TEXT',
        text,
        access_token: accessToken,
      }),
    }
  );

  const createData = await createRes.json();

  if (!createRes.ok || createData.error) {
    throw new Error(createData.error?.message || 'Media container 생성 실패');
  }

  const containerId = createData.id;

  // Step 2: Publish the container
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
