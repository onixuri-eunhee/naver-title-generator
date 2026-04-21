// tests/unit/prompt.test.js
//
// spec §7.4 — prompt.js 순수성 + retryAttempt + scriptType 분기.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildSystemPrompt,
  buildUserPrompt,
  __resetReasoningWarning,
} from '../../lib/shortform/prompt.js';

beforeEach(() => {
  __resetReasoningWarning();
});

// ─────────────────────────────────────────────────────────────────────────────
// 기본 호출 — reasoningExamples 없이도 실행
// ─────────────────────────────────────────────────────────────────────────────

test('buildSystemPrompt: reasoningExamples 없어도 crash 안 함', () => {
  const prompt = buildSystemPrompt({
    category: 'wedding',
    scriptType: 'question',
    firstThreeSeconds: 'auto',
    contentType: 'short',
  });
  assert.ok(typeof prompt === 'string');
  assert.ok(prompt.length > 100, '의미 있는 프롬프트 길이');
  assert.ok(!prompt.includes('undefined'), 'undefined 문자열 포함 금지');
});

test('buildSystemPrompt: reasoningExamples 제공 시 프롬프트에 반영', () => {
  const examples = {
    copies: ['예비부부는 의심형에 댓글 2배'],
    fewShots: [{ input: '웨딩', output: '의심형 리플레이 30% ↑' }],
  };
  const prompt = buildSystemPrompt({
    category: 'wedding',
    scriptType: 'question',
    firstThreeSeconds: 'auto',
    contentType: 'short',
    reasoningExamples: examples,
  });
  assert.ok(prompt.includes('예비부부') || prompt.includes('의심형'),
    'reasoningExamples 내용이 프롬프트에 포함');
});

// ─────────────────────────────────────────────────────────────────────────────
// retryAttempt > 0: JSON strict 블록 맨 앞
// ─────────────────────────────────────────────────────────────────────────────

test('retryAttempt=0: strict 블록 없음', () => {
  const prompt = buildSystemPrompt({
    category: 'wedding',
    scriptType: 'question',
    firstThreeSeconds: 'auto',
    contentType: 'short',
    retryAttempt: 0,
  });
  assert.ok(!prompt.includes('시도 '));
});

test('retryAttempt=1: strict 블록 포함 + "시도 1/3"', () => {
  const prompt = buildSystemPrompt({
    category: 'wedding',
    scriptType: 'question',
    firstThreeSeconds: 'auto',
    contentType: 'short',
    retryAttempt: 1,
  });
  assert.ok(prompt.includes('시도 1/3') || prompt.includes('시도 1'),
    'retry 횟수 명시');
  assert.ok(prompt.includes('JSON'), 'JSON strict 언급');
});

test('retryAttempt=2: "시도 2/3" 포함', () => {
  const prompt = buildSystemPrompt({
    category: 'wedding',
    scriptType: 'question',
    firstThreeSeconds: 'auto',
    contentType: 'short',
    retryAttempt: 2,
  });
  assert.ok(prompt.includes('시도 2/3') || prompt.includes('시도 2'));
});

