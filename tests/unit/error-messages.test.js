// tests/unit/error-messages.test.js
//
// spec §7.5 — 에러 메시지 금지 용어 + 비난조 + 필수 코드 + 5xx 변수 의무.
// 비타협 항목: 저자가 자가 위반하면 배포 전 자동 차단.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ERROR_MESSAGES,
  renderErrorMessage,
} from '../../lib/shortform/error-messages.js';

// ────────────────────────────────────────────────────────────────────────────
// 금지 용어 (§6.5 톤 가이드 + §7.5)
// ────────────────────────────────────────────────────────────────────────────

const FORBIDDEN_WORDS = [
  // 기술 용어 — 사용자에게 노출 금지
  '렌더',
  'render',
  'API',
  'Claude',
  'ElevenLabs',
  'null',
  'undefined',
  'stack',
  '스택트레이스',
  '서버',
  '버그',
  '예외',
  '500',
  '502',
  '4xx',
  '5xx',
  // 부정어 — 대안 강제
  '에러', // → "문제"
  '실패', // → "어려웠어요"
  '오류', // → "문제"
];

const BLAME_PATTERNS = [/잘못됐습니다/, /틀렸습니다/, /못했습니다/];

const REQUIRED_CODES = [
  'claude_5xx',
  'claude_4xx',
  'tts_5xx',
  'timeout',
  'asset_404',
  'asset_fetch',
  'oom',
  'composition_id',
  'script_generation_failed',
  'refine_failed',
];

// ────────────────────────────────────────────────────────────────────────────
// 필수 코드 — 누락 시 fail (UI 렌더 실패 방지)
// ────────────────────────────────────────────────────────────────────────────

for (const code of REQUIRED_CODES) {
  test(`required code present: ${code}`, () => {
    assert.ok(
      ERROR_MESSAGES[code],
      `ERROR_MESSAGES[${code}] missing — UI 렌더 실패 경로 생김`
    );
    assert.equal(typeof ERROR_MESSAGES[code].toast, 'string');
    assert.ok(ERROR_MESSAGES[code].toast.length > 0);
    assert.ok(
      ['4xx', '5xx'].includes(ERROR_MESSAGES[code].severity),
      `severity must be '4xx' or '5xx', got ${ERROR_MESSAGES[code].severity}`
    );
  });
}

// ────────────────────────────────────────────────────────────────────────────
// 금지 용어 스캔 — 전 toast 문자열 검사 (비타협)
// ────────────────────────────────────────────────────────────────────────────

test('forbidden word scan: no toast contains a forbidden term', () => {
  const violations = [];
  for (const [code, entry] of Object.entries(ERROR_MESSAGES)) {
    for (const word of FORBIDDEN_WORDS) {
      if (entry.toast.includes(word)) {
        violations.push(`${code}: "${word}" found in toast`);
      }
    }
  }
  assert.deepEqual(
    violations,
    [],
    `금지 용어 위반 — ${violations.join(' / ')}`
  );
});

// ────────────────────────────────────────────────────────────────────────────
// 비난조 패턴 스캔 — 사용자 탓하는 표현 차단
// ────────────────────────────────────────────────────────────────────────────

test('blame pattern scan: no toast blames the user', () => {
  const violations = [];
  for (const [code, entry] of Object.entries(ERROR_MESSAGES)) {
    for (const pattern of BLAME_PATTERNS) {
      if (pattern.test(entry.toast)) {
        violations.push(`${code}: matches ${pattern.source}`);
      }
    }
  }
  assert.deepEqual(violations, [], `비난조 위반 — ${violations.join(' / ')}`);
});

// ────────────────────────────────────────────────────────────────────────────
// 5xx severity → {refunded} 또는 {balance} 변수 포함 의무 (spec §4.6)
// ────────────────────────────────────────────────────────────────────────────

