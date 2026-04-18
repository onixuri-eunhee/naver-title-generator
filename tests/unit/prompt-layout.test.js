// tests/unit/prompt-layout.test.js
//
// D5 — buildLayoutTypeBlock 단위 테스트.
// visualStyle 분기 + 레이아웃 포함/미포함 + 이모지 금지 규칙 검증.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { _buildLayoutTypeBlock } from '../../lib/shortform/prompt.js';

test('kinetic → 비어있지 않은 문자열 반환', () => {
  const result = _buildLayoutTypeBlock({ visualStyle: 'kinetic' });
  assert.ok(typeof result === 'string');
  assert.ok(result.length > 0, '빈 문자열이면 안 됨');
});

test('image → 비어있지 않은 문자열 반환 (Phase 1 2026-04-18: visualStyle 무관 항상 활성)', () => {
  const result = _buildLayoutTypeBlock({ visualStyle: 'image' });
  assert.ok(typeof result === 'string');
  assert.ok(result.length > 0, 'image 모드에서도 layoutType 블록 필요 (SceneCard fallback 방지)');
});

test('kinetic 결과에 big-impact-text 포함', () => {
  const result = _buildLayoutTypeBlock({ visualStyle: 'kinetic' });
  assert.ok(result.includes('big-impact-text'), 'big-impact-text 누락');
});

test('kinetic 결과에 bar-chart 포함', () => {
  const result = _buildLayoutTypeBlock({ visualStyle: 'kinetic' });
  assert.ok(result.includes('bar-chart'), 'bar-chart 누락');
});

test('kinetic 결과에 icon-label 미포함 (제거됨)', () => {
  const result = _buildLayoutTypeBlock({ visualStyle: 'kinetic' });
  assert.ok(!result.includes('icon-label'), 'icon-label이 아직 남아있음');
});

test('kinetic 결과에 이모지/이모티콘 금지 규칙 포함', () => {
  const result = _buildLayoutTypeBlock({ visualStyle: 'kinetic' });
  assert.ok(
    result.includes('이모지') || result.includes('이모티콘'),
    '이모지/이모티콘 금지 규칙 누락',
  );
});
