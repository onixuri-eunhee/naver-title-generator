// lib/shared-prompts/rollout.js
//
// A/B 롤아웃 분기용 결정적 해시 + 플래그 헬퍼.
// 숏폼 SLIM(resolveSlimPromptFlag)과 동일 수학. 카드뉴스·스레드 등에서 공용.

/**
 * 결정적 간단 해시. crypto 의존 없음(edge/중첩 환경 안전).
 * @param {string} str
 * @returns {number} 0 이상 정수
 */
export function simpleHash(str) {
  const s = String(str ?? '');
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

/**
 * rollout% 만큼 sticky 분기. 같은 email은 항상 같은 결과.
 *
 * @param {{ email?: string|null, rollout: number }} opts
 * @returns {boolean}
 */
export function resolveRolloutFlag({ email, rollout }) {
  const r = Number(rollout);
  if (!Number.isFinite(r) || r <= 0) return false;
  if (r >= 100) return true;
  return (simpleHash(email || 'anon') % 100) < r;
}
