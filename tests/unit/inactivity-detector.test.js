// tests/unit/inactivity-detector.test.js
//
// 클라 useJobProgress inactivity timeout 순수 로직 검증.
// 3분 threshold, status 'running'일 때만 적용.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  isInactive,
  INACTIVITY_THRESHOLD_MS,
} from '../../lib/shortform/inactivity-detector.js';

test('threshold 값이 3분(180_000ms)', () => {
  assert.equal(INACTIVITY_THRESHOLD_MS, 180_000);
});

test('running + 경과 < threshold → inactive 아님', () => {
  const now = 1_000_000;
  const last = now - 2 * 60 * 1000; // 2분 전
  assert.equal(isInactive({ status: 'running', lastEventTs: last, now }), false);
});

test('running + 경과 = threshold 정확히 → inactive 아님 (초과만 true)', () => {
  const now = 1_000_000;
  const last = now - INACTIVITY_THRESHOLD_MS;
  assert.equal(isInactive({ status: 'running', lastEventTs: last, now }), false);
});

test('running + 경과 > threshold → inactive', () => {
  const now = 1_000_000;
  const last = now - (INACTIVITY_THRESHOLD_MS + 1);
  assert.equal(isInactive({ status: 'running', lastEventTs: last, now }), true);
});

test('idle 상태 + 경과 초과 → inactive 아님 (실행 중이 아님)', () => {
  const now = 1_000_000;
  const last = now - 2 * INACTIVITY_THRESHOLD_MS;
  assert.equal(isInactive({ status: 'idle', lastEventTs: last, now }), false);
});

test('complete 상태 → inactive 아님', () => {
  const now = 1_000_000;
  const last = now - 2 * INACTIVITY_THRESHOLD_MS;
  assert.equal(isInactive({ status: 'complete', lastEventTs: last, now }), false);
});

test('error 상태 → inactive 아님', () => {
  const now = 1_000_000;
  const last = now - 2 * INACTIVITY_THRESHOLD_MS;
  assert.equal(isInactive({ status: 'error', lastEventTs: last, now }), false);
});

test('lastEventTs null → inactive 아님 (아직 시작 전)', () => {
  assert.equal(isInactive({ status: 'running', lastEventTs: null, now: 1000 }), false);
});

test('lastEventTs undefined → inactive 아님 (훅 초기값)', () => {
  assert.equal(isInactive({ status: 'running', lastEventTs: undefined, now: 1000 }), false);
});
