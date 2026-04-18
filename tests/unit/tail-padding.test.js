// tests/unit/tail-padding.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeTailPadding,
  FALLBACK_TAIL_PADDING_FRAMES,
  MIN_TAIL_PADDING_FRAMES,
  SAFETY_BUFFER_SEC,
} from '../../lib/shortform/tail-padding.js';

test('fps 미지정 → throw', () => {
  assert.throws(
    () => computeTailPadding({ audioRealDurationSec: 10, charEndSec: 9 }),
    /fps is required/,
  );
});

test('audioRealDurationSec 없으면 FALLBACK (90f)', () => {
  const r = computeTailPadding({ audioRealDurationSec: null, charEndSec: 9, fps: 30 });
  assert.equal(r, FALLBACK_TAIL_PADDING_FRAMES);
});

test('charEndSec 없으면 FALLBACK', () => {
  const r = computeTailPadding({ audioRealDurationSec: 10, charEndSec: null, fps: 30 });
  assert.equal(r, FALLBACK_TAIL_PADDING_FRAMES);
});

test('audioRealDurationSec 0이면 FALLBACK', () => {
  const r = computeTailPadding({ audioRealDurationSec: 0, charEndSec: 9, fps: 30 });
  assert.equal(r, FALLBACK_TAIL_PADDING_FRAMES);
});

test('drift 없고 buffer만 — ceil(0.3*30) = 9f', () => {
  const r = computeTailPadding({ audioRealDurationSec: 10, charEndSec: 10, fps: 30 });
  assert.equal(r, 9);
});

test('drift 1초 + buffer 0.3초 → ceil(1.3*30) = 39f', () => {
  const r = computeTailPadding({ audioRealDurationSec: 11, charEndSec: 10, fps: 30 });
  assert.equal(r, 39);
});

test('drift 음수(실 오디오가 timestamps보다 짧음) → max 0으로 clamp', () => {
  const r = computeTailPadding({ audioRealDurationSec: 9, charEndSec: 10, fps: 30 });
  assert.equal(r, 9); // ceil(0.3*30) = 9
});

test('fps 24 — ceil(0.3*24) = 8f, MIN 9로 올림', () => {
  const r = computeTailPadding({ audioRealDurationSec: 10, charEndSec: 10, fps: 24 });
  assert.equal(r, MIN_TAIL_PADDING_FRAMES);
});

test('실제 시나리오 — 30초 영상, drift 0.5초 → ceil(0.8*30) = 24f (기존 90f에서 단축)', () => {
  const r = computeTailPadding({ audioRealDurationSec: 30.5, charEndSec: 30.0, fps: 30 });
  assert.equal(r, 24);
  assert.ok(r < FALLBACK_TAIL_PADDING_FRAMES, 'FALLBACK보다 작아야 개선');
});

test('상수 값 회귀', () => {
  assert.equal(FALLBACK_TAIL_PADDING_FRAMES, 90);
  assert.equal(MIN_TAIL_PADDING_FRAMES, 9);
  assert.equal(SAFETY_BUFFER_SEC, 0.3);
});
