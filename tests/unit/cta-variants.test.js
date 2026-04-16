// tests/unit/cta-variants.test.js
//
// spec §4.4 / Q2 — CTA Variant 레지스트리.
// 핵심: componentName 내부 메타 비노출 + dev throw / prod fallback 양 경로.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CTA_VARIANTS,
  getCTAVariant,
  listCTAVariants,
  getDefaultCTAVariant,
} from '../../lib/shortform/cta-variants.js';

// ────────────────────────────────────────────────────────────────────────────
// 레지스트리 구성 — Q2: save_follow_casual + save_follow_professional 2종
// ────────────────────────────────────────────────────────────────────────────

test('CTA_VARIANTS has exactly 2 variants (Q2)', () => {
  const ids = Object.keys(CTA_VARIANTS).sort();
  assert.deepEqual(ids, ['save_follow_casual', 'save_follow_professional']);
});

test('CTA_VARIANTS is frozen', () => {
  assert.ok(Object.isFrozen(CTA_VARIANTS));
});

test('CTA_VARIANTS each variant is frozen', () => {
  for (const [id, v] of Object.entries(CTA_VARIANTS)) {
    assert.ok(Object.isFrozen(v), `${id} not frozen`);
    assert.ok(Object.isFrozen(v.icons), `${id}.icons not frozen`);
  }
});

// ────────────────────────────────────────────────────────────────────────────
// componentName 비노출 (§4.4 제약) — Remotion 내부 메타, 공개 API 차단
// ────────────────────────────────────────────────────────────────────────────

test('componentName is NOT exposed in CTA_VARIANTS', () => {
  for (const [id, v] of Object.entries(CTA_VARIANTS)) {
    assert.ok(
      !('componentName' in v),
      `${id} leaks internal componentName meta`
    );
  }
});

test('componentName is NOT exposed via getCTAVariant', () => {
  const v = getCTAVariant('save_follow_casual');
  assert.ok(!('componentName' in v));
});

test('componentName is NOT exposed via listCTAVariants', () => {
  for (const v of listCTAVariants()) {
    assert.ok(!('componentName' in v));
  }
});

// ────────────────────────────────────────────────────────────────────────────
// 공개 필드 — id / tone / variant / copy / icons
// ────────────────────────────────────────────────────────────────────────────

test('each variant exposes required public fields', () => {
  for (const [id, v] of Object.entries(CTA_VARIANTS)) {
    assert.equal(v.id, id);
    assert.equal(typeof v.tone, 'string');
    assert.equal(typeof v.variant, 'string');
    assert.equal(typeof v.copy, 'string');
    assert.ok(v.copy.length > 0);
    assert.equal(typeof v.icons.save, 'string');
    assert.equal(typeof v.icons.follow, 'string');
  }
});

test('save_follow_casual copy matches spec Q2 exact text', () => {
  // spec §2 Q2 공식 카피
  const expected =
    '이 내용 저장해두시고, 비슷한 이야기 더 듣고 싶으시면 팔로우도 해주세요';
  assert.equal(CTA_VARIANTS.save_follow_casual.copy, expected);
});

test('casual variant uses casual tone + variant', () => {
  const v = CTA_VARIANTS.save_follow_casual;
  assert.equal(v.tone, 'casual');
  assert.equal(v.variant, 'casual');
});

test('professional variant uses professional tone + variant', () => {
  const v = CTA_VARIANTS.save_follow_professional;
  assert.equal(v.tone, 'professional');
  assert.equal(v.variant, 'professional');
});

test('icons use save + follow emoji (Q2 시각 구성)', () => {
  for (const v of Object.values(CTA_VARIANTS)) {
    assert.equal(v.icons.save, '💾');
    assert.equal(v.icons.follow, '➕');
  }
});

// ────────────────────────────────────────────────────────────────────────────
// getCTAVariant — 유효 id / unknown id 양 경로
// ────────────────────────────────────────────────────────────────────────────

test('getCTAVariant returns matching variant for known id', () => {
  const v = getCTAVariant('save_follow_professional');
  assert.equal(v.id, 'save_follow_professional');
  assert.equal(v.tone, 'professional');
});

test('getCTAVariant in development throws on unknown id', () => {
  const original = process.env.NODE_ENV;
  process.env.NODE_ENV = 'development';
  try {
    assert.throws(
      () => getCTAVariant('does_not_exist'),
      /Unknown variant id/
    );
  } finally {
    if (original === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = original;
  }
});

test('getCTAVariant in production falls back to save_follow_casual + warn', () => {
  const original = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';

  // console.warn 캡처 — 폴백 경로가 반드시 경고를 남겨야 함
  const originalWarn = console.warn;
  const warnings = [];
  console.warn = (...args) => warnings.push(args.join(' '));

  try {
    const v = getCTAVariant('does_not_exist');
    assert.equal(v.id, 'save_follow_casual');
    assert.ok(warnings.length === 1, 'expected exactly one console.warn');
    assert.match(warnings[0], /does_not_exist/);
    assert.match(warnings[0], /save_follow_casual/);
  } finally {
    console.warn = originalWarn;
    if (original === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = original;
  }
});

test('getCTAVariant with NODE_ENV undefined defaults to prod behavior (fallback, no throw)', () => {
  const original = process.env.NODE_ENV;
  delete process.env.NODE_ENV;

  const originalWarn = console.warn;
  console.warn = () => {}; // silence

  try {
    const v = getCTAVariant('does_not_exist');
    assert.equal(v.id, 'save_follow_casual');
  } finally {
    console.warn = originalWarn;
    if (original !== undefined) process.env.NODE_ENV = original;
  }
});

// ────────────────────────────────────────────────────────────────────────────
// listCTAVariants
// ────────────────────────────────────────────────────────────────────────────

test('listCTAVariants returns array of all variants', () => {
  const list = listCTAVariants();
  assert.equal(Array.isArray(list), true);
  assert.equal(list.length, 2);
  const ids = list.map((v) => v.id).sort();
  assert.deepEqual(ids, ['save_follow_casual', 'save_follow_professional']);
});

// ────────────────────────────────────────────────────────────────────────────
// getDefaultCTAVariant — tone별 분기
// ────────────────────────────────────────────────────────────────────────────

test('getDefaultCTAVariant("casual") returns casual variant', () => {
  const v = getDefaultCTAVariant('casual');
  assert.equal(v.id, 'save_follow_casual');
});

test('getDefaultCTAVariant("professional") returns professional variant', () => {
  const v = getDefaultCTAVariant('professional');
  assert.equal(v.id, 'save_follow_professional');
});

test('getDefaultCTAVariant(undefined) defaults to casual', () => {
  const v = getDefaultCTAVariant();
  assert.equal(v.id, 'save_follow_casual');
});

test('getDefaultCTAVariant("nonsense") defaults to casual (not throw)', () => {
  const v = getDefaultCTAVariant('nonsense');
  assert.equal(v.id, 'save_follow_casual');
});

// ────────────────────────────────────────────────────────────────────────────
// 변조 불가능 — 반환 객체 수정 시도
// ────────────────────────────────────────────────────────────────────────────

test('getCTAVariant result is frozen (mutation throws)', () => {
  const v = getCTAVariant('save_follow_casual');
  assert.throws(() => {
    v.copy = 'hijacked';
  }, TypeError);
});
