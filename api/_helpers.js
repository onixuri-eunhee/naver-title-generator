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
  // Vercel이 설정하는 x-real-ip를 우선 사용 (클라이언트 조작 불가)
  return (
    req.headers['x-real-ip'] ||
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.socket?.remoteAddress ||
    'unknown'
  );
}

function extractToken(req) {
  const auth = req.headers['authorization'] || req.headers['Authorization'] || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7);
  return null;
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

function setCorsHeaders(res, req) {
  const allowedOrigins = [
    'https://ddukddaktool.co.kr',
    'https://www.ddukddaktool.co.kr',
  ];
  if (process.env.NODE_ENV !== 'production') {
    allowedOrigins.push('http://localhost:3000', 'http://localhost:5173');
  }
  const origin = req?.headers?.origin || '';
  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Audio-Mime-Type');
}

export { getRedis, getClientIp, extractToken, resolveSessionEmail, resolveAdmin, setCorsHeaders, ADMIN_EMAILS };
