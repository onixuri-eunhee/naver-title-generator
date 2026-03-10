import { Receiver } from '@upstash/qstash';
import { Redis } from '@upstash/redis';
import { publishToThreads } from './threads-publish.js';

let redis;
function getRedis() {
  if (!redis) {
    redis = new Redis({
      url: process.env.KV_REST_API_URL,
      token: process.env.KV_REST_API_TOKEN,
    });
  }
  return redis;
}

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

  const { text } = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;

  if (!text) {
    return res.status(400).json({ error: 'No text provided' });
  }

  try {
    const threadId = await publishToThreads(text);

    // Update Redis record if message ID is available
    const messageId = req.headers['upstash-message-id'];
    if (messageId) {
      const key = `schedule:threads:${messageId}`;
      const existing = await getRedis().get(key);
      if (existing) {
        const data = typeof existing === 'string' ? JSON.parse(existing) : existing;
        data.status = 'published';
        data.threadId = threadId;
        data.publishedAt = new Date().toISOString();
        await getRedis().set(key, JSON.stringify(data), { ex: 86400 }); // keep for 24h
      }
    }

    return res.status(200).json({ success: true, threadId });
  } catch (err) {
    console.error('Threads Callback Publish Error:', err);
    return res.status(500).json({ error: err.message });
  }
}
