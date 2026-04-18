// tests/unit/shared-prompts-seda.test.js
//
// SEDA 원칙 블록 회귀 — 네 원칙 키워드가 프롬프트에 모두 포함되는지 보장.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { SEDA_PROMPT_BLOCK } from '../../lib/shared-prompts/seda.js';

test('SEDA 블록에 S/E/D/A 네 원칙 모두 포함', () => {
  assert.match(SEDA_PROMPT_BLOCK, /Shortly/);
  assert.match(SEDA_PROMPT_BLOCK, /Easily/);
  assert.match(SEDA_PROMPT_BLOCK, /Divide/);
  assert.match(SEDA_PROMPT_BLOCK, /Again/);
});

test('SEDA 블록에 한글 풀이 포함 (짧게·쉽게·나누기·재독)', () => {
  assert.match(SEDA_PROMPT_BLOCK, /짧게/);
  assert.match(SEDA_PROMPT_BLOCK, /쉽게/);
  assert.ok(
    /나누|문단/.test(SEDA_PROMPT_BLOCK),
    'D: 문단 나누기 풀이 누락',
  );
  assert.ok(
    /독자|재독|다시 읽/.test(SEDA_PROMPT_BLOCK),
    'A: 독자 재독 풀이 누락',
  );
});

test('SEDA 블록 길이 합리성 (너무 길면 프롬프트 비효율)', () => {
  assert.ok(
    SEDA_PROMPT_BLOCK.length <= 500,
    `SEDA_PROMPT_BLOCK 길이 ${SEDA_PROMPT_BLOCK.length} > 500자, 슬림 원칙 위반`,
  );
  assert.ok(SEDA_PROMPT_BLOCK.length >= 80, '너무 짧음 (원칙 빠진 가능성)');
});

test('SEDA 블록에 \\n 사용 가이드 포함 (Divide 실제 적용)', () => {
  assert.ok(
    /\\n|줄바꿈/.test(SEDA_PROMPT_BLOCK),
    '\\n 줄바꿈 가이드 누락 — Divide 적용 불가',
  );
});
