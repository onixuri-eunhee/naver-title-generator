// tests/unit/voice-upload-remap.test.js
//
// Phase F — scene 시간축 재분배 단위 테스트
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { remapScenesToAudio } from '../../lib/shortform/voice-upload-remap.js';

test('remapScenesToAudio — 1.5배 scale', () => {
  const scenes = [
    { id: 'hook', startTime: 0, duration: 2, script: 'a' },
    { id: 'body', startTime: 2, duration: 4, script: 'b' },
    { id: 'cta', startTime: 6, duration: 2, script: 'c' },
  ];
  const result = remapScenesToAudio(scenes, 8, 12);
  assert.equal(result.length, 3);
  assert.equal(result[0].startTime, 0);
  assert.equal(result[0].duration, 3);
  assert.equal(result[1].startTime, 3);
  assert.equal(result[1].duration, 6);
  assert.equal(result[2].startTime, 9);
  assert.equal(result[2].duration, 3);
});

test('remapScenesToAudio — scene 필드 보존', () => {
  const scenes = [{ id: 'hook', startTime: 0, duration: 2, script: '원본', layoutType: 'textCard' }];
  const result = remapScenesToAudio(scenes, 2, 3);
  assert.equal(result[0].script, '원본');
  assert.equal(result[0].layoutType, 'textCard');
  assert.equal(result[0].duration, 3);
});

test('remapScenesToAudio — oldTotalDuration 0이면 균등 분배 fallback', () => {
  const scenes = [
    { id: 'a', startTime: 0, duration: 0, script: 'a' },
    { id: 'b', startTime: 0, duration: 0, script: 'b' },
    { id: 'c', startTime: 0, duration: 0, script: 'c' },
  ];
  const result = remapScenesToAudio(scenes, 0, 6);
  assert.equal(result[0].duration, 2);
  assert.equal(result[1].duration, 2);
  assert.equal(result[2].duration, 2);
  assert.equal(result[0].startTime, 0);
  assert.equal(result[1].startTime, 2);
  assert.equal(result[2].startTime, 4);
});

test('remapScenesToAudio — 빈 scenes 배열', () => {
  assert.deepEqual(remapScenesToAudio([], 10, 20), []);
});

test('remapScenesToAudio — duration 합계 일치 (부동소수점 tolerance)', () => {
  const scenes = [
    { id: 'a', startTime: 0, duration: 1.3, script: 'a' },
    { id: 'b', startTime: 1.3, duration: 2.7, script: 'b' },
    { id: 'c', startTime: 4.0, duration: 1.0, script: 'c' },
  ];
  const result = remapScenesToAudio(scenes, 5.0, 7.0);
  const total = result.reduce((s, sc) => s + sc.duration, 0);
  assert.ok(Math.abs(total - 7.0) < 0.01, `total=${total}`);
});
