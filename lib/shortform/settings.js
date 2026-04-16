// lib/shortform/settings.js
//
// SSOT — Phase A-bis 숏폼 설정 스키마, 비용, refine 라우팅, fps 파생.
// spec: docs/superpowers/specs/2026-04-16-video-phase-a-bis-design.md §4.1
//
// 규칙 (spec §3):
// - L1: React/Remotion import 금지
// - L2: 다른 모듈 import 금지 (리프 노드)
// - L6: process.env 직접 접근 금지 (인자로 주입)

export const SETTINGS_SCHEMA_VERSION = 1;

export const FPS_BY_CONTENT_TYPE = Object.freeze({ short: 30, long: 24 });

const CATEGORY_OPTIONS = [
  { id: 'auto', label: '자동 감지' },
  { id: 'wedding', label: '웨딩' },
  { id: 'food', label: '음식' },
  { id: 'realestate', label: '부동산' },
  { id: 'ai_education', label: 'AI 교육' },
  { id: 'beauty', label: '뷰티' },
  { id: 'fitness', label: '피트니스' },
  { id: 'lifestyle', label: '라이프스타일' },
  { id: 'business', label: '비즈니스' },
  { id: 'other', label: '기타' },
];

const FIRST_THREE_OPTIONS = [
  { id: 'auto', label: '자동' },
  { id: 'shock', label: '충격형' },
  { id: 'number', label: '숫자형' },
  { id: 'story', label: '스토리형' },
];

const SCRIPT_TYPE_OPTIONS = [
  { id: 'auto', label: '자동' },
  { id: 'question', label: '질문형' },
  { id: 'list', label: '리스트형' },
  { id: 'story', label: '스토리형' },
];

const CTA_TONE_OPTIONS = [
  { id: 'casual', label: '친근형' },
  { id: 'professional', label: '전문형' },
];

// CHIP_SCHEMA — Q9 칩 5종 (카테고리 → 첫3초 → 스크립트유형 → CTA톤 → 음성속도)
// 스캔 순서 = 사용자 의사결정 중요도.
export const CHIP_SCHEMA = Object.freeze({
  category: Object.freeze({
    id: 'category',
    label: '🏷️ 카테고리',
    type: 'select',
    options: Object.freeze(CATEGORY_OPTIONS.map((o) => Object.freeze(o))),
    refineRoute: 'category-refine',
    cost: 0.3,
  }),
  firstThreeSeconds: Object.freeze({
    id: 'firstThreeSeconds',
    label: '⚡ 첫 3초 스타일',
    type: 'select',
    options: Object.freeze(FIRST_THREE_OPTIONS.map((o) => Object.freeze(o))),
    refineRoute: 'first-three-refine',
    cost: 0.2,
  }),
  scriptType: Object.freeze({
    id: 'scriptType',
    label: '💬 스크립트 유형',
    type: 'select',
    options: Object.freeze(SCRIPT_TYPE_OPTIONS.map((o) => Object.freeze(o))),
    refineRoute: 'script-type-refine',
    cost: 0.5,
  }),
  ctaTone: Object.freeze({
    id: 'ctaTone',
    label: '🤝 CTA 톤',
    type: 'select',
    options: Object.freeze(CTA_TONE_OPTIONS.map((o) => Object.freeze(o))),
    refineRoute: null,
    cost: 0,
  }),
  voiceSpeed: Object.freeze({
    id: 'voiceSpeed',
    label: '🎙️ 음성 속도',
    type: 'slider',
    min: 1.05,
    max: 1.2,
    step: 0.01,
    default: 1.12,
    refineRoute: null,
    cost: 0,
  }),
});

// REFINE_ROUTES — CHIP_SCHEMA에서 파생
export const REFINE_ROUTES = Object.freeze(
  Object.fromEntries(
    Object.values(CHIP_SCHEMA).map((chip) => [chip.id, chip.refineRoute])
  )
);

// DEFAULT_SETTINGS — CHIP_SCHEMA에서 파생
// select: options[0].id / slider: default
export const DEFAULT_SETTINGS = Object.freeze(
  Object.fromEntries(
    Object.values(CHIP_SCHEMA).map((chip) => {
      if (chip.type === 'slider') return [chip.id, chip.default];
      return [chip.id, chip.options[0].id];
    })
  )
);

export function getChipCost(chipId, _optionId) {
  const chip = CHIP_SCHEMA[chipId];
  if (!chip) return 0;
  return chip.cost;
}

export function getTotalRefineCost(changedChips) {
  if (!Array.isArray(changedChips)) return 0;
  return changedChips.reduce((sum, id) => sum + getChipCost(id), 0);
}

export function getRefineRoute(chipId) {
  return REFINE_ROUTES[chipId] ?? null;
}

// migrateSettings — 빈 껍데기 (Phase F까지 실제 변환 로직 없음).
// 저장된 settings를 DEFAULT에 병합 + 버전 주입.
export function migrateSettings(saved) {
  const base = saved && typeof saved === 'object' ? saved : {};
  return {
    ...DEFAULT_SETTINGS,
    ...base,
    _version: SETTINGS_SCHEMA_VERSION,
  };
}

export function validateSettings(settings) {
  const errors = [];
  if (!settings || typeof settings !== 'object') {
    return { ok: false, errors: ['settings_not_object'] };
  }
  for (const chipId of Object.keys(CHIP_SCHEMA)) {
    if (!(chipId in settings)) errors.push(`missing:${chipId}`);
  }
  return { ok: errors.length === 0, errors };
}

export function getFps(contentType) {
  return FPS_BY_CONTENT_TYPE[contentType] ?? FPS_BY_CONTENT_TYPE.short;
}

export function formatCredit(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '0크레딧';
  if (Number.isInteger(n)) return `${n}크레딧`;
  return `${n}크레딧`;
}