test('retryAttempt strict 블록은 프롬프트 맨 앞에 위치', () => {
  const prompt = buildSystemPrompt({
    category: 'wedding',
    scriptType: 'question',
    firstThreeSeconds: 'auto',
    contentType: 'short',
    retryAttempt: 1,
  });
  const jsonIdx = prompt.indexOf('JSON');
  const firstThreeIdx = prompt.indexOf('첫 3초');
  if (firstThreeIdx > 0) {
    assert.ok(jsonIdx < firstThreeIdx, 'strict 블록이 First 3 Sec 블록보다 앞');
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// scriptType === 'story': 루프 훅 미적용
// ─────────────────────────────────────────────────────────────────────────────

test('scriptType=story: 루프 훅 블록 없음', () => {
  const prompt = buildSystemPrompt({
    category: 'wedding',
    scriptType: 'story',
    firstThreeSeconds: 'auto',
    contentType: 'short',
  });
  assert.ok(!prompt.includes('루프 훅'), 'story에는 루프 훅 없어야');
});

test('scriptType=question: 루프 훅 블록 포함', () => {
  const prompt = buildSystemPrompt({
    category: 'wedding',
    scriptType: 'question',
    firstThreeSeconds: 'auto',
    contentType: 'short',
  });
  assert.ok(prompt.includes('루프') || prompt.includes('질문'),
    'question에는 루프 훅 또는 질문 규칙 포함');
});

test('scriptType=list: 루프 훅 블록 포함', () => {
  const prompt = buildSystemPrompt({
    category: 'wedding',
    scriptType: 'list',
    firstThreeSeconds: 'auto',
    contentType: 'short',
  });
  assert.ok(prompt.includes('루프') || prompt.includes('키워드') || prompt.includes('리스트'),
    'list에는 루프 훅 또는 리스트 관련 규칙 포함');
});

// ─────────────────────────────────────────────────────────────────────────────
// First 3 Seconds 블록 — Q4
// ─────────────────────────────────────────────────────────────────────────────

test('First 3 Seconds: 14자 제약 언급', () => {
  const prompt = buildSystemPrompt({
    category: 'wedding',
    scriptType: 'question',
    firstThreeSeconds: 'shock',
    contentType: 'short',
  });
  assert.ok(prompt.includes('14자') || prompt.includes('14'),
    '첫 씬 14자 제약 언급');
});

test('First 3 Seconds: 1.0초 이상 발화 가이드 (MIN guard 사전 예방)', () => {
  const prompt = buildSystemPrompt({
    category: 'wedding',
    scriptType: 'question',
    firstThreeSeconds: 'auto',
    contentType: 'short',
  });
  assert.ok(prompt.includes('1.0초') || prompt.includes('1초'),
    '1초 이상 발화 가이드 포함 (MIN guard 예방)');
});

// ─────────────────────────────────────────────────────────────────────────────
// L6: process.env 미접근
// ─────────────────────────────────────────────────────────────────────────────

test('process.env 비워도 buildSystemPrompt 정상 작동 (L6)', () => {
  const origEnv = process.env;
  process.env = {};
  try {
    const prompt = buildSystemPrompt({
      category: 'wedding',
      scriptType: 'question',
      firstThreeSeconds: 'auto',
      contentType: 'short',
    });
    assert.ok(prompt.length > 0);
  } finally {
    process.env = origEnv;
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// buildUserPrompt 기본
// ─────────────────────────────────────────────────────────────────────────────

test('buildUserPrompt: 기본 호출', () => {
  const prompt = buildUserPrompt({
    topic: '웨딩플래너가 알려주는 3대 실수',
    tone: 'casual',
    targetSceneCount: 7,
  });
  assert.ok(typeof prompt === 'string');
  assert.ok(prompt.includes('웨딩플래너'), '주제가 프롬프트에 포함');
});

test('buildUserPrompt: tone professional', () => {
  const prompt = buildUserPrompt({
    topic: '세무사의 절세 팁',
    tone: 'professional',
    targetSceneCount: 10,
  });
  assert.ok(typeof prompt === 'string');
  assert.ok(prompt.includes('세무사'), '주제 포함');
});

test('buildUserPrompt: 벤치마킹 대신 프롬프트 자산 규칙 포함', () => {
  const prompt = buildUserPrompt({
    topic: '아이 편식 줄이는 방법',
    tone: 'casual',
    targetSceneCount: 7,
  });
  assert.ok(prompt.includes('숏츠 작성 원칙'), '프롬프트 자산 섹션 포함');
  assert.ok(prompt.includes('~일 수 있어요'), '금지 표현 규칙 포함');
  assert.ok(!prompt.includes('실제 바이럴 영상'), '자동 벤치마킹 섹션 제거');
});

// ─────────────────────────────────────────────────────────────────────────────
// contentType 분기 (short vs long)
// ─────────────────────────────────────────────────────────────────────────────

test('contentType=long: 롱폼 힌트 포함', () => {
  const prompt = buildSystemPrompt({
    category: 'business',
    scriptType: 'list',
    firstThreeSeconds: 'auto',
    contentType: 'long',
  });
  assert.ok(prompt.includes('롱폼') || prompt.includes('long') || prompt.includes('60') || prompt.includes('90'),
    '롱폼 관련 힌트');
});
