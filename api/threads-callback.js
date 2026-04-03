import { Receiver } from '@upstash/qstash';
import { publishToThreads } from './threads-publish.js';
import { getRedis } from './_helpers.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Verify QStash signature
  try {
    const receiver = new Receiver({
      currentSigningKey: process.env.QSTASH_CURRENT_SIGNING_KEY,
      nextSigningKey: process.env.QSTASH_NEXT_SIGNING_KEY,
    });

    const signature = req.headers['upstash-signature'];
    const body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);

    await receiver.verify({
      signature,
      body,
    });
  } catch (err) {
    console.error('QStash signature verification failed:', err);
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const parsed = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  const { text, email } = parsed;

  if (!text) {
    return res.status(400).json({ error: 'No text provided' });
  }

  try {
    let userId, accessToken;

    if (email) {
      // 일반 회원: Redis에서 토큰 조회
      const threadsData = await getRedis().get(`threads:user:${email}`);
      if (!threadsData) {
        console.error(`Threads token not found for ${email}`);
        return res.status(400).json({ error: 'Threads 연결이 만료되었습니다.' });
      }
      const data = typeof threadsData === 'string' ? JSON.parse(threadsData) : threadsData;
      userId = data.userId;
      accessToken = data.accessToken;
    } else {
      // 관리자: 환경변수
      userId = process.env.THREADS_USER_ID;
      accessToken = process.env.THREADS_ACCESS_TOKEN;
    }

    const threadId = await publishToThreads(text, userId, accessToken);

    // Update Redis record
    const messageId = req.headers['upstash-message-id'];
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

    return res.status(200).json({ success: true, threadId });
  } catch (err) {
    console.error('Threads Callback Publish Error:', err);
    return res.status(500).json({ error: 'Threads 발행 중 오류가 발생했습니다.' });
  }
}
