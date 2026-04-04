# 프리미엄 이미지 스택 단순화 v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 프리미엄 이미지 8장을 썸네일(FLUX Realism 1장) + Satori 템플릿(4장) + Imagen 3 사진(3장)으로 구성하여 원가 196원/마진 88% 달성. Haiku가 능동적으로 비교표/흐름도/체크리스트/벤다이어그램을 발굴.

**Architecture:** card-news.js의 Satori 인프라(h, lines, 폰트, WASM)를 공유 모듈로 추출. 4종 Satori 템플릿(비교표/흐름도/체크리스트/벤다이어그램) 개발. Haiku 프롬프트를 "PHOTO-FIRST"에서 "BALANCED" 전략으로 전환하여 8장 중 절반을 Satori로 채움. photo는 썸네일(1번)만 FLUX Realism, 나머지는 Imagen 3. GPT Image 1.5는 삭제하지 않고 비활성 폴백으로 유지.

**Tech Stack:** Satori (JSX→SVG), @resvg/resvg-wasm (SVG→PNG), Vertex AI Imagen 3, FLUX Realism (fal.ai), Claude Haiku 4.5

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `api/_satori-renderer.js` | **Create** | Satori 공유 인프라 (h, lines, fonts, WASM init, renderToBase64) |
| `api/_satori-templates.js` | **Create** | 비교표 + 흐름도 + 체크리스트 + 벤다이어그램 4종 템플릿 |
| `api/card-news.js` | **Modify** | 공유 모듈 import로 전환 (중복 코드 제거) |
| `api/blog-image-pro.js` | **Modify** | Satori 렌더링 통합 + Haiku 전략 변경 + photo 라우팅 변경 |

---

### Task 1: Satori 공유 인프라 모듈 추출

**Files:**
- Create: `/Users/gong-eunhui/Desktop/naver-title-generator/api/_satori-renderer.js`
- Modify: `/Users/gong-eunhui/Desktop/naver-title-generator/api/card-news.js:6-126`

- [ ] **Step 1: `api/_satori-renderer.js` 생성**

card-news.js 라인 6~126의 Satori/Resvg/폰트/헬퍼 코드를 공유 모듈로 추출한다.

```javascript
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
```

- [ ] **Step 2: card-news.js 공유 모듈 import로 전환**

card-news.js 라인 6~126 전체를 삭제하고 아래로 교체:

```javascript
import { h, lines, _F, getSatori, getResvg, initResvgWasm, loadFonts } from './_satori-renderer.js';
```

card-news.js 내부의 `_W`, `_H`, `_P` 상수(라인 111)와 `layouts` 객체(라인 127~236)는 카드뉴스 전용이므로 그대로 유지:
```javascript
const _W = 1080, _H = 1350, _P = 100;
const layouts = { ... }; // 기존 그대로
```

`renderSlides()` 함수(라인 437~479)도 그대로 두되, import한 함수를 사용하게 된다 (getSatori, getResvg, initResvgWasm, loadFonts는 이제 외부 모듈에서 옴).

- [ ] **Step 3: 카드뉴스 동작 확인**

```
card-news.html 접속 → 아무 텍스트 붙여넣기 → 카드뉴스 생성
슬라이드 PNG가 기존과 동일하게 렌더링되는지 확인
```

- [ ] **Step 4: 커밋**

```bash
git add api/_satori-renderer.js api/card-news.js
git commit -m "refactor: Satori 공유 인프라 모듈 추출 (_satori-renderer.js)"
```

---

### Task 2: Satori 4종 템플릿 개발 (비교표/흐름도/체크리스트/벤다이어그램)

**Files:**
- Create: `/Users/gong-eunhui/Desktop/naver-title-generator/api/_satori-templates.js`

- [ ] **Step 1: `api/_satori-templates.js` 생성**

4종 템플릿 파일을 만든다. 각 템플릿은 Haiku가 출력하는 구조화 JSON을 받아 Satori vnode를 반환한다.

