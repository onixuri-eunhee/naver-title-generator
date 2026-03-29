/**
 * Redis → Neon 사용자 마이그레이션 스크립트
 *
 * 실행 방법:
 *   node --env-file=.env.local scripts/migrate-users.js
 *
 * 안전장치:
 *   - INSERT ... ON CONFLICT DO NOTHING (중복 무시)
 *   - 드라이런 모드: --dry-run 플래그로 먼저 확인 가능
 *   - 실패한 건만 로그로 출력
 */
import { Redis } from '@upstash/redis';
import { neon } from '@neondatabase/serverless';

const isDryRun = process.argv.includes('--dry-run');

async function main() {
  const redis = new Redis({
    url: process.env.KV_REST_API_URL,
    token: process.env.KV_REST_API_TOKEN,
  });
  const sql = neon(process.env.POSTGRES_URL);

  console.log(isDryRun ? '=== DRY RUN MODE ===' : '=== MIGRATION START ===');

  // 1) Redis에서 user:* 키 전체 조회
  let cursor = 0;
  const allKeys = [];
  do {
    const [nextCursor, keys] = await redis.scan(cursor, { match: 'user:*', count: 100 });
    cursor = nextCursor;
    // user_session:* 제외
    allKeys.push(...keys.filter(k => !k.startsWith('user_session:')));
  } while (cursor !== 0);

  console.log(`Found ${allKeys.length} user keys in Redis`);

  let success = 0;
  let skipped = 0;
  let failed = 0;

  for (const key of allKeys) {
    const email = key.replace('user:', '');
    try {
      const raw = await redis.get(key);
      if (!raw) { skipped++; continue; }

      const data = typeof raw === 'string' ? JSON.parse(raw) : raw;

      if (isDryRun) {
        console.log(`[DRY] ${email} | name: ${data.name} | credits: ${data.credits} | created: ${data.createdAt}`);
        success++;
        continue;
      }

      await sql`INSERT INTO users (email, name, phone, password_hash, salt, credits, created_at, updated_at)
        VALUES (
          ${email},
          ${data.name || null},
          ${data.phone || null},
          ${data.passwordHash || null},
          ${data.salt || null},
          ${data.credits ?? 5},
          ${data.createdAt || new Date().toISOString()},
          ${new Date().toISOString()}
        )
        ON CONFLICT (email) DO NOTHING`;

      // 가입 크레딧 지급 기록도 생성
      await sql`INSERT INTO credit_ledger (user_email, amount, type, reason, created_at)
        VALUES (${email}, ${data.credits ?? 5}, 'grant', '가입 지급 (마이그레이션)', ${data.createdAt || new Date().toISOString()})`;

      success++;
    } catch (err) {
      console.error(`[FAIL] ${email}: ${err.message}`);
      failed++;
    }
  }

  console.log(`\n=== RESULT ===`);
  console.log(`Total: ${allKeys.length} | Success: ${success} | Skipped: ${skipped} | Failed: ${failed}`);
  if (isDryRun) console.log('(Dry run — no data was written)');
}

main().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
