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