```javascript
// api/_satori-templates.js
// 프리미엄 이미지 Satori 템플릿 4종: 비교표, 흐름도, 체크리스트, 벤다이어그램
import { h, _F } from './_satori-renderer.js';

const W = 1024, H = 1536; // 2:3 vertical (기존 gpth 사이즈 동일)

const C = {
  bg: '#F8F9FA', card: '#FFFFFF', text: '#1A1A2E', sub: '#6B7280',
  accent: '#ff5f1f', border: '#E5E7EB',
  bars: ['#ff5f1f', '#3B82F6', '#10B981', '#8B5CF6', '#F59E0B', '#EC4899'],
};

// ─── 헤더 (제목 + 부제 + 구분선) — 공통 ───
function header(title, subtitle) {
  return h('div', { style: { display: 'flex', flexDirection: 'column', marginBottom: 48 } },
    title ? h('div', { style: { display: 'flex', fontFamily: _F, fontWeight: 700, fontSize: 48, color: C.text, lineHeight: 1.3 } }, title) : null,
    subtitle ? h('div', { style: { display: 'flex', fontFamily: _F, fontWeight: 400, fontSize: 28, color: C.sub, marginTop: 12 } }, subtitle) : null,
    h('div', { style: { display: 'flex', width: '100%', height: 2, background: C.border, marginTop: 32 } }),
  );
}

// ─── 출처 (하단) — 공통 ───
function footer(source) {
  if (!source) return null;
  return h('div', { style: { display: 'flex', fontFamily: _F, fontWeight: 400, fontSize: 22, color: C.sub, marginTop: 40, justifyContent: 'flex-end' } }, `Source: ${source}`);
}

// ════════════════════════════════════════
// 1. 비교표 (infographic_data)
// ════════════════════════════════════════
// JSON: { title, subtitle?, source?, items: [{ label, value, unit? }] }
function dataTemplate(data) {
  const { title, subtitle, source, items = [] } = data;
  const maxVal = Math.max(...items.map(it => parseFloat(it.value) || 0), 1);

  return h('div', { style: { display: 'flex', flexDirection: 'column', width: W, height: H, background: C.bg, padding: '80px 60px 60px' } },
    header(title, subtitle),
    h('div', { style: { display: 'flex', flexDirection: 'column', flex: 1, gap: 28, justifyContent: 'center' } },
      ...items.map((item, i) => {
        const pct = Math.round(((parseFloat(item.value) || 0) / maxVal) * 100);
        const color = C.bars[i % C.bars.length];
        return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
          h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
            h('div', { style: { display: 'flex', fontFamily: _F, fontWeight: 500, fontSize: 28, color: C.text } }, item.label || ''),
            h('div', { style: { display: 'flex', fontFamily: _F, fontWeight: 700, fontSize: 32, color } }, `${item.value}${item.unit || ''}`),
          ),
          h('div', { style: { display: 'flex', width: '100%', height: 36, background: '#F3F4F6', borderRadius: 8 } },
            h('div', { style: { display: 'flex', width: `${Math.max(pct, 5)}%`, height: 36, background: color, borderRadius: 8 } }),
          ),
        );
      }),
    ),
    footer(source),
  );
}

// ════════════════════════════════════════
// 2. 흐름도 (infographic_flow)
// ════════════════════════════════════════
// JSON: { title, subtitle?, steps: [{ label, description? }] }
function flowTemplate(data) {
  const { title, subtitle, steps = [] } = data;

  return h('div', { style: { display: 'flex', flexDirection: 'column', width: W, height: H, background: C.bg, padding: '80px 60px 60px' } },
    header(title, subtitle),
    h('div', { style: { display: 'flex', flexDirection: 'column', flex: 1, justifyContent: 'center', gap: 0 } },
      ...steps.flatMap((step, i) => {
        const color = C.bars[i % C.bars.length];
        const nodes = [];
        nodes.push(
          h('div', { style: { display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 24 } },
            h('div', { style: { display: 'flex', width: 64, height: 64, borderRadius: 32, background: color, alignItems: 'center', justifyContent: 'center', flexShrink: 0 } },
              h('div', { style: { display: 'flex', fontFamily: _F, fontWeight: 700, fontSize: 28, color: '#FFFFFF' } }, String(i + 1)),
            ),
            h('div', { style: { display: 'flex', flexDirection: 'column', flex: 1, background: C.card, borderRadius: 16, padding: '24px 32px', border: `2px solid ${C.border}` } },
              h('div', { style: { display: 'flex', fontFamily: _F, fontWeight: 700, fontSize: 30, color: C.text, lineHeight: 1.4 } }, step.label || ''),
              step.description ? h('div', { style: { display: 'flex', fontFamily: _F, fontWeight: 400, fontSize: 24, color: C.sub, lineHeight: 1.5, marginTop: 8 } }, step.description) : null,
            ),
          )
        );
        if (i < steps.length - 1) {
          nodes.push(
            h('div', { style: { display: 'flex', justifyContent: 'flex-start', paddingLeft: 26, height: 32 } },
              h('div', { style: { display: 'flex', width: 12, height: 32, borderLeft: `3px solid ${C.border}`, borderRight: `3px solid ${C.border}` } }),
            )
          );
        }
        return nodes;
      }),
    ),
  );
}

// ════════════════════════════════════════
// 3. 체크리스트 (checklist)
// ════════════════════════════════════════
// JSON: { title, subtitle?, items: [{ text, checked? }] }
function checklistTemplate(data) {
  const { title, subtitle, items = [] } = data;

  return h('div', { style: { display: 'flex', flexDirection: 'column', width: W, height: H, background: C.bg, padding: '80px 60px 60px' } },
    header(title, subtitle),
    h('div', { style: { display: 'flex', flexDirection: 'column', flex: 1, justifyContent: 'center', gap: 20 } },
      ...items.map((item, i) => {
        const checked = item.checked !== false; // 기본 checked
        const color = C.bars[i % C.bars.length];
        return h('div', { style: { display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 20, background: C.card, borderRadius: 16, padding: '24px 32px', border: `2px solid ${checked ? color : C.border}` } },
          // 체크 아이콘
          h('div', { style: { display: 'flex', width: 48, height: 48, borderRadius: 24, background: checked ? color : '#F3F4F6', alignItems: 'center', justifyContent: 'center', flexShrink: 0 } },
            h('div', { style: { display: 'flex', fontFamily: _F, fontWeight: 700, fontSize: 24, color: checked ? '#FFFFFF' : C.sub } }, checked ? '✓' : String(i + 1)),
          ),
          // 텍스트
          h('div', { style: { display: 'flex', flex: 1, fontFamily: _F, fontWeight: 500, fontSize: 28, color: C.text, lineHeight: 1.5 } }, item.text || ''),
        );
      }),
    ),
  );
}

// ════════════════════════════════════════
// 4. 벤다이어그램 / 관계도 (venn)
// ════════════════════════════════════════
// JSON: { title, subtitle?, sets: [{ label, description? }], overlap?: string }
// 2~3개 집합 지원
function vennTemplate(data) {
  const { title, subtitle, sets = [], overlap } = data;
  const count = Math.min(sets.length, 3);

  // 원 위치 계산 (2개: 좌우, 3개: 삼각형)
  const circleSize = count === 2 ? 380 : 320;
  const positions = count === 2
    ? [{ x: 260, y: 520 }, { x: 520, y: 520 }]
    : [{ x: 390, y: 420 }, { x: 260, y: 600 }, { x: 520, y: 600 }];

  // 라벨 위치 (원 바깥)
  const labelPositions = count === 2
    ? [{ x: 140, y: 780 }, { x: 600, y: 780 }]
    : [{ x: 300, y: 320 }, { x: 100, y: 800 }, { x: 580, y: 800 }];

  return h('div', { style: { display: 'flex', flexDirection: 'column', width: W, height: H, background: C.bg, padding: '80px 60px 60px' } },
    header(title, subtitle),
    // 벤다이어그램 영역
    h('div', { style: { display: 'flex', position: 'relative', flex: 1, width: '100%' } },
      // 원들
      ...sets.slice(0, count).map((set, i) => {
        const color = C.bars[i % C.bars.length];
        const pos = positions[i];
        return h('div', { style: { display: 'flex', position: 'absolute', left: pos.x - circleSize / 2, top: pos.y - circleSize / 2, width: circleSize, height: circleSize, borderRadius: circleSize / 2, background: color, opacity: 0.25 } });
      }),
      // 라벨들
      ...sets.slice(0, count).map((set, i) => {
        const color = C.bars[i % C.bars.length];
        const lp = labelPositions[i];
        return h('div', { style: { display: 'flex', flexDirection: 'column', position: 'absolute', left: lp.x, top: lp.y, alignItems: 'center', maxWidth: 280 } },
          h('div', { style: { display: 'flex', fontFamily: _F, fontWeight: 700, fontSize: 28, color } }, set.label || ''),
          set.description ? h('div', { style: { display: 'flex', fontFamily: _F, fontWeight: 400, fontSize: 22, color: C.sub, marginTop: 8, textAlign: 'center' } }, set.description) : null,
        );
      }),
      // 교집합 텍스트
      overlap ? h('div', { style: { display: 'flex', position: 'absolute', left: count === 2 ? 310 : 320, top: count === 2 ? 490 : 540, maxWidth: 200, fontFamily: _F, fontWeight: 700, fontSize: 24, color: C.text, textAlign: 'center', background: 'rgba(255,255,255,0.8)', borderRadius: 12, padding: '12px 16px' } }, overlap) : null,
    ),
  );
}

// ─── 템플릿 라우터 ───
// type → 템플릿 함수 매핑
function renderTemplate(type, jsonData) {
  const data = typeof jsonData === 'string' ? JSON.parse(jsonData) : jsonData;
  switch (type) {
    case 'infographic_data': return { vnode: dataTemplate(data), w: W, h: H };
    case 'infographic_flow': return { vnode: flowTemplate(data), w: W, h: H };
    case 'checklist': return { vnode: checklistTemplate(data), w: W, h: H };
    case 'venn': return { vnode: vennTemplate(data), w: W, h: H };
    default: return { vnode: dataTemplate(data), w: W, h: H };
  }
}

export { dataTemplate, flowTemplate, checklistTemplate, vennTemplate, renderTemplate, W as TMPL_W, H as TMPL_H };
```

