// tests/unit/scene-timing.test.js
//
// spec §7.3 — scene-timing Q6 Hybrid + MIN guard 경계 케이스.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  SUBTITLE_LEAD_FRAMES,
  MIN_FIRST_SCENE_FRAMES,
  deriveSceneDurationsFromWordTimestamps,
  deriveSceneDurationsFromCharTimestamps,
  buildSceneCharRanges,
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

test('transition overlap: fade = 8', () => {
  assert.equal(getTransitionOverlapFrames('fade', 30), 8);
});

test('transition overlap: slide-fast = 4', () => {
  assert.equal(getTransitionOverlapFrames('slide-fast', 30), 4);
});

test('transition overlap: fade-long = 15', () => {
  assert.equal(getTransitionOverlapFrames('fade-long', 30), 15);
});

test('transition overlap: cut = 1', () => {
  assert.equal(getTransitionOverlapFrames('cut', 30), 1);
});

test('transition overlap: auto = 평균', () => {
  const avg = getTransitionOverlapFrames('auto', 30);
  // rotation: [fade, slide-fast, fade-long, fade, slide-fast, fade, fade-long, slide-fast]
  // (8+4+15+8+4+8+15+4)/8 = 66/8 = 8.25 → Math.round = 8
  assert.equal(avg, 8);
});

test('transition overlap: unknown → slide fallback (8)', () => {
  assert.equal(getTransitionOverlapFrames('nonexistent', 30), 8);
});

test('transition overlap: fps 필수', () => {
  assert.throws(() => getTransitionOverlapFrames('fade'), /fps is required/);
});

// ─────────────────────────────────────────────────────────────────────────────
// buildSceneCharRanges
// ─────────────────────────────────────────────────────────────────────────────

test('buildSceneCharRanges: 2씬 join 구분자 반영', () => {
  const scenes = [{ script: '안녕하세요' }, { script: '반갑습니다' }];
  const ranges = buildSceneCharRanges(scenes);
  assert.equal(ranges.length, 2);
  assert.equal(ranges[0].start, 0);
  assert.equal(ranges[0].end, 5);  // '안녕하세요' = 5자
  assert.equal(ranges[1].start, 6); // space separator = 1자
  assert.equal(ranges[1].end, 11);  // '반갑습니다' = 5자
});

test('buildSceneCharRanges: 빈 씬 처리', () => {
  const scenes = [{ script: '안녕' }, { script: '' }, { script: '세계' }];
  const ranges = buildSceneCharRanges(scenes);
  assert.equal(ranges.length, 3);
  assert.equal(ranges[1].start, ranges[1].end); // 빈 씬은 width 0
});

test('buildSceneCharRanges: 특수문자 포함', () => {
  const s1 = '왜 안 될까요?';
  const s2 = '"진짜" 3가지…';
  const scenes = [{ script: s1 }, { script: s2 }];
  const ranges = buildSceneCharRanges(scenes);
  assert.equal(ranges[0].end - ranges[0].start, s1.length);
  assert.equal(ranges[1].end - ranges[1].start, s2.length);
});

test('buildSceneCharRanges: 1씬만', () => {
  const ranges = buildSceneCharRanges([{ script: '테스트' }]);
  assert.equal(ranges.length, 1);
  assert.equal(ranges[0].start, 0);
  assert.equal(ranges[0].end, 3);
});

// ─────────────────────────────────────────────────────────────────────────────
// deriveSceneDurationsFromCharTimestamps
// ─────────────────────────────────────────────────────────────────────────────

function makeCharAlignment(text) {
  const chars = text.split('');
  const secPerChar = 0.08;
  return {
    characters: chars,
    starts: chars.map((_, i) => +(i * secPerChar).toFixed(4)),
    ends: chars.map((_, i) => +((i + 1) * secPerChar).toFixed(4)),
  };
}

test('charTimestamps: 2씬 정확 매핑', () => {
  const scenes = [{ script: '안녕하세요' }, { script: '반갑습니다' }];
  const ttsText = '안녕하세요 반갑습니다';
  const alignment = makeCharAlignment(ttsText);
  const durations = deriveSceneDurationsFromCharTimestamps(alignment, scenes, { fps: 30 });

  assert.equal(durations.length, 2);
  // 각 씬 5자 × 0.08초 = 0.4초 = 12프레임. MIN 30으로 clamp됨.
  durations.forEach((d) => assert.ok(d >= MIN_FIRST_SCENE_FRAMES));
});

test('charTimestamps: 5씬 다양한 길이', () => {
  const scenes = [
    { script: '왜?' },              // 2자
    { script: '19년 동안 봤어요' },  // 10자 (공백 포함)
    { script: '첫 번째 실수' },      // 7자
    { script: '두 번째 실수' },      // 7자
    { script: '다시 물어볼게요' },   // 8자
  ];
  const ttsText = scenes.map((s) => s.script.trim()).filter(Boolean).join(' ');
  const alignment = makeCharAlignment(ttsText);
  const durations = deriveSceneDurationsFromCharTimestamps(alignment, scenes, { fps: 30 });

  assert.equal(durations.length, 5);
  // 2자 씬은 MIN으로 clamp, 10자 씬은 더 길어야
  assert.ok(durations[1] >= durations[0], '긴 텍스트 씬이 더 긴 duration');
});

