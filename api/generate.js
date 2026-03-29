import { Redis } from '@upstash/redis';
import { resolveAdmin, setCorsHeaders } from './_helpers.js';
import { logUsage } from './_db.js';

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
    req.headers['x-real-ip'] ||
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
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
  setCorsHeaders(res, req);

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

      const token = extractToken(req);
      const email = await resolveSessionEmail(token);
      if (!email) {
        return res.status(200).json({ remaining: 0, limit: MEMBER_DAILY_LIMIT, loginRequired: true });
      }
      const key = getTodayKeyByEmail(email);
      const count = (await getRedis().get(key)) || 0;
      const remaining = Math.max(MEMBER_DAILY_LIMIT - count, 0);
      return res.status(200).json({ remaining, limit: MEMBER_DAILY_LIMIT });
    } catch {
      return res.status(200).json({ remaining: 0, limit: MEMBER_DAILY_LIMIT });
    }
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let rateLimitKey = null;

  try {
    const { prompt, system, messages, model, max_tokens, isAutoCorrect } = req.body;

    const apiMessages = messages || (prompt ? [{ role: 'user', content: prompt }] : null);

    if (!apiMessages) {
      return res.status(400).json({ error: 'prompt 또는 messages가 필요합니다.' });
    }

    // 모델 화이트리스트 (허용된 모델만 사용 가능)
    const ALLOWED_MODELS = ['claude-sonnet-4-20250514', 'claude-haiku-4-5-20251001'];
    const safeModel = ALLOWED_MODELS.includes(model) ? model : 'claude-sonnet-4-20250514';

    // max_tokens 상한 (클라이언트 요청을 서버가 제한)
    const MAX_TOKENS_LIMIT = 8192;
    const safeMaxTokens = Math.min(Math.max(parseInt(max_tokens, 10) || 2000, 1), MAX_TOKENS_LIMIT);

    // 로그인 필수
    const whitelisted = await resolveAdmin(req);
    const token = extractToken(req);
    const email = await resolveSessionEmail(token);

    if (!whitelisted && !email) {
      return res.status(401).json({ error: '로그인이 필요합니다.' });
    }

    const dailyLimit = MEMBER_DAILY_LIMIT;
    let remaining = whitelisted ? 999 : dailyLimit;

    // 자동수정 1회 무료 처리: 서버에서 Redis 플래그로 검증
    let skipRateLimit = false;
    if (isAutoCorrect && !whitelisted) {
      const acKey = `autocorrect:${email}:${getKSTDate()}`;
      const used = await getRedis().get(acKey);
      if (!used) {
        // 미사용 → 이번 요청은 rate limit 스킵, 플래그 소비
        await getRedis().set(acKey, '1', { ex: getTTLUntilMidnightKST() });
        skipRateLimit = true;
      }
      // 이미 사용했으면 일반 rate limit 적용
    }

    if (!whitelisted && !skipRateLimit) {
      rateLimitKey = getTodayKeyByEmail(email);
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
    } else if (skipRateLimit) {
      // 자동수정 무료: 현재 남은 횟수만 조회
      const key = getTodayKeyByEmail(email);
      const count = (await getRedis().get(key)) || 0;
      remaining = Math.max(dailyLimit - count, 0);
    }

    const apiBody = {
      model: safeModel,
      max_tokens: safeMaxTokens,
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

    logUsage(email, 'blog', isAutoCorrect ? 'auto_correct' : null, getClientIp(req));
    return res.status(200).json({ ...data, remaining, limit: dailyLimit });

  } catch (error) {
    console.error('API Error:', error);
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
}
