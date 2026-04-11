#!/usr/bin/env node
import { SYSTEM_PROMPT, buildUserPrompt } from '../api/shortform-script.js';

const failures = [];

function assertContains(haystack, needle, label) {
  if (!haystack.includes(needle)) failures.push(`MISSING: ${label} — expected "${needle}"`);
}

function assertNotContains(haystack, needle, label) {
  if (haystack.includes(needle)) failures.push(`FORBIDDEN: ${label} — should not contain "${needle}"`);
}

// ── SYSTEM_PROMPT 검증 ──

// Hook 6종 공감 베이스 재해석
assertContains(SYSTEM_PROMPT, '공감 베이스', 'Hook 6종 재해석 헤더');
assertContains(SYSTEM_PROMPT, '6종 중 토픽에 가장 잘 맞는 것을 매번 다르게 선택', 'Hook 다양성 강제');

// 구조 강제 (공감 루프)
assertContains(SYSTEM_PROMPT, '공감 루프', '구조 섹션 헤더');
assertContains(SYSTEM_PROMPT, '7씬 (30초)', '30초 구조');
assertContains(SYSTEM_PROMPT, '10씬 (45초)', '45초 구조');
assertContains(SYSTEM_PROMPT, '마음읽기 질문', '마음읽기 강제');
assertContains(SYSTEM_PROMPT, 'scene[1]', 'scene[1] 위치 명시');

// Point 섹션
assertContains(SYSTEM_PROMPT, 'personaMemo', 'Point에 메모 변수 참조');
assertContains(SYSTEM_PROMPT, '관찰형 1인칭', '메모 없을 때 폴백');
assertContains(SYSTEM_PROMPT, '추상 나열 금지', 'Point 나열 금지');

// CTA 섹션 — 동료 호출 + 허용 예시
assertContains(SYSTEM_PROMPT, '동료로 호출', 'CTA 동료 호출 톤');
assertContains(SYSTEM_PROMPT, '비슷한 경험 있으면 댓글로 알려주세요', 'CTA 허용 예시');

// ── buildUserPrompt 검증 ──
const userPrompt = buildUserPrompt('테스트 토픽', '', 'casual', 30, 7, { fallback: true }, '저는 15년차 헤어 디자이너입니다');
assertContains(userPrompt, 'personaMemo', 'userPrompt에 personaMemo 라인');
assertContains(userPrompt, '저는 15년차 헤어 디자이너입니다', 'userPrompt에 메모 본문');
assertContains(userPrompt, '템플릿화 금지', 'userPrompt에 변주 강제');

const userPromptNoMemo = buildUserPrompt('테스트', '', 'casual', 30, 7, { fallback: true }, '');
assertContains(userPromptNoMemo, '(없음)', '메모 비었을 때 표시');

// ── 결과 출력 ──
if (failures.length === 0) {
  console.log('[PROMPT TEST] ✅ All assertions passed');
  process.exit(0);
} else {
  console.error('[PROMPT TEST] ❌ ' + failures.length + ' failures:');
  failures.forEach(f => console.error('  - ' + f));
  process.exit(1);
}
