// lib/shortform/prompt-validator.js
//
// SLIM 프롬프트 모드용 post-generation 검증 + 통계 수집.
// spec: docs/superpowers/plans/2026-04-18-shortform-prompt-slim.md Task 2
//
// 규칙:
// - L1: React/Remotion import 금지
// - 순수 함수. 사이드 이펙트 없음.
// - errors → 심각(재시도 대상): layoutType 누락/오타
// - warnings → 경미(로그만): 데이터 시각화 <2회, onScreenText 길이/누락

/** 데이터 시각화 그룹 — 룰 4 기준 */
export const DATA_VIZ_LAYOUTS = new Set([
  'big-impact-text',
  'counter',
  'number-slam',
  'progress-bar',
  'bar-chart',
  'pie-chart',
]);

/** 17종 enum — 룰 2 기준 */
export const VALID_LAYOUTS = new Set([
  // 데이터 시각화 6
  'big-impact-text',
  'counter',
  'number-slam',
  'progress-bar',
  'bar-chart',
  'pie-chart',
  // 관계·프로세스 5
  'flow-diagram',
  'comparison',
  'comparison-chart',
  'venn-diagram',
  'network',
  // 텍스트 임팩트 4
  'bullet-list',
  'emphasis-box',
  'strikethrough',
  'vertical-bar',
  // 보조·레이블 2
  'small-label',
  'subtitle-bar',
]);

// Module-load drift guard — if a layout is added/removed without updating
// the expected counts here, this throws at import time (loud failure).
// The 17-layout enum is duplicated in 4 places; drift is the dominant risk.
if (VALID_LAYOUTS.size !== 17) {
  throw new Error(
    `[prompt-validator] VALID_LAYOUTS size drifted: expected 17, got ${VALID_LAYOUTS.size}`,
  );
}
if (DATA_VIZ_LAYOUTS.size !== 6) {
  throw new Error(
    `[prompt-validator] DATA_VIZ_LAYOUTS size drifted: expected 6, got ${DATA_VIZ_LAYOUTS.size}`,
  );
}

export const MAX_ONSCREEN_TEXT_LENGTH = 8;
export const MIN_DATA_VIZ_COUNT = 2;

/**
 * 슬림 프롬프트 출력 검증.
 *
 * @param {{ scenes?: Array<object> }} parsed — safeParseJson 결과
 * @returns {{
 *   ok: boolean,
 *   errors: string[],
 *   warnings: string[],
 *   stats: {
 *     sceneCount: number,
 *     dataVizCount: number,
 *     layoutDistribution: Record<string, number>,
 *   }
 * }}
 */
export function validateScriptQuality(parsed) {
  const errors = [];
  const warnings = [];

  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.scenes)) {
    return {
      ok: false,
      errors: ['scenes_not_array'],
      warnings: [],
      stats: { sceneCount: 0, dataVizCount: 0, layoutDistribution: {} },
    };
  }

  const scenes = parsed.scenes;

  // 룰 2: 모든 씬에 유효한 layoutType
  scenes.forEach((s, i) => {
    if (!s.layoutType) {
      errors.push(`scene_${i}_missing_layoutType`);
    } else if (!VALID_LAYOUTS.has(s.layoutType)) {
      errors.push(`scene_${i}_invalid_layoutType:${s.layoutType}`);
    }
    if (!s.layoutProps) {
      warnings.push(`scene_${i}_missing_layoutProps`);
    }
  });

  // 룰 3: onScreenText ≤8자
  scenes.forEach((s, i) => {
    if (!s.onScreenText) {
      warnings.push(`scene_${i}_missing_onScreenText`);
    } else if (typeof s.onScreenText === 'string' && s.onScreenText.length > MAX_ONSCREEN_TEXT_LENGTH) {
      warnings.push(`scene_${i}_onScreenText_too_long:${s.onScreenText.length}`);
    }
  });

  // 룰 4: 데이터 시각화 ≥2회
  const dataVizCount = scenes.filter((s) => DATA_VIZ_LAYOUTS.has(s.layoutType)).length;
  if (dataVizCount < MIN_DATA_VIZ_COUNT) {
    warnings.push(`data_viz_count_below_threshold:${dataVizCount}`);
  }

  const layoutDistribution = {};
  scenes.forEach((s) => {
    const key = s.layoutType || 'missing';
    layoutDistribution[key] = (layoutDistribution[key] || 0) + 1;
  });

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    stats: {
      sceneCount: scenes.length,
      dataVizCount,
      layoutDistribution,
    },
  };
}