- [ ] **Step 2: 커밋**

```bash
git add api/_satori-templates.js
git commit -m "feat: Satori 4종 템플릿 — 비교표/흐름도/체크리스트/벤다이어그램"
```

---

### Task 3: blog-image-pro.js — Satori 렌더링 통합 + photo 라우팅 변경

**Files:**
- Modify: `/Users/gong-eunhui/Desktop/naver-title-generator/api/blog-image-pro.js`

이 태스크에서 blog-image-pro.js의 모델 라우터, 재시도 로직, 로그 라벨을 변경한다.

- [ ] **Step 1: import 추가 (라인 1~5)**

기존 import 블록 아래에 추가:
```javascript
import { renderToBase64 } from './_satori-renderer.js';
import { renderTemplate } from './_satori-templates.js';
```

- [ ] **Step 2: generateByModel 변경 (라인 326~338)**

기존:
```javascript
async function generateByModel(model, prompt) {
  switch (model) {
    case 'fluxr':
      return await callFluxRealism(prompt);
    case 'gpth':
      return await callGptImageHigh(prompt);
    case 'nb2':
      return await callVertexImagen3(prompt);
    default:
      return await callFluxRealism(prompt);
  }
}
```

변경:
```javascript
async function generateByModel(model, prompt, type) {
  switch (model) {
    case 'fluxr':
      return await callFluxRealism(prompt);
    case 'gpth':
      return await callGptImageHigh(prompt);
    case 'nb2':
      return await callVertexImagen3(prompt);
    case 'satori': {
      const data = typeof prompt === 'string' ? JSON.parse(prompt) : prompt;
      const { vnode, w, h } = renderTemplate(type, data);
      return await renderToBase64(vnode, w, h);
    }
    default:
      return await callFluxRealism(prompt);
  }
}
```

