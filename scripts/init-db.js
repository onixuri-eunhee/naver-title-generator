/**
 * DB 스키마 초기화 (로컬 실행)
 * 실행: node --env-file=.env.local scripts/init-db.js
 */
import { neon } from '@neondatabase/serverless';

async function main() {
  const sql = neon(process.env.POSTGRES_URL);
  console.log('Connecting to Neon...');

  // users
  await sql`CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(254) UNIQUE NOT NULL,
    name VARCHAR(50),
    phone VARCHAR(20),
    password_hash TEXT,
    salt TEXT,
    credits INTEGER DEFAULT 5,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  )`;
  console.log('+ users table');

  // usage_logs
  await sql`CREATE TABLE IF NOT EXISTS usage_logs (
    id SERIAL PRIMARY KEY,
    user_email VARCHAR(254),
    tool VARCHAR(30) NOT NULL,
    mode VARCHAR(30),
    ip VARCHAR(45),
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`;
  console.log('+ usage_logs table');

  // credit_ledger
  await sql`CREATE TABLE IF NOT EXISTS credit_ledger (
    id SERIAL PRIMARY KEY,
    user_email VARCHAR(254),
    amount INTEGER NOT NULL,
    type VARCHAR(20) NOT NULL,
    reason VARCHAR(100),
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`;
  console.log('+ credit_ledger table');

  // indexes
  await sql`CREATE INDEX IF NOT EXISTS idx_usage_logs_email_created ON usage_logs (user_email, created_at)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_usage_logs_tool_created ON usage_logs (tool, created_at)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_usage_logs_created ON usage_logs (created_at)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_credit_ledger_email ON credit_ledger (user_email, created_at)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_users_created ON users (created_at)`;
  console.log('+ 5 indexes');

  console.log('\nDone! All tables and indexes created.');
}

main().catch(err => { console.error('Error:', err); process.exit(1); });
