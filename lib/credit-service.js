/**
 * lib/credit-service.js — Phase A-bis idempotent charge/refund
 *
 * Worker #3 (API + Prompt) 담당. spec §6.1.
 *
 * `lib/db.js::chargeCredits` / `refundCredits`는 이 파일의 idempotent 버전을
 * 호출하는 호환 래퍼다 — 모든 차감/환불이 이 단일 경로를 지난다.
 * 회계 이력은 credit_ledger(구매·보너스와 같은 장부)에 함께 기록하고,
 * charge_log / refund_log는 중복 방지(idempotency) 전용으로 유지한다.
 *
 * 전략 (spec §6.1):
 * - requestId(UUID) PRIMARY KEY로 차감/환불 이력 저장
 * - 같은 requestId 중복 호출은 no-op + { deduplicated: true } 반환
 * - 4xx 에러는 환불 없음, 5xx는 호출자(API 라우트)가 catch 후 refundCredit 호출
 * - DB 마이그레이션은 lazy — ensureIdempotencyTables()를 charge/refund 진입 시 호출
 */

import { getDb } from './db.js';

// 첫 호출 시 CREATE TABLE IF NOT EXISTS를 실행하도록 메모이즈
let _tablesReady = null;

/**
 * charge_log / refund_log 테이블을 lazy CREATE. 세션당 1회만 실행.
 * @returns {Promise<void>}
 */
export async function ensureIdempotencyTables() {
  if (_tablesReady) return _tablesReady;
  const sql = getDb();
  _tablesReady = (async () => {
    await sql`
      CREATE TABLE IF NOT EXISTS charge_log (
        request_id UUID PRIMARY KEY,
        user_id TEXT NOT NULL,
        amount NUMERIC(6, 2) NOT NULL,
        phase TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT now()
      )
    `;
    await sql`
      CREATE TABLE IF NOT EXISTS refund_log (
        request_id UUID PRIMARY KEY,
        user_id TEXT NOT NULL,
        amount NUMERIC(6, 2) NOT NULL,
        refund_reason TEXT NOT NULL,
        phase TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT now()
      )
    `;
  })().catch((err) => {
    _tablesReady = null; // 다음 호출에서 재시도
    throw err;
  });
  return _tablesReady;
}

/**
 * Idempotent 크레딧 차감.
 *
 * 흐름:
 *  1. ensureIdempotencyTables
 *  2. charge_log에 requestId가 이미 있으면 → { deduplicated: true } + 현재 잔액
 *  3. 잔액 확인 (pre-check, 베스트 에포트)
 *  4. INSERT INTO charge_log (PK 충돌 시 UNIQUE_VIOLATION → dedup 경로)
 *  5. UPDATE users SET credits -= amount WHERE credits >= amount
 *  6. UPDATE 실패(동시 차감으로 잔액 부족) → charge_log 보상 DELETE + throw
 *
 * @param {{ userId: string, requestId?: string, amount: number, phase: string }} params
 * @returns {Promise<{ charged: number, balance: number, deduplicated: boolean, requestId: string }>}
 * @throws {Error & { code: 'insufficient_credits' | 'invalid_input', balance?: number }}
 */
export async function chargeCredit({ userId, requestId, amount, phase }) {
  validateInput({ userId, amount, phase });
  const rid = normalizeRequestId(requestId);

  await ensureIdempotencyTables();
  const sql = getDb();

  // 1. 기존 차감 이력 확인 (PK lookup)
  const existingCharge = await sql`
    SELECT amount FROM charge_log WHERE request_id = ${rid}
  `;
  if (existingCharge.length > 0) {
    const balance = await readBalance(sql, userId);
    return { charged: 0, balance, deduplicated: true, requestId: rid };
  }

  // 2. 잔액 사전 확인 — 베스트 에포트 (race 시 5단계 UPDATE에서 최종 판정)
  const preBalance = await readBalance(sql, userId);
  if (preBalance < amount) {
    throwInsufficient(preBalance);
  }

  // 3. charge_log INSERT — PK 충돌 = 동시 차감 감지
  try {
    await sql`
      INSERT INTO charge_log (request_id, user_id, amount, phase)
      VALUES (${rid}, ${userId}, ${amount}, ${phase})
    `;
  } catch (err) {
    if (isUniqueViolation(err)) {
      const balance = await readBalance(sql, userId);
      return { charged: 0, balance, deduplicated: true, requestId: rid };
    }
    throw err;
  }

  // 4. 원자적 잔액 차감 — UPDATE 자체가 throw하면(네트워크 등) charge_log 보상
  //    DELETE 후 rethrow. 보상 없이 로그만 남으면 같은 requestId 재시도가 dedup에
  //    걸려 차감 없이 성공 응답을 반환하는 무결성 버그가 됨.
  let result;
  try {
    result = await sql`
      UPDATE users
      SET credits = credits - ${amount}, updated_at = NOW()
      WHERE email = ${userId} AND credits >= ${amount}
      RETURNING credits
    `;
  } catch (err) {
    await sql`DELETE FROM charge_log WHERE request_id = ${rid}`.catch(() => {});
    throw err;
  }

  if (result.length === 0) {
    // 동시 차감으로 잔액 부족 — charge_log 보상 DELETE
    await sql`DELETE FROM charge_log WHERE request_id = ${rid}`.catch(() => {});
    throwInsufficient(await readBalance(sql, userId));
  }

  await writeLedger(sql, { userId, amount: -amount, type: 'usage', reason: phase });

  return {
    charged: Number(amount),
    balance: Number(result[0].credits),
    deduplicated: false,
    requestId: rid,
  };
}

