// api/_satori-renderer.js
// Satori + Resvg 공유 렌더링 인프라 (카드뉴스 + 프리미엄 이미지 공용)

let _satori, _Resvg, _initWasm;
async function getSatori() {
  if (!_satori) {
    const mod = await import('satori');
    _satori = mod.default || mod;
  }
  return _satori;
}
async function getResvg() {
  if (!_Resvg || !_initWasm) {
    const mod = await import('@resvg/resvg-wasm');
    _Resvg = mod.Resvg;
    _initWasm = mod.initWasm;
  }
  return { Resvg: _Resvg, initWasm: _initWasm };
}

let fontRegular, fontBold, wasmInited = false;
const BASE_URL = 'https://ddukddaktool.co.kr';

async function initResvgWasm() {
  if (wasmInited) return;
  const { initWasm } = await getResvg();
  const resp = await fetch(`${BASE_URL}/assets/resvg.wasm`);
  const wasmBuf = await resp.arrayBuffer();
  await initWasm(wasmBuf);
  wasmInited = true;
}

async function loadFonts() {
  if (!fontRegular) {
    const [rResp, bResp] = await Promise.all([
      fetch(`${BASE_URL}/assets/NotoSansKR-Regular.subset.ttf`),
      fetch(`${BASE_URL}/assets/NotoSansKR-Bold.subset.ttf`),
    ]);
    fontRegular = Buffer.from(await rResp.arrayBuffer());
    fontBold = Buffer.from(await bResp.arrayBuffer());
  }
  return [
    { name: 'Noto Sans KR', data: fontRegular, weight: 400, style: 'normal' },
    { name: 'Noto Sans KR', data: fontBold, weight: 700, style: 'normal' },
  ];
}

const _F = 'Noto Sans KR';

function h(type, props, ...children) {
  const flat = children.flat().filter(Boolean);
  return { type, props: { ...props, children: flat.length === 1 ? flat[0] : flat.length === 0 ? undefined : flat } };
}

// \n → 줄별 div 분리 (Satori는 텍스트 \n 무시)
function lines(text, style) {
  if (!text) return null;
  const parts = String(text).split('\n').filter(Boolean);
  const isCentered = style.textAlign === 'center';
  const baseStyle = { display: 'flex', ...style };
  if (parts.length <= 1) return h('div', { style: baseStyle }, text || '');
  return h('div', { style: { ...baseStyle, flexDirection: 'column', alignItems: isCentered ? 'center' : 'flex-start' } },
    ...parts.map(line => h('div', { style: { display: 'flex', justifyContent: isCentered ? 'center' : 'flex-start' } }, line))
  );
}

// vnode → PNG base64 (data URI 형식)
async function renderToBase64(vnode, width = 1080, height = 1350) {
  await initResvgWasm();
  const satoriRender = await getSatori();
  const { Resvg } = await getResvg();
  const fonts = await loadFonts();

  const svg = await satoriRender(vnode, { width, height, fonts });
  const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: width } });
  const rendered = resvg.render();
  const pngBuffer = rendered.asPng();
  return `data:image/png;base64,${Buffer.from(pngBuffer).toString('base64')}`;
}

export { h, lines, _F, renderToBase64, getSatori, getResvg, initResvgWasm, loadFonts };
