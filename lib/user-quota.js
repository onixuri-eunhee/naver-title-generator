/**
 * 사용자 이미지 보관함 용량 판정
 * - 무료: 크레딧 구매 이력 없음 → 50MB
 * - 유료: credit_ledger에 type='purchase' 레코드 존재 → 500MB
 */
import { getDb } from '@/lib/db';

export const QUOTA_FREE_BYTES = 50 * 1024 * 1024;    // 50MB
export const QUOTA_PAID_BYTES = 500 * 1024 * 1024;   // 500MB

/**
 * 유저의 총 용량 한도(bytes) 조회
 */
export async function getUserQuota(email) {
  try {
    const sql = getDb();
    const rows = await sql`SELECT 1 FROM credit_ledger
      WHERE user_email = ${email} AND type = 'purchase' LIMIT 1`;
    return rows.length > 0 ? QUOTA_PAID_BYTES : QUOTA_FREE_BYTES;
  } catch (err) {
    console.error('[QUOTA] getUserQuota failed:', err.message);
    return QUOTA_FREE_BYTES;
  }
}

/**
 * 유저가 현재 사용 중인 용량(bytes)
 */
export async function getUserUsage(email) {
  try {
    const sql = getDb();
    const rows = await sql`SELECT COALESCE(SUM(file_size), 0) AS used
      FROM user_images WHERE user_email = ${email}`;
    return Number(rows[0]?.used || 0);
  } catch (err) {
    console.error('[QUOTA] getUserUsage failed:', err.message);
    return 0;
  }
}

/**
 * 업로드 가능 여부 체크
 * @returns {{ ok: boolean, quota: number, used: number, available: number }}
 */
export async function checkQuota(email, incomingBytes) {
  const [quota, used] = await Promise.all([getUserQuota(email), getUserUsage(email)]);
  const available = quota - used;
  return {
    ok: incomingBytes <= available,
    quota,
    used,
    available,
  };
}
