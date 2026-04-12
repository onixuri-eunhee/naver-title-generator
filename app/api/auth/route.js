import crypto from 'crypto';
import { getRedis, getClientIp, extractToken, jsonResponse, handleOptions, ADMIN_EMAILS } from '@/lib/api-helpers';
import { getDb } from '@/lib/db';

function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
}

function validateEmail(email) {
  const re = /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/;
  return re.test(email);
}

async function checkRateLimit(request, action) {
  const ip = getClientIp(request);
  const key = `ratelimit:${action}:${ip}`;
  const current = await getRedis().incr(key);
  if (current === 1) {
    await getRedis().expire(key, 900);
  }
  const limit = action === 'login' ? 10 : 5;
  return current > limit;
}

async function handleSignup(request) {
  const body = await request.json().catch(() => ({}));
  const { email, password, name, phone } = body;

  if (!email || !validateEmail(email) || email.length > 254) {
    return jsonResponse(request, { error: '올바른 이메일 형식을 입력해주세요.' }, { status: 400 });
  }
  if (!password || password.length < 8 || password.length > 128) {
    return jsonResponse(request, { error: '비밀번호는 8자 이상 128자 이하여야 합니다.' }, { status: 400 });
  }
  if (!name || typeof name !== 'string' || name.length > 50) {
    return jsonResponse(request, { error: '이름을 입력해주세요. (50자 이내)' }, { status: 400 });
  }
  if (!phone || typeof phone !== 'string' || phone.length > 20 || !/^[\d\-+() ]+$/.test(phone)) {
    return jsonResponse(request, { error: '올바른 전화번호를 입력해주세요.' }, { status: 400 });
  }

  const safeName = name.trim().replace(/<[^>]*>/g, '');
  const safePhone = phone.trim();

  const salt = crypto.randomBytes(16);
  const passwordHash = hashPassword(password, salt);

  const userData = {
    name: safeName,
    phone: safePhone,
    passwordHash,
    salt: salt.toString('hex'),
    credits: 5,
    createdAt: new Date().toISOString(),
  };

  const wasSet = await getRedis().set(`user:${email}`, JSON.stringify(userData), { nx: true });
  if (!wasSet) {
    return jsonResponse(request, { error: '이미 가입된 이메일입니다.' }, { status: 409 });
  }

  try {
    const sql = getDb();
    await sql`INSERT INTO users (email, name, phone, password_hash, salt, credits, created_at)
      VALUES (${email}, ${safeName}, ${safePhone}, ${passwordHash}, ${salt.toString('hex')}, ${5}, ${userData.createdAt})
      ON CONFLICT (email) DO NOTHING`;
    await sql`INSERT INTO credit_ledger (user_email, amount, type, reason, created_at)
      VALUES (${email}, ${5}, 'grant', '가입 지급', ${userData.createdAt})`;
  } catch (dbErr) {
    console.error('[AUTH] Neon signup write failed (non-fatal):', dbErr.message);
  }

  const token = crypto.randomBytes(32).toString('hex');
  await getRedis().set(`session:${token}`, JSON.stringify({
    email,
    createdAt: new Date().toISOString(),
  }), { ex: 2592000 });
  await getRedis().set(`user_session:${email}`, token, { ex: 2592000 });

  return jsonResponse(request, {
    success: true,
    message: '회원가입이 완료되었습니다.',
    token,
    user: { name: safeName, email, credits: 5 },
  }, { status: 201 });
}

