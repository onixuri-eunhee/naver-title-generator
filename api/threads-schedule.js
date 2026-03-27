import { Client } from '@upstash/qstash';
import { Redis } from '@upstash/redis';

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

import { resolveAdmin, setCorsHeaders } from './_helpers.js';

export default async function handler(req, res) {
  setCorsHeaders(res, req);

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const isAdmin = await resolveAdmin(req);
  if (!isAdmin) {
    return res.status(403).json({ error: '관리자 인증 실패' });
  }

  const { text, publishAt } = req.body || {};

  if (!text || !text.trim()) {
    return res.status(400).json({ error: '발행할 텍스트가 없습니다.' });
  }

  if (text.length > 500) {
    return res.status(400).json({ error: '500자를 초과하는 글은 발행할 수 없습니다.' });
  }

  if (!publishAt) {
    return res.status(400).json({ error: '예약 시간을 지정해주세요.' });
  }

  const publishDate = new Date(publishAt);
  const now = new Date();
  const delaySec = Math.floor((publishDate.getTime() - now.getTime()) / 1000);

  if (delaySec < 60) {
    return res.status(400).json({ error: '예약 시간은 현재로부터 최소 1분 이후여야 합니다.' });
  }

  try {
    const qstash = new Client({ token: process.env.QSTASH_TOKEN });

    // Determine the base URL for the callback
    const baseUrl = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : 'https://ddukddaktool.co.kr';

    const result = await qstash.publishJSON({
      url: `${baseUrl}/api/threads-callback`,
      body: { text: text.trim() },
      delay: delaySec,
    });

    // Save schedule info to Redis
    const scheduleId = result.messageId;
    await getRedis().set(
      `schedule:threads:${scheduleId}`,
      JSON.stringify({
        text: text.trim(),
        publishAt,
        createdAt: now.toISOString(),
        status: 'scheduled',
      }),
      { ex: delaySec + 3600 } // TTL: delay + 1 hour buffer
    );

    return res.status(200).json({
      success: true,
      scheduleId,
      publishAt,
    });
  } catch (err) {
    console.error('Threads Schedule Error:', err);
    return res.status(500).json({ error: '예약 발행 등록 중 오류가 발생했습니다.' });
  }
}
