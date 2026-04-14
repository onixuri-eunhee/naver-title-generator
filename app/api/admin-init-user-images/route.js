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

    await sql`CREATE TABLE IF NOT EXISTS user_images (
      id SERIAL PRIMARY KEY,
      user_email VARCHAR(254) NOT NULL,
      r2_key TEXT NOT NULL,
      public_url TEXT NOT NULL,
      thumb_url TEXT NOT NULL,
      filename VARCHAR(255) NOT NULL,
      mime_type VARCHAR(50) NOT NULL,
      file_size INTEGER NOT NULL,
      width INTEGER,
      height INTEGER,
      tag VARCHAR(50),
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`;

    await sql`CREATE INDEX IF NOT EXISTS idx_user_images_email_created
      ON user_images (user_email, created_at DESC)`;

    return jsonResponse(request, { success: true, message: 'user_images 테이블 + 인덱스 생성 완료' });
  } catch (err) {
    console.error('[INIT-USER-IMAGES] Error:', err.message);
    return jsonResponse(request, { error: err.message }, { status: 500 });
  }
}
