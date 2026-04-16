// tests/unit/parse-claude-json.test.js
//
// spec §7.6 — Claude 응답 JSON 파서 회귀 테스트.
// 3/16 blog-writer 사고("JSON 뒤 잡소리" greedy regex 실패) 재발 방지가 핵심.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { safeParseJson } from '../../lib/shortform/parse-claude-json.js';

// ────────────────────────────────────────────────────────────────────────────
// Happy path — 순수 JSON
// ────────────────────────────────────────────────────────────────────────────

test('parses clean JSON object', () => {
  const result = safeParseJson('{"title":"hello","n":3}');
  assert.deepEqual(result, { title: 'hello', n: 3 });
});

test('parses nested object', () => {
  const result = safeParseJson(
    '{"outer":{"inner":{"k":"v"}},"list":[1,2,3]}'
  );
  assert.deepEqual(result, {
    outer: { inner: { k: 'v' } },
    list: [1, 2, 3],
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Trailing junk — Claude가 JSON 뒤에 설명 붙이는 패턴 (3/16 사고)
// ────────────────────────────────────────────────────────────────────────────

test('parses JSON followed by trailing prose text', () => {
  const raw = '{"key":"value"} — 위 JSON은 설명을 위해 드린 예시입니다.';
  const result = safeParseJson(raw);
  assert.deepEqual(result, { key: 'value' });
});

test('parses JSON preceded by markdown fence and trailing junk', () => {
  const raw = '```json\n{"title":"테스트","ok":true}\n```\n추가 설명';
  const result = safeParseJson(raw);
  assert.deepEqual(result, { title: '테스트', ok: true });
});

test('parses JSON preceded by prose', () => {
  const raw = '결과는 다음과 같습니다:\n{"status":"ok"}';
  const result = safeParseJson(raw);
  assert.deepEqual(result, { status: 'ok' });
});

// ────────────────────────────────────────────────────────────────────────────
// 문자열 내 중괄호 — greedy regex 오작동 케이스 (balanced brace 필수)
// ────────────────────────────────────────────────────────────────────────────

test('ignores } inside string literal', () => {
  const raw = '{"body":"수식 f(x) = {x+1} 참고"} trailing junk';
  const result = safeParseJson(raw);
  assert.deepEqual(result, { body: '수식 f(x) = {x+1} 참고' });
});

test('ignores { inside string literal', () => {
  const raw = '{"template":"안녕 {name}님"}';
  const result = safeParseJson(raw);
  assert.deepEqual(result, { template: '안녕 {name}님' });
});

test('handles escaped quote inside string', () => {
  const raw = '{"quote":"그녀가 말했다: \\"안녕\\""}';
  const result = safeParseJson(raw);
  assert.deepEqual(result, { quote: '그녀가 말했다: "안녕"' });
});

test('handles backslash before closing brace in string', () => {
  // "path\\" 는 실제로 path\ 를 의미, 뒤의 } 는 JSON 종결
  const raw = '{"path":"C:\\\\temp\\\\"}';
  const result = safeParseJson(raw);
  assert.deepEqual(result, { path: 'C:\\temp\\' });
});

// ────────────────────────────────────────────────────────────────────────────
// Raw 개행 — 문자열 리터럴 내부 정규화 (2차 폴백 발동)
// ────────────────────────────────────────────────────────────────────────────

test('normalizes raw newlines inside string literal', () => {
  // Claude가 실제 개행 문자를 JSON 문자열 안에 그대로 넣는 경우
  const raw = '{"body":"line1\nline2\nline3"}';
  const result = safeParseJson(raw);
  assert.deepEqual(result, { body: 'line1\nline2\nline3' });
});

test('normalizes raw tabs inside string literal', () => {
  const raw = '{"code":"if\tfoo"}';
  const result = safeParseJson(raw);
  assert.deepEqual(result, { code: 'if\tfoo' });
});

// ────────────────────────────────────────────────────────────────────────────
// 완전 실패 경로 — null 반환 (throw 아님, spec §7.6)
// ────────────────────────────────────────────────────────────────────────────

test('returns null for completely broken JSON', () => {
  const result = safeParseJson('이건 JSON이 아닙니다');
  assert.equal(result, null);
});

test('returns null for truncated JSON (open brace only)', () => {
  const result = safeParseJson('{"partial":');
  assert.equal(result, null);
});

test('returns null for empty string', () => {
  assert.equal(safeParseJson(''), null);
});

test('returns null for non-string input', () => {
  assert.equal(safeParseJson(null), null);
  assert.equal(safeParseJson(undefined), null);
  assert.equal(safeParseJson(123), null);
  assert.equal(safeParseJson({}), null);
});

test('top-level array passes through JSON.parse (stage 1)', () => {
  // 숏폼 스크립트 응답은 { scripts: [...] } 형태라 루트는 오브젝트지만,
  // 배열 루트 입력이 오면 valid JSON이므로 그대로 통과한다.
  assert.deepEqual(safeParseJson('[1,2,3]'), [1, 2, 3]);
});

test('top-level string value passes through (edge: Claude raw text 응답)', () => {
  assert.equal(safeParseJson('"just a string"'), 'just a string');
});

test('returns null for prose with no JSON at all', () => {
  assert.equal(safeParseJson('안녕하세요 그냥 텍스트입니다'), null);
});

// ────────────────────────────────────────────────────────────────────────────
// Happy — 4 단계 폴백 끝까지 도달 후 성공
// ────────────────────────────────────────────────────────────────────────────

test('4th-stage fallback: extract + normalize escape', () => {
  // 1,2차는 실패(앞뒤 잡소리+raw 개행), 3차 추출 후 4차 정규화 통과
  const raw =
    '결과:\n```json\n{"body":"첫 줄\n둘째 줄"}\n```\n감사합니다.';
  const result = safeParseJson(raw);
  assert.deepEqual(result, { body: '첫 줄\n둘째 줄' });
});

// ────────────────────────────────────────────────────────────────────────────
// 성능 가드 — 큰 입력에도 합리적 시간 (무한 루프 회귀 방지)
// ────────────────────────────────────────────────────────────────────────────

test('handles large JSON under 100ms', () => {
  const big = { items: Array.from({ length: 1000 }, (_, i) => ({ i, s: `item${i}` })) };
  const raw = JSON.stringify(big) + '\n\n추가 설명 텍스트입니다.';
  const t0 = Date.now();
  const result = safeParseJson(raw);
  const dt = Date.now() - t0;
  assert.ok(result);
  assert.equal(result.items.length, 1000);
  assert.ok(dt < 100, `parse took ${dt}ms`);
});
