// tests/unit/shared-prompts-length-rules.test.js
//
// CARD_NEWS_LIMITS 상수 값 회귀, getLimit 존재/부재 케이스, findOverflows 감지 로직.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CARD_NEWS_LIMITS,
  getLimit,
  findOverflows,
} from '../../lib/shared-prompts/length-rules.js';

test('CARD_NEWS_LIMITS — 상수 값 회귀', () => {
  assert.equal(CARD_NEWS_LIMITS['cover.title'], 20);
  assert.equal(CARD_NEWS_LIMITS['cover.subtitle'], 25);
  assert.equal(CARD_NEWS_LIMITS['summary.title'], 18);
  assert.equal(CARD_NEWS_LIMITS['summary.body'], 60);
  assert.equal(CARD_NEWS_LIMITS['content.title'], 15);
  assert.equal(CARD_NEWS_LIMITS['content.body'], 60);
  assert.equal(CARD_NEWS_LIMITS['cta.title'], 18);
  assert.equal(CARD_NEWS_LIMITS['compare.title'], 22);
  assert.equal(CARD_NEWS_LIMITS['compare.label'], 10);
  assert.equal(CARD_NEWS_LIMITS['compare.item'], 20);
  assert.equal(CARD_NEWS_LIMITS['flow.title'], 22);
  assert.equal(CARD_NEWS_LIMITS['flow.step.title'], 12);
  assert.equal(CARD_NEWS_LIMITS['flow.step.body'], 30);
});

test('CARD_NEWS_LIMITS — frozen (immutable)', () => {
  assert.throws(() => {
    CARD_NEWS_LIMITS['cover.title'] = 999;
  });
});

test('getLimit — 존재하는 키', () => {
  assert.equal(getLimit(CARD_NEWS_LIMITS, 'cover.title'), 20);
});

test('getLimit — 존재하지 않는 키 → null', () => {
  assert.equal(getLimit(CARD_NEWS_LIMITS, 'nope.foo'), null);
});

test('getLimit — limits 자체가 null/undefined → null', () => {
  assert.equal(getLimit(null, 'cover.title'), null);
  assert.equal(getLimit(undefined, 'cover.title'), null);
});

test('findOverflows — overflow 없으면 빈 배열', () => {
  const slides = [
    { type: 'cover', title: '짧은 제목', subtitle: '부제' },
    { type: 'cta', title: '팔로우' },
  ];
  const fieldMap = {
    cover: [
      { path: 'title', limitKey: 'cover.title' },
      { path: 'subtitle', limitKey: 'cover.subtitle' },
    ],
    cta: [{ path: 'title', limitKey: 'cta.title' }],
  };
  const result = findOverflows(slides, CARD_NEWS_LIMITS, fieldMap);
  assert.deepEqual(result, []);
});

test('findOverflows — 단일 overflow 감지', () => {
  const slides = [
    { type: 'cover', title: '아주아주아주아주 긴 제목입니다 정말로 길어요' },
  ];
  const fieldMap = {
    cover: [{ path: 'title', limitKey: 'cover.title' }],
  };
  const result = findOverflows(slides, CARD_NEWS_LIMITS, fieldMap);
  assert.equal(result.length, 1);
  assert.equal(result[0].slideIndex, 0);
  assert.equal(result[0].field, 'title');
  assert.equal(result[0].limit, 20);
  assert.ok(result[0].actual > 20);
});

test('findOverflows — 복수 슬라이드 복수 필드 overflow', () => {
  const slides = [
    { type: 'cover', title: '아주아주아주아주 긴 제목입니다 정말로 길어요', subtitle: '짧음' },
    { type: 'content', title: '이것도 너무너무 긴 본문 제목 입니다요' },
  ];
  const fieldMap = {
    cover: [
      { path: 'title', limitKey: 'cover.title' },
      { path: 'subtitle', limitKey: 'cover.subtitle' },
    ],
    content: [{ path: 'title', limitKey: 'content.title' }],
  };
  const result = findOverflows(slides, CARD_NEWS_LIMITS, fieldMap);
  assert.equal(result.length, 2);
});

test('findOverflows — \\n은 길이에서 제외 (Divide 줄바꿈 보호)', () => {
  const slides = [{ type: 'cover', title: '12345\n67890' }];
  const fieldMap = { cover: [{ path: 'title', limitKey: 'cover.title' }] };
  const result = findOverflows(slides, CARD_NEWS_LIMITS, fieldMap);
  assert.deepEqual(result, []);
});

test('findOverflows — compare.items 배열 각 항목 체크', () => {
  const slides = [
    {
      type: 'compare',
      leftItems: ['짧음', '아주아주아주아주 긴 항목입니다 너무 김'],
      rightItems: ['OK1', 'OK2'],
    },
  ];
  const fieldMap = {
    compare: [
      { path: 'leftItems[]', limitKey: 'compare.item' },
      { path: 'rightItems[]', limitKey: 'compare.item' },
    ],
  };
  const result = findOverflows(slides, CARD_NEWS_LIMITS, fieldMap);
  assert.equal(result.length, 1);
  assert.match(result[0].field, /leftItems\[1\]/);
});

test('findOverflows — flow.steps 중첩 필드', () => {
  const slides = [
    {
      type: 'flow',
      steps: [
        { number: '01', title: '짧음', body: '본문' },
        { number: '02', title: '이것도 너무너무 긴 제목임', body: '본문' },
      ],
    },
  ];
  const fieldMap = {
    flow: [
      { path: 'steps[].title', limitKey: 'flow.step.title' },
      { path: 'steps[].body', limitKey: 'flow.step.body' },
    ],
  };
  const result = findOverflows(slides, CARD_NEWS_LIMITS, fieldMap);
  assert.equal(result.length, 1);
  assert.match(result[0].field, /steps\[1\]\.title/);
});

test('findOverflows — 정확히 limit 길이 (경계값)는 overflow 아님 (strict >)', () => {
  // cover.title limit = 20. 정확히 20자 문자열.
  const slides = [{ type: 'cover', title: '12345678901234567890' }];
  const fieldMap = { cover: [{ path: 'title', limitKey: 'cover.title' }] };
  const result = findOverflows(slides, CARD_NEWS_LIMITS, fieldMap);
  assert.deepEqual(result, [], '경계값은 overflow 아님 (회귀: >=로 바뀌면 실패)');
});

test('findOverflows — throw 안 함 (soft 검증)', () => {
  const slides = [{ type: 'cover', title: null }];
  const fieldMap = { cover: [{ path: 'title', limitKey: 'cover.title' }] };
  const result = findOverflows(slides, CARD_NEWS_LIMITS, fieldMap);
  assert.deepEqual(result, []);
});

test('findOverflows — fieldMap에 없는 타입은 skip', () => {
  const slides = [{ type: 'unknown', anything: 'x'.repeat(1000) }];
  const fieldMap = { cover: [{ path: 'title', limitKey: 'cover.title' }] };
  const result = findOverflows(slides, CARD_NEWS_LIMITS, fieldMap);
  assert.deepEqual(result, []);
});