async function handleLogin(request) {
  const body = await request.json().catch(() => ({}));
  const { email, password } = body;

  if (!email || !password) {
    return jsonResponse(request, { error: '이메일과 비밀번호를 입력해주세요.' }, { status: 400 });
  }
  if (password.length > 128) {
    return jsonResponse(request, { error: '이메일 또는 비밀번호가 올바르지 않습니다.' }, { status: 400 });
  }

  const raw = await getRedis().get(`user:${email}`);
  if (!raw) {
    return jsonResponse(request, { error: '이메일 또는 비밀번호가 올바르지 않습니다.' }, { status: 401 });
  }

  const userData = typeof raw === 'string' ? JSON.parse(raw) : raw;

  const salt = Buffer.from(userData.salt, 'hex');
  const hash = hashPassword(password, salt);
  const hashBuffer = Buffer.from(hash, 'hex');
  const storedHashBuffer = Buffer.from(userData.passwordHash, 'hex');
  if (hashBuffer.length !== storedHashBuffer.length || !crypto.timingSafeEqual(hashBuffer, storedHashBuffer)) {
    return jsonResponse(request, { error: '이메일 또는 비밀번호가 올바르지 않습니다.' }, { status: 401 });
  }

  const prevToken = await getRedis().get(`user_session:${email}`);
  if (prevToken) {
    await getRedis().del(`session:${prevToken}`);
  }

  const token = crypto.randomBytes(32).toString('hex');
  const sessionData = {
    email,
    createdAt: new Date().toISOString(),
  };

  await getRedis().set(`session:${token}`, JSON.stringify(sessionData), { ex: 2592000 });
  await getRedis().set(`user_session:${email}`, token, { ex: 2592000 });

  return jsonResponse(request, {
    success: true,
    token,
    user: {
      name: userData.name,
      email,
      credits: userData.credits,
    },
  });
}

async function handleMe(request) {
  const token = extractToken(request);
  if (!token) {
    return jsonResponse(request, { error: '인증 토큰이 필요합니다.' }, { status: 401 });
  }

  const sessionRaw = await getRedis().get(`session:${token}`);
  if (!sessionRaw) {
    return jsonResponse(request, { error: '세션이 만료되었거나 유효하지 않습니다.' }, { status: 401 });
  }

  const session = typeof sessionRaw === 'string' ? JSON.parse(sessionRaw) : sessionRaw;

  const userRaw = await getRedis().get(`user:${session.email}`);
  if (!userRaw) {
    return jsonResponse(request, { error: '사용자를 찾을 수 없습니다.' }, { status: 401 });
  }

  const userData = typeof userRaw === 'string' ? JSON.parse(userRaw) : userRaw;
  const isAdmin = ADMIN_EMAILS.includes(session.email.toLowerCase());

  return jsonResponse(request, {
    name: userData.name,
    email: session.email,
    phone: userData.phone,
    credits: userData.credits,
    createdAt: userData.createdAt,
    isAdmin,
  });
}

async function handleLogout(request) {
  const token = extractToken(request);
  if (token) {
    const sessionRaw = await getRedis().get(`session:${token}`);
    if (sessionRaw) {
      const session = typeof sessionRaw === 'string' ? JSON.parse(sessionRaw) : sessionRaw;
      if (session.email) {
        await getRedis().del(`user_session:${session.email}`);
      }
    }
    await getRedis().del(`session:${token}`);
  }

  return jsonResponse(request, { success: true });
}

function getAction(request) {
  return new URL(request.url).searchParams.get('action');
}

export async function OPTIONS(request) {
  return handleOptions(request);
}

export async function GET(request) {
  const action = getAction(request);
  try {
    if (action === 'me') {
      return await handleMe(request);
    }
    return jsonResponse(request, { error: '올바른 action 파라미터가 필요합니다. (me)' }, { status: 400 });
  } catch (error) {
    console.error('Auth API Error:', error);
    return jsonResponse(request, { error: '서버 오류가 발생했습니다.' }, { status: 500 });
  }
}

export async function POST(request) {
  const action = getAction(request);
  try {
    switch (action) {
      case 'signup':
        if (await checkRateLimit(request, 'signup')) {
          return jsonResponse(request, { error: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.' }, { status: 429 });
        }
        return await handleSignup(request);

      case 'login':
        if (await checkRateLimit(request, 'login')) {
          return jsonResponse(request, { error: '로그인 시도가 너무 많습니다. 잠시 후 다시 시도해주세요.' }, { status: 429 });
        }
        return await handleLogin(request);

      case 'logout':
        return await handleLogout(request);

      default:
        return jsonResponse(request, { error: '올바른 action 파라미터가 필요합니다. (signup, login, logout)' }, { status: 400 });
    }
  } catch (error) {
    console.error('Auth API Error:', error);
    return jsonResponse(request, { error: '서버 오류가 발생했습니다.' }, { status: 500 });
  }
}
