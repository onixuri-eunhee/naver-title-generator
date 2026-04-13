/**
 * 카드뉴스 디자인 풍부화 레이어 (컬러/레이아웃 불변 하드 락)
 *
 * 원칙:
 * - 기존 레이아웃(app/api/card-news/route.js)의 vnode를 감싸서 overlay만 덧씌움
 * - 기존 컬러/폰트/크기/레이아웃/텍스트/이미지 배치 절대 불변
 * - 새 hex 컬러 도입 금지 — rgba 흑/백 투명도만 사용
 * - 모든 레이어는 position:absolute로 기존 위에 배치
 *
 * Satori(resvg-wasm) 제약 — 우아하게 생략/대체한 레이어:
 * - box-shadow inset: resvg-wasm 패닉 → absolute overlay div로 대체
 * - backdrop-filter / mix-blend-mode: 미지원 → opacity + rgba로 대체
 * - filter: blur(): 제한적 → 넓은 radial-gradient falloff로 블러 효과
 * - feTurbulence / SVG pattern: 복잡 → 생략 (Layer 6 Grid, Layer 7 Film Grain)
 * - 기존 카드 box-shadow 수정 (Layer 2): 하드 락 위반 → 생략
 * - 기존 구분선 / 텍스트 스타일 수정 (Layer 10, 11): 하드 락 위반 → 생략
 *
 * 적용된 레이어: 1, 3, 4, 5, 8, 9, 12 (7/12)
 * 생략 레이어: 2 (기존 스타일 수정 필요), 6 (SVG pattern), 7 (feTurbulence),
 *             10 (기존 구분선 수정), 11 (기존 텍스트 스타일 수정)
 */

import { h } from './satori-renderer.js';

const W = 1080;
const H = 1350;

const overlay = (style) =>
  h('div', { style: { display: 'flex', position: 'absolute', ...style } });

// ═══════════════════════════════════════════════════════════════
// Layer 1 — Mesh Gradient Overlay (4개 모서리 빛 번짐)
// Satori blur 미지원 → radial-gradient의 falloff로 블러 감 흉내
// 각 원은 카드 경계에 걸치도록 배치
// ═══════════════════════════════════════════════════════════════
const MESH_TOP_LEFT = overlay({
  top: -180,
  left: -180,
  width: 600,
  height: 600,
  background:
    'radial-gradient(circle, rgba(255,255,255,0.25) 0%, rgba(255,255,255,0) 70%)',
});
const MESH_TOP_RIGHT = overlay({
  top: -150,
  right: -150,
  width: 500,
  height: 500,
  background:
    'radial-gradient(circle, rgba(255,255,255,0.20) 0%, rgba(255,255,255,0) 70%)',
});
const MESH_BOTTOM_LEFT = overlay({
  bottom: -165,
  left: -165,
  width: 550,
  height: 550,
  background:
    'radial-gradient(circle, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0) 70%)',
});
const MESH_BOTTOM_RIGHT = overlay({
  bottom: -210,
  right: -210,
  width: 700,
  height: 700,
  background:
    'radial-gradient(circle, rgba(255,255,255,0.22) 0%, rgba(255,255,255,0) 70%)',
});

// ═══════════════════════════════════════════════════════════════
// Layer 8 — Ambient Radial Glow (빈 여백 공기감)
// 중앙에 극도로 은은한 방사형 그라디언트
// ═══════════════════════════════════════════════════════════════
const AMBIENT_GLOW = overlay({
  top: 0,
  left: 0,
  width: W,
  height: H,
  background:
    'radial-gradient(ellipse at center, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0) 60%)',
});

// ═══════════════════════════════════════════════════════════════
// Layer 4 — Edge Vignette (가장자리 디밍)
// 시선을 중앙으로 유도 / 영화적 기법
// inset box-shadow 대신 radial-gradient overlay 사용
// ═══════════════════════════════════════════════════════════════
const VIGNETTE = overlay({
  top: 0,
  left: 0,
  width: W,
  height: H,
  background:
    'radial-gradient(ellipse at center, rgba(0,0,0,0) 45%, rgba(0,0,0,0.08) 100%)',
});

// ═══════════════════════════════════════════════════════════════
// Layer 3 — Inner Highlight (상단 빛 반사, Apple 디자인 언어)
// inset box-shadow 불가 → 상단 가장자리에 얇은 그라디언트 바
// ═══════════════════════════════════════════════════════════════
const TOP_HIGHLIGHT = overlay({
  top: 0,
  left: 0,
  width: W,
  height: 3,
  background:
    'linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.5) 50%, rgba(255,255,255,0) 100%)',
});

// ═══════════════════════════════════════════════════════════════
// Layer 5 — Corner Glow (4 모서리 은은한 빛 점)
// 사진 필름 가장자리 빛 새는 느낌
// 각 모서리에 80×80 radial-gradient
// ═══════════════════════════════════════════════════════════════
const CORNER_GLOW_TL = overlay({
  top: -20,
  left: -20,
  width: 120,
  height: 120,
  background:
    'radial-gradient(circle at 30% 30%, rgba(255,255,255,0.15) 0%, rgba(255,255,255,0) 60%)',
});
const CORNER_GLOW_TR = overlay({
  top: -20,
  right: -20,
  width: 120,
  height: 120,
  background:
    'radial-gradient(circle at 70% 30%, rgba(255,255,255,0.15) 0%, rgba(255,255,255,0) 60%)',
});
const CORNER_GLOW_BL = overlay({
  bottom: -20,
  left: -20,
  width: 120,
  height: 120,
  background:
    'radial-gradient(circle at 30% 70%, rgba(255,255,255,0.15) 0%, rgba(255,255,255,0) 60%)',
});
const CORNER_GLOW_BR = overlay({
  bottom: -20,
  right: -20,
  width: 120,
  height: 120,
  background:
    'radial-gradient(circle at 70% 70%, rgba(255,255,255,0.15) 0%, rgba(255,255,255,0) 60%)',
});

