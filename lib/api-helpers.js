/**
 * App Router Route Handler 공용 헬퍼
 * - Request(웹 표준) 객체 기반
 * - NextResponse 반환
 * - 기존 api/_helpers.js의 App Router 포팅판
 */
import crypto from 'crypto';
import { Redis } from '@upstash/redis';
import { NextResponse } from 'next/server';

let _redis;
export function getRedis() {
  if (!_redis) {
    _redis = new Redis({
      url: process.env.KV_REST_API_URL,
      token: process.env.KV_REST_API_TOKEN,
    });
  }
  return _redis;
}

export function getClientIp(request) {
  const h = request.headers;
  return (
    h.get('x-real-ip') ||
    h.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    'unknown'
  );
}

export function extractToken(request) {
  const auth = request.headers.get('authorization') || request.headers.get('Authorization') || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7);
  return null;
}

export async function resolveSessionEmail(token) {
  if (!token) return null;
  try {
    const session = await getRedis().get(`session:${token}`);
    if (session && session.email) return session.email;
  } catch (_) {}
  return null;
}

export const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '')
  .split(',')
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

// ── 내부 비서팀 API 키 (영구 토큰 · TTL 없음 · 2026-04-30 도입) ──
// 형식: INTERNAL_API_KEYS="sk_internal_xxx:bot@email.com,sk_internal_yyy:bot2@email.com"
// 권한: 무제한 호출 · rate limit 우회 · 크레딧 차감 X · admin 페이지 접근 X · 사용자 데이터 접근 X
// 모듈 로딩 시 1회 파싱 + Buffer 캐시. Vercel은 재배포 시 새 lambda → 새 process.env로 자연 반영.
const INTERNAL_API_KEYS = (process.env.INTERNAL_API_KEYS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
  .reduce((acc, pair) => {
    const idx = pair.indexOf(':');
    if (idx < 0) return acc;
    const key = pair.slice(0, idx).trim();
    const email = pair.slice(idx + 1).trim().toLowerCase();
    if (key && email) acc.push({ keyBuf: Buffer.from(key), email });
    return acc;
  }, []);

export function extractInternalKey(request) {
  return (
    request.headers.get('x-internal-key') ||
    request.headers.get('X-Internal-Key') ||
    null
  );
}

export function resolveInternalIdentity(providedKey) {
  if (!providedKey || INTERNAL_API_KEYS.length === 0) return null;
  const provided = Buffer.from(providedKey);
  for (const { keyBuf, email } of INTERNAL_API_KEYS) {
    if (provided.length !== keyBuf.length) continue;
    if (crypto.timingSafeEqual(provided, keyBuf)) {
      return { email, isInternal: true };
    }
  }
  return null;
}

/**
 * 통합 인증 — Internal Key 우선. Internal Key 제공 시 invalid면 401 즉시 (Bearer 폴백 X — 보안).
 * @returns {Promise<{email, isInternal, isAdmin} | null>}
 */
export async function resolveAuthIdentity(request) {
  if (INTERNAL_API_KEYS.length > 0) {
    const internalKey = extractInternalKey(request);
    if (internalKey) {
      const internal = resolveInternalIdentity(internalKey);
      return internal ? { ...internal, isAdmin: false } : null;
    }
  }
  const token = extractToken(request);
  const email = await resolveSessionEmail(token);
  if (!email) return null;
  return {
    email,
    isInternal: false,
    isAdmin: ADMIN_EMAILS.includes(email.toLowerCase()),
  };
}

export async function resolveAdmin(request) {
  const ip = getClientIp(request);
  try {
    const ipWhitelisted = await getRedis().get(`admin:whitelist:${ip}`);
    if (ipWhitelisted) return true;
  } catch (_) {}
  const token = extractToken(request);
  const email = await resolveSessionEmail(token);
  if (email && ADMIN_EMAILS.includes(email.toLowerCase())) return true;
  return false;
}

const ALLOWED_ORIGINS = (() => {
  const base = ['https://ddukddaktool.co.kr', 'https://www.ddukddaktool.co.kr'];
  if (process.env.NODE_ENV !== 'production') {
    base.push('http://localhost:3000', 'http://localhost:5173');
  }
  return base;
})();

export function corsHeaders(request) {
  const headers = {};
  const origin = request.headers.get('origin') || '';
  if (ALLOWED_ORIGINS.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
  }
  headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS';
  headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization, X-Audio-Mime-Type, X-Internal-Key';
  return headers;
}

/**
 * JSON 응답 + CORS 헤더 병합
 * @param {Request} request - CORS origin 판별용
 * @param {any} data - JSON 직렬화 대상
 * @param {ResponseInit} [init] - status, headers 등
 */
export function jsonResponse(request, data, init = {}) {
  const mergedHeaders = { ...corsHeaders(request), ...(init.headers || {}) };
  return NextResponse.json(data, { ...init, headers: mergedHeaders });
}

export function handleOptions(request) {
  return new NextResponse(null, { status: 200, headers: corsHeaders(request) });
}

// QStash 콜백 등 외부 webhook URL 만들 때 사용. VERCEL_URL 은 deployment-specific
// URL을 가리키는데, Vercel deployment protection 때문에 외부 호출이 401을 받음.
// 항상 production custom domain (또는 NEXT_PUBLIC_SITE_URL) 을 사용해야 함.
export function resolveCallbackBaseUrl() {
  return process.env.NEXT_PUBLIC_SITE_URL || 'https://ddukddaktool.co.kr';
}

// ── 크레딧 과금 시스템 (4/25 런칭) ──
const CREDIT_LAUNCH_DATE = new Date('2026-04-25T00:00:00+09:00');

export function isCreditsActive() {
  return Date.now() >= CREDIT_LAUNCH_DATE.getTime();
}
