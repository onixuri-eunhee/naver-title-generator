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

function getClientIp(req) {
  return (
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.headers['x-real-ip'] ||
    req.socket?.remoteAddress ||
    'unknown'
  );
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

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '')
  .split(',')
  .map(e => e.trim().toLowerCase())
  .filter(Boolean);

async function resolveAdmin(req) {
  const ip = getClientIp(req);
  // 1) Redis IP 화이트리스트
  const ipWhitelisted = await getRedis().get(`admin:whitelist:${ip}`);
  if (ipWhitelisted) return true;
  // 2) 로그인 세션의 이메일이 ADMIN_EMAILS에 포함
  const token = extractToken(req);
  const email = await resolveSessionEmail(token);
  if (email && ADMIN_EMAILS.includes(email.toLowerCase())) return true;
  return false;
}

export { getRedis, getClientIp, extractToken, resolveSessionEmail, resolveAdmin, ADMIN_EMAILS };
