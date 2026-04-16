// tests/unit/settings.test.js
//
// spec §7.2 — settings SSOT 회귀 테스트.
// 비타협 항목: 비용 고정값, CHIP_SCHEMA freeze, refine 라우트 매핑.
// 비용 drift 1회 = 배포 직전 거절 사유.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  SETTINGS_SCHEMA_VERSION,
  FPS_BY_CONTENT_TYPE,
  CHIP_SCHEMA,
  REFINE_ROUTES,
  DEFAULT_SETTINGS,
  getChipCost,
  getTotalRefineCost,
  getRefineRoute,
  migrateSettings,
  validateSettings,
  getFps,
  formatCredit,
} from '../../lib/shortform/settings.js';

// ────────────────────────────────────────────────────────────────────────────
// 비용 고정값 회귀 — spec §2 Q9 테이블과 정확히 일치해야 함
// ────────────────────────────────────────────────────────────────────────────

test('cost regression: category refine = 0.3', () => {
  assert.equal(getChipCost('category'), 0.3);
});

test('cost regression: firstThreeSeconds refine = 0.2', () => {
  assert.equal(getChipCost('firstThreeSeconds'), 0.2);
});

test('cost regression: scriptType refine = 0.5', () => {
  assert.equal(getChipCost('scriptType'), 0.5);
});

test('cost regression: ctaTone inline = 0 (무료)', () => {
  assert.equal(getChipCost('ctaTone'), 0);
});

test('cost regression: voiceSpeed inline = 0 (무료)', () => {
  assert.equal(getChipCost('voiceSpeed'), 0);
});

test('cost regression: unknown chip id returns 0 without throwing', () => {
  assert.equal(getChipCost('does_not_exist'), 0);
});

// ────────────────────────────────────────────────────────────────────────────
// getTotalRefineCost — 합산
// ────────────────────────────────────────────────────────────────────────────

test('getTotalRefineCost empty array = 0', () => {
  assert.equal(getTotalRefineCost([]), 0);
});

test('getTotalRefineCost single refine chip', () => {
  assert.equal(getTotalRefineCost(['category']), 0.3);
});

test('getTotalRefineCost mixed inline + refine', () => {
  // ctaTone 0 + category 0.3 + voiceSpeed 0 = 0.3
  const total = getTotalRefineCost(['ctaTone', 'category', 'voiceSpeed']);
  assert.ok(Math.abs(total - 0.3) < 1e-9, `expected ~0.3, got ${total}`);
});

test('getTotalRefineCost all three refine chips = 1.0', () => {
  // category 0.3 + firstThreeSeconds 0.2 + scriptType 0.5 = 1.0
  const total = getTotalRefineCost([
    'category',
    'firstThreeSeconds',
    'scriptType',
  ]);
  assert.ok(Math.abs(total - 1.0) < 1e-9, `expected ~1.0, got ${total}`);
});

test('getTotalRefineCost non-array returns 0', () => {
  assert.equal(getTotalRefineCost(null), 0);
  assert.equal(getTotalRefineCost(undefined), 0);
  assert.equal(getTotalRefineCost('category'), 0);
});

// ────────────────────────────────────────────────────────────────────────────
// REFINE_ROUTES + getRefineRoute — 라우트 매핑
// ────────────────────────────────────────────────────────────────────────────

test('getRefineRoute: category → category-refine', () => {
  assert.equal(getRefineRoute('category'), 'category-refine');
});

test('getRefineRoute: firstThreeSeconds → first-three-refine', () => {
  assert.equal(getRefineRoute('firstThreeSeconds'), 'first-three-refine');
});

test('getRefineRoute: scriptType → script-type-refine', () => {
  assert.equal(getRefineRoute('scriptType'), 'script-type-refine');
});

test('getRefineRoute: ctaTone → null (inline)', () => {
  assert.equal(getRefineRoute('ctaTone'), null);
});

test('getRefineRoute: voiceSpeed → null (inline)', () => {
  assert.equal(getRefineRoute('voiceSpeed'), null);
});

test('getRefineRoute: unknown chip → null', () => {
  assert.equal(getRefineRoute('nope'), null);
});

