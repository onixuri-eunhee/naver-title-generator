/**
 * App Router Route Handler 공용 헬퍼
 * - Request(웹 표준) 객체 기반
 * - NextResponse 반환
 * - 기존 api/_helpers.js의 App Router 포팅판
 */
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
  headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization, X-Audio-Mime-Type';
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

// ── 크레딧 과금 시스템 (4/25 런칭) ──
const CREDIT_LAUNCH_DATE = new Date('2026-04-25T00:00:00+09:00');

export function isCreditsActive() {
  return Date.now() >= CREDIT_LAUNCH_DATE.getTime();
}
