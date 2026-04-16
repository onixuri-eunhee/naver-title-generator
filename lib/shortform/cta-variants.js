// lib/shortform/cta-variants.js
//
// CTA Variant 레지스트리 — Remotion CTAVariantScene.jsx와 1:1 매칭.
// spec: docs/superpowers/specs/2026-04-16-video-phase-a-bis-design.md §4.4 / Q2
//
// 규칙:
// - L1: React/Remotion import 금지
// - componentName 필드는 레지스트리 내부 메타 — 공개 API가 반환하는 객체에는 제외
// - NODE_ENV === 'development'에서만 unknown ID에 throw, production은
//   save_follow_casual 폴백 + console.warn (Remotion 렌더 전체 실패 방지)

const FALLBACK_ID = 'save_follow_casual';

// 내부 레지스트리 — componentName 포함. 외부 노출 금지.
const _INTERNAL_REGISTRY = {
  save_follow_casual: {
    id: 'save_follow_casual',
    tone: 'casual',
    variant: 'casual', // Remotion CTAVariantScene props.variantProps.variant
    copy: '이 내용 저장해두시고, 비슷한 이야기 더 듣고 싶으시면 팔로우도 해주세요',
    icons: { save: '💾', follow: '➕' },
    componentName: 'CTAVariantScene', // 내부 메타 — 공개 API에서 제외
  },
  save_follow_professional: {
    id: 'save_follow_professional',
    tone: 'professional',
    variant: 'professional',
    copy: '유용하셨다면 저장해두시고, 더 많은 인사이트는 팔로우로 받아보세요',
    icons: { save: '💾', follow: '➕' },
    componentName: 'CTAVariantScene',
  },
};

function _stripInternal(entry) {
  if (!entry) return null;
  // componentName만 제외한 얕은 복사 후 freeze
  const { componentName: _cn, ...pub } = entry;
  return Object.freeze({ ...pub, icons: Object.freeze({ ...pub.icons }) });
}

// 공개 레지스트리 — componentName 제거된 frozen 맵
export const CTA_VARIANTS = Object.freeze(
  Object.fromEntries(
    Object.entries(_INTERNAL_REGISTRY).map(([id, entry]) => [
      id,
      _stripInternal(entry),
    ])
  )
);

function _isDev() {
  // process.env.NODE_ENV는 Next.js/webpack 빌드 타임 치환 대상 —
  // L6 "runtime env 주입" 규칙의 예외 (빌드 상수 취급).
  try {
    return typeof process !== 'undefined' && process.env && process.env.NODE_ENV === 'development';
  } catch {
    return false;
  }
}

export function getCTAVariant(id) {
  const hit = CTA_VARIANTS[id];
  if (hit) return hit;

  if (_isDev()) {
    throw new Error(`[cta-variants] Unknown variant id: ${id}`);
  }

  // production 폴백 — 렌더 전체 실패 방지
  // eslint-disable-next-line no-console
  console.warn(
    `[cta-variants] Unknown variant id "${id}", falling back to "${FALLBACK_ID}"`
  );
  return CTA_VARIANTS[FALLBACK_ID];
}

export function listCTAVariants() {
  return Object.values(CTA_VARIANTS);
}

export function getDefaultCTAVariant(tone) {
  if (tone === 'professional') return CTA_VARIANTS.save_follow_professional;
  return CTA_VARIANTS.save_follow_casual;
}
