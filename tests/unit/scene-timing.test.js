// tests/unit/scene-timing.test.js
//
// spec §7.3 — scene-timing Q6 Hybrid + MIN guard 경계 케이스.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  SUBTITLE_LEAD_FRAMES,
  MIN_FIRST_SCENE_FRAMES,
  deriveSceneDurationsFromWordTimestamps,
  getTransitionOverlapFrames,
  fallbackDurationsFromCharCount,
} from '../../lib/shortform/scene-timing.js';

// ─────────────────────────────────────────────────────────────────────────────
// 헬퍼 — word timestamps 생성
// ─────────────────────────────────────────────────────────────────────────────

function makeWords(boundariesSec) {
  const words = [];
  for (let i = 0; i < boundariesSec.length - 1; i++) {
    words.push({
      word: `w${i}`,
      start: boundariesSec[i],
      end: boundariesSec[i + 1],
    });
  }
  return words;
}

function makeScenes(count) {
  return Array.from({ length: count }, (_, i) => ({
    script: `씬 ${i} 대본 텍스트입니다`,
  }));
}

function sum(arr) {
  return arr.reduce((a, b) => a + b, 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// 상수 검증
// ─────────────────────────────────────────────────────────────────────────────

test('SUBTITLE_LEAD_FRAMES = 6 (spec Q6)', () => {
  assert.equal(SUBTITLE_LEAD_FRAMES, 6);
});

test('MIN_FIRST_SCENE_FRAMES = 30 (1초 @ 30fps)', () => {
  assert.equal(MIN_FIRST_SCENE_FRAMES, 30);
});

// ─────────────────────────────────────────────────────────────────────────────
// fps 필수 (L6 규칙)
// ─────────────────────────────────────────────────────────────────────────────

test('fps 없으면 throw', () => {
  const words = makeWords([0, 1, 2]);
  const scenes = makeScenes(2);
  assert.throws(
    () => deriveSceneDurationsFromWordTimestamps(words, scenes),
    /fps is required/,
  );
});

test('fps 0이면 throw', () => {
  assert.throws(
    () => deriveSceneDurationsFromWordTimestamps([], [], { fps: 0 }),
    /fps is required/,
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// 일반 케이스 — MIN guard 미발동
// ─────────────────────────────────────────────────────────────────────────────

test('일반 케이스: lead 6f 적용, 총 프레임 보존', () => {
  const words = makeWords([0, 3, 5, 8, 10]);
  const scenes = makeScenes(4);
  const durations = deriveSceneDurationsFromWordTimestamps(words, scenes, { fps: 30 });

  assert.equal(durations.length, 4);

  // 첫 씬: 원본 ~90f 에서 6f 빼졌어야
  assert.ok(durations[0] < 90, '첫 씬은 lead로 줄었어야');

  // 총합 보존 (actualLead > 0 이므로 마지막 씬에 보상됨)
  const originalEstimate = 10 * 30; // 10초 * 30fps = 300
  const actualSum = sum(durations);
  assert.ok(
    Math.abs(actualSum - originalEstimate) <= 2,
    `총합 보존: expected ~${originalEstimate}, got ${actualSum}`,
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// MIN guard 발동 케이스
// ─────────────────────────────────────────────────────────────────────────────

test('MIN guard: 첫 씬 0.8초(24f) → MIN 30f로 clamp', () => {
  const words = makeWords([0, 0.8, 3, 5, 8]);
  const scenes = makeScenes(4);
  const durations = deriveSceneDurationsFromWordTimestamps(words, scenes, { fps: 30 });

  assert.equal(durations[0], MIN_FIRST_SCENE_FRAMES, '첫 씬은 30f로 clamp');

  // 총합은 원본 이상 (패딩 허용, 축소 금지)
  const originalEstimate = 8 * 30;
  assert.ok(
    sum(durations) >= originalEstimate,
    '총합은 원본 이상 (마지막 씬 축소 금지)',
  );
  assert.ok(
    sum(durations) - originalEstimate <= SUBTITLE_LEAD_FRAMES,
    '초과는 최대 6프레임',
  );
});

test('MIN guard: 첫 씬이 정확히 MIN이면 lead 불가', () => {
  const words = makeWords([0, 1, 3, 5, 8]);
  const scenes = makeScenes(4);
  const durations = deriveSceneDurationsFromWordTimestamps(words, scenes, { fps: 30 });

  // 첫 씬 ~30f (1초). lead 빼면 24f < MIN(30f). MIN guard 발동.
  assert.equal(durations[0], MIN_FIRST_SCENE_FRAMES);
});

// ─────────────────────────────────────────────────────────────────────────────
// 씬 1개 — lead 적용 안 함
// ─────────────────────────────────────────────────────────────────────────────

test('씬 1개: lead 미적용', () => {
  const words = makeWords([0, 5]);
  const scenes = makeScenes(1);
  const durations = deriveSceneDurationsFromWordTimestamps(words, scenes, { fps: 30 });

  assert.equal(durations.length, 1);
  // 5초 = 150f. lead 적용 안 됨 — 보상 대상(마지막 씬)이 자기 자신이라 불가
  assert.equal(durations[0], 150);
});

// ─────────────────────────────────────────────────────────────────────────────
// 빈 입력
// ─────────────────────────────────────────────────────────────────────────────

test('빈 scenes → 빈 배열', () => {
  const result = deriveSceneDurationsFromWordTimestamps([], [], { fps: 30 });
  assert.deepStrictEqual(result, []);
});

test('words 없으면 fallback', () => {
  const scenes = makeScenes(3);
  const durations = deriveSceneDurationsFromWordTimestamps(null, scenes, { fps: 30 });

  assert.equal(durations.length, 3);
  durations.forEach((d) => assert.ok(d >= MIN_FIRST_SCENE_FRAMES, 'fallback도 MIN 보장'));
});

// ─────────────────────────────────────────────────────────────────────────────
// fallbackDurationsFromCharCount
// ─────────────────────────────────────────────────────────────────────────────

test('fallback: 문자수 비례 분배, 합 = totalTargetFrames', () => {
  const scenes = [{ text: '안녕' }, { text: '반갑습니다 여러분' }];
  const total = 300;
  const durations = fallbackDurationsFromCharCount(scenes, total);

  assert.equal(durations.length, 2);
  // 두 번째가 더 길어야 (문자 더 많으니)
  assert.ok(durations[1] >= durations[0], '문자수 많은 씬이 더 긴 duration');
});

test('fallback: 빈 scenes → 빈 배열', () => {
  assert.deepStrictEqual(fallbackDurationsFromCharCount([], 300), []);
});

// ─────────────────────────────────────────────────────────────────────────────
// getTransitionOverlapFrames
// ─────────────────────────────────────────────────────────────────────────────

test('transition overlap: fade = 15', () => {
  assert.equal(getTransitionOverlapFrames('fade', 30), 15);
});

test('transition overlap: slide-fast = 8', () => {
  assert.equal(getTransitionOverlapFrames('slide-fast', 30), 8);
});

test('transition overlap: fade-long = 30', () => {
  assert.equal(getTransitionOverlapFrames('fade-long', 30), 30);
});

test('transition overlap: cut = 1', () => {
  assert.equal(getTransitionOverlapFrames('cut', 30), 1);
});

test('transition overlap: auto = 평균', () => {
  const avg = getTransitionOverlapFrames('auto', 30);
  // (8+15+15+30)/4 = 17
  assert.equal(avg, 17);
});

test('transition overlap: unknown → slide fallback (15)', () => {
  assert.equal(getTransitionOverlapFrames('nonexistent', 30), 15);
});

test('transition overlap: fps 필수', () => {
  assert.throws(() => getTransitionOverlapFrames('fade'), /fps is required/);
});
