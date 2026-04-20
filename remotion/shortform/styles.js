/**
 * 숏폼 디자인 토큰 — my-video 포팅판.
 * Phase 3 (2026-04-18): Pretendard 통일. kinetic-type/fonts.js에서 FontFace API로
 * jsdelivr CDN 로드. SceneCard + Hook/Body/CTA 레거시 씬도 이제 Pretendard 사용.
 *
 * 폰트 로딩은 kinetic-type/fonts.js 의 모듈 side-effect로 처리. 본 파일 import 시
 * 체인 타고 자동 로드됨 (delayRender로 프레임 대기).
 */

import { PRETENDARD } from './kinetic-type/fonts.js';

export const FONTS = {
  primary: PRETENDARD,
  weight: {
    regular: 400,
    medium: 500,
    bold: 700,
    extraBold: 800,
    black: 900,
  },
};

export const SPACING = {
  xs: 6,
  sm: 16,
  md: 24,
  lg: 40,
  xl: 60,
  xxl: 80,
};

export const RADIUS = {
  card: 24,
  large: 48,
  full: 100,
};

export const SIZES = {
  hookBadge: 38,
  hookTitle: 88,
  hookUnderline: 64,
  bodyHeader: 64,
  bodyCaption: 40,
  cardNumber: 120,
  cardTitle: 48,
  cardDescription: 28,
  ctaBrand: 56,
  ctaHeadline: 56,
  ctaButton: 44,
};

export const SPRING_CONFIG = { damping: 200 };

export const SHORTFORM_FPS = 30;
export const SHORTFORM_WIDTH = 1080;
export const SHORTFORM_HEIGHT = 1920;

// ─────────────────────────────────────────────────────────────────────────────
// Phase 4 (2026-04-18): my-video styles.ts 에서 이식 — shadow/glass 스타일 토큰.
// preset 주입 방식이라 색상은 동적 생성. rgba 계산은 hexToRgba 유틸 재사용.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 5층 멀티 카드 쉐도우 — my-video CARD_SHADOW 포팅.
 * accent-deep 기반 rgba 중첩으로 깊이감 생성. 블러 강도 단계적 증가.
 */
export function buildCardShadow(accentDeep = '#B33A2F') {
  return [
    `0 1px 1px ${hexToRgba(accentDeep, 0.05)}`,
    `0 4px 8px ${hexToRgba(accentDeep, 0.06)}`,
    `0 12px 24px ${hexToRgba(accentDeep, 0.07)}`,
    `0 24px 48px ${hexToRgba(accentDeep, 0.05)}`,
    'inset 0 1px 0 rgba(255, 255, 255, 0.7)',
  ].join(', ');
}

/** 2층 날카로운 타이틀 쉐도우 — 비블러 우선. */
export function buildTitleShadow(accentDeep = '#B33A2F') {
  return [
    `0 2px 0 ${hexToRgba(accentDeep, 0.12)}`,
    `0 4px 8px ${hexToRgba(accentDeep, 0.08)}`,
  ].join(', ');
}

/** 강조어 전용 2층 쉐도우. */
export function buildAccentTextShadow(accentDeep = '#B33A2F') {
  return [
    `0 2px 0 ${hexToRgba(accentDeep, 0.20)}`,
    `0 4px 10px ${hexToRgba(accentDeep, 0.12)}`,
  ].join(', ');
}

/** preset 기반 shadow 토큰 세트 (sm/md/lg/xl). */
export function buildShadowTokens(accentDeep = '#B33A2F') {
  return {
    sm: hexToRgba(accentDeep, 0.06),
    md: hexToRgba(accentDeep, 0.10),
    lg: hexToRgba(accentDeep, 0.15),
    xl: hexToRgba(accentDeep, 0.20),
  };
}

export const GLASS_BACKDROP_STRONG = {
  backdropFilter: 'blur(30px) saturate(140%)',
  WebkitBackdropFilter: 'blur(30px) saturate(140%)',
};

export const GLASS_BACKDROP_SOFT = {
  backdropFilter: 'blur(20px) saturate(140%)',
  WebkitBackdropFilter: 'blur(20px) saturate(140%)',
};

export const CARD_BG = 'rgba(255, 255, 255, 0.7)';

export function buildCardBorder(accent = '#ff6f61') {
  return `1px solid ${hexToRgba(accent, 0.15)}`;
}

/**
 * Phase F — Step 6에서 커스터마이즈된 subtitle 값을 CSS로 변환
 *
 * subtitle: { color, font, size, position, bgColor, bgOpacity }
 * textPosition: 'top'|'center'|'center-large'|'bottom'|'free'
 */
export function buildSubtitleStyle(subtitle, textPosition) {
  if (!subtitle) return null;
  const sizeBoost = textPosition === 'center-large' ? 1.25 : 1;
  const isSolidBlock = (subtitle.bgOpacity ?? 0.5) >= 0.98;
  const wantsShadow = subtitle.noShadow ? false : !subtitle.bgColor;
  return {
    color: subtitle.color || '#ffffff',
    fontFamily: subtitle.font
      ? `"${subtitle.font}", ${PRETENDARD}`
      : PRETENDARD,
    fontSize: Math.round((subtitle.size || 56) * sizeBoost),
    backgroundColor: subtitle.bgColor
      ? hexToRgba(subtitle.bgColor, subtitle.bgOpacity ?? 0.5)
      : 'transparent',
    padding: subtitle.bgColor ? '14px 26px' : 0,
    borderRadius: isSolidBlock ? 6 : 12,      // 단색 블록은 sharp 느낌
    fontWeight: isSolidBlock ? 800 : 900,      // 단색 블록은 살짝 가볍게 (가독성)
    lineHeight: 1.25,
    letterSpacing: isSolidBlock ? 0 : -0.5,    // 단색 블록은 정상 자간 (비즈니스 프린트 느낌)
    textAlign: 'center',
    display: 'inline-block',
    // bg 가 투명/없을 때만 기본 드롭섀도우 (가독성 보조). noShadow=true 또는 단색 블록에서는 제거.
    textShadow: wantsShadow ? '0 2px 6px rgba(0,0,0,0.45)' : 'none',
  };
}

function hexToRgba(hex, alpha) {
  if (!hex) return `rgba(0,0,0,${alpha})`;
  const h = hex.replace('#', '');
  if (h.length !== 6) return hex;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * textPosition → flex align 매핑
 */
export function textPositionToAlign(textPosition) {
  switch (textPosition) {
    case 'top':
      return 'flex-start';
    case 'center':
    case 'center-large':
      return 'center';
    case 'free':
      return 'center';
    case 'bottom':
    default:
      return 'flex-end';
  }
}
