import { Redis } from '@upstash/redis';
import { resolveAdmin } from './_helpers.js';

const GUEST_DAILY_LIMIT = 3;
const MEMBER_DAILY_LIMIT = 5;

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

function getClientIp(req) {
  return (
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.headers['x-real-ip'] ||
    req.socket?.remoteAddress ||
    'unknown'
  );
}

function getKSTDate() {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

function getTodayKey(ip) {
  return `ratelimit:${ip}:${getKSTDate()}`;
}

function getTodayKeyByEmail(email) {
  return `ratelimit:generate:${email}:${getKSTDate()}`;
}

function getTTLUntilMidnightKST() {
  const now = new Date();
  const kstOffset = 9 * 60 * 60 * 1000;
  const kstNow = new Date(now.getTime() + kstOffset);
  const nextMidnight = new Date(kstNow);
  nextMidnight.setUTCHours(0, 0, 0, 0);
  nextMidnight.setUTCDate(nextMidnight.getUTCDate() + 1);
  const seconds = Math.ceil((nextMidnight.getTime() - kstNow.getTime()) / 1000);
  return Math.max(seconds, 60);
}

function extractToken(req) {
  const auth = req.headers['authorization'] || req.headers['Authorization'] || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7);
  return req.body?.token || req.query?.token || null;
}

async function resolveSessionEmail(token) {
  if (!token) return null;
  try {
    const session = await getRedis().get(`session:${token}`);
    if (session && session.email) return session.email;
  } catch (e) {}
  return null;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // GET: 남은 횟수 조회
  if (req.method === 'GET') {
    try {
      const whitelisted = await resolveAdmin(req);
      if (whitelisted) {
        return res.status(200).json({ remaining: 999, limit: MEMBER_DAILY_LIMIT, admin: true });
      }

      // 로그인 유저: 이메일 기반 5회
      const token = extractToken(req);
      const email = await resolveSessionEmail(token);
      if (email) {
        const key = getTodayKeyByEmail(email);
        const count = (await getRedis().get(key)) || 0;
        const remaining = Math.max(MEMBER_DAILY_LIMIT - count, 0);
        return res.status(200).json({ remaining, limit: MEMBER_DAILY_LIMIT });
      }

      // 비로그인: IP 기반 3회
      if (GUEST_DAILY_LIMIT <= 0) {
        return res.status(200).json({ remaining: 0, limit: 0 });
      }
      const key = getTodayKey(ip);
      const count = (await getRedis().get(key)) || 0;
      const remaining = Math.max(GUEST_DAILY_LIMIT - count, 0);
      return res.status(200).json({ remaining, limit: GUEST_DAILY_LIMIT });
    } catch {
      return res.status(200).json({ remaining: GUEST_DAILY_LIMIT, limit: GUEST_DAILY_LIMIT });
    }
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let rateLimitKey = null;

  try {
    const { prompt, system, messages, model, max_tokens, skipRateLimit } = req.body;

    const apiMessages = messages || (prompt ? [{ role: 'user', content: prompt }] : null);

    if (!apiMessages) {
      return res.status(400).json({ error: 'prompt 또는 messages가 필요합니다.' });
    }

    // Rate limit
    const whitelisted = await resolveAdmin(req);

    // 로그인 유저 확인
    const token = extractToken(req);
    const email = await resolveSessionEmail(token);
    const dailyLimit = email ? MEMBER_DAILY_LIMIT : GUEST_DAILY_LIMIT;

    let remaining = whitelisted ? 999 : dailyLimit;

    if (!whitelisted && !skipRateLimit) {
      rateLimitKey = email ? getTodayKeyByEmail(email) : getTodayKey(ip);
      const newCount = await getRedis().incr(rateLimitKey);
      await getRedis().expire(rateLimitKey, getTTLUntilMidnightKST());

      if (newCount > dailyLimit) {
        await getRedis().decr(rateLimitKey);
        return res.status(429).json({
          error: `일일 무료 사용 한도(${dailyLimit}회)를 초과했습니다. 내일 다시 이용해주세요.`,
          remaining: 0,
        });
      }
      remaining = dailyLimit - newCount;
    } else if (!whitelisted && skipRateLimit) {
      const key = email ? getTodayKeyByEmail(email) : getTodayKey(ip);
      const count = (await getRedis().get(key)) || 0;
      remaining = Math.max(dailyLimit - count, 0);
    }

    const apiBody = {
      model: model || 'claude-sonnet-4-20250514',
      max_tokens: max_tokens || 2000,
      temperature: 0.5,
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
      console.error('Claude API Error:', data);
      if (rateLimitKey) try { await getRedis().decr(rateLimitKey); } catch (_) {}
      return res.status(500).json({ error: '글 생성 중 오류가 발생했습니다.' });
    }

    return res.status(200).json({ ...data, remaining, limit: dailyLimit });

  } catch (error) {
    console.error('API Error:', error);
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
}