- [ ] **Step 3: 배치 생성에서 type 파라미터 전달 (라인 963)**

기존:
```javascript
const url = await generateByModel(modelName, item.prompt);
```

변경:
```javascript
const url = await generateByModel(modelName, item.prompt, item.type);
```

- [ ] **Step 4: 모델 라벨 업데이트 (라인 961)**

기존:
```javascript
const modelLabel = { fluxr: 'FLUX Realism', gpth: 'GPT Image high', nb2: 'Nano Banana 2' }[modelName] || modelName;
```

변경:
```javascript
const modelLabel = { fluxr: 'FLUX Realism', gpth: 'GPT Image high', nb2: 'Imagen 3', satori: 'Satori 템플릿' }[modelName] || modelName;
```

- [ ] **Step 5: 재시도 로직에서 satori 처리 (라인 974~981)**

기존:
```javascript
if (modelName !== 'fluxr') {
  retryPrompt = item.prompt.replace(/\s*,?\s*no text,?\s*no letters,?\s*photography style\s*$/i, '') +
    ', no text, no letters, photography style';
  retryModel = 'fluxr';
}
```

변경:
```javascript
if (modelName !== 'fluxr') {
  retryModel = 'fluxr';
  if (modelName === 'satori' || typeof item.prompt !== 'string') {
    // Satori 실패 시 기본 사진 프롬프트로 FLUX Realism 폴백
    retryPrompt = 'high quality Korean lifestyle blog photography, soft natural lighting, editorial style, photorealistic, clean composition, no text, no letters, photography style';
  } else {
    retryPrompt = item.prompt.replace(/\s*,?\s*no text,?\s*no letters,?\s*photography style\s*$/i, '') +
      ', no text, no letters, photography style';
  }
}
```

- [ ] **Step 6: 재시도 결과의 type 반영 (라인 986)**

기존:
```javascript
type: retryModel === 'fluxr' ? 'photo' : item.type,
```

이건 그대로 OK — satori 실패 시 fluxr로 바뀌면 type도 photo로 변환됨.

- [ ] **Step 7: regenerate_single에서 satori 처리 (라인 706)**

기존:
```javascript
const url = await generateByModel(targetModel, finalPrompt);
```

변경:
```javascript
const url = await generateByModel(targetModel, finalPrompt, targetType);
```

기존 라인 720~723의 폴백에서도 satori 처리:
```javascript
if (targetModel !== 'fluxr') {
  try {
    let fbPrompt;
    if (targetModel === 'satori' || typeof finalPrompt !== 'string') {
      fbPrompt = 'high quality Korean lifestyle blog photography, soft natural lighting, editorial style, photorealistic, clean composition, no text, no letters, photography style';
    } else {
      fbPrompt = (finalPrompt || '').replace(/\s*,?\s*no text,?\s*no letters,?\s*photography style\s*$/i, '') +
        ', no text, no letters, photography style';
    }
    const url = await callFluxRealism(fbPrompt);
```

- [ ] **Step 8: photo 라우팅 — 배치 생성 직전에 index 기반 재라우팅 추가**

라인 950 (orderedItems 생성 후, 배치 생성 전)에 추가:

```javascript
// photo 라우팅: 첫 번째(썸네일)만 FLUX Realism, 나머지 photo는 Imagen 3
for (let i = 1; i < orderedItems.length; i++) {
  if (orderedItems[i].type === 'photo' && orderedItems[i].model === 'fluxr') {
    orderedItems[i].model = 'nb2';
  }
}
```

- [ ] **Step 9: 파일 헤더 주석 업데이트 (라인 9~20)**

기존:
```
 * 모델 라우팅:
 *   photo → FLUX Realism (fal-ai/flux-realism)
 *   infographic_data → GPT Image 1.5 high (gpt-image-1.5, quality: high)
 *   infographic_flow → Vertex AI Imagen 3 (GCP 크레딧)
 *   poster → Vertex AI Imagen 3 (GCP 크레딧)
```

