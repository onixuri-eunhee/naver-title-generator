import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

const DAILY_LIMIT = 5;

function getClientIp(req) {
  return (
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.headers['x-real-ip'] ||
    req.socket?.remoteAddress ||
    'unknown'
  );
}

function getTodayKey(ip) {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  return `ratelimit:${ip}:${today}`;
}

export default async function handler(req, res) {
  // CORS 헤더
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // IP 기반 rate limit 체크
    const ip = getClientIp(req);
    const key = getTodayKey(ip);
    const count = (await redis.get(key)) || 0;

    if (count >= DAILY_LIMIT) {
      return res.status(429).json({
        error: `일일 사용 한도(${DAILY_LIMIT}회)를 초과했습니다. 내일 다시 이용해주세요.`,
        remaining: 0,
      });
    }

    // 요청 body에서 파라미터 추출
    const { prompt, system, messages, model, max_tokens } = req.body;

    // prompt 방식 (기존 호환) 또는 messages 방식 (threads-writer 등)
    const apiMessages = messages || (prompt ? [{ role: 'user', content: prompt }] : null);

    if (!apiMessages) {
      return res.status(400).json({ error: 'prompt 또는 messages가 필요합니다.' });
    }

    const apiBody = {
      model: model || 'claude-sonnet-4-20250514',
      max_tokens: max_tokens || 2000,
      messages: apiMessages,
    };
    if (system) apiBody.system = system;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(apiBody),
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({ error: data });
    }

    // 성공 시 카운트 증가 (TTL 24시간)
    await redis.incr(key);
    await redis.expire(key, 86400);

    const remaining = DAILY_LIMIT - count - 1;

    return res.status(200).json({ ...data, remaining });

  } catch (error) {
    console.error('API Error:', error);
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
}
