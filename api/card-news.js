import { Redis } from '@upstash/redis';
import { resolveAdmin, setCorsHeaders } from './_helpers.js';
import satori from 'satori';
import { Resvg, initWasm } from '@resvg/resvg-wasm';
import { readFileSync } from 'fs';
import { join } from 'path';
import { readFile } from 'fs/promises';

export const config = { maxDuration: 120 };

/**
 * 카드뉴스 생성 API
 * POST: 블로그 글 텍스트 + 슬라이드 수 + 테마 → 카드뉴스 PNG base64 배열
 * GET: 남은 횟수 조회
 */

const FREE_DAILY_LIMIT = 3;
const FREE_CUTOFF = '2026-04-24T23:59:59+09:00';
const CANVAS_W = 1080;
const CANVAS_H = 1350; // 4:5 비율

// ─── Redis ───
let redis;
function getRedis() {
  if (!redis) {
    redis = new Redis({
      url: process.env.KV_REST_API_URL,
      token: process.env.KV_REST_API_TOKEN,
    });
  }
  return redis;
}

function getClientIp(req) {
  return (
    req.headers['x-real-ip'] ||
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.socket?.remoteAddress ||
    'unknown'
  );
}

function getKSTDate() {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

function getTodayKey(ip) {
  return `ratelimit:cardnews:${ip}:${getKSTDate()}`;
}

function getTTLUntilMidnightKST() {
  const now = new Date();
  const kstOffset = 9 * 60 * 60 * 1000;
  const kstNow = new Date(now.getTime() + kstOffset);
  const nextMidnight = new Date(kstNow);
  nextMidnight.setUTCHours(0, 0, 0, 0);
  nextMidnight.setUTCDate(nextMidnight.getUTCDate() + 1);
  const seconds = Math.ceil((nextMidnight.getTime() - kstNow.getTime()) / 1000);
  return Math.max(seconds, 60);
}

// ─── WASM + 폰트 로딩 (콜드 스타트 시 1회) ───
let fontRegular, fontBold, wasmInited = false;

async function initResvgWasm() {
  if (wasmInited) return;
  // WASM 파일을 여러 경로에서 시도
  const candidates = [
    join(process.cwd(), 'node_modules', '@resvg', 'resvg-wasm', 'index_bg.wasm'),
    join('/var/task', 'node_modules', '@resvg', 'resvg-wasm', 'index_bg.wasm'),
  ];
  let wasmBuf;
  for (const p of candidates) {
    try { wasmBuf = readFileSync(p); break; } catch (_) {}
  }
  if (!wasmBuf) {
    // fallback: require.resolve로 찾기
    try {
      const resolved = require.resolve('@resvg/resvg-wasm/index_bg.wasm');
      wasmBuf = readFileSync(resolved);
    } catch (_) {}
  }
  if (!wasmBuf) throw new Error('resvg WASM 파일을 찾을 수 없습니다.');
  await initWasm(wasmBuf);
  wasmInited = true;
}

function loadFonts() {
  if (!fontRegular) {
    const dir = join(process.cwd(), 'fonts');
    fontRegular = readFileSync(join(dir, 'NotoSansKR-Regular.subset.ttf'));
    fontBold = readFileSync(join(dir, 'NotoSansKR-Bold.subset.ttf'));
  }
  return [
    { name: 'Noto Sans KR', data: fontRegular, weight: 400, style: 'normal' },
    { name: 'Noto Sans KR', data: fontBold, weight: 700, style: 'normal' },
  ];
}

// ─── 테마 프리셋 9종 (인라인) ───
const themes = {
  cafe: { name: '카페·베이커리', primary: '#8B6914', secondary: '#F5F0E8', accent: '#D4A843', text: '#3D2B00', textLight: '#8B7355', bg: '#FFFCF5', bgDark: '#3D2B00', radius: 16 },
  beauty: { name: '뷰티·살롱', primary: '#C2185B', secondary: '#FFF0F5', accent: '#E91E90', text: '#4A0028', textLight: '#A0607A', bg: '#FFFAFC', bgDark: '#4A0028', radius: 20 },
  fitness: { name: '피트니스·헬스', primary: '#1B1B1B', secondary: '#F0F0F0', accent: '#AAFF00', text: '#FFFFFF', textLight: '#B0B0B0', bg: '#F5F5F5', bgDark: '#111111', radius: 12 },
  food: { name: '요식업·맛집', primary: '#D32F2F', secondary: '#FFF8F0', accent: '#FF6D3A', text: '#3E1008', textLight: '#9C6B5E', bg: '#FFFBF7', bgDark: '#3E1008', radius: 16 },
  edu: { name: '교육·강의', primary: '#1A3A6B', secondary: '#EEF2F9', accent: '#3B7DDD', text: '#0D1F3C', textLight: '#6B82A6', bg: '#F7F9FC', bgDark: '#0D1F3C', radius: 14 },
  realty: { name: '부동산·인테리어', primary: '#2E7D5B', secondary: '#EFF6F2', accent: '#43B88C', text: '#1A3D2E', textLight: '#6E9A88', bg: '#F7FBF9', bgDark: '#1A3D2E', radius: 14 },
  clean: { name: '클린·미니멀', primary: '#0D9488', secondary: '#F0FDFA', accent: '#2DD4BF', text: '#134E4A', textLight: '#6B9E99', bg: '#F8FFFE', bgDark: '#134E4A', radius: 18 },
  dark: { name: '다크·프리미엄', primary: '#C9A84C', secondary: '#2A2A2A', accent: '#E8C65A', text: '#F5F0E0', textLight: '#A89E88', bg: '#1E1E1E', bgDark: '#111111', radius: 12 },
  vivid: { name: '비비드·활기', primary: '#7C3AED', secondary: '#FFF9E6', accent: '#FACC15', text: '#2D1065', textLight: '#8B6FC0', bg: '#FDFBFF', bgDark: '#2D1065', radius: 20 },
};

// ─── 레이아웃 (인라인) ───
const _F = 'Noto Sans KR';
const _W = 1080, _H = 1350, _P = 100;
function h(type, props, ...children) {
  const flat = children.flat().filter(Boolean);
  return { type, props: { ...props, children: flat.length === 1 ? flat[0] : flat.length === 0 ? undefined : flat } };
}
const layouts = {
  cover: (s, t) => h('div', { style: { display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', width: _W, height: _H, background: t.bgDark, padding: _P } },
    h('div', { style: { display: 'flex', width: 100, height: 8, background: t.accent, borderRadius: 4, marginBottom: 56 } }),
    h('div', { style: { display: 'flex', fontFamily: _F, fontWeight: 700, fontSize: s.title && s.title.length > 16 ? 80 : 96, color: '#FFFFFF', textAlign: 'center', lineHeight: 1.35, maxWidth: _W - _P * 2, justifyContent: 'center' } }, s.title || ''),
    s.subtitle ? h('div', { style: { display: 'flex', fontFamily: _F, fontWeight: 400, fontSize: 36, color: t.accent, marginTop: 44, textAlign: 'center', lineHeight: 1.5, maxWidth: _W - _P * 2, justifyContent: 'center' } }, s.subtitle) : null,
    s.brand ? h('div', { style: { display: 'flex', fontFamily: _F, fontWeight: 400, fontSize: 28, color: 'rgba(255,255,255,0.45)', marginTop: 72, letterSpacing: 2 } }, s.brand) : null,
  ),
  summary: (s, t) => h('div', { style: { display: 'flex', flexDirection: 'column', width: _W, height: _H, background: t.bg, padding: _P } },
    h('div', { style: { display: 'flex', width: '100%', height: 8, background: t.accent, borderRadius: 4, marginBottom: 56 } }),
    s.label ? h('div', { style: { display: 'flex', fontFamily: _F, fontWeight: 700, fontSize: 32, color: t.accent, marginBottom: 24, letterSpacing: 1 } }, s.label) : null,
    h('div', { style: { display: 'flex', fontFamily: _F, fontWeight: 700, fontSize: 56, color: t.text, lineHeight: 1.4, marginBottom: 44 } }, s.title || ''),
    h('div', { style: { display: 'flex', fontFamily: _F, fontWeight: 400, fontSize: 40, color: t.textLight, lineHeight: 1.7, maxWidth: _W - _P * 2 } }, s.body || ''),
  ),
  content: (s, t) => { const num = s.number ? String(s.number).padStart(2, '0') : '01'; return h('div', { style: { display: 'flex', flexDirection: 'column', width: _W, height: _H, background: t.bg, padding: _P } },
    h('div', { style: { display: 'flex', flexDirection: 'row', alignItems: 'flex-start', marginBottom: 48 } },
      h('div', { style: { display: 'flex', fontFamily: _F, fontWeight: 700, fontSize: 96, color: t.primary, marginRight: 32, lineHeight: 1 } }, num),
      h('div', { style: { display: 'flex', fontFamily: _F, fontWeight: 700, fontSize: 56, color: t.text, lineHeight: 1.35, paddingTop: 12, maxWidth: _W - _P * 2 - 140 } }, s.title || ''),
    ),
    h('div', { style: { display: 'flex', width: 80, height: 5, background: t.accent, borderRadius: 3, marginBottom: 44 } }),
    h('div', { style: { display: 'flex', fontFamily: _F, fontWeight: 400, fontSize: 40, color: t.textLight, lineHeight: 1.75, maxWidth: _W - _P * 2 } }, s.body || ''),
  ); },
  quote: (s, t) => h('div', { style: { display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', width: _W, height: _H, background: t.secondary, padding: _P } },
    h('div', { style: { display: 'flex', fontFamily: _F, fontWeight: 700, fontSize: 200, color: t.accent, lineHeight: 0.6, marginBottom: 32 } }, '\u201C'),
    h('div', { style: { display: 'flex', fontFamily: _F, fontWeight: 700, fontSize: 52, color: t.text, textAlign: 'center', lineHeight: 1.55, maxWidth: _W - _P * 2 - 40, justifyContent: 'center' } }, s.body || ''),
    s.source ? h('div', { style: { display: 'flex', fontFamily: _F, fontWeight: 400, fontSize: 32, color: t.textLight, marginTop: 48, textAlign: 'center', justifyContent: 'center' } }, s.source) : null,
  ),
  data: (s, t) => h('div', { style: { display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', width: _W, height: _H, background: t.bg, padding: _P } },
    s.label ? h('div', { style: { display: 'flex', fontFamily: _F, fontWeight: 700, fontSize: 34, color: t.textLight, marginBottom: 32, letterSpacing: 2 } }, s.label) : null,
    h('div', { style: { display: 'flex', flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center', marginBottom: 20 } },
      h('div', { style: { display: 'flex', fontFamily: _F, fontWeight: 700, fontSize: 152, color: t.primary, lineHeight: 1 } }, s.value || '0'),
      s.unit ? h('div', { style: { display: 'flex', fontFamily: _F, fontWeight: 700, fontSize: 60, color: t.primary, marginLeft: 10, paddingBottom: 18 } }, s.unit) : null,
    ),
    h('div', { style: { display: 'flex', width: 80, height: 5, background: t.accent, borderRadius: 3, marginTop: 24, marginBottom: 40 } }),
    h('div', { style: { display: 'flex', fontFamily: _F, fontWeight: 400, fontSize: 40, color: t.textLight, textAlign: 'center', lineHeight: 1.65, maxWidth: _W - _P * 2, justifyContent: 'center' } }, s.body || ''),
  ),
  cta: (s, t) => h('div', { style: { display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', width: _W, height: _H, background: t.bgDark, padding: _P } },
    h('div', { style: { display: 'flex', fontFamily: _F, fontWeight: 700, fontSize: 64, color: '#FFFFFF', textAlign: 'center', lineHeight: 1.45, maxWidth: _W - _P * 2, justifyContent: 'center', marginBottom: 48 } }, s.title || ''),
    s.buttonText ? h('div', { style: { display: 'flex', justifyContent: 'center', alignItems: 'center', background: t.accent, borderRadius: t.radius, padding: '24px 64px', marginBottom: 44 } },
      h('div', { style: { display: 'flex', fontFamily: _F, fontWeight: 700, fontSize: 36, color: t.bgDark } }, s.buttonText),
    ) : null,
    s.body ? h('div', { style: { display: 'flex', fontFamily: _F, fontWeight: 400, fontSize: 34, color: 'rgba(255,255,255,0.55)', textAlign: 'center', lineHeight: 1.6, maxWidth: _W - _P * 2, justifyContent: 'center' } }, s.body) : null,
  ),
};

// ─── safeParseJson (balanced bracket parser, blog-writer.html 패턴) ───
function safeParseJson(rawText) {
  // 1차: 그대로 파싱
  try { return JSON.parse(rawText); } catch (_) {}
  // 2차: 균형 잡힌 중괄호 매칭 (문자열 내 {} 무시)
  const start = rawText.indexOf('{');
  if (start === -1) throw new Error('AI 응답에서 JSON을 찾을 수 없습니다.');
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < rawText.length; i++) {
    const c = rawText[i];
    if (esc) { esc = false; continue; }
    if (c === '\\') { esc = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return JSON.parse(rawText.substring(start, i + 1));
    }
  }
  throw new Error('AI 응답을 파싱할 수 없습니다.');
}

// ─── Claude Sonnet 호출 ───
async function callSonnet(systemPrompt, userMessage, maxTokens = 4000) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: maxTokens,
      temperature: 0.7,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(JSON.stringify(data));
  return (data.content?.[0]?.text || '').trim();
}

// ─── AI 슬라이드 구조화 시스템 프롬프트 ───
const SLIDE_SYSTEM_PROMPT = `당신은 블로그 글을 인스타그램 카드뉴스용 슬라이드로 변환하는 전문가입니다.

[목표]
블로그 글에서 핵심 내용만 추출하여, 각 슬라이드마다 0.2초 안에 스크롤을 멈추게 하는 훅이 포함된 카드뉴스를 만듭니다.

[슬라이드 구성]
1. 표지(1장, type:"cover"): 강렬한 훅 포함 제목 + 부제. 스크롤을 멈추게 하는 첫인상.
2. 요약(1장, type:"summary"): 훅 포함 요약 제목 + 핵심 내용 1~2문장. 전체 글의 매력적 요약.
3. 본문(나머지, type:"content"): 각 핵심 포인트별 번호 + 훅 포함 제목 + 핵심 내용.
4. CTA(1장, type:"cta"): 팔로우/저장/댓글 유도 문구.

[14가지 심리학 기반 훅 공식 — Tier 1 비율 높게]
--- Tier 1: 즉각 반응 (0.1~0.3초) ---
1. 패턴 인터럽트: 예상을 깨는 문장으로 자동 스크롤 강제 중단. 예: "읽지 마세요. (단, OO 고민 없다면)"
2. 손실회피: 모르면 손해. 인간은 이익보다 손실에 2배 반응. 예: "이거 모르면 계속 손해봅니다"
3. 호기심폭발: 정보 격차 생성. 예: "업계 사람만 아는 비밀"

--- Tier 2: 빠른 인지 (0.3~1초) ---
4. 구체성수치: 3가지, 5단계 등 수치로 신뢰도 상승. 예: "딱 3가지만 기억하면 됩니다"
5. 정체성호출: 자아상을 건드림. 예: "진심으로 잘하고 싶은 분만 보세요"
6. 사회적증거: 동조 본능 자극. 예: "요즘 사장님들 다 이걸로 바꾸고 있어요"

--- Tier 3: 감정적 반응 (1~3초) ---
7. 문제공감: 실제 불편/고통을 먼저 꺼냄. 예: "매일 열심히 하는데 왜 결과가 안 나올까요"
8. 상식비틀기: 상식을 뒤집어 호기심 자극. 예: "좋다는 게 오히려 독이 될 수 있습니다"
9. 욕망자극: 근본 욕구를 건드림. 예: "한 달 만에 인생이 바뀐 사람들의 비밀"
10. 권위부여: 신뢰를 자연스럽게 심음. 예: "상위 1% 사장님이 실제로 쓰는 방법"
11. 오픈루프: 미완결 정보로 신경 쓰이게 함. 예: "3가지 중 마지막이 진짜인데..."
12. 즉시성: 행동 유도. 예: "지금 당장 해결하는 방법"
13. 비밀은밀함: 독점적 정보 느낌. 예: "절대 공개 안 하는 비법"
14. 비교자극: A vs B. 예: "성공하는 사람 vs 실패하는 사람"

[글자수 제한 — 반드시 준수]
- cover.title: 최대 30자
- cover.subtitle: 최대 40자
- summary.title: 최대 25자
- summary.body: 최대 100자
- content.title: 최대 20자
- content.body: 최대 100자
- cta.title: 최대 30자

[절대 규칙]
1. 블로그 글의 군더더기를 제거하고 핵심만 추출한다.
2. 각 슬라이드 제목에 반드시 훅을 넣는다 (14가지 공식 활용).
3. 요청된 슬라이드 수를 정확히 맞춘다.
4. 한국어 조사(은/는, 이/가, 을/를)를 정확히 사용한다.
5. 이모지 사용 금지.
6. 출력은 순수 JSON만. 마크다운 코드블록, 설명 텍스트 금지.

[출력 JSON 형식]
{
  "slides": [
    { "type": "cover", "title": "훅 포함 제목", "subtitle": "부제" },
    { "type": "summary", "title": "훅 포함 요약 제목", "body": "핵심 요약 1~2문장" },
    { "type": "content", "number": "01", "title": "포인트 제목", "body": "핵심 내용" },
    { "type": "cta", "title": "CTA 문구", "buttonText": "팔로우하기", "body": "이 글이 도움됐다면 저장해두세요" }
  ]
}`;

// ─── 슬라이드 JSON 유효성 검증 ───
function validateSlides(parsed, requestedCount) {
  if (!parsed || !Array.isArray(parsed.slides)) {
    throw new Error('slides 배열이 없습니다.');
  }

  let slides = parsed.slides;

  // 슬라이드 수 조정 (요청 수와 일치시키기)
  if (slides.length > requestedCount) {
    slides = slides.slice(0, requestedCount);
  }

  // 각 슬라이드 유효성 검증 + truncation
  const LIMITS = {
    cover: { title: 30, subtitle: 40 },
    summary: { title: 25, body: 100 },
    content: { title: 20, body: 100 },
    quote: { body: 80, source: 30 },
    data: { label: 20, value: 10, unit: 10, body: 80 },
    cta: { title: 30, buttonText: 15, body: 60 },
  };

  const VALID_TYPES = Object.keys(LIMITS);

  slides = slides.map((slide, idx) => {
    // 타입 누락 시 기본값
    if (!slide.type || !VALID_TYPES.includes(slide.type)) {
      if (idx === 0) slide.type = 'cover';
      else if (idx === slides.length - 1) slide.type = 'cta';
      else slide.type = 'content';
    }

    // content 번호 자동 할당
    if (slide.type === 'content' && !slide.number) {
      // cover(1) + summary(1) 이후부터 번호 시작
      const contentIdx = slides.slice(0, idx).filter(s => s.type === 'content').length + 1;
      slide.number = String(contentIdx).padStart(2, '0');
    }

    // cover 기본값
    if (slide.type === 'cover') {
      if (!slide.title) slide.title = '카드뉴스';
      if (!slide.subtitle) slide.subtitle = '';
    }

    // cta 기본값
    if (slide.type === 'cta') {
      if (!slide.title) slide.title = '이 글이 도움이 됐다면?';
      if (!slide.buttonText) slide.buttonText = '저장하기';
    }

    // 글자수 truncation
    const limits = LIMITS[slide.type] || {};
    for (const [field, max] of Object.entries(limits)) {
      if (slide[field] && typeof slide[field] === 'string' && slide[field].length > max) {
        slide[field] = slide[field].slice(0, max);
      }
    }

    return slide;
  });

  return { slides };
}

// ─── Satori + Resvg 렌더링 (직렬) ───
async function renderSlides(slidesData, theme) {
  await initResvgWasm();
  const fonts = loadFonts();
  const pngs = [];

  // 레이아웃 함수 매핑
  const layoutMap = {
    cover: layouts.cover,
    summary: layouts.summary,
    content: layouts.content,
    quote: layouts.quote,
    data: layouts.data,
    cta: layouts.cta,
  };

  // 직렬 처리 (메모리 초과 방지, Promise.all 금지)
  for (const slide of slidesData.slides) {
    const layoutFn = layoutMap[slide.type] || layoutMap.content;
    const vnode = layoutFn(slide, theme);

    // Satori → SVG
    const svg = await satori(vnode, {
      width: CANVAS_W,
      height: CANVAS_H,
      fonts,
    });

    // Resvg → PNG
    const resvg = new Resvg(svg, {
      fitTo: { mode: 'width', value: CANVAS_W },
    });
    const rendered = resvg.render();
    const pngBuffer = rendered.asPng();

    // base64 인코딩 (접두사 없이 순수 base64만 — 프론트에서 data:image/png;base64, 추가)
    const base64 = Buffer.from(pngBuffer).toString('base64');
    pngs.push(base64);
  }

  return pngs;
}

// ─── 핸들러 ───
export default async function handler(req, res) {
  setCorsHeaders(res, req);

  if (req.method === 'OPTIONS') return res.status(200).end();

  // ─── GET: 남은 횟수 조회 (인증 불필요) ───
  if (req.method === 'GET') {
    const isAdminGet = await resolveAdmin(req);
    if (isAdminGet) {
      return res.status(200).json({ remaining: 999, limit: FREE_DAILY_LIMIT, admin: true });
    }
    try {
      const ip = getClientIp(req);
      const key = getTodayKey(ip);
      const count = (await getRedis().get(key)) || 0;
      const remaining = Math.max(FREE_DAILY_LIMIT - count, 0);
      return res.status(200).json({ remaining, limit: FREE_DAILY_LIMIT });
    } catch {
      return res.status(200).json({ remaining: FREE_DAILY_LIMIT, limit: FREE_DAILY_LIMIT });
    }
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ─── 인증: 관리자 OR 로그인 회원 (POST만) ───
  const isAdmin = await resolveAdmin(req);

  let sessionEmail = null;

  if (!isAdmin) {
    const token = req.body?.token || req.query?.token || req.headers?.authorization?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ error: '로그인이 필요합니다.' });
    }
    const session = await getRedis().get(`session:${token}`);
    if (!session) {
      return res.status(401).json({ error: '세션이 만료되었습니다. 다시 로그인해주세요.' });
    }
    const userData = await getRedis().get(`user:${session.email}`);
    if (!userData) {
      return res.status(401).json({ error: '회원 정보를 찾을 수 없습니다.' });
    }
    if (new Date(userData.createdAt) > new Date(FREE_CUTOFF)) {
      return res.status(403).json({ error: '4/24까지 가입한 회원만 무료 체험이 가능합니다.' });
    }
    sessionEmail = session.email;
  }

  // ─── POST: 카드뉴스 생성 ───
  let rateLimitKey = null;

  try {
    // ui-dev 계약: { text, title?, slideCount, theme, brandColor? }
    const blogText = req.body.text || req.body.blogText || '';
    const slideCount = req.body.slideCount;
    const themeId = req.body.theme || req.body.themeId || 'clean';
    const blogTitle = req.body.title || '';

    // 입력 검증
    if (!blogText || blogText.trim().length < 100) {
      return res.status(400).json({ error: '블로그 글을 100자 이상 입력해주세요.' });
    }
    if (blogText.length > 30000) {
      return res.status(400).json({ error: '블로그 글이 너무 깁니다. 30,000자 이내로 입력해주세요.' });
    }

    const count = Math.min(Math.max(Number(slideCount) || 7, 5), 10);
    const brandPrimary = req.body.brandPrimary || '';
    const brandSecondary = req.body.brandSecondary || '';
    const baseTheme = themes[themeId] || themes.clean;

    // 브랜드 컬러 2색 → 전체 테마 자동 계산
    const isValidHex = (c) => /^#[0-9a-fA-F]{6}$/.test(c);
    let theme = baseTheme;
    if (isValidHex(brandPrimary)) {
      const p = brandPrimary;
      const s = isValidHex(brandSecondary) ? brandSecondary : baseTheme.secondary;
      // hex → RGB → 밝기/어둡기 파생
      const hexToRgb = (hex) => [parseInt(hex.slice(1,3),16), parseInt(hex.slice(3,5),16), parseInt(hex.slice(5,7),16)];
      const rgbToHex = (r,g,b) => '#' + [r,g,b].map(c => Math.min(255,Math.max(0,Math.round(c))).toString(16).padStart(2,'0')).join('');
      const lighten = (hex, amt) => { const [r,g,b] = hexToRgb(hex); return rgbToHex(r+(255-r)*amt, g+(255-g)*amt, b+(255-b)*amt); };
      const darken = (hex, amt) => { const [r,g,b] = hexToRgb(hex); return rgbToHex(r*(1-amt), g*(1-amt), b*(1-amt)); };
      const mix = (h1, h2, w) => { const [r1,g1,b1]=hexToRgb(h1); const [r2,g2,b2]=hexToRgb(h2); return rgbToHex(r1*w+r2*(1-w), g1*w+g2*(1-w), b1*w+b2*(1-w)); };
      theme = {
        ...baseTheme,
        primary: p,
        secondary: s,
        accent: mix(p, s, 0.6),
        text: darken(p, 0.7),
        textLight: darken(p, 0.4),
        bg: lighten(p, 0.95),
        bgDark: darken(s, 0.6),
      };
    }

    // Rate limit (INCR-first, 관리자 스킵)
    let remaining = isAdmin ? 999 : FREE_DAILY_LIMIT;

    if (!isAdmin) {
      const ip = getClientIp(req);
      rateLimitKey = getTodayKey(ip);
      const newCount = await getRedis().incr(rateLimitKey);
      await getRedis().expire(rateLimitKey, getTTLUntilMidnightKST());

      if (newCount > FREE_DAILY_LIMIT) {
        await getRedis().decr(rateLimitKey);
        return res.status(429).json({
          error: `카드뉴스 일일 무료 한도(${FREE_DAILY_LIMIT}회)를 초과했습니다. 내일 다시 이용해주세요.`,
          remaining: 0,
        });
      }
      remaining = FREE_DAILY_LIMIT - newCount;
    }

    console.log(`[CARD-NEWS] Start | slides: ${count} | theme: ${themeId} | blogText: ${blogText.length}자`);

    // 1) Claude Sonnet 호출 → 슬라이드 JSON
    const titleLine = blogTitle ? `블로그 제목: ${blogTitle}\n` : '';
    const userMessage = `다음 블로그 글을 ${count}장 카드뉴스 슬라이드로 변환해주세요.
구성: 표지 1장(cover) + 요약 1장(summary) + 본문 ${count - 3}장(content) + CTA 1장(cta) = 총 ${count}장

${titleLine}블로그 글:
${blogText.substring(0, 8000)}`;

    const raw = await callSonnet(SLIDE_SYSTEM_PROMPT, userMessage, 4000);
    console.log(`[CARD-NEWS] Sonnet response: ${raw.length}자`);

    // 2) JSON 파싱 (balanced bracket 포함)
    const parsed = safeParseJson(raw);

    // 3) 유효성 검증
    const validated = validateSlides(parsed, count);
    console.log(`[CARD-NEWS] Validated slides: ${validated.slides.length}장`);

    // 4) Satori + Resvg 렌더링 (직렬)
    const pngs = await renderSlides(validated, theme);
    console.log(`[CARD-NEWS] Rendered ${pngs.length} PNGs`);

    return res.status(200).json({
      slides: validated.slides,
      images: pngs,
      remaining,
      limit: FREE_DAILY_LIMIT,
    });

  } catch (error) {
    console.error('[CARD-NEWS] Error:', error.message);
    // AI 호출 실패 시 rate limit 복원
    if (rateLimitKey) {
      try { await getRedis().decr(rateLimitKey); } catch (_) {}
    }
    return res.status(500).json({ error: '카드뉴스 생성 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.' });
  }
}