변경:
```
 * 모델 라우팅:
 *   photo(썸네일 1번) → FLUX Realism (fal-ai/flux-realism)
 *   photo(본문 2번~) → Vertex AI Imagen 3 (GCP 크레딧, "no text")
 *   infographic_data → Satori 비교표 템플릿 (서버 렌더링)
 *   infographic_flow → Satori 흐름도 템플릿 (서버 렌더링)
 *   checklist → Satori 체크리스트 템플릿 (서버 렌더링)
 *   venn → Satori 벤다이어그램 템플릿 (서버 렌더링)
 *   poster → Vertex AI Imagen 3 (GCP 크레딧)
 *   (GPT Image 1.5 — 비활성 폴백으로 유지)
```

- [ ] **Step 10: 커밋**

```bash
git add api/blog-image-pro.js
git commit -m "feat: Satori 렌더링 통합 + photo 라우팅 변경 (썸네일=Realism, 본문=Imagen3)"
```

---

### Task 4: Haiku 프롬프트 — BALANCED 전략으로 전환

**Files:**
- Modify: `/Users/gong-eunhui/Desktop/naver-title-generator/api/blog-image-pro.js:355-485`

Haiku가 8장 중 약 4장을 Satori 템플릿(비교표/흐름도/체크리스트/벤다이어그램)으로 능동 분류하도록 프롬프트를 전면 개편한다.

- [ ] **Step 1: 시스템 프롬프트 전면 교체 (라인 355~430)**

기존 `CRITICAL: PHOTO-FIRST RULE` + 4 IMAGE TYPES 섹션 전체를 아래로 교체:

```javascript
  const systemPrompt = `You are a blog image prompt engineer with automatic model routing.
Classify each marker into ONE of 6 types, select the best renderer, and generate the prompt or structured data.

## BALANCED STRATEGY (핵심)
8장의 이미지 중 최적 배분을 목표로 합니다:
- photo: 3~4장 (사실적 사진 — 감성, 분위기, 제품, 풍경)
- Satori 템플릿: 3~4장 (데이터/프로세스/체크리스트/관계도 — 정보 시각화)
- poster: 0~1장 (포스터/배너 — 한글 타이포)

블로그 글의 내용을 분석하여, 수치/비교/단계/목록/관계가 언급되는 곳에서 **적극적으로** Satori 유형을 선택하세요.
단, 첫 번째 마커는 반드시 photo (대표이미지/썸네일)여야 합니다.

## 6 IMAGE TYPES

### 1. photo → model: "fluxr" (사실적 사진)
For: 사진, 배경, 풍경, 음식, 인물, 제품, 인테리어, 사물, 감성/분위기 연출
- Describe subjects, lighting, angle, mood as cinematic/editorial photography
- Signs/menus in scene → describe as blurred
- End with: ", photorealistic, clean composition, no text, no letters, photography style"
- prompt: 영어 80-150 words

### 2. infographic_data → model: "satori" (비교표/차트)
For: 수치 비교, 통계, 가격 비교, 순위, 비율, 장단점 대조 등 **숫자가 있는 비교**
- prompt: JSON 객체 (영어 아님!)
  {"title":"한국어 제목","subtitle":"범위/연도","source":"출처","items":[{"label":"항목명","value":"85","unit":"%"}]}
- items 3~6개. value는 숫자 문자열. unit은 %, 만원, 명, 개월 등
- 블로그 문맥에서 **실제 데이터를 추출**하여 사실적으로 구성

### 3. infographic_flow → model: "satori" (흐름도/프로세스)
For: 절차, 순서, 단계, 타임라인, 로드맵, 준비 과정, 진행 순서 등 **순서가 있는 프로세스**
- prompt: JSON 객체
  {"title":"한국어 제목","subtitle":"부제","steps":[{"label":"단계명","description":"설명"}]}
- steps 3~6개. 블로그 문맥에서 실제 절차를 추출

### 4. checklist → model: "satori" (체크리스트)
For: 준비물, 필수 항목, 팁 모음, 주의사항, 확인 사항 등 **나열형 정보**
- prompt: JSON 객체
  {"title":"한국어 제목","subtitle":"부제","items":[{"text":"항목 내용","checked":true}]}
- items 4~8개. checked는 true/false (핵심 항목만 true)

### 5. venn → model: "satori" (벤다이어그램/관계도)
For: 개념 비교, 공통점/차이점, 카테고리 관계, A vs B, 겹치는 영역 등 **관계/교집합**
- prompt: JSON 객체
  {"title":"한국어 제목","subtitle":"부제","sets":[{"label":"집합A","description":"설명"},{"label":"집합B","description":"설명"}],"overlap":"공통점"}
- sets 2~3개. overlap은 교집합 설명

### 6. poster → model: "nb2" (포스터/배너)
For: 한글 타이포그래피, 공지, 텍스트 위주 포스터, 배너
- Large centered Korean headline in quotes, subtitle below
- Bold typography, high contrast background, 2-3 colors max
- prompt: 영어 80-150 words (Korean text only in double quotes)

