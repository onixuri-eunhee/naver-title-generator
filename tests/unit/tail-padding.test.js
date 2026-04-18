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

test('audioRealDurationSec 0이면 FALLBACK', () => {
  const r = computeTailPadding({ audioRealDurationSec: 0, charEndSec: 9, fps: 30 });
  assert.equal(r, FALLBACK_TAIL_PADDING_FRAMES);
});

test('audioRealDurationSec 있으면 safety margin 9f (charEndSec 무관)', () => {
  const r1 = computeTailPadding({ audioRealDurationSec: 10, charEndSec: 10, fps: 30 });
  const r2 = computeTailPadding({ audioRealDurationSec: 11, charEndSec: 10, fps: 30 });
  const r3 = computeTailPadding({ audioRealDurationSec: 9, charEndSec: 10, fps: 30 });
  const r4 = computeTailPadding({ audioRealDurationSec: 30.5, charEndSec: 30.0, fps: 30 });
  assert.equal(r1, 9);
  assert.equal(r2, 9);
  assert.equal(r3, 9);
  assert.equal(r4, 9);
});

test('fps 24 — ceil(0.3*24) = 8f, MIN 9로 올림', () => {
  const r = computeTailPadding({ audioRealDurationSec: 10, charEndSec: 10, fps: 24 });
  assert.equal(r, MIN_TAIL_PADDING_FRAMES);
});

test('상수 값 회귀', () => {
  assert.equal(FALLBACK_TAIL_PADDING_FRAMES, 90);
  assert.equal(MIN_TAIL_PADDING_FRAMES, 9);
  assert.equal(SAFETY_BUFFER_SEC, 0.3);
});
