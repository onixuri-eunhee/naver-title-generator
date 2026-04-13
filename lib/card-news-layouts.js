/**
 * 카드뉴스 디자인 풍부화 레이어 (컬러/레이아웃 불변)
 *
 * 실제 레이아웃 정의는 app/api/card-news/route.js에 인라인으로 있음 (3종 content 순환 등).
 * 이 모듈은 렌더 파이프라인 끝단에서 rgba 흑/백 overlay만 덧씌우는 역할.
 *
 * resvg-wasm이 `box-shadow: inset`에서 패닉하므로 전부 position:absolute overlay div로 구현.
 */

import { h } from './satori-renderer.js';

const W = 1080;
const H = 1350;

const overlay = (style) =>
  h('div', { style: { display: 'flex', position: 'absolute', ...style } });

const MESH_TOP_LEFT = overlay({
  top: -120,
  left: -120,
  width: 600,
  height: 600,
  background:
    'radial-gradient(circle, rgba(255,255,255,0.25) 0%, rgba(255,255,255,0) 70%)',
});
const MESH_BOTTOM_RIGHT = overlay({
  bottom: -160,
  right: -180,
  width: 700,
  height: 700,
  background:
    'radial-gradient(circle, rgba(255,255,255,0.20) 0%, rgba(255,255,255,0) 70%)',
});
const VIGNETTE = overlay({
  top: 0,
  left: 0,
  width: W,
  height: H,
  background:
    'radial-gradient(ellipse at center, rgba(0,0,0,0) 40%, rgba(0,0,0,0.05) 100%)',
});
const TOP_HIGHLIGHT = overlay({
  top: 0,
  left: 0,
  width: W,
  height: 2,
  background:
    'linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.4) 50%, rgba(255,255,255,0) 100%)',
});

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
    MESH_TOP_LEFT,
    MESH_BOTTOM_RIGHT,
    VIGNETTE,
    TOP_HIGHLIGHT,
    ...childArr,
  );
}
