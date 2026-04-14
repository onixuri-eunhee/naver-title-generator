/**
 * 숏폼 온보딩 관련 헬퍼.
 *
 * 책임:
 * 1) users 테이블 컬럼 lazy migration (onboarding_completed, first_shortform_at)
 * 2) 온보딩 상태 CRUD (조회/완료 표시)
 * 3) 첫 영상 무료 자격 판정 + 마킹 (가입 후 7일 이내 + 첫 숏폼)
 *
 * Phase K (2026-04-14) 온보딩 위저드 + 첫 영상 무료 플랜 참조:
 *   docs/superpowers/plans/2026-04-14-shortform-phase-k-onboarding.md
 *
 * 사용처:
 * - app/api/auth/route.js (handleMe)            — onboarding 상태 응답
 * - app/api/auth/onboarding/route.js            — 온보딩 완료 표시
 * - app/api/shortform-script/route.js (D 담당)  — 크레딧 차감 전 무료 자격 확인
 *                                                 + 성공 후 markFirstShortform
 *
 * DB 마이그레이션 패턴: lib/user-images.js 의 ensureSchema 와 동일한
 * 모듈 레벨 캐시 변수 사용 (serverless 인스턴스당 1회만 ALTER 실행).
 */
import { getDb } from '@/lib/db';

// 가입 후 첫 영상 무료 유효 기간 (일수)
export const FREE_FIRST_WINDOW_DAYS = 7;

let _schemaReady = null;

/**
 * users 테이블에 onboarding 관련 컬럼을 lazy로 추가.
 * 이미 존재하면 ALTER IF NOT EXISTS 가 no-op 처리.
 */
export async function ensureOnboardingColumns() {
  if (_schemaReady) return _schemaReady;
  _schemaReady = (async () => {
    const sql = getDb();
    await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN DEFAULT FALSE`;
    await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS first_shortform_at TIMESTAMPTZ`;
  })().catch((err) => {
    _schemaReady = null; // 실패 시 다음 호출에서 재시도
    console.error('[shortform-onboarding] ensureOnboardingColumns 실패:', err?.message);
    throw err;
  });
  return _schemaReady;
}

/**
 * 사용자 온보딩 상태 조회.
 * @param {string} email
 * @returns {Promise<{onboardingCompleted:boolean, firstShortformAt:Date|null, createdAt:Date|null}|null>}
 */
export async function getOnboardingState(email) {
  if (!email) return null;
  await ensureOnboardingColumns();
  const sql = getDb();
  const rows = await sql`
    SELECT onboarding_completed, first_shortform_at, created_at
    FROM users
    WHERE email = ${email}
    LIMIT 1
  `;
  if (!rows || rows.length === 0) return null;
  const row = rows[0];
  return {
    onboardingCompleted: Boolean(row.onboarding_completed),
    firstShortformAt: row.first_shortform_at || null,
    createdAt: row.created_at || null,
  };
}

/**
 * 온보딩 완료 표시.
 */
export async function markOnboardingCompleted(email) {
  if (!email) return;
  await ensureOnboardingColumns();
  const sql = getDb();
  await sql`UPDATE users SET onboarding_completed = TRUE WHERE email = ${email}`;
}

/**
 * 첫 숏폼 생성 시각 기록. 이미 값이 있으면 덮어쓰지 않는다.
 */
export async function markFirstShortform(email) {
  if (!email) return;
  await ensureOnboardingColumns();
  const sql = getDb();
  await sql`
    UPDATE users
    SET first_shortform_at = COALESCE(first_shortform_at, NOW())
    WHERE email = ${email}
  `;
}

/**
 * 첫 영상 무료 자격 여부 판정.
 *
 * 기준 (두 조건 모두 만족):
 * - first_shortform_at IS NULL (아직 숏폼을 만든 적 없음)
 * - created_at 가 최근 FREE_FIRST_WINDOW_DAYS (=7) 일 이내
 *
 * 실패/예외 시 `false`를 반환 (기존 크레딧 차감 흐름 유지 — 안전 실패).
 *
 * @param {string} email
 * @returns {Promise<boolean>}
 */
export async function isEligibleForFreeFirstShortform(email) {
  if (!email) return false;
  try {
    await ensureOnboardingColumns();
    const sql = getDb();
    const rows = await sql`
      SELECT first_shortform_at, created_at
      FROM users
      WHERE email = ${email}
      LIMIT 1
    `;
    if (!rows || rows.length === 0) return false;
    const row = rows[0];
    if (row.first_shortform_at) return false;
    if (!row.created_at) return false;

    const created = new Date(row.created_at).getTime();
    if (!Number.isFinite(created)) return false;
    const now = Date.now();
    const windowMs = FREE_FIRST_WINDOW_DAYS * 24 * 3600 * 1000;
    return now - created <= windowMs;
  } catch (err) {
    console.error('[shortform-onboarding] isEligibleForFreeFirstShortform 실패:', err?.message);
    return false;
  }
}

/**
 * 첫 영상 무료 로직을 /api/shortform-script 에서 한 번에 호출하기 위한 헬퍼.
 *
 * 사용 패턴 (D 에이전트 또는 post-merge 통합 시점):
 *
 *   const { freeFirst } = await checkFreeFirstShortform(email);
 *   if (!freeFirst) {
 *     const ok = await chargeCredits(email, cost, 'shortform-script');
 *     if (!ok) return 402;
 *   }
 *   // ... 대본 생성 ...
 *   if (freeFirst) await markFirstShortform(email);
 *   return { ..., freeFirstApplied: freeFirst };
 *
 * @param {string} email
 * @returns {Promise<{freeFirst: boolean}>}
 */
export async function checkFreeFirstShortform(email) {
  const freeFirst = await isEligibleForFreeFirstShortform(email);
  return { freeFirst };
}
