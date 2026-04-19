// tests/unit/cardnews-placeholder.test.js
//
// resolveImagePlaceholders + validateCardCount.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveImagePlaceholders,
  validateCardCount,
  TRANSPARENT_PLACEHOLDER_DATA_URL,
} from '../../lib/cardnews/placeholder.js';

// === resolveImagePlaceholders ===

test('resolvePlaceholders — 단일 치환', () => {
  const html = '<img src="{{img:0}}">';
  const result = resolveImagePlaceholders(html, ['https://cdn.x/a.jpg']);
  assert.equal(result, '<img src="https://cdn.x/a.jpg">');
});

test('resolvePlaceholders — 다중 치환 + 순서 유지', () => {
  const html = '<img src="{{img:0}}"><img src="{{img:1}}"><img src="{{img:2}}">';
  const result = resolveImagePlaceholders(html, ['a.jpg', 'b.jpg', 'c.jpg']);
  assert.ok(result.includes('src="a.jpg"'));
  assert.ok(result.includes('src="b.jpg"'));
  assert.ok(result.includes('src="c.jpg"'));
});

test('resolvePlaceholders — 범위 초과 placeholder → transparent data URL', () => {
  const html = '<img src="{{img:0}}"><img src="{{img:5}}">';
  const result = resolveImagePlaceholders(html, ['a.jpg']);
  assert.ok(result.includes('src="a.jpg"'));
  assert.ok(result.includes(TRANSPARENT_PLACEHOLDER_DATA_URL));
});

test('resolvePlaceholders — 빈 imageUrls 배열 → 모두 transparent', () => {
  const html = '<img src="{{img:0}}"><img src="{{img:1}}">';
  const result = resolveImagePlaceholders(html, []);
  const count = (result.match(new RegExp(TRANSPARENT_PLACEHOLDER_DATA_URL.slice(0, 30), 'g')) || []).length;
  assert.equal(count, 2);
});

test('resolvePlaceholders — 같은 placeholder 여러 번 사용 (중복)', () => {
  const html = '<img src="{{img:0}}" class="a"><img src="{{img:0}}" class="b">';
  const result = resolveImagePlaceholders(html, ['hello.jpg']);
  const count = (result.match(/hello\.jpg/g) || []).length;
  assert.equal(count, 2);
});

// === validateCardCount ===

test('validateCardCount — 정확히 일치', () => {
  const html = '<div class="card c1">a</div><div class="card c2">b</div><div class="card c3">c</div>';
  const result = validateCardCount(html, 3);
  assert.equal(result.ok, true);
  assert.equal(result.actual, 3);
  assert.equal(result.expected, 3);
});

test('validateCardCount — 개수 불일치 (적음)', () => {
  const html = '<div class="card c1">a</div><div class="card c2">b</div>';
  const result = validateCardCount(html, 5);
  assert.equal(result.ok, false);
  assert.equal(result.actual, 2);
});

test('validateCardCount — 초과 생성은 허용 (렌더러가 앞 N개만 캡처)', () => {
  const html = '<div class="card c1"></div><div class="card c2"></div><div class="card c3"></div><div class="card c4"></div>';
  const result = validateCardCount(html, 2);
  assert.equal(result.ok, true);
  assert.equal(result.actual, 4);
  assert.equal(result.expected, 2);
});

test('validateCardCount — 빈 HTML / card 없음', () => {
  const result = validateCardCount('<div>no cards</div>', 3);
  assert.equal(result.ok, false);
  assert.equal(result.actual, 0);
});
