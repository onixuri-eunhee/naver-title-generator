/**
 * 시즌2 규제 검수 패스 (PRD 04번).
 *
 * 동작: 원고 생성 후 별도 검수. 위반 문구·사유 리스트 반환 → 위반 있으면 그 문구만
 * 재작성 지시 → 재검수(최대 N회). 그래도 남으면 발행 차단 + 사용자 경고(책임 확인 로그).
 *
 * 생성 프롬프트에 규제를 쌓지 않는 이유: rule-stacking 과적재 방지(글로벌 규칙).
 */

import { getRuleSet } from './regulation-rules.js';

/**
 * 검수용 시스템 프롬프트. 저비용 모델(Haiku)로 충분.
 * @param {string} industry
 */
export function buildCheckSystemPrompt(industry) {
  const rules = getRuleSet(industry);
  const ruleLines = rules
    .map((r) => `- ${r.id} (${r.basis}): 예) ${r.catch} → ${r.replace}`)
    .join('\n');
  return `너는 한국 광고 규제 검수기다. 아래 룰에 위반되는 표현을 원고에서 찾는다.
업종 룰:
${ruleLines || '(룰 없음 — 위반 없음으로 처리)'}

# 지침
- 원고에서 위반 소지 문구를 그대로(quote) 찾아 rule id와 사유를 단다.
- 애매하면 위반으로 보고(보수적). 근거 없는 단정·최상급·결과 보장에 특히 민감하게.
- 위반이 하나도 없으면 verdict=pass.

# 출력(JSON만)
{
  "verdict": "pass" | "fail",
  "violations": [
    { "quote": "원고 속 문구 그대로", "rule": "rule id", "reason": "왜 위반", "fix_hint": "권장 대체" }
  ]
}`;
}

/** 검수 결과 파싱. 모델이 코드펜스로 감싸도 견고하게. */
export function parseVerdict(rawText) {
  const text = String(rawText || '').trim();
  const jsonStr = extractJson(text);
  if (!jsonStr) {
    // 파싱 실패 시 안전하게 fail 처리(사람이 확인하도록) — 통과로 오판하지 않음
    return { verdict: 'fail', violations: [], parseError: true, raw: text.slice(0, 500) };
  }
  try {
    const obj = JSON.parse(jsonStr);
    const violations = Array.isArray(obj.violations) ? obj.violations : [];
    const verdict = obj.verdict === 'pass' && violations.length === 0 ? 'pass' : 'fail';
    return { verdict, violations };
  } catch {
    return { verdict: 'fail', violations: [], parseError: true, raw: text.slice(0, 500) };
  }
}

/** 텍스트에서 첫 JSON 객체를 추출(코드펜스·앞뒤 잡담 허용). */
function extractJson(text) {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fence ? fence[1].trim() : text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  return candidate.slice(start, end + 1);
}

/** 위반 문구만 고치라는 재작성 지시 프롬프트. */
export function buildFixInstruction(violations) {
  const lines = violations
    .map((v) => `- "${v.quote}" → ${v.fix_hint || '규정에 맞게 수정'} (${v.reason})`)
    .join('\n');
  return `아래 문구가 광고 규제에 위반된다. 해당 문구만 규정에 맞게 고쳐라. 나머지 글은 그대로 두고, 전체 원고를 같은 JSON 형식으로 다시 출력하라.
${lines}`;
}

export const MAX_FIX_ROUNDS = 2;
