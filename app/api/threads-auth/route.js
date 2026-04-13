import crypto from 'crypto';
import { NextResponse } from 'next/server';
import {
  getRedis,
  extractToken,
  resolveSessionEmail,
  jsonResponse,
  handleOptions,
} from '@/lib/api-helpers';

const THREADS_APP_ID = process.env.THREADS_APP_ID;
const THREADS_APP_SECRET = process.env.THREADS_APP_SECRET;
const REDIRECT_URI = 'https://ddukddaktool.co.kr/api/threads-auth';
const TOKEN_TTL = 5184000; // 60일

function getQuery(request) {
  return new URL(request.url).searchParams;
}

function resolveAction(request) {
  const sp = getQuery(request);
  const action = sp.get('action');
  if (action) return action;
  if (sp.get('code') || sp.get('error')) return 'callback';
  return '';
}

export async function OPTIONS(request) {
  return handleOptions(request);
}

async function handleAuthorize(request) {
  const sp = getQuery(request);
  const token = extractToken(request) || sp.get('token');
  const email = await resolveSessionEmail(token);
  if (!email) return jsonResponse(request, { error: '로그인이 필요합니다.' }, { status: 401 });

  const nonce = crypto.randomUUID();
  await getRedis().set(`threads:oauth:${nonce}`, email, { ex: 600 });

  const scope = 'threads_basic,threads_content_publish';
  const url = `https://threads.net/oauth/authorize?client_id=${THREADS_APP_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=${scope}&response_type=code&state=${nonce}`;

  return NextResponse.redirect(url, 302);
}

async function handleCallback(request) {
  const sp = getQuery(request);
  const code = sp.get('code');
  const state = sp.get('state');
  const error = sp.get('error');

  const origin = new URL(request.url).origin;
  const redirectUrl = (qs) => new URL(`/mypage?${qs}`, origin);

  if (error) {
    return NextResponse.redirect(redirectUrl('threads=denied'), 302);
  }

  if (!code || !state) {
    return NextResponse.redirect(redirectUrl('threads=error'), 302);
  }

  const email = await getRedis().get(`threads:oauth:${state}`);
  if (!email) {
    return NextResponse.redirect(redirectUrl('threads=error'), 302);
  }
  await getRedis().del(`threads:oauth:${state}`);

  try {
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
      return NextResponse.redirect(redirectUrl('threads=error'), 302);
    }

    const shortToken = tokenData.access_token;

    const longRes = await fetch(
      `https://graph.threads.net/access_token?grant_type=th_exchange_token&client_secret=${THREADS_APP_SECRET}&access_token=${shortToken}`
    );
    const longData = await longRes.json();

    if (!longRes.ok || longData.error) {
      console.error('Threads long-lived token error:', longData);
      return NextResponse.redirect(redirectUrl('threads=error'), 302);
    }

    const accessToken = longData.access_token;
    const expiresIn = longData.expires_in || TOKEN_TTL;

    const meRes = await fetch(
      `https://graph.threads.net/v1.0/me?fields=id,username&access_token=${accessToken}`
    );
    const meData = await meRes.json();

    if (!meRes.ok || meData.error) {
      console.error('Threads me error:', meData);
      return NextResponse.redirect(redirectUrl('threads=error'), 302);
    }

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

    return NextResponse.redirect(redirectUrl('threads=connected'), 302);
  } catch (err) {
    console.error('Threads OAuth callback error:', err);
    return NextResponse.redirect(redirectUrl('threads=error'), 302);
  }
}

async function handleStatus(request) {
  const token = extractToken(request);
  const email = await resolveSessionEmail(token);
  if (!email) return jsonResponse(request, { error: '로그인이 필요합니다.' }, { status: 401 });

  const data = await getRedis().get(`threads:user:${email}`);
  if (!data) {
    return jsonResponse(request, { connected: false });
  }

  const parsed = typeof data === 'string' ? JSON.parse(data) : data;
  return jsonResponse(request, {
    connected: true,
    username: parsed.username,
    connectedAt: parsed.connectedAt,
  });
}

async function handleDisconnect(request) {
  const token = extractToken(request);
  const email = await resolveSessionEmail(token);
  if (!email) return jsonResponse(request, { error: '로그인이 필요합니다.' }, { status: 401 });

  await getRedis().del(`threads:user:${email}`);
  return jsonResponse(request, { success: true });
}

export async function GET(request) {
  const action = resolveAction(request);
  if (action === 'authorize') return handleAuthorize(request);
  if (action === 'callback') return handleCallback(request);
  if (action === 'status') return handleStatus(request);
  return jsonResponse(request, { error: '잘못된 요청입니다.' }, { status: 400 });
}

export async function POST(request) {
  const action = resolveAction(request);
  if (action === 'disconnect') return handleDisconnect(request);
  return jsonResponse(request, { error: '잘못된 요청입니다.' }, { status: 400 });
}