## SATORI 유형 선택 가이드 (적극 발굴)
다음 신호가 글에 있으면 해당 Satori 유형을 우선 선택:
- 숫자/가격/비율/순위 → infographic_data
- "먼저/그 다음/마지막으로", 순서/단계/과정 → infographic_flow
- "준비물/필수/체크/확인/주의" → checklist
- "A와 B의 차이", "공통점", "비교" (숫자 없이) → venn
이 신호가 없는 마커만 photo로 분류하세요.

## PROMPT RULES

### Rule 1: photo/poster → prompt는 100% 영어
- Korean은 이미지 내 텍스트용 double quotes 안에서만 허용
- photo: "no text, no letters" 필수

### Rule 2: satori 유형 (data/flow/checklist/venn) → prompt는 JSON 객체
- 반드시 위 스키마를 따르는 유효한 JSON
- 한국어 텍스트 사용 (영어 아님)

### Rule 3: prompt 품질
- photo: 80-150 English words, composition/lighting/angle/mood 구체적으로
- satori: 블로그 문맥에서 실제 정보를 추출 (임의 데이터 금지)

### Rule 4: 문맥 정확성
- 마커 텍스트 + 앞뒤 문맥을 꼼꼼히 읽고 의미에 맞는 유형 선택

${isRegenerate ? '\nREGENERATION MODE: Generate MORE SPECIFIC prompts with different compositions and visual approaches.' : ''}

## OUTPUT FORMAT
Return ONLY a valid JSON array. Each element:
{"type":"[photo|infographic_data|infographic_flow|checklist|venn|poster]","model":"[fluxr|satori|nb2]","reason":"[한국어 1문장]","prompt":"[photo/poster: 영어 프롬프트] 또는 [satori: JSON 객체]"}

IMPORTANT: satori 유형의 prompt 값은 JSON 객체를 **문자열로 직렬화**하여 넣으세요 (이중 이스케이프).
예: "prompt": "{\\"title\\":\\"월별 매출 비교\\",\\"items\\":[...]}"`;
```

- [ ] **Step 2: validTypes + 모델 결정 함수 변경 (라인 450~465)**

기존:
```javascript
const validTypes = ['photo', 'infographic_data', 'infographic_flow', 'poster'];
const modelMap = { photo: 'fluxr', infographic_data: 'gpth', infographic_flow: 'nb2', poster: 'nb2' };

for (let idx = 0; idx < result.length; idx++) {
  const item = result[idx];
  if (!validTypes.includes(item.type)) {
    item.type = 'photo';
  }
  item.model = modelMap[item.type];
```

변경:
```javascript
const validTypes = ['photo', 'infographic_data', 'infographic_flow', 'checklist', 'venn', 'poster'];
const satoriTypes = ['infographic_data', 'infographic_flow', 'checklist', 'venn'];

function getModel(type) {
  if (satoriTypes.includes(type)) return 'satori';
  if (type === 'poster') return 'nb2';
  return 'fluxr'; // photo
}

for (let idx = 0; idx < result.length; idx++) {
  const item = result[idx];
  if (!validTypes.includes(item.type)) {
    item.type = 'photo';
  }
  item.model = getModel(item.type);

  // satori 모델: prompt가 JSON이어야 함 → 파싱 검증
  if (item.model === 'satori') {
    try {
      const parsed = typeof item.prompt === 'string' ? JSON.parse(item.prompt) : item.prompt;
      item.prompt = parsed; // 객체로 저장
    } catch {
      // JSON 파싱 실패 → photo로 폴백
      console.warn(`[IMAGE-PRO] Satori JSON parse failed for marker ${idx + 1}, fallback to photo`);
      item.type = 'photo';
      item.model = 'fluxr';
      if (!item.prompt || typeof item.prompt !== 'string') {
        item.prompt = 'high quality Korean lifestyle blog photography, soft natural lighting, photorealistic, clean composition, no text, no letters, photography style';
      }
    }
  }

  if (!item.prompt) {
    item.prompt = 'high quality Korean lifestyle blog photography, soft natural lighting, photorealistic, clean composition, shallow depth of field, no text, photography style';
    item.type = 'photo';
    item.model = 'fluxr';
  }
}
```

- [ ] **Step 3: 첫 마커 강제 photo 로직 업데이트 (라인 476~482)**

기존:
```javascript
if (result[0].type !== 'photo') {
  result[0].type = 'photo';
  result[0].model = 'fluxr';
  if (!result[0].prompt.includes('no text')) {
    result[0].prompt += ', photorealistic, clean composition, shallow depth of field, no text, photography style';
  }
}
```

변경:
```javascript
if (result[0].type !== 'photo') {
  result[0].type = 'photo';
  result[0].model = 'fluxr';
  // satori JSON 객체였을 수 있으므로 문자열 체크
  if (typeof result[0].prompt !== 'string' || !result[0].prompt.includes('no text')) {
    result[0].prompt = 'high quality Korean lifestyle blog photography, soft natural lighting, photorealistic, clean composition, shallow depth of field, no text, photography style';
  }
}
```

- [ ] **Step 4: AI 추천 마커 라우팅 업데이트 (라인 842~894)**

