import { Redis } from '@upstash/redis';
import crypto from 'crypto';

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

function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
}

function setCorsHeaders(res, req) {
  const allowedOrigins = [
    'https://ddukddaktool.co.kr',
    'https://www.ddukddaktool.co.kr',
  ];
  // Allow localhost in development
  if (process.env.NODE_ENV !== 'production') {
    allowedOrigins.push('http://localhost:3000', 'http://localhost:5173');
  }
  const origin = req?.headers?.origin || '';
  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else if (!origin) {
    // Same-origin requests (no Origin header) — allow for Vercel serverless
    res.setHeader('Access-Control-Allow-Origin', 'https://ddukddaktool.co.kr');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function validateEmail(email) {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(email);
}

async function checkRateLimit(req, action) {
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.headers['x-real-ip'] || 'unknown';
  const key = `ratelimit:${action}:${ip}`;
  const current = await getRedis().incr(key);
  if (current === 1) {
    // Set expiry on first increment (15 minute window)
    await getRedis().expire(key, 900);
  }
  // Allow 10 login attempts per 15 minutes, 5 signup attempts per 15 minutes
  const limit = action === 'login' ? 10 : 5;
  return current > limit;
}

function extractToken(req) {
  const auth = req.headers['authorization'] || req.headers['Authorization'] || '';
  if (auth.startsWith('Bearer ')) {
    return auth.slice(7);
  }
  return null;
}

async function handleSignup(req, res) {
  const { email, password, name, phone } = req.body || {};

  // 유효성 검사
  if (!email || !validateEmail(email) || email.length > 254) {
    return res.status(400).json({ error: '올바른 이메일 형식을 입력해주세요.' });
  }
  if (!password || password.length < 8 || password.length > 128) {
    return res.status(400).json({ error: '비밀번호는 8자 이상 128자 이하여야 합니다.' });
  }
  if (!name) {
    return res.status(400).json({ error: '이름을 입력해주세요.' });
  }
  if (!phone) {
    return res.status(400).json({ error: '전화번호를 입력해주세요.' });
  }

  // 비밀번호 해싱
  const salt = crypto.randomBytes(16);
  const passwordHash = hashPassword(password, salt);

  // 사용자 저장 (atomic: SET NX prevents race condition on duplicate signup)
  const userData = {
    name,
    phone,
    passwordHash,
    salt: salt.toString('hex'),
    credits: 5,
    createdAt: new Date().toISOString(),
  };

  const wasSet = await getRedis().set(`user:${email}`, JSON.stringify(userData), { nx: true });
  if (!wasSet) {
    return res.status(409).json({ error: '이미 가입된 이메일입니다.' });
  }

  // 가입 즉시 로그인: 세션 토큰 발급
  const token = crypto.randomBytes(32).toString('hex');
  await getRedis().set(`session:${token}`, JSON.stringify({
    email,
    createdAt: new Date().toISOString(),
  }), { ex: 2592000 });

  return res.status(201).json({
    success: true,
    message: '회원가입이 완료되었습니다. 5크레딧이 지급되었습니다.',
    token,
    user: { name, email, credits: 5 },
  });
}

async function handleLogin(req, res) {
  const { email, password } = req.body || {};

  if (!email || !password) {
    return res.status(400).json({ error: '이메일과 비밀번호를 입력해주세요.' });
  }
  if (password.length > 128) {
    return res.status(400).json({ error: '이메일 또는 비밀번호가 올바르지 않습니다.' });
  }

  // 사용자 조회
  const raw = await getRedis().get(`user:${email}`);
  if (!raw) {
    return res.status(401).json({ error: '이메일 또는 비밀번호가 올바르지 않습니다.' });
  }

  const userData = typeof raw === 'string' ? JSON.parse(raw) : raw;

  // 비밀번호 검증 (timing-safe comparison to prevent timing attacks)
  const salt = Buffer.from(userData.salt, 'hex');
  const hash = hashPassword(password, salt);
  const hashBuffer = Buffer.from(hash, 'hex');
  const storedHashBuffer = Buffer.from(userData.passwordHash, 'hex');
  if (hashBuffer.length !== storedHashBuffer.length || !crypto.timingSafeEqual(hashBuffer, storedHashBuffer)) {
    return res.status(401).json({ error: '이메일 또는 비밀번호가 올바르지 않습니다.' });
  }

  // 세션 토큰 생성
  const token = crypto.randomBytes(32).toString('hex');
  const sessionData = {
    email,
    createdAt: new Date().toISOString(),
  };

  await getRedis().set(`session:${token}`, JSON.stringify(sessionData), { ex: 2592000 });

  return res.status(200).json({
    success: true,
    token,
    user: {
      name: userData.name,
      email,
      credits: userData.credits,
    },
  });
}

async function handleMe(req, res) {
  const token = extractToken(req);
  if (!token) {
    return res.status(401).json({ error: '인증 토큰이 필요합니다.' });
  }

  // 세션 조회
  const sessionRaw = await getRedis().get(`session:${token}`);
  if (!sessionRaw) {
    return res.status(401).json({ error: '세션이 만료되었거나 유효하지 않습니다.' });
  }

  const session = typeof sessionRaw === 'string' ? JSON.parse(sessionRaw) : sessionRaw;

  // 사용자 데이터 조회
  const userRaw = await getRedis().get(`user:${session.email}`);
  if (!userRaw) {
    return res.status(401).json({ error: '사용자를 찾을 수 없습니다.' });
  }

  const userData = typeof userRaw === 'string' ? JSON.parse(userRaw) : userRaw;

  return res.status(200).json({
    name: userData.name,
    email: session.email,
    phone: userData.phone,
    credits: userData.credits,
    createdAt: userData.createdAt,
  });
}

async function handleLogout(req, res) {
  const token = extractToken(req);
  if (token) {
    await getRedis().del(`session:${token}`);
  }

  return res.status(200).json({ success: true });
}

export default async function handler(req, res) {
  setCorsHeaders(res, req);

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const action = req.query.action;

  try {
    switch (action) {
      case 'signup':
        if (req.method !== 'POST') {
          return res.status(405).json({ error: 'Method not allowed' });
        }
        if (await checkRateLimit(req, 'signup')) {
          return res.status(429).json({ error: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.' });
        }
        return await handleSignup(req, res);

      case 'login':
        if (req.method !== 'POST') {
          return res.status(405).json({ error: 'Method not allowed' });
        }
        if (await checkRateLimit(req, 'login')) {
          return res.status(429).json({ error: '로그인 시도가 너무 많습니다. 잠시 후 다시 시도해주세요.' });
        }
        return await handleLogin(req, res);

      case 'me':
        if (req.method !== 'GET') {
          return res.status(405).json({ error: 'Method not allowed' });
        }
        return await handleMe(req, res);

      case 'logout':
        if (req.method !== 'POST') {
          return res.status(405).json({ error: 'Method not allowed' });
        }
        return await handleLogout(req, res);

      default:
        return res.status(400).json({ error: '올바른 action 파라미터가 필요합니다. (signup, login, me, logout)' });
    }
  } catch (error) {
    console.error('Auth API Error:', error);
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
}
