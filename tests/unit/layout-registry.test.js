// tests/unit/layout-registry.test.js
//
// D5 — LAYOUT_TYPES 레지스트리 검증.
// SceneRouter.jsx는 JSX라서 Node.js 직접 import 불가.
// SceneRouter가 export하는 LAYOUT_TYPES = Object.keys(LAYOUT_REGISTRY)를
// 소스 파일 파싱으로 간접 검증.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(
  resolve(__dirname, '../../remotion/shortform/SceneRouter.jsx'),
  'utf-8',
);

// LAYOUT_REGISTRY에서 키 추출 ('key': Component 패턴)
const keys = [...src.matchAll(/'([a-z][\w-]*)'\s*:/g)].map((m) => m[1]);

test('LAYOUT_REGISTRY에 10개 이상 등록', () => {
  assert.ok(keys.length >= 10, `${keys.length}개 — 10개 미만`);
});

test('필수 layoutType 포함: big-impact-text', () => {
  assert.ok(keys.includes('big-impact-text'));
});

test('필수 layoutType 포함: counter', () => {
  assert.ok(keys.includes('counter'));
});

test('필수 layoutType 포함: bar-chart', () => {
  assert.ok(keys.includes('bar-chart'));
});

test('필수 layoutType 포함: flow-diagram', () => {
  assert.ok(keys.includes('flow-diagram'));
});

test('필수 layoutType 포함: comparison-chart', () => {
  assert.ok(keys.includes('comparison-chart'));
});

test('제거된 layoutType 미포함: icon-label 없음', () => {
  assert.ok(!keys.includes('icon-label'), 'icon-label이 아직 등록되어 있음');
});