기존 TRIGGER 정규식과 detectModelFromMarker를 확장:

```javascript
const TRIGGER_SATORI_DATA = /차트|그래프|통계표|비교표|수치\s*비교|데이터\s*시각화|가격\s*비교|순위/;
const TRIGGER_SATORI_FLOW = /흐름도|타임라인|로드맵|프로세스|단계도|절차|순서|과정/;
const TRIGGER_SATORI_CHECK = /체크리스트|준비물|필수\s*항목|확인\s*사항|주의사항|팁\s*모음/;
const TRIGGER_SATORI_VENN = /벤다이어그램|관계도|공통점|차이점|비교\s*분석/;
const TRIGGER_NB2 = /포스터|배너|공지문/;

function detectModelFromMarker(text) {
  if (TRIGGER_SATORI_DATA.test(text)) return { type: 'infographic_data', model: 'satori' };
  if (TRIGGER_SATORI_FLOW.test(text)) return { type: 'infographic_flow', model: 'satori' };
  if (TRIGGER_SATORI_CHECK.test(text)) return { type: 'checklist', model: 'satori' };
  if (TRIGGER_SATORI_VENN.test(text)) return { type: 'venn', model: 'satori' };
  if (TRIGGER_NB2.test(text)) return { type: 'poster', model: 'nb2' };
  return { type: 'photo', model: 'fluxr' };
}
```

번역 요청(라인 864~869)의 promptInstruction도 확장:

```javascript
const promptInstruction = markerTexts.map((t, i) => {
  const r = routingInfo[i];
  if (r.model === 'fluxr') return `${i + 1}. ${t} [PHOTO: describe as realistic photography. End with ", photorealistic, clean composition, no text, no letters, photography style"]`;
  if (r.type === 'infographic_data') return `${i + 1}. ${t} [DATA: output JSON {"title":"한국어","subtitle":"범위","source":"출처","items":[{"label":"항목","value":"숫자","unit":"단위"}]} 3-6 items from blog context]`;
  if (r.type === 'infographic_flow') return `${i + 1}. ${t} [FLOW: output JSON {"title":"한국어","subtitle":"","steps":[{"label":"단계명","description":"설명"}]} 3-6 steps from blog context]`;
  if (r.type === 'checklist') return `${i + 1}. ${t} [CHECKLIST: output JSON {"title":"한국어","subtitle":"","items":[{"text":"항목","checked":true}]} 4-8 items from blog context]`;
  if (r.type === 'venn') return `${i + 1}. ${t} [VENN: output JSON {"title":"한국어","subtitle":"","sets":[{"label":"집합","description":"설명"}],"overlap":"공통점"} 2-3 sets from blog context]`;
  return `${i + 1}. ${t} [POSTER: describe as poster with Korean text in quotes, layout, colors]`;
}).join('\n');
```

번역 결과 후처리에서 satori JSON 파싱:

```javascript
analysisResult = translatedPrompts.map((prompt, i) => {
  const r = routingInfo[i];
  let parsedPrompt = prompt;
  if (r.model === 'satori') {
    try { parsedPrompt = typeof prompt === 'string' ? JSON.parse(prompt) : prompt; } catch { /* 문자열 유지 */ }
  }
  return {
    marker: markers[i].text, type: r.type, model: r.model,
    reason: `AI 추천 마커 → ${r.type}`, prompt: parsedPrompt,
  };
});
```

- [ ] **Step 5: callHaikuSingleMarkerPro 업데이트 (라인 489~539)**

typeInstructions에 satori 유형 추가:

기존:
```javascript
const typeInstructions = {
  photo: `Cinematic/editorial photo prompt...`,
  infographic_data: `Data visualization for GPT Image (2:3 vertical layout)...`,
  infographic_flow: `Flow/timeline for Nano Banana 2...`,
  poster: `Poster/banner for Nano Banana 2...`,
};
```

변경:
```javascript
const typeInstructions = {
  photo: `Cinematic/editorial photo prompt.
- Describe subjects, lighting, angle, mood
- Signs/menus → describe as blurred
- End with: ", photorealistic, clean composition, no text, no letters, photography style"`,
  infographic_data: `비교표 데이터 시각화 (Satori 렌더러).
- Output JSON object (NOT English prompt): {"title":"한국어 제목","subtitle":"범위","source":"출처","items":[{"label":"항목","value":"숫자","unit":"단위"}]}
- 3-6 items. 블로그 문맥에서 실제 데이터 추출`,
  infographic_flow: `흐름도/프로세스 (Satori 렌더러).
- Output JSON object: {"title":"한국어 제목","subtitle":"부제","steps":[{"label":"단계명","description":"설명"}]}
- 3-6 steps. 블로그 문맥에서 실제 절차 추출`,
  checklist: `체크리스트 (Satori 렌더러).
- Output JSON object: {"title":"한국어 제목","subtitle":"부제","items":[{"text":"항목 내용","checked":true}]}
- 4-8 items. 핵심 항목은 checked:true`,
  venn: `벤다이어그램 관계도 (Satori 렌더러).
