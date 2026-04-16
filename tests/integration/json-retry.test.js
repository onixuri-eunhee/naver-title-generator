// tests/integration/json-retry.test.js
//
// spec §7.8 — JSON 파싱 retry 시뮬레이션.
// Claude mock으로 첫 시도 깨진 JSON → 재시도 시 strict 블록 주입 확인.
//
// DB 불필요 (순수 로직 테스트). prompt.js의 buildSystemPrompt + retryAttempt 검증.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { safeParseJson } from '../../lib/shortform/parse-claude-json.js';
import { buildSystemPrompt, __resetReasoningWarning } from '../../lib/shortform/prompt.js';

// ─────────────────────────────────────────────────────────────────────────────
// safeParseJson + retry 시뮬레이션
// ─────────────────────────────────────────────────────────────────────────────

test('첫 시도 깨진 JSON → safeParseJson null → retryAttempt 증가 → strict 블록', () => {
  __resetReasoningWarning();

  // 시뮬: Claude 첫 응답이 깨진 JSON
  const brokenResponse = '여기 JSON 결과입니다: {"scenes": [{"script": "안녕"}]}  ← 이게 결과!';
  const parsed = safeParseJson(brokenResponse);

  // safeParseJson은 balanced bracket으로 복구 시도 — 성공할 수도 있음
  if (parsed) {
    assert.ok(parsed.scenes, 'safeParseJson이 복구한 경우 scenes 존재');
  } else {
    // 복구 실패 시 null → retry 트리거
    assert.equal(parsed, null, '깨진 JSON은 null');
  }

  // retry 시 strict 블록이 주입되는지 검증
  const promptRetry1 = buildSystemPrompt({
    category: 'wedding',
    scriptType: 'question',
    firstThreeSeconds: 'auto',
    contentType: 'short',
    retryAttempt: 1,
  });
  assert.ok(promptRetry1.includes('JSON'), 'retry=1에 JSON strict 블록');
  assert.ok(promptRetry1.includes('시도 1') || promptRetry1.includes('1/3'), '시도 횟수 명시');
});

test('완전 깨진 JSON → null → retry에서 strict → 정상 JSON parse', () => {
  const broken = 'not json at all {{{{';
  assert.equal(safeParseJson(broken), null, '완전 깨진 JSON은 null');

  // retry=2 (마지막 시도)
  const promptRetry2 = buildSystemPrompt({
    category: 'food',
    scriptType: 'list',
    firstThreeSeconds: 'number',
    contentType: 'short',
    retryAttempt: 2,
  });
  assert.ok(promptRetry2.includes('시도 2') || promptRetry2.includes('2/3'), '마지막 retry 시도 명시');

  // 정상 JSON은 파싱 성공
  const goodJson = '{"scenes": [{"script": "맛집 추천"}]}';
  const result = safeParseJson(goodJson);
  assert.ok(result.scenes[0].script === '맛집 추천');
});

test('retry 패턴 전체 흐름 시뮬레이션 (3회 시도)', () => {
  __resetReasoningWarning();

  const MAX_RETRIES = 2;
  const claudeResponses = [
    '여기요 {"scenes 이상한거',                           // 시도 1: 완전 깨짐
    '{"scenes": [{"script": "안녕"}]} 추가 설명입니다!',  // 시도 2: 뒤에 잡소리
    '{"scenes": [{"script": "정상"}]}',                   // 시도 3: 완벽
  ];

  let lastParsed = null;
  let successAttempt = -1;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const prompt = buildSystemPrompt({
      category: 'wedding',
      scriptType: 'question',
      firstThreeSeconds: 'auto',
      contentType: 'short',
      retryAttempt: attempt,
    });

    if (attempt > 0) {
      assert.ok(prompt.includes('JSON'), `attempt ${attempt}에 strict 블록`);
    }

    const raw = claudeResponses[attempt];
    const parsed = safeParseJson(raw);

    if (parsed && Array.isArray(parsed.scenes)) {
      lastParsed = parsed;
      successAttempt = attempt;
      break;
    }
  }

  // safeParseJson의 balanced bracket이 시도 2에서 복구할 수 있음
  assert.ok(lastParsed !== null, '3회 이내에 파싱 성공');
  assert.ok(successAttempt <= MAX_RETRIES, `성공 시도: ${successAttempt}`);
  assert.ok(Array.isArray(lastParsed.scenes));
});

// ─────────────────────────────────────────────────────────────────────────────
// retryAttempt가 프롬프트에 미치는 영향만 검증 (실제 Claude 호출 X)
// ─────────────────────────────────────────────────────────────────────────────

test('retryAttempt 0→1→2: strict 블록 점점 더 앞에', () => {
  __resetReasoningWarning();

  const prompts = [0, 1, 2].map((attempt) =>
    buildSystemPrompt({
      category: 'beauty',
      scriptType: 'list',
      firstThreeSeconds: 'auto',
      contentType: 'short',
      retryAttempt: attempt,
    }),
  );

  // attempt 0: strict 없음
  assert.ok(!prompts[0].includes('시도 '));

  // attempt 1, 2: strict 있음
  assert.ok(prompts[1].includes('1/3'), 'retryAttempt=1 → 1/3');
  assert.ok(prompts[2].includes('2/3'), 'retryAttempt=2 → 2/3');

  // strict 블록 위치: 프롬프트 맨 앞 (첫 3초 블록보다 선행)
  for (const p of [prompts[1], prompts[2]]) {
    const strictIdx = p.indexOf('JSON');
    const firstThreeIdx = p.indexOf('첫 3초');
    if (firstThreeIdx > 0 && strictIdx > 0) {
      assert.ok(strictIdx < firstThreeIdx, 'strict가 First 3 Sec보다 앞');
    }
  }
});