test('REFINE_ROUTES is derived from CHIP_SCHEMA, no duplicates', () => {
  const routeKeys = Object.keys(REFINE_ROUTES).sort();
  const chipKeys = Object.keys(CHIP_SCHEMA).sort();
  assert.deepEqual(routeKeys, chipKeys);
});

// ────────────────────────────────────────────────────────────────────────────
// CHIP_SCHEMA freeze — 런타임 변경 금지 (spec §4.1)
// ────────────────────────────────────────────────────────────────────────────

test('CHIP_SCHEMA is frozen at top level', () => {
  assert.ok(Object.isFrozen(CHIP_SCHEMA));
});

test('CHIP_SCHEMA each chip is frozen', () => {
  for (const [id, chip] of Object.entries(CHIP_SCHEMA)) {
    assert.ok(Object.isFrozen(chip), `chip ${id} not frozen`);
  }
});

test('CHIP_SCHEMA select options array is frozen', () => {
  assert.ok(Object.isFrozen(CHIP_SCHEMA.category.options));
});

test('CHIP_SCHEMA mutation attempt is silently ignored (non-strict) or throws (strict)', () => {
  // ESM 모듈은 strict mode — 프로즌 객체 쓰기는 throw
  assert.throws(
    () => {
      CHIP_SCHEMA.category.cost = 999;
    },
    TypeError,
    'frozen CHIP_SCHEMA.category should reject writes'
  );
});

test('CHIP_SCHEMA contains exactly 5 chips in spec order', () => {
  const expected = [
    'category',
    'firstThreeSeconds',
    'scriptType',
    'ctaTone',
    'voiceSpeed',
  ];
  assert.deepEqual(Object.keys(CHIP_SCHEMA), expected);
});

test('CHIP_SCHEMA.category has exactly 10 options (9 categories + auto)', () => {
  assert.equal(CHIP_SCHEMA.category.options.length, 10);
  const ids = CHIP_SCHEMA.category.options.map((o) => o.id);
  // spec §2 Q3 — 9 고정 카테고리 + auto
  for (const expectedId of [
    'auto',
    'wedding',
    'food',
    'realestate',
    'ai_education',
    'beauty',
    'fitness',
    'lifestyle',
    'business',
    'other',
  ]) {
    assert.ok(ids.includes(expectedId), `category missing: ${expectedId}`);
  }
});

test('CHIP_SCHEMA.voiceSpeed slider range matches spec (1.05~1.2 default 1.12)', () => {
  const slider = CHIP_SCHEMA.voiceSpeed;
  assert.equal(slider.type, 'slider');
  assert.equal(slider.min, 1.05);
  assert.equal(slider.max, 1.2);
  assert.equal(slider.default, 1.12);
});

// ────────────────────────────────────────────────────────────────────────────
// DEFAULT_SETTINGS — CHIP_SCHEMA에서 자동 파생 (중복 정의 금지)
// ────────────────────────────────────────────────────────────────────────────

test('DEFAULT_SETTINGS covers every chip', () => {
  for (const chipId of Object.keys(CHIP_SCHEMA)) {
    assert.ok(chipId in DEFAULT_SETTINGS, `missing default: ${chipId}`);
  }
});

test('DEFAULT_SETTINGS select defaults = options[0].id', () => {
  assert.equal(DEFAULT_SETTINGS.category, 'auto');
  assert.equal(DEFAULT_SETTINGS.firstThreeSeconds, 'auto');
  assert.equal(DEFAULT_SETTINGS.scriptType, 'auto');
  assert.equal(DEFAULT_SETTINGS.ctaTone, 'casual');
});

test('DEFAULT_SETTINGS slider default = 1.12', () => {
  assert.equal(DEFAULT_SETTINGS.voiceSpeed, 1.12);
});

test('DEFAULT_SETTINGS is frozen', () => {
  assert.ok(Object.isFrozen(DEFAULT_SETTINGS));
});

// ────────────────────────────────────────────────────────────────────────────
// getFps — contentType 분기 (L6: env 직접 접근 금지, 인자 주입)
// ────────────────────────────────────────────────────────────────────────────

test('getFps("short") = 30', () => {
  assert.equal(getFps('short'), 30);
});

test('getFps("long") = 24', () => {
  assert.equal(getFps('long'), 24);
});

test('getFps(undefined) falls back to short fps (30)', () => {
  assert.equal(getFps(undefined), 30);
});

