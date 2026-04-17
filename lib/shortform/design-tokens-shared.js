/**
 * lib/shortform/design-tokens-shared.js — 디자인 토큰 상수 (클라이언트/서버 공용)
 *
 * Redis 의존성이 없으므로 'use client' 컴포넌트와 Remotion 번들에서 안전하게 import 가능.
 * 서버 전용 함수(getDesignTokens, saveDesignTokens 등)는 design-tokens.js에서 import할 것.
 */

/**
 * @typedef {object} DesignTokens
 * @property {number} titleSize       제목 폰트 크기 (px, 1080 기준)
 * @property {number} bodySize        본문 폰트 크기
 * @property {number} labelSize       보조 라벨 크기
 * @property {'top'|'center'|'bottom'} titlePosition
 * @property {number} titlePositionPercent  상단에서 % (0~100)
 * @property {'dark'|'light'|'mixed'} backgroundTone
 * @property {string[]} preferredTransitions
 * @property {number} avgSceneDuration  평균 씬 길이 (초)
 * @property {'high'|'medium'} textContrast
 * @property {'bold'|'subtle'} accentUsage
 * @property {string|null} updatedAt  ISO timestamp
 * @property {number} sampleCount     분석한 영상 수
 */

/** 기본 토큰 — 벤치마크 데이터 없을 때 fallback */
export const DEFAULT_DESIGN_TOKENS = {
  titleSize: 88,
  bodySize: 48,
  labelSize: 32,
  titlePosition: 'top',
  titlePositionPercent: 30,
  backgroundTone: 'light',
  preferredTransitions: ['fade', 'slide', 'wipe'],
  avgSceneDuration: 4.5,
  textContrast: 'high',
  accentUsage: 'bold',
  updatedAt: null,
  sampleCount: 0,
};
