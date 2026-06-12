/**
 * Neon PostgreSQL 연결 헬퍼
 * @neondatabase/serverless — Vercel Serverless 환경 최적화
 */
import { neon } from '@neondatabase/serverless';
import { chargeCredit, refundCredit } from './credit-service.js';

let _sql = null;

export function getDb() {
  if (!_sql) {
    _sql = neon(process.env.POSTGRES_URL);
  }
  return _sql;
}

/**
 * 사용 로그 기록 (non-fatal — 실패해도 API 응답에 영향 없음)
 */
export async function logUsage(userEmail, tool, mode, ip) {
  try {
    const sql = getDb();
    await sql`INSERT INTO usage_logs (user_email, tool, mode, ip) VALUES (${userEmail}, ${tool}, ${mode || null}, ${ip || null})`;
  } catch (err) {
    console.error('[DB] logUsage failed:', err.message);
  }
}

/**
 * 크레딧 차감 (원자적). 성공 시 잔액 반환, 실패 시 null.
 *
 * lib/credit-service.js의 idempotent 경로를 호출하는 호환 래퍼.
 * requestId를 넘기면 같은 요청의 중복 차감이 무시된다(재시도/더블클릭 안전).
 *
 * @param {string} email
 * @param {number} cost - 차감할 크레딧 (예: 1, 0.5, 3)
 * @param {string} reason - 장부(credit_ledger/charge_log)에 기록할 사유
 * @param {string} [requestId] - 중복 방지용 UUID (선택)
 * @returns {Promise<{remaining: number}|null>} 잔액 또는 null(부족)
 */
export async function chargeCredits(email, cost, reason, requestId) {
  if (typeof cost !== 'number' || !Number.isFinite(cost) || cost <= 0) {
    throw new Error(`chargeCredits: cost must be a positive finite number, got ${cost}`);
  }
  if (!email || typeof email !== 'string') {
    throw new Error('chargeCredits: email is required');
  }
  try {
    const result = await chargeCredit({ userId: email, requestId, amount: cost, phase: reason });
    return { remaining: result.balance };
  } catch (err) {
    if (err?.code === 'insufficient_credits') return null;
    throw err;
  }
}

/**
 * 크레딧 환불 (non-fatal)
 *
 * lib/credit-service.js의 idempotent 경로를 호출하는 호환 래퍼.
 *
 * @param {string} email
 * @param {number} cost
 * @param {string} reason
 * @param {string} [requestId] - 중복 방지용 UUID (선택)
 */
export async function refundCredits(email, cost, reason, requestId) {
  if (typeof cost !== 'number' || !Number.isFinite(cost) || cost <= 0) {
    console.error('[DB] refundCredits: invalid cost', { email, cost, reason });
    return;
  }
  if (!email || typeof email !== 'string') {
    console.error('[DB] refundCredits: invalid email', { email, cost, reason });
    return;
  }
  try {
    await refundCredit({ userId: email, requestId, amount: cost, refundReason: reason, phase: reason });
  } catch (err) {
    console.error('[DB] refundCredits failed:', err.message, { email, cost, reason });
  }
}

/**
 * 유저 크레딧 잔액 조회
 */
export async function getUserCredits(email) {
  try {
    const sql = getDb();
    const result = await sql`SELECT credits FROM users WHERE email = ${email}`;
    return result.length ? Number(result[0].credits) : 0;
  } catch {
    return 0;
  }
}
