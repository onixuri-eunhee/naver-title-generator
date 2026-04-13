/**
 * 카드뉴스 Variant 시스템 — Phase 1
 *
 * 목적: 같은 입력(텍스트/테마)이라도 시드에 따라 매번 시각적으로 다른
 * 결과가 나오도록 "효과 스킬 풀"에서 결정론적으로 랜덤 선택.
 *
 * 적용 pool (Phase 1):
 * 1. typeScale    — compact / normal / impact / asymmetric
 * 2. accentPlacement — left-bar / top-bar / corner-mark / dot-cluster
 * 3. numberStyle  — circle-badge / big-serif / underline / corner-tag
 * 4. contentRotation — seed 기반 변형 (A/B/C) 순환 (기존 번호 modulo 대체)
 *
 * 사용자가 "다시" 누르면 새 시드 → 다른 조합.
 * 시드를 응답에 포함시켜 재현 가능.
 */

// ═══════════════════════════════════════════════════════════════
// Seeded PRNG (mulberry32) — 결정론적 난수 생성
// ═══════════════════════════════════════════════════════════════
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function stringToSeed(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// pool에서 1개 pick
function pickFrom(rng, pool) {
  return pool[Math.floor(rng() * pool.length)];
}

// ═══════════════════════════════════════════════════════════════
// Variant Pool 정의
// ═══════════════════════════════════════════════════════════════

export const TYPE_SCALES = {
  compact: {
    name: '컴팩트',
    // 제목 작고 본문 크게 (정보 밀도 높게)
    cover: { title: 72, subtitle: 28 },
    summary: { title: 44, body: 36, label: 24 },
    content: { title: 40, body: 38, number: 76 },
    quote: { body: 36 },
    cta: { title: 48, button: 30 },
    compare: { title: 44, label: 26, item: 24 },
    flow: { title: 46, stepTitle: 28, stepBody: 22 },
  },
  normal: {
    name: '기본',
    cover: { title: 96, subtitle: 36 },
    summary: { title: 52, body: 36, label: 28 },
    content: { title: 48, body: 36, number: 88 },
    quote: { body: 44 },
    cta: { title: 60, button: 36 },
    compare: { title: 50, label: 30, item: 26 },
    flow: { title: 54, stepTitle: 32, stepBody: 22 },
  },
  impact: {
    name: '임팩트',
    // 제목 거대 + 본문 타이트 (포스터 느낌)
    cover: { title: 112, subtitle: 42 },
    summary: { title: 64, body: 32, label: 30 },
    content: { title: 60, body: 32, number: 104 },
    quote: { body: 54 },
    cta: { title: 72, button: 38 },
    compare: { title: 60, label: 34, item: 24 },
    flow: { title: 66, stepTitle: 36, stepBody: 22 },
  },
  asymmetric: {
    name: '비대칭',
    // 한 줄이 크고 나머지가 작음
    cover: { title: 104, subtitle: 30 },
    summary: { title: 58, body: 32, label: 26 },
    content: { title: 54, body: 32, number: 96 },
    quote: { body: 48 },
    cta: { title: 66, button: 34 },
    compare: { title: 54, label: 32, item: 24 },
    flow: { title: 60, stepTitle: 34, stepBody: 22 },
  },
};

export const ACCENT_PLACEMENTS = ['left-bar', 'top-bar', 'corner-mark', 'dot-cluster'];

export const NUMBER_STYLES = ['circle-badge', 'big-serif', 'underline', 'corner-tag'];

export const CONTENT_VARIANTS = ['A', 'B', 'C'];

// ═══════════════════════════════════════════════════════════════
// pickVariant — 시드로부터 전체 variant 설정 derive
// ═══════════════════════════════════════════════════════════════
/**
 * @param {number} seed — 양의 정수 시드. 없으면 Date.now() 기반.
 * @returns {VariantConfig}
 */
export function pickVariant(seed) {
  if (typeof seed !== 'number' || !Number.isFinite(seed)) {
    seed = Math.floor(Math.random() * 0xFFFFFFFF);
  }
  const rng = mulberry32(seed);

  // 각 pool에서 결정론적 pick
  const typeScaleKey = pickFrom(rng, Object.keys(TYPE_SCALES));
  const accentPlacement = pickFrom(rng, ACCENT_PLACEMENTS);
  const numberStyle = pickFrom(rng, NUMBER_STYLES);

  // contentRotation: 슬라이드별로 다른 variant rotate (seed + 슬라이드 인덱스 기반)
  // 여기서는 시작 오프셋만 pick. 실제 rotation은 render 시점에 index 더해서 진행.
  const contentStartOffset = Math.floor(rng() * CONTENT_VARIANTS.length);

  return {
    seed,
    typeScale: typeScaleKey,
    accentPlacement,
    numberStyle,
    contentStartOffset,
    // 각 슬라이드 인덱스에 대해 rotation 결과 반환
    getContentVariant(slideIndex) {
      return CONTENT_VARIANTS[(contentStartOffset + slideIndex) % CONTENT_VARIANTS.length];
    },
    // 폰트 사이즈 조회 — this.typeScale 기준 (override 대응)
    getSize(layoutName, key) {
      const scale = TYPE_SCALES[this.typeScale] || TYPE_SCALES.normal;
      return scale[layoutName] ? scale[layoutName][key] : undefined;
    },
  };
}

// ═══════════════════════════════════════════════════════════════
// 설명용 메타
// ═══════════════════════════════════════════════════════════════
export const VARIANT_META = {
  typeScale: {
    compact: '제목 작게, 본문 크게 (정보 밀도)',
    normal: '균형 잡힌 기본 스케일',
    impact: '제목 거대, 본문 타이트 (포스터 느낌)',
    asymmetric: '한 줄만 거대 (리듬감)',
  },
  accentPlacement: {
    'left-bar': '좌측 세로 바',
    'top-bar': '상단 가로 바',
    'corner-mark': '모서리 L자 마커',
    'dot-cluster': '점 클러스터',
  },
  numberStyle: {
    'circle-badge': '원형 배지',
    'big-serif': '큰 세리프 숫자',
    'underline': '밑줄 번호',
    'corner-tag': '모서리 태그',
  },
};