test('5xx severity messages include {refunded} or {balance}', () => {
  const violations = [];
  for (const [code, entry] of Object.entries(ERROR_MESSAGES)) {
    if (entry.severity !== '5xx') continue;
    const hasRefundVar =
      entry.toast.includes('{refunded}') || entry.toast.includes('{balance}');
    if (!hasRefundVar) {
      violations.push(`${code} (5xx) — 환불/잔액 변수 없음`);
    }
  }
  assert.deepEqual(violations, []);
});

test('4xx severity messages do NOT need refund variable (환불 없음)', () => {
  // claude_4xx는 환불 없음 — {refunded}가 있으면 오히려 혼란
  const claude4xx = ERROR_MESSAGES.claude_4xx;
  assert.equal(claude4xx.severity, '4xx');
  assert.ok(!claude4xx.toast.includes('{refunded}'));
  assert.ok(!claude4xx.toast.includes('{balance}'));
});

// ────────────────────────────────────────────────────────────────────────────
// ERROR_MESSAGES freeze — 런타임 변조 금지
// ────────────────────────────────────────────────────────────────────────────

test('ERROR_MESSAGES is frozen', () => {
  assert.ok(Object.isFrozen(ERROR_MESSAGES));
});

test('ERROR_MESSAGES each entry is frozen', () => {
  for (const [code, entry] of Object.entries(ERROR_MESSAGES)) {
    assert.ok(Object.isFrozen(entry), `${code} entry not frozen`);
  }
});

// ────────────────────────────────────────────────────────────────────────────
// renderErrorMessage — 템플릿 치환 + 크레딧 자동 포맷
// ────────────────────────────────────────────────────────────────────────────

test('renderErrorMessage substitutes {refunded} with formatCredit', () => {
  const msg = renderErrorMessage('claude_5xx', {
    refunded: 1,
    balance: 5.3,
  });
  assert.ok(msg.includes('1크레딧'), `expected "1크레딧" in: ${msg}`);
  assert.ok(msg.includes('5.3크레딧'), `expected "5.3크레딧" in: ${msg}`);
  // 원본 placeholder가 남아있으면 안 됨
  assert.ok(!msg.includes('{refunded}'));
  assert.ok(!msg.includes('{balance}'));
});

test('renderErrorMessage handles 0.3 credit (refine cost)', () => {
  const msg = renderErrorMessage('refine_failed', {
    refunded: 0.3,
    balance: 10,
  });
  assert.ok(msg.includes('0.3크레딧'));
  assert.ok(msg.includes('10크레딧'));
});

test('renderErrorMessage unknown code returns safe fallback (not empty)', () => {
  const msg = renderErrorMessage('nonexistent_code');
  assert.equal(typeof msg, 'string');
  assert.ok(msg.length > 0);
  // 폴백도 금지 용어 포함 금지
  for (const word of FORBIDDEN_WORDS) {
    assert.ok(!msg.includes(word), `fallback contains "${word}"`);
  }
});

test('renderErrorMessage without vars leaves placeholders (not crashes)', () => {
  const msg = renderErrorMessage('claude_5xx');
  assert.equal(typeof msg, 'string');
  assert.ok(msg.length > 0);
});

test('renderErrorMessage 4xx case (no credit vars needed)', () => {
  const msg = renderErrorMessage('claude_4xx');
  assert.equal(typeof msg, 'string');
  assert.ok(msg.length > 0);
});

// ────────────────────────────────────────────────────────────────────────────
// 톤 체크 — 다음 동작 제시 (§6.5 "무엇이 + 왜 + 다음 동작")
// ────────────────────────────────────────────────────────────────────────────

test('every toast suggests a next action', () => {
  // "주세요" / "보세요" / "해도 돼요" / "돼요" 등 행동 유도 어미 포함
  const NEXT_ACTION_PATTERNS = [
    /주세요/,
    /보세요/,
    /해도/,
    /돼요/,
    /시도/,
  ];
  const violations = [];
  for (const [code, entry] of Object.entries(ERROR_MESSAGES)) {
    const hasAction = NEXT_ACTION_PATTERNS.some((p) => p.test(entry.toast));
    if (!hasAction) {
      violations.push(`${code}: no next-action phrase`);
    }
  }
  assert.deepEqual(violations, []);
});