- Output JSON object: {"title":"한국어 제목","subtitle":"부제","sets":[{"label":"집합명","description":"설명"}],"overlap":"공통점"}
- 2-3 sets`,
  poster: `Poster/banner for Imagen 3.
- Large centered Korean headline in quotes, subtitle below
- Bold typography, high contrast background, 2-3 colors max`,
};
```

출력 형식도 변경 — satori 유형은 JSON 객체 반환:
```javascript
const isSatoriType = ['infographic_data', 'infographic_flow', 'checklist', 'venn'].includes(targetType);
const isPhotoType = targetType === 'photo';

const systemPrompt = `You are a blog image prompt engineer. Generate ONE new ${isSatoriType ? 'JSON data object' : 'prompt'} for SINGLE IMAGE REGENERATION.
Type: ${targetType}. Create a COMPLETELY DIFFERENT ${isSatoriType ? 'data set' : 'composition and visual approach'}.

${instruction}

Rules:
${isSatoriType
  ? '- Output ONLY a JSON object: {"prompt": <JSON object as string>}'
  : `- prompt 100% English${isPhotoType ? '' : ' (Korean text only inside double quotes)'}
- 80-150 English words
- Maintain Korean/East Asian aesthetic
${isPhotoType ? '- Do NOT add Korean text' : '- Do NOT add "no text" — text IS the point'}`}

Output: Return ONLY a JSON object: {"prompt": ${isSatoriType ? '"{\\"title\\":\\"...\\",\\"items\\":[...]}"' : '"English prompt 80-150 words..."'}}`;
```

- [ ] **Step 6: 커밋**

```bash
git add api/blog-image-pro.js
git commit -m "feat: Haiku BALANCED 전략 — 6유형 능동 분류 (data/flow/checklist/venn/photo/poster)"
```

---

### Task 5: 프론트엔드 — 새 유형 표시 지원

**Files:**
- Modify: `/Users/gong-eunhui/Desktop/naver-title-generator/blog-image-pro.html`

- [ ] **Step 1: 이미지 유형 라벨/아이콘 확장**

blog-image-pro.html에서 이미지 카드에 유형을 표시하는 부분을 찾아 새 유형을 추가한다. 기존에 photo/infographic_data/infographic_flow/poster 4종을 표시하던 로직에 checklist/venn을 추가.

이미지 카드의 유형 라벨 매핑 (renderResults 함수 내, 라인 900~910 부근):

```javascript
var typeLabels = {
  photo: { icon: '📷', label: '사진', bg: '#F0F7FF' },
  infographic_data: { icon: '📊', label: '비교표', bg: '#F0FFF4' },
  infographic_flow: { icon: '🔄', label: '흐름도', bg: '#FFF8F0' },
  checklist: { icon: '✅', label: '체크리스트', bg: '#F0FFF4' },
  venn: { icon: '⭕', label: '관계도', bg: '#FFF0F5' },
  poster: { icon: '🎨', label: '포스터', bg: '#FFF8F0' },
};
```

- [ ] **Step 2: 재생성 시 type 전달 확인**

regenerateSingle 함수에서 originalType을 서버에 전달하는 부분이 이미 있으므로 (라인 1115~1132), 새 유형(checklist/venn)도 자동으로 전달됨. 추가 변경 불필요.

- [ ] **Step 3: 커밋**

```bash
git add blog-image-pro.html
git commit -m "feat: 프론트엔드 — 체크리스트/벤다이어그램 유형 라벨 추가"
```

---

### Task 6: 통합 테스트 + 메모리 업데이트

- [ ] **Step 1: 테스트 시나리오**

```
1. blog-image-pro.html → 블로그 텍스트 붙여넣기 → "이미지 생성"
   - 첫 번째 이미지: FLUX Realism (photo, 썸네일) ✓
   - 2번째~ photo: Imagen 3 (nb2) ✓
   - Satori 비교표: 바 차트 PNG 정상 렌더링 ✓
   - Satori 흐름도: 스텝 카드 PNG 정상 렌더링 ✓
   - Satori 체크리스트: 체크 아이콘 + 항목 ✓
   - Satori 벤다이어그램: 원 + 교집합 ✓
   - poster: Imagen 3 ✓

2. card-news.html → 기존과 동일 동작 확인

3. "AI 마커 추천" → Satori 유형도 추천되는지 확인

4. 개별 재생성 → satori/photo/poster 각각 동작 확인
```

- [ ] **Step 2: 메모리 업데이트**

MEMORY.md + project_image_stack_redesign.md 업데이트:
- 모델 구조: photo(썸네일)→FLUX Realism, photo(본문)→Imagen 3, data/flow/checklist/venn→Satori, poster→Imagen 3
- GPT Image 1.5: 비활성 폴백으로 유지 (callGptImageHigh 함수 잔류)
- 기본 이미지 (blog-image.js): FLUX Schnell 유지 (8장 272원 마진 부족)

- [ ] **Step 3: 최종 커밋**

```bash
git add -A
git commit -m "docs: 이미지 스택 단순화 v2 완료 — 6유형 라우팅 + Satori 4종 템플릿"
```