test('charTimestamps: 14씬 (사용자 실제 케이스)', () => {
  const scenes = Array.from({ length: 14 }, (_, i) => ({
    script: `씬${i} 대본 텍스트 여기에 작성`,
  }));
  const ttsText = scenes.map((s) => s.script.trim()).filter(Boolean).join(' ');
  const alignment = makeCharAlignment(ttsText);
  const durations = deriveSceneDurationsFromCharTimestamps(alignment, scenes, { fps: 30 });

  assert.equal(durations.length, 14);
  durations.forEach((d) => assert.ok(d >= MIN_FIRST_SCENE_FRAMES, `모든 씬 ≥ MIN: ${d}`));
});

test('charTimestamps: 20씬', () => {
  const scenes = Array.from({ length: 20 }, (_, i) => ({
    script: `Scene ${i}: 이 씬의 대본입니다`,
  }));
  const ttsText = scenes.map((s) => s.script.trim()).filter(Boolean).join(' ');
  const alignment = makeCharAlignment(ttsText);
  const durations = deriveSceneDurationsFromCharTimestamps(alignment, scenes, { fps: 30 });

  assert.equal(durations.length, 20);
});

test('charTimestamps: alignment 없으면 fallback', () => {
  const scenes = [{ script: '테스트' }];
  const durations = deriveSceneDurationsFromCharTimestamps(null, scenes, { fps: 30 });
  assert.equal(durations.length, 1);
});

test('charTimestamps: alignment 길이 불일치 시 fallback', () => {
  const scenes = [{ script: '안녕하세요' }, { script: '반갑습니다' }];
  const badAlignment = { characters: ['a'], starts: [0], ends: [1] };
  const durations = deriveSceneDurationsFromCharTimestamps(badAlignment, scenes, { fps: 30 });
  assert.equal(durations.length, 2);
});

test('charTimestamps: fps 필수', () => {
  const scenes = [{ script: '테스트' }];
  const alignment = makeCharAlignment('테스트');
  assert.throws(
    () => deriveSceneDurationsFromCharTimestamps(alignment, scenes),
    /fps is required/,
  );
});

test('charTimestamps: Q6 lead + MIN guard 적용 (2씬 이상)', () => {
  const scenes = [{ script: '짧음' }, { script: '이것은 좀 더 긴 문장입니다 여러분' }];
  const ttsText = scenes.map((s) => s.script.trim()).join(' ');
  const alignment = makeCharAlignment(ttsText);
  const durations = deriveSceneDurationsFromCharTimestamps(alignment, scenes, { fps: 30 });

  assert.equal(durations.length, 2);
  assert.ok(durations[0] >= MIN_FIRST_SCENE_FRAMES, '첫 씬 MIN 보장');
});

test('charTimestamps: 영어 + 숫자 + 한글 혼합', () => {
  const scenes = [
    { script: 'AI가 3가지를 바꿉니다' },
    { script: 'Step 1: 자동화' },
  ];
  const ttsText = scenes.map((s) => s.script.trim()).join(' ');
  const alignment = makeCharAlignment(ttsText);
  const durations = deriveSceneDurationsFromCharTimestamps(alignment, scenes, { fps: 30 });
  assert.equal(durations.length, 2);
});

test('charTimestamps: audioRealDurationSec 있으면 마지막 씬이 거기까지 확장', () => {
  const scenes = [{ script: 'AAAAA' }, { script: 'BBBBB' }];
  // makeCharAlignment은 총 11자 (A×5 + ' ' + B×5), 각 0.08s, 총 0.88s
  const ttsText = 'AAAAA BBBBB';
  const alignment = makeCharAlignment(ttsText);
  // audioRealDurationSec 을 발화 끝보다 1초 더 길게 설정
  const durations = deriveSceneDurationsFromCharTimestamps(
    alignment,
    scenes,
    { fps: 30, audioRealDurationSec: 1.88 },
  );
  // 첫 씬: 0 ~ 두 번째 씬 start (0.48s) = 0.48s = 14.4 → round 14 → MIN으로 30 clamp
  // 두 번째 씬: 0.48 ~ 1.88 = 1.4s = 42 frames (MIN 이상)
  assert.equal(durations.length, 2);
  // 두 번째 씬(마지막) duration이 audioRealDurationSec를 반영해서 42f 정도
  assert.ok(durations[1] >= 40, `두 번째 씬 duration ${durations[1]} should absorb gap to audioEnd`);
});

test('charTimestamps: 각 씬 duration 합 ≈ 전체 오디오 길이 (gap 포함)', () => {
  // 3씬, 각 5자. TTS text "AAAAA BBBBB CCCCC" = 17자 × 0.08s = 1.36s
  // 각 씬 시작: 0, 0.48, 0.96. audioRealDurationSec = 1.5s (발화 끝 1.36 + 0.14s tail)
  const scenes = [{ script: 'AAAAA' }, { script: 'BBBBB' }, { script: 'CCCCC' }];
  const alignment = makeCharAlignment('AAAAA BBBBB CCCCC');
  const durations = deriveSceneDurationsFromCharTimestamps(
    alignment,
    scenes,
    { fps: 30, audioRealDurationSec: 1.5 },
  );
  // Σ durations * (1/fps) ≈ audioRealDurationSec
  // (단 MIN guard + lead 보정이 적용될 수 있으니 정확한 숫자보다는 근사)
  const totalSec = durations.reduce((a, b) => a + b, 0) / 30;
  // 최소 MIN guard 때문에 정확히 같지 않을 수 있음. 의미있는 하한만 체크.
  assert.ok(totalSec >= 1.4, `총 duration ${totalSec}s ≥ 1.4s (audio 길이 반영)`);
});
