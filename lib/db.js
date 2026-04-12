/**
 * Neon PostgreSQL 연결 헬퍼
 * @neondatabase/serverless — Vercel Serverless 환경 최적화
 */
import { neon } from '@neondatabase/serverless';

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
 * @param {string} email
 * @param {number} cost - 차감할 크레딧 (예: 1, 0.5, 3)
 * @param {string} reason - credit_ledger에 기록할 사유
 * @returns {Promise<{remaining: number}|null>} 잔액 또는 null(부족)
 */
export async function chargeCredits(email, cost, reason) {
  const sql = getDb();
  const result = await sql`UPDATE users SET credits = credits - ${cost}, updated_at = NOW()
    WHERE email = ${email} AND credits >= ${cost}
    RETURNING credits`;
  if (result.length === 0) return null;
  await sql`INSERT INTO credit_ledger (user_email, amount, type, reason)
    VALUES (${email}, ${-cost}, 'usage', ${reason})`;
  return { remaining: Number(result[0].credits) };
}

/**
 * 크레딧 환불 (non-fatal)
 */
export async function refundCredits(email, cost, reason) {
  try {
    const sql = getDb();
    await sql`UPDATE users SET credits = credits + ${cost}, updated_at = NOW()
      WHERE email = ${email} RETURNING credits`;
    await sql`INSERT INTO credit_ledger (user_email, amount, type, reason)
      VALUES (${email}, ${cost}, 'refund', ${reason})`;
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
