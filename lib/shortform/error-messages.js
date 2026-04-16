// lib/shortform/error-messages.js
//
// 사용자 대면 에러 메시지 중앙 저장소 — toast 문구 + severity 태깅.
// spec: docs/superpowers/specs/2026-04-16-video-phase-a-bis-design.md
//       §4.6 / §6.5 / §6.6 / §7.5
//
// 톤 규칙 (§6.5): "무엇이 + 왜(비난 없이) + 다음 동작" 3요소.
//
// 자체 금지 목록 — §7.5 unit test가 전 toast 문자열에 대해 아래를 검증:
//   - 기술 용어: 렌더/render/API/DB/Claude/ElevenLabs/null/undefined/
//     stack/스택트레이스/서버/버그/예외/500/502/4xx/5xx
//   - 부정어: 에러/실패/오류 (→ 문제/어려웠어요)
//   - 비난조: /잘못됐습니다/ /틀렸습니다/ /못했습니다/
// 5xx severity는 {refunded} 또는 {balance} 변수 포함 의무.

import { formatCredit } from './settings.js';

// 크레딧 단위로 포맷팅할 variable 키 — renderErrorMessage가 자동 변환.
const CREDIT_VARS = new Set(['refunded', 'balance', 'charged', 'costCharged']);

const FALLBACK_TOAST = '잠시 문제가 있었어요. 다시 시도해 주세요.';

export const ERROR_MESSAGES = Object.freeze({
  claude_5xx: Object.freeze({
    toast:
      '잠시 문제가 있었어요. {refunded}을 돌려드렸고, 잔액은 {balance}이에요. 다시 시도해도 되고, 1~2분 후가 안전해요.',
    severity: '5xx',
  }),
  claude_4xx: Object.freeze({
    toast:
      '입력을 확인해 주세요. 주제를 조금 더 구체적으로 적거나, 특수문자를 줄여보면 좋아요.',
    severity: '4xx',
  }),
  tts_5xx: Object.freeze({
    toast:
      '음성을 만드는 중에 문제가 있었어요. {refunded}을 돌려드렸고, 잔액은 {balance}이에요. 같은 대본으로 다시 시도해도 되고, 1~2분 후가 안전해요.',
    severity: '5xx',
  }),
  timeout: Object.freeze({
    toast:
      '평소보다 오래 걸리고 있어요. {refunded}을 돌려드렸고, 잔액은 {balance}이에요. 같은 주제로 다시 시도하거나, 주제를 조금 다르게 적어 보세요.',
    severity: '5xx',
  }),
  asset_404: Object.freeze({
    toast:
      '이미지 한 장을 찾을 수 없어요. {refunded}을 돌려드렸고, 잔액은 {balance}이에요. Step 5에서 다시 선택해 주세요.',
    severity: '5xx',
  }),
  asset_fetch: Object.freeze({
    toast:
      '이미지를 가져오는 중에 문제가 있었어요. {refunded}을 돌려드렸고, 잔액은 {balance}이에요. Step 5에서 다른 이미지로 바꾸거나 잠시 후 다시 시도해 주세요.',
    severity: '5xx',
  }),
  oom: Object.freeze({
    toast:
      '영상이 조금 길어서 만들기 어려웠어요. {refunded}을 돌려드렸고, 잔액은 {balance}이에요. Step 3에서 대본을 줄이거나, 60초 이내로 조정해 주세요.',
    severity: '5xx',
  }),
  composition_id: Object.freeze({
    toast:
      '영상을 구성하는 중에 문제가 있었어요. {refunded}을 돌려드렸고, 잔액은 {balance}이에요. 잠시 후 다시 시도해 주세요.',
    severity: '5xx',
  }),
  script_generation_failed: Object.freeze({
    toast:
      '대본 만드는 중에 문제가 있었어요. {refunded}을 돌려드렸고, 잔액은 {balance}이에요. 주제를 조금 다르게 적거나, 1~2분 후 다시 시도해 주세요.',
    severity: '5xx',
  }),
  refine_failed: Object.freeze({
    toast:
      '수정을 적용하는 중에 문제가 있었어요. {refunded}을 돌려드렸고, 잔액은 {balance}이에요. 다시 시도하거나, 해당 항목을 바꾸지 않고 계속 진행해도 돼요.',
    severity: '5xx',
  }),
});

/**
 * 템플릿 변수 치환. 크레딧 관련 키({refunded}, {balance} 등)는 자동으로
 * formatCredit 적용. 알 수 없는 code는 FALLBACK_TOAST 반환 (렌더 경로 보호).
 *
 * @param {string} code - ERROR_MESSAGES 키
 * @param {object} [vars] - 치환 변수 { refunded, balance, ... }
 * @returns {string}
 */
export function renderErrorMessage(code, vars = {}) {
  const entry = ERROR_MESSAGES[code];
  if (!entry) return FALLBACK_TOAST;

  let toast = entry.toast;
  if (vars && typeof vars === 'object') {
    for (const [key, value] of Object.entries(vars)) {
      const placeholder = `{${key}}`;
      let replacement;
      if (CREDIT_VARS.has(key) && typeof value === 'number') {
        replacement = formatCredit(value);
      } else {
        replacement = String(value);
      }
      toast = toast.split(placeholder).join(replacement);
    }
  }
  return toast;
}
