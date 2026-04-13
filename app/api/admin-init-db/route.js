import { resolveAdmin, jsonResponse, handleOptions } from '@/lib/api-helpers';
import { getDb } from '@/lib/db';

export async function OPTIONS(request) {
  return handleOptions(request);
}

export async function POST(request) {
  const isAdmin = await resolveAdmin(request);
  if (!isAdmin) return jsonResponse(request, { error: '관리자 인증 실패' }, { status: 403 });

  try {
    const sql = getDb();

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

    await sql`CREATE TABLE IF NOT EXISTS usage_logs (
      id SERIAL PRIMARY KEY,
      user_email VARCHAR(254),
      tool VARCHAR(30) NOT NULL,
      mode VARCHAR(30),
      ip VARCHAR(45),
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`;

    await sql`CREATE TABLE IF NOT EXISTS credit_ledger (
      id SERIAL PRIMARY KEY,
      user_email VARCHAR(254),
      amount DECIMAL(10,1) NOT NULL,
      type VARCHAR(20) NOT NULL,
      reason VARCHAR(100),
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`;

    await sql`CREATE INDEX IF NOT EXISTS idx_usage_logs_email_created ON usage_logs (user_email, created_at)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_usage_logs_tool_created ON usage_logs (tool, created_at)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_usage_logs_created ON usage_logs (created_at)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_credit_ledger_email ON credit_ledger (user_email, created_at)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_users_created ON users (created_at)`;

    return jsonResponse(request, { success: true, message: '테이블 3개 + 인덱스 5개 생성 완료' });
  } catch (err) {
    console.error('[INIT-DB] Error:', err.message);
    return jsonResponse(request, { error: '서버 오류가 발생했습니다.' }, { status: 500 });
  }
}
