/**
 * DB 스키마 초기화 (1회성 — 관리자 전용)
 * POST /api/admin-init-db
 */
import { getDb } from './_db.js';
import { resolveAdmin, setCorsHeaders } from './_helpers.js';

export default async function handler(req, res) {
  setCorsHeaders(res, req);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const isAdmin = await resolveAdmin(req);
  if (!isAdmin) return res.status(403).json({ error: '관리자 인증 실패' });

  try {
    const sql = getDb();

    // users 테이블
    await sql`CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email VARCHAR(254) UNIQUE NOT NULL,
      name VARCHAR(50),
      phone VARCHAR(20),
      password_hash TEXT,
      salt TEXT,
      credits DECIMAL(10,1) DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )`;

    // usage_logs 테이블
    await sql`CREATE TABLE IF NOT EXISTS usage_logs (
      id SERIAL PRIMARY KEY,
      user_email VARCHAR(254),
      tool VARCHAR(30) NOT NULL,
      mode VARCHAR(30),
      ip VARCHAR(45),
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`;

    // credit_ledger 테이블
    await sql`CREATE TABLE IF NOT EXISTS credit_ledger (
      id SERIAL PRIMARY KEY,
      user_email VARCHAR(254),
      amount DECIMAL(10,1) NOT NULL,
      type VARCHAR(20) NOT NULL,
      reason VARCHAR(100),
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`;

    // 인덱스
    await sql`CREATE INDEX IF NOT EXISTS idx_usage_logs_email_created ON usage_logs (user_email, created_at)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_usage_logs_tool_created ON usage_logs (tool, created_at)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_usage_logs_created ON usage_logs (created_at)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_credit_ledger_email ON credit_ledger (user_email, created_at)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_users_created ON users (created_at)`;

    return res.status(200).json({ success: true, message: '테이블 3개 + 인덱스 5개 생성 완료' });
  } catch (err) {
    console.error('[INIT-DB] Error:', err.message);
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
}
