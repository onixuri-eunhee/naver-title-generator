// tests/unit/shared-prompts-rollout.test.js
//
// simpleHash 결정성 + resolveRolloutFlag 분기 논리 검증.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  simpleHash,
  resolveRolloutFlag,
} from '../../lib/shared-prompts/rollout.js';

test('simpleHash — 결정적 (같은 입력 → 같은 해시)', () => {
  assert.equal(simpleHash('foo@bar.com'), simpleHash('foo@bar.com'));
});

test('simpleHash — 0 이상 정수', () => {
  const h = simpleHash('user@example.com');
  assert.ok(Number.isInteger(h));
  assert.ok(h >= 0);
});

test('simpleHash — 서로 다른 입력은 대체로 다른 해시', () => {
  const a = simpleHash('a@x.com');
  const b = simpleHash('b@x.com');
  const c = simpleHash('c@x.com');
  const uniq = new Set([a, b, c]);
  assert.ok(uniq.size >= 2, 'too many collisions');
});

test('simpleHash — 빈 문자열도 안전', () => {
  const h = simpleHash('');
  assert.ok(Number.isInteger(h) && h >= 0);
});

test('resolveRolloutFlag — rollout=0 → false', () => {
  assert.equal(resolveRolloutFlag({ email: 'a@x.com', rollout: 0 }), false);
});

test('resolveRolloutFlag — rollout=100 → true (모든 사용자)', () => {
  assert.equal(resolveRolloutFlag({ email: 'a@x.com', rollout: 100 }), true);
  assert.equal(resolveRolloutFlag({ email: 'b@y.com', rollout: 100 }), true);
});

test('resolveRolloutFlag — rollout 음수/NaN → false (안전 fallback)', () => {
  assert.equal(resolveRolloutFlag({ email: 'a@x.com', rollout: -5 }), false);
  assert.equal(resolveRolloutFlag({ email: 'a@x.com', rollout: NaN }), false);
  assert.equal(resolveRolloutFlag({ email: 'a@x.com', rollout: 'x' }), false);
});

test('resolveRolloutFlag — 같은 email+rollout 은 항상 같은 결과 (sticky)', () => {
  const r1 = resolveRolloutFlag({ email: 'user@test.com', rollout: 10 });
  const r2 = resolveRolloutFlag({ email: 'user@test.com', rollout: 10 });
  assert.equal(r1, r2);
});

test('resolveRolloutFlag — 100명 sample 에서 rollout=10 이면 대략 10% 근처', () => {
  let hits = 0;
  for (let i = 0; i < 100; i++) {
    if (resolveRolloutFlag({ email: `user${i}@test.com`, rollout: 10 })) hits++;
  }
  assert.ok(hits >= 3 && hits <= 25, `hits=${hits} out of 5~25`);
});

test('resolveRolloutFlag — email 누락 시 anon 취급', () => {
  const r1 = resolveRolloutFlag({ email: null, rollout: 50 });
  const r2 = resolveRolloutFlag({ email: null, rollout: 50 });
  assert.equal(r1, r2);
  assert.equal(typeof r1, 'boolean');
});
