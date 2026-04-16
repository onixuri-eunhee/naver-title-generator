// tests/integration/idempotency.test.js
//
// spec §7.7 — charge/refund idempotency 왕복 테스트.
//
// ⚠️ 이 테스트는 Neon 브랜치 DB가 필요합니다.
//    POSTGRES_URL 환경 변수가 없으면 자동 스킵됩니다.
//
// 실행: node --env-file=.env.local --test tests/integration/idempotency.test.js

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

const POSTGRES_URL = process.env.POSTGRES_URL;
const SKIP_REASON = POSTGRES_URL
  ? null
  : 'POSTGRES_URL 환경 변수 없음 — 통합 테스트 스킵 (node --env-file=.env.local 으로 실행 필요)';

let chargeCredit, refundCredit, ensureIdempotencyTables;

describe('idempotency integration', { skip: SKIP_REASON }, () => {
  before(async () => {
    ({ chargeCredit, refundCredit, ensureIdempotencyTables } =
      await import('../../lib/credit-service.js'));
    await ensureIdempotencyTables();
  });

  test('같은 requestId로 charge 2번 → 1번만 차감', async () => {
    const reqId = crypto.randomUUID();
    const userId = `test-${crypto.randomUUID().slice(0, 8)}`;

    const r1 = await chargeCredit({ userId, requestId: reqId, amount: 1.0, phase: 'test' });
    const r2 = await chargeCredit({ userId, requestId: reqId, amount: 1.0, phase: 'test' });

    assert.ok(r1.charged > 0 || r2.charged > 0, '둘 중 하나는 실제 차감');
    assert.ok(r1.deduplicated || r2.deduplicated, '둘 중 하나는 중복 감지');
    assert.ok(!(r1.charged > 0 && r2.charged > 0), '둘 다 차감되면 안 됨');
  });

  test('같은 requestId로 refund 2번 → 1번만 환불', async () => {
    const reqId = crypto.randomUUID();
    const userId = `test-${crypto.randomUUID().slice(0, 8)}`;

    const r1 = await refundCredit({
      userId, requestId: reqId, amount: 1.0,
      refundReason: 'claude_5xx', phase: 'test',
    });
    const r2 = await refundCredit({
      userId, requestId: reqId, amount: 1.0,
      refundReason: 'claude_5xx', phase: 'test',
    });

    assert.equal(r1.refunded, true, '첫 환불 성공');
    assert.equal(r2.refunded, false, '중복 환불은 no-op');
  });

  test('charge → refund 같은 requestId로 양방향 추적', async () => {
    const baseId = crypto.randomUUID();
    const userId = `test-${crypto.randomUUID().slice(0, 8)}`;

    await chargeCredit({
      userId, requestId: baseId, amount: 0.3, phase: 'test-charge',
    });

    const refund = await refundCredit({
      userId, requestId: `${baseId}:refund`, amount: 0.3,
      refundReason: 'claude_5xx', phase: 'test-refund',
    });

    assert.equal(refund.refunded, true, 'refund with :refund suffix 성공');
  });

  test('서로 다른 requestId → 각각 독립 차감', async () => {
    const userId = `test-${crypto.randomUUID().slice(0, 8)}`;
    const reqId1 = crypto.randomUUID();
    const reqId2 = crypto.randomUUID();

    const r1 = await chargeCredit({ userId, requestId: reqId1, amount: 0.5, phase: 'test' });
    const r2 = await chargeCredit({ userId, requestId: reqId2, amount: 0.3, phase: 'test' });

    assert.ok(!r1.deduplicated, '첫 요청은 새 차감');
    assert.ok(!r2.deduplicated, '두 번째 요청도 새 차감 (다른 ID)');
  });
});
