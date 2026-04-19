// tests/unit/cardnews-system-prompt.test.js
//
// CARDNEWS_SYSTEM_PROMPT 회귀 — Claude가 따라야 할 구조 제약 키워드가 모두 포함됐는지.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { CARDNEWS_SYSTEM_PROMPT } from '../../lib/shared-prompts/cardnews-system-prompt.js';

test('system prompt — SEDA 4원칙 포함', () => {
  assert.match(CARDNEWS_SYSTEM_PROMPT, /Shortly/);
  assert.match(CARDNEWS_SYSTEM_PROMPT, /Easily/);
  assert.match(CARDNEWS_SYSTEM_PROMPT, /Divide/);
  assert.match(CARDNEWS_SYSTEM_PROMPT, /Again/);
});

test('system prompt — Chromium 렌더에 필수 구조 제약 포함', () => {
  // 카드 DOM 구조 (puppeteer element.screenshot 대상)
  assert.match(CARDNEWS_SYSTEM_PROMPT, /class="card cN"|class="card c\d|<div class="card/);
  // viewport 1080 × 1350
  assert.match(CARDNEWS_SYSTEM_PROMPT, /1080/);
  assert.match(CARDNEWS_SYSTEM_PROMPT, /1350/);
  // container query 사용 가이드
  assert.match(CARDNEWS_SYSTEM_PROMPT, /container-type|cqw/);
  // {{img:N}} placeholder
  assert.match(CARDNEWS_SYSTEM_PROMPT, /\{\{img:N\}\}|img:N|img:\d/);
  // script 금지
  assert.match(CARDNEWS_SYSTEM_PROMPT, /<script>|script 태그/);
  // 이모지 금지
  assert.match(CARDNEWS_SYSTEM_PROMPT, /이모지|이모티콘/);
  // Pretendard CDN
  assert.match(CARDNEWS_SYSTEM_PROMPT, /Pretendard/);
});

test('system prompt — 디자인 자유도 강조 문구 포함', () => {
  // 카드마다 다르게 디자인
  assert.ok(
    /다채|다르게|독립|자유/.test(CARDNEWS_SYSTEM_PROMPT),
    '자유도 가이드 누락',
  );
  // 초대형 타이포 가이드
  assert.match(CARDNEWS_SYSTEM_PROMPT, /초대형|16cqw|8cqw|cqw/);
});

test('system prompt — 응답 형식: 순수 HTML (마크다운 금지)', () => {
  // "순수 HTML" or "마크다운 금지"
  assert.ok(
    /순수 HTML|마크다운.*금지|코드블록.*금지/.test(CARDNEWS_SYSTEM_PROMPT),
    '응답 형식 지시 누락',
  );
});

test('system prompt — 길이 합리성 (프롬프트 슬림 원칙)', () => {
  // 너무 길면 자유도 가리는 규칙이 많다는 뜻
  assert.ok(
    CARDNEWS_SYSTEM_PROMPT.length <= 3000,
    `system prompt 길이 ${CARDNEWS_SYSTEM_PROMPT.length} > 3000자 — 슬림 원칙 위반`,
  );
  assert.ok(
    CARDNEWS_SYSTEM_PROMPT.length >= 800,
    '너무 짧음 — 필수 제약 빠진 가능성',
  );
});