test('getFps("nonsense") falls back to short fps', () => {
  assert.equal(getFps('nonsense'), 30);
});

test('FPS_BY_CONTENT_TYPE is frozen', () => {
  assert.ok(Object.isFrozen(FPS_BY_CONTENT_TYPE));
});

// ────────────────────────────────────────────────────────────────────────────
// migrateSettings — 빈 껍데기 (Phase F까지 실 로직 없음)
// ────────────────────────────────────────────────────────────────────────────

test('migrateSettings(null) returns DEFAULTS + _version', () => {
  const m = migrateSettings(null);
  assert.equal(m._version, SETTINGS_SCHEMA_VERSION);
  for (const k of Object.keys(DEFAULT_SETTINGS)) {
    assert.equal(m[k], DEFAULT_SETTINGS[k]);
  }
});

test('migrateSettings preserves user overrides', () => {
  const saved = { category: 'wedding', voiceSpeed: 1.15 };
  const m = migrateSettings(saved);
  assert.equal(m.category, 'wedding');
  assert.equal(m.voiceSpeed, 1.15);
  // 빈 필드는 DEFAULT 병합
  assert.equal(m.ctaTone, DEFAULT_SETTINGS.ctaTone);
  assert.equal(m._version, SETTINGS_SCHEMA_VERSION);
});

test('migrateSettings injects _version=1 on legacy object (no _version)', () => {
  const legacy = { category: 'food' };
  assert.equal(migrateSettings(legacy)._version, 1);
});

test('migrateSettings accepts non-object (string) without throwing', () => {
  const m = migrateSettings('garbage');
  assert.equal(m._version, SETTINGS_SCHEMA_VERSION);
  assert.equal(m.category, DEFAULT_SETTINGS.category);
});

// ────────────────────────────────────────────────────────────────────────────
// validateSettings — 키 존재 검증
// ────────────────────────────────────────────────────────────────────────────

test('validateSettings accepts DEFAULT_SETTINGS', () => {
  const { ok, errors } = validateSettings(DEFAULT_SETTINGS);
  assert.equal(ok, true);
  assert.deepEqual(errors, []);
});

test('validateSettings rejects null', () => {
  const { ok, errors } = validateSettings(null);
  assert.equal(ok, false);
  assert.ok(errors.length > 0);
});

test('validateSettings rejects object with missing chip', () => {
  const partial = { ...DEFAULT_SETTINGS };
  delete partial.category;
  const { ok, errors } = validateSettings(partial);
  assert.equal(ok, false);
  assert.ok(errors.some((e) => e.includes('category')));
});

test('validateSettings error codes are keys only (UI i18n concern)', () => {
  const { errors } = validateSettings({});
  // 5 missing errors
  assert.equal(errors.length, 5);
  // 키 형식만 포함, 한국어 메시지 없음
  for (const e of errors) {
    assert.match(e, /^missing:\w+$/);
  }
});

// ────────────────────────────────────────────────────────────────────────────
// formatCredit — "0.3크레딧" / "1크레딧" / "0크레딧"
// ────────────────────────────────────────────────────────────────────────────

test('formatCredit(1) = "1크레딧"', () => {
  assert.equal(formatCredit(1), '1크레딧');
});

test('formatCredit(0.3) = "0.3크레딧"', () => {
  assert.equal(formatCredit(0.3), '0.3크레딧');
});

test('formatCredit(0) = "0크레딧"', () => {
  assert.equal(formatCredit(0), '0크레딧');
});

test('formatCredit(NaN) safe fallback', () => {
  assert.equal(formatCredit(NaN), '0크레딧');
});

test('formatCredit(null) safe fallback', () => {
  assert.equal(formatCredit(null), '0크레딧');
});

test('formatCredit(undefined) safe fallback', () => {
  assert.equal(formatCredit(undefined), '0크레딧');
});

// ────────────────────────────────────────────────────────────────────────────
// SETTINGS_SCHEMA_VERSION — 1 고정 (Phase F 진입 전 bump 시 migrate 로직 필요)
// ────────────────────────────────────────────────────────────────────────────

test('SETTINGS_SCHEMA_VERSION = 1 (A-bis)', () => {
  assert.equal(SETTINGS_SCHEMA_VERSION, 1);
});