// ═══════════════════════════════════════════════════════════════
// Layer 9 — Border Highlight Stack (외곽 이중 경계)
// 유리 판 느낌. outer dark border + inner white highlight line
// ═══════════════════════════════════════════════════════════════
// 외곽 다크 라인 (미세) — 전체 바닥 border emulation via top/bottom/left/right bars
const BORDER_OUTER_TOP = overlay({
  top: 0, left: 0, width: W, height: 1, background: 'rgba(0,0,0,0.04)',
});
const BORDER_OUTER_BOTTOM = overlay({
  bottom: 0, left: 0, width: W, height: 1, background: 'rgba(0,0,0,0.04)',
});
const BORDER_OUTER_LEFT = overlay({
  top: 0, left: 0, width: 1, height: H, background: 'rgba(0,0,0,0.04)',
});
const BORDER_OUTER_RIGHT = overlay({
  top: 0, right: 0, width: 1, height: H, background: 'rgba(0,0,0,0.04)',
});
// 내부 하이라이트 (1px 안쪽)
const BORDER_INNER_TOP = overlay({
  top: 1, left: 1, width: W - 2, height: 1, background: 'rgba(255,255,255,0.6)',
});
const BORDER_INNER_LEFT = overlay({
  top: 1, left: 1, width: 1, height: H - 2, background: 'rgba(255,255,255,0.4)',
});

// ═══════════════════════════════════════════════════════════════
// Layer 12 — Decorative Corner Accents (모서리 L자 마커)
// 에디토리얼 매거진 모서리 마커 느낌
// 각 모서리에 가로 24×1px + 세로 1×24px (inset 40px)
// ═══════════════════════════════════════════════════════════════
const CORNER_MARK = 'rgba(0,0,0,0.1)';
const CORNER_LEN = 24;
const CORNER_INSET = 40;
const CORNER_TL_H = overlay({
  top: CORNER_INSET, left: CORNER_INSET, width: CORNER_LEN, height: 1, background: CORNER_MARK,
});
const CORNER_TL_V = overlay({
  top: CORNER_INSET, left: CORNER_INSET, width: 1, height: CORNER_LEN, background: CORNER_MARK,
});
const CORNER_TR_H = overlay({
  top: CORNER_INSET, right: CORNER_INSET, width: CORNER_LEN, height: 1, background: CORNER_MARK,
});
const CORNER_TR_V = overlay({
  top: CORNER_INSET, right: CORNER_INSET, width: 1, height: CORNER_LEN, background: CORNER_MARK,
});
const CORNER_BL_H = overlay({
  bottom: CORNER_INSET, left: CORNER_INSET, width: CORNER_LEN, height: 1, background: CORNER_MARK,
});
const CORNER_BL_V = overlay({
  bottom: CORNER_INSET, left: CORNER_INSET, width: 1, height: CORNER_LEN, background: CORNER_MARK,
});
const CORNER_BR_H = overlay({
  bottom: CORNER_INSET, right: CORNER_INSET, width: CORNER_LEN, height: 1, background: CORNER_MARK,
});
const CORNER_BR_V = overlay({
  bottom: CORNER_INSET, right: CORNER_INSET, width: 1, height: CORNER_LEN, background: CORNER_MARK,
});

/**
 * 기존 카드뉴스 vnode를 감싸서 12레이어(적용 가능한 7개)를 덧씌움.
 * 렌더 순서(후방→전방):
 *   1. BACKGROUND — Mesh Gradient × 4 (Layer 1)
 *   2. BACKGROUND — Ambient Glow (Layer 8)
 *   3. CONTENT — 기존 children (변경 없음)
 *   4. FOREGROUND — Vignette (Layer 4)
 *   5. FOREGROUND — Top Highlight (Layer 3)
 *   6. FOREGROUND — Corner Glow × 4 (Layer 5)
 *   7. FOREGROUND — Border Stack (Layer 9)
 *   8. FOREGROUND — Corner Accents × 8 (Layer 12)
 */
export function withRichness(vnode) {
  const existingChildren = vnode.props.children;
  const childArr = [].concat(existingChildren ?? []);
  return h(
    vnode.type,
    {
      ...vnode.props,
      style: {
        ...(vnode.props.style || {}),
        position: 'relative',
        overflow: 'hidden',
      },
    },
    // ── BACKGROUND LAYERS (기존 컨텐츠 뒤) ──
    MESH_TOP_LEFT,
    MESH_TOP_RIGHT,
    MESH_BOTTOM_LEFT,
    MESH_BOTTOM_RIGHT,
    AMBIENT_GLOW,
    // ── CONTENT (기존 불변) ──
    ...childArr,
    // ── FOREGROUND LAYERS (기존 컨텐츠 앞) ──
    VIGNETTE,
    TOP_HIGHLIGHT,
    CORNER_GLOW_TL,
    CORNER_GLOW_TR,
    CORNER_GLOW_BL,
    CORNER_GLOW_BR,
    BORDER_OUTER_TOP,
    BORDER_OUTER_BOTTOM,
    BORDER_OUTER_LEFT,
    BORDER_OUTER_RIGHT,
    BORDER_INNER_TOP,
    BORDER_INNER_LEFT,
    CORNER_TL_H,
    CORNER_TL_V,
    CORNER_TR_H,
    CORNER_TR_V,
    CORNER_BL_H,
    CORNER_BL_V,
    CORNER_BR_H,
    CORNER_BR_V,
  );
}
