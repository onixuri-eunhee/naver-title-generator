/**
 * lib/shortform/design-tokens.js — 카테고리별 디자인 토큰
 *
 * 벤치마크 영상 분석에서 자동 추출된 디자인 메타데이터를
 * 카테고리별로 집계하여 Redis에 저장/조회.
 * SceneRouter가 렌더 시 동적 적용.
 *
 * Redis key: design-rules:{category}, TTL 30일
 */
import { getRedis } from '@/lib/api-helpers';

const REDIS_PREFIX = 'design-rules:';
const TTL_SEC = 30 * 86400; // 30일

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

/**
 * Redis에서 카테고리별 디자인 토큰 읽기.
 * 없으면 DEFAULT_DESIGN_TOKENS 반환.
 *
 * @param {string} category
 * @returns {Promise<DesignTokens>}
 */
export async function getDesignTokens(category) {
  if (!category) return { ...DEFAULT_DESIGN_TOKENS };
  try {
    const redis = getRedis();
    const stored = await redis.get(`${REDIS_PREFIX}${category}`);
    if (stored && typeof stored === 'object') {
      return { ...DEFAULT_DESIGN_TOKENS, ...stored };
    }
  } catch (err) {
    console.warn(`[design-tokens] Redis read failed for ${category}:`, err.message);
  }
  return { ...DEFAULT_DESIGN_TOKENS };
}

/**
 * Redis에 카테고리별 디자인 토큰 저장 (TTL 30일).
 *
 * @param {string} category
 * @param {DesignTokens} tokens
 */
export async function saveDesignTokens(category, tokens) {
  if (!category || !tokens) return;
  try {
    const redis = getRedis();
    await redis.set(`${REDIS_PREFIX}${category}`, tokens, { ex: TTL_SEC });
    console.log(`[design-tokens] Saved for category=${category}, sampleCount=${tokens.sampleCount}`);
  } catch (err) {
    console.warn(`[design-tokens] Redis write failed for ${category}:`, err.message);
  }
}

/**
 * 여러 영상 분석 결과의 designMeta를 집계하여 DesignTokens 생성.
 *
 * @param {Array<object>} analysisResults  각 항목에 .designMeta 존재
 * @returns {DesignTokens}
 */
export function aggregateDesignTokens(analysisResults) {
  const metas = (analysisResults || [])
    .map((r) => r?.designMeta)
    .filter(Boolean);

  if (metas.length === 0) return { ...DEFAULT_DESIGN_TOKENS };

  // 평균 계산 헬퍼
  const avg = (arr) => arr.reduce((a, b) => a + b, 0) / (arr.length || 1);

  // 최빈값 계산 헬퍼
  const mode = (arr) => {
    const counts = {};
    for (const v of arr) if (v) counts[v] = (counts[v] || 0) + 1;
    return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  };

  // titleSizeRatio → px 변환 (1080 기준)
  const titleSizeRatios = metas.map((m) => m.titleSizeRatio).filter((v) => typeof v === 'number');
  const titleSize = titleSizeRatios.length > 0
    ? Math.round(avg(titleSizeRatios) * 1080)
    : DEFAULT_DESIGN_TOKENS.titleSize;

  // titlePositionPercent
  const posPercents = metas.map((m) => m.titlePositionPercent).filter((v) => typeof v === 'number');
  const titlePositionPercent = posPercents.length > 0
    ? Math.round(avg(posPercents))
    : DEFAULT_DESIGN_TOKENS.titlePositionPercent;

  // titlePosition 파생
  let titlePosition = 'center';
  if (titlePositionPercent <= 33) titlePosition = 'top';
  else if (titlePositionPercent >= 67) titlePosition = 'bottom';

  // backgroundTone
  const tones = metas.map((m) => m.backgroundTone).filter(Boolean);
  const backgroundTone = mode(tones) || DEFAULT_DESIGN_TOKENS.backgroundTone;

  // avgSceneDuration
  const durations = metas.map((m) => m.avgSceneDurationSec).filter((v) => typeof v === 'number');
  const avgSceneDuration = durations.length > 0
    ? Math.round(avg(durations) * 10) / 10
    : DEFAULT_DESIGN_TOKENS.avgSceneDuration;

  // textContrast
  const contrasts = metas.map((m) => m.textContrast).filter(Boolean);
  const textContrast = mode(contrasts) || DEFAULT_DESIGN_TOKENS.textContrast;

  // transitionStyle → preferredTransitions
  const transitions = metas.map((m) => m.transitionStyle).filter(Boolean);
  const dominantTransition = mode(transitions) || 'fade';
  const preferredTransitions = dominantTransition === 'mixed'
    ? ['fade', 'slide', 'wipe']
    : [dominantTransition];

  // accentUsage: dark background → bold, light → subtle
  const accentUsage = backgroundTone === 'dark' ? 'bold' : 'subtle';

  // bodySize, labelSize 비례 계산
  const bodySize = Math.round(titleSize * 0.55);
  const labelSize = Math.round(titleSize * 0.36);

  return {
    titleSize,
    bodySize,
    labelSize,
    titlePosition,
    titlePositionPercent,
    backgroundTone,
    preferredTransitions,
    avgSceneDuration,
    textContrast,
    accentUsage,
    updatedAt: new Date().toISOString(),
    sampleCount: metas.length,
  };
}