/**
 * Idempotent 크레딧 환불.
 *
 * 흐름:
 *  1. ensureIdempotencyTables
 *  2. refund_log PK lookup → 있으면 { deduplicated: true }
 *  3. INSERT INTO refund_log (PK 충돌 시 UNIQUE_VIOLATION → dedup)
 *  4. UPDATE users SET credits += amount
 *
 * 4xx 에러는 환불 X (호출자가 이 함수를 부르지 말 것).
 * 5xx는 자동 환불 대상 — 호출자가 catch 후 호출.
 *
 * @param {{
 *   userId: string,
 *   requestId?: string,
 *   amount: number,
 *   refundReason: string,
 *   phase: string,
 * }} params
 * @returns {Promise<{ refunded: number, balance: number, deduplicated: boolean, requestId: string }>}
 * @throws {Error & { code: 'invalid_input' }}
 */
export async function refundCredit({ userId, requestId, amount, refundReason, phase }) {
  validateInput({ userId, amount, phase });
  if (!refundReason || typeof refundReason !== 'string') {
    const err = new Error('refundReason is required');
    err.code = 'invalid_input';
    throw err;
  }
  const rid = normalizeRequestId(requestId);

  await ensureIdempotencyTables();
  const sql = getDb();

  // 1. 기존 환불 이력
  const existing = await sql`
    SELECT amount FROM refund_log WHERE request_id = ${rid}
  `;
  if (existing.length > 0) {
    const balance = await readBalance(sql, userId);
    return { refunded: 0, balance, deduplicated: true, requestId: rid };
  }

  // 2. refund_log INSERT
  try {
    await sql`
      INSERT INTO refund_log (request_id, user_id, amount, refund_reason, phase)
      VALUES (${rid}, ${userId}, ${amount}, ${refundReason}, ${phase})
    `;
  } catch (err) {
    if (isUniqueViolation(err)) {
      const balance = await readBalance(sql, userId);
      return { refunded: 0, balance, deduplicated: true, requestId: rid };
    }
    throw err;
  }

  // 3. 잔액 증가
  const result = await sql`
    UPDATE users
    SET credits = credits + ${amount}, updated_at = NOW()
    WHERE email = ${userId}
    RETURNING credits
  `;

  // users row가 없는 경우(삭제된 계정)는 refund_log만 남기고 balance 0 반환
  const balance = result.length > 0 ? Number(result[0].credits) : 0;

  await writeLedger(sql, { userId, amount, type: 'refund', reason: refundReason });

  return {
    refunded: Number(amount),
    balance,
    deduplicated: false,
    requestId: rid,
  };
}

/**
 * requestId로 차감/환불 이력 조회 (테스트·디버깅용).
 *
 * @param {string} requestId
 * @returns {Promise<{ charges: Array, refunds: Array }>}
 */
export async function getLedger(requestId) {
  const rid = normalizeRequestId(requestId, { allowNull: true });
  if (!rid) return { charges: [], refunds: [] };

  await ensureIdempotencyTables();
  const sql = getDb();
  const charges = await sql`SELECT * FROM charge_log WHERE request_id = ${rid}`;
  const refunds = await sql`SELECT * FROM refund_log WHERE request_id = ${rid}`;
  return { charges, refunds };
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

function validateInput({ userId, amount, phase }) {
  if (!userId || typeof userId !== 'string') {
    const err = new Error('userId is required');
    err.code = 'invalid_input';
    throw err;
  }
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
    const err = new Error('amount must be a positive number');
    err.code = 'invalid_input';
    throw err;
  }
  if (!phase || typeof phase !== 'string') {
    const err = new Error('phase is required');
    err.code = 'invalid_input';
    throw err;
  }
}

function normalizeRequestId(requestId, { allowNull = false } = {}) {
  if (!requestId || typeof requestId !== 'string') {
    if (allowNull) return null;
    // globalThis.crypto — Node 19+ / 브라우저 공통 (node:crypto import 시 클라이언트 번들이 깨짐)
    return globalThis.crypto.randomUUID();
  }
  // UUID 형식이 아니면 그대로 두되, PG UUID 컬럼에서 파싱 오류가 날 수 있음.
  // 현재는 서버가 crypto.randomUUID()로 생성하거나 클라이언트가 표준 UUID를 보내는 계약.
  return requestId;
}

// credit_ledger 회계 기록 — non-fatal (장부 기록 실패가 차감/환불 자체를 깨지 않게)
export async function writeLedger(sql, { userId, amount, type, reason }) {
  try {
    await sql`INSERT INTO credit_ledger (user_email, amount, type, reason)
      VALUES (${userId}, ${amount}, ${type}, ${reason})`;
  } catch (err) {
    console.error('[credit-service] credit_ledger write failed:', err.message, { userId, amount, type, reason });
  }
}

async function readBalance(sql, userId) {
  const rows = await sql`SELECT credits FROM users WHERE email = ${userId}`;
  return rows.length > 0 ? Number(rows[0].credits) : 0;
}

function throwInsufficient(balance) {
  const err = new Error('insufficient_credits');
  err.code = 'insufficient_credits';
  err.balance = Number(balance || 0);
  throw err;
}

function isUniqueViolation(err) {
  // PG UNIQUE_VIOLATION = 23505
  if (err && err.code === '23505') return true;
  const msg = err?.message || '';
  return /duplicate key|unique.*constraint/i.test(msg);
}
