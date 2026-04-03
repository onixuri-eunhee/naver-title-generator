import crypto from 'crypto';
import { getRedis, extractToken, resolveSessionEmail, setCorsHeaders } from './_helpers.js';

const THREADS_APP_ID = process.env.THREADS_APP_ID;
const THREADS_APP_SECRET = process.env.THREADS_APP_SECRET;
const REDIRECT_URI = 'https://ddukddaktool.co.kr/api/threads-auth';
const TOKEN_TTL = 5184000; // 60일

export default async function handler(req, res) {
  setCorsHeaders(res, req);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const action = req.query.action || (req.query.code ? 'callback' : '');

  if (action === 'authorize') return handleAuthorize(req, res);
  if (action === 'callback' || req.query.code) return handleCallback(req, res);
  if (action === 'status') return handleStatus(req, res);
  if (action === 'disconnect') return handleDisconnect(req, res);

  return res.status(400).json({ error: '잘못된 요청입니다.' });
}

async function handleAuthorize(req, res) {
  const token = extractToken(req) || req.query.token;
  const email = await resolveSessionEmail(token);
  if (!email) return res.status(401).json({ error: '로그인이 필요합니다.' });

  // 랜덤 nonce 생성 (세션 토큰 대신 사용하여 URL 노출 방지)
  const nonce = crypto.randomUUID();
  await getRedis().set(`threads:oauth:${nonce}`, email, { ex: 600 }); // 10분 TTL

  const scope = 'threads_basic,threads_content_publish';
  const url = `https://threads.net/oauth/authorize?client_id=${THREADS_APP_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=${scope}&response_type=code&state=${nonce}`;

  return res.redirect(302, url);
}

async function handleCallback(req, res) {
  const { code, state, error } = req.query;

  if (error) {
    return res.redirect(302, '/mypage.html?threads=denied');
  }

  if (!code || !state) {
    return res.redirect(302, '/mypage.html?threads=error');
  }

  // state 검증
  const email = await getRedis().get(`threads:oauth:${state}`);
  if (!email) {
    return res.redirect(302, '/mypage.html?threads=error');
  }
  await getRedis().del(`threads:oauth:${state}`);

  try {
    // Step 1: code → 단기 토큰
    const tokenRes = await fetch('https://graph.threads.net/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: THREADS_APP_ID,
        client_secret: THREADS_APP_SECRET,
        grant_type: 'authorization_code',
        redirect_uri: REDIRECT_URI,
        code,
      }),
    });
    const tokenData = await tokenRes.json();

    if (!tokenRes.ok || tokenData.error) {
      console.error('Threads token exchange error:', tokenData);
      return res.redirect(302, '/mypage.html?threads=error');
    }

    const shortToken = tokenData.access_token;

    // Step 2: 단기 → 장기 토큰
    const longRes = await fetch(
      `https://graph.threads.net/access_token?grant_type=th_exchange_token&client_secret=${THREADS_APP_SECRET}&access_token=${shortToken}`
    );
    const longData = await longRes.json();

    if (!longRes.ok || longData.error) {
      console.error('Threads long-lived token error:', longData);
      return res.redirect(302, '/mypage.html?threads=error');
    }

    const accessToken = longData.access_token;
    const expiresIn = longData.expires_in || TOKEN_TTL;

    // Step 3: 사용자 정보 조회
    const meRes = await fetch(
      `https://graph.threads.net/v1.0/me?fields=id,username&access_token=${accessToken}`
    );
    const meData = await meRes.json();

    if (!meRes.ok || meData.error) {
      console.error('Threads me error:', meData);
      return res.redirect(302, '/mypage.html?threads=error');
    }

    // Step 4: Redis 저장
    const now = new Date();
    const expiresAt = new Date(now.getTime() + expiresIn * 1000).toISOString();

    await getRedis().set(
      `threads:user:${email}`,
      JSON.stringify({
        userId: meData.id,
        accessToken,
        username: meData.username,
        connectedAt: now.toISOString(),
        expiresAt,
      }),
      { ex: expiresIn }
    );

    return res.redirect(302, '/mypage.html?threads=connected');
  } catch (err) {
    console.error('Threads OAuth callback error:', err);
    return res.redirect(302, '/mypage.html?threads=error');
  }
}

async function handleStatus(req, res) {
  const token = extractToken(req);
  const email = await resolveSessionEmail(token);
  if (!email) return res.status(401).json({ error: '로그인이 필요합니다.' });

  const data = await getRedis().get(`threads:user:${email}`);
  if (!data) {
    return res.status(200).json({ connected: false });
  }

  const parsed = typeof data === 'string' ? JSON.parse(data) : data;
  return res.status(200).json({
    connected: true,
    username: parsed.username,
    connectedAt: parsed.connectedAt,
  });
}

async function handleDisconnect(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const token = extractToken(req);
  const email = await resolveSessionEmail(token);
  if (!email) return res.status(401).json({ error: '로그인이 필요합니다.' });

  await getRedis().del(`threads:user:${email}`);
  return res.status(200).json({ success: true });
}
