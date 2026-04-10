import { Redis } from '@upstash/redis';
import { resolveAdmin, setCorsHeaders } from './_helpers.js';
import { replaceUrlsWithR2, uploadImageUrlToR2 } from './_r2.js';
import { logUsage } from './_db.js';
import crypto from 'crypto';
import { renderToBase64 } from './_satori-renderer.js';
import { renderTemplate } from './_satori-templates.js';

export const config = { maxDuration: 300 };

/*
 * 프리미엄 이미지 생성 v2 (회원 전용 공개)
 * 자동 모델 라우팅: Haiku가 이미지 유형 판단 → 최적 모델 선택
 *
 * 모델 라우팅:
 *   photo(썸네일 1번) → FLUX Realism (fal-ai/flux-realism)
 *   photo(본문 2번~) → Vertex AI Imagen 3 (GCP 크레딧, "no text")
 *   infographic_data → Satori 비교표 템플릿 (서버 렌더링)
 *   infographic_flow → Satori 흐름도 템플릿 (서버 렌더링)
 *   checklist → Satori 체크리스트 템플릿 (서버 렌더링)
 *   venn → Satori 벤다이어그램 템플릿 (서버 렌더링)
 *   poster → Vertex AI Imagen 3 (GCP 크레딧)
 *   (GPT Image 1.5 — 비활성 폴백으로 유지)
 *
 * 인증: 관리자(서버 판별) OR 로그인 회원 (4/24까지 가입 시 1일 3회 무료)
 */

const FREE_DAILY_LIMIT = 3;
const FREE_CUTOFF = '2026-04-24T23:59:59+09:00';
const MAX_MARKERS = 8;
const DIRECT_IMAGES = 8;

const FULL_COST = 3;          // 전체 생성/재생성: 3 크레딧
const SINGLE_REGEN_COST = 1;  // 개별 1장 재생성: 1 크레딧
const DAILY_LIMIT_SCALED = FREE_DAILY_LIMIT * FULL_COST; // 9 = 3회 × 3

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

function getTodayKeyPro(ip) {
  return `ratelimit:blogimage-pro:v2:${ip}:${getKSTDate()}`;
}

function getSuggestMarkersKey(ip) {
  return `ratelimit:suggest-markers:${ip}:${getKSTDate()}`;
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

const moodPrompts = {
  'bright': 'bright, clean, minimal Korean lifestyle blog image, white background, natural daylight, high quality',
  'warm': 'warm, cozy, soft tones Korean lifestyle blog image, golden hour lighting, high quality',
  'professional': 'professional, corporate, clean Korean business blog image, modern office, high quality',
  'emotional': 'emotional, moody, aesthetic Korean blog image, soft bokeh, film tone, high quality',
};

// ─── AI API 호출 함수들 ───

async function callClaude(systemPrompt, userMessage, maxTokens = 200) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(JSON.stringify(data));
  return (data.content?.[0]?.text || '').trim();
}

// FLUX Realism — 사실적 사진/배경/풍경/음식/인물/제품 (30초 타임아웃)
async function callFluxRealism(prompt) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch('https://fal.run/fal-ai/flux-realism', {
      method: 'POST',
      headers: {
        Authorization: `Key ${process.env.FAL_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt,
        image_size: { width: 1024, height: 1024 },
        num_images: 1,
        num_inference_steps: 28,
        guidance_scale: 3.5,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const data = await response.json();
    if (!response.ok) throw new Error(JSON.stringify(data));
    return data.images?.[0]?.url || null;
  } catch (err) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') throw new Error('FLUX Realism 30s timeout');
    throw err;
  }
}

// GPT Image 1.5 high — 차트/그래프/통계/수치 인포그래픽 (60초 타임아웃)
async function callGptImageHigh(prompt) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);
  try {
    const response = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-image-1.5',
        prompt,
        n: 1,
        size: '1024x1536',
        quality: 'high',
        output_format: 'webp',
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const data = await response.json();
    if (!response.ok) throw new Error(JSON.stringify(data));
    const b64 = data.data?.[0]?.b64_json;
    if (!b64) return null;
    return `data:image/webp;base64,${b64}`;
  } catch (err) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') throw new Error('GPT Image 60s timeout');
    throw err;
  }
}

// ─── Vertex AI Imagen 3 (GCP 크레딧 활용) ───
const GOOGLE_OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_CLOUD_SCOPE = 'https://www.googleapis.com/auth/cloud-platform';
let _vertexTokenCache = { token: null, expiresAt: 0 };

function _parseServiceAccount() {
  const raw = process.env.GOOGLE_VERTEX_SERVICE_ACCOUNT_JSON || process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '';
  try { const p = JSON.parse(raw); return p?.client_email && p?.private_key ? p : null; } catch { return null; }
}

function _base64url(input) {
  const b = typeof input === 'string' ? Buffer.from(input) : input;
  return b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function _getVertexToken() {
  const now = Math.floor(Date.now() / 1000);
  if (_vertexTokenCache.token && _vertexTokenCache.expiresAt - 60 > now) return _vertexTokenCache.token;

  const sa = _parseServiceAccount();
  if (!sa) throw new Error('Google 서비스 계정 환경변수가 없습니다');

  const header = _base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = _base64url(JSON.stringify({ iss: sa.client_email, scope: GOOGLE_CLOUD_SCOPE, aud: GOOGLE_OAUTH_TOKEN_URL, exp: now + 3600, iat: now }));
  const sig = crypto.createSign('RSA-SHA256').update(`${header}.${claims}`).end().sign(sa.private_key.replace(/\\n/g, '\n'));
  const jwt = `${header}.${claims}.${_base64url(sig)}`;

  const res = await fetch(GOOGLE_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });
  const data = await res.json();
  if (!res.ok || !data.access_token) throw new Error(`Google token failed: ${res.status}`);
  _vertexTokenCache = { token: data.access_token, expiresAt: now + (data.expires_in || 3600) };
  return data.access_token;
}

async function callVertexImagen3(prompt) {
  const token = await _getVertexToken();
  const projectId = process.env.GOOGLE_VERTEX_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || 'ddukddaktool';
  const location = process.env.GOOGLE_VERTEX_LOCATION || 'us-central1';
  const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/imagen-3.0-generate-002:predict`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instances: [{ prompt }],
        parameters: { sampleCount: 1, aspectRatio: '1:1', outputOptions: { mimeType: 'image/png' } },
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const data = await res.json();
    if (!res.ok) throw new Error(`Imagen 3 error: ${res.status} ${JSON.stringify(data).slice(0, 200)}`);

    const b64 = data.predictions?.[0]?.bytesBase64Encoded;
    if (!b64) throw new Error('Imagen 3: no image in response');
    return `data:image/png;base64,${b64}`;
  } catch (err) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') throw new Error('Vertex AI Imagen 30s timeout');
    throw err;
  }
}

// 안전한 JSON 배열 추출 (균형 잡힌 대괄호 매칭)
function extractJsonArray(raw) {
  const start = raw.indexOf('[');
  if (start === -1) return null;
  let depth = 0;
  for (let i = start; i < raw.length; i++) {
    if (raw[i] === '[') depth++;
    else if (raw[i] === ']') depth--;
    if (depth === 0) return raw.substring(start, i + 1);
  }
  return null;
}

// ─── Haiku 마커 자동 추천 (suggest_markers) ───

async function callHaikuSuggestMarkers(blogText) {
  const blogSummary = blogText.substring(0, 500).trim();
  const firstLine = blogText.split('\n').find(l => l.trim()) || '';
  const blogTitle = firstLine.trim().substring(0, 80);
  const headings = blogText.match(/【\d+\.?】[^\n]*/g) || [];
  const blogStructure = headings.map(h => h.trim()).join(' | ');
  const paragraphs = blogText.split(/\n\s*\n/).filter(p => p.trim().length > 30);

  const systemPrompt = `You are a Korean blog image placement expert. Analyze the blog post and suggest 4-8 optimal positions to insert images.

## YOUR TASK
1. Read the entire blog post carefully
2. Identify the heading/section structure (【1】, 【2】, etc.)
3. Find 4-8 locations where an image would enhance the reading experience
4. For each location, generate a descriptive Korean marker text that describes what image should go there

## PLACEMENT RULES
- First marker: representative image for the blog (대표이미지), placed near the beginning
- Place images after key paragraphs, not in the middle of sentences
- Space images evenly throughout the post (don't cluster them)
- Each section (【】) should have at least 1 image if possible
- Prefer placing images after emotional/descriptive paragraphs or topic transitions
- 4 markers minimum, 8 markers maximum

## MARKER TEXT RULES
- Write in Korean, 5-15 characters
- Describe the visual subject clearly (e.g., "커피 원두를 볶는 과정", "아늑한 카페 인테리어")
- Must be specific to the blog content, not generic
- Most markers should describe photo-friendly scenes
- BUT if the blog content discusses data/statistics/comparisons, include trigger words for special rendering:
  - Data/charts: include "차트", "그래프", "비교표", "통계표" (e.g., "월별 매출 비교 차트")
  - Flows/timelines: include "흐름도", "타임라인", "로드맵", "프로세스" (e.g., "창업 준비 타임라인")
  - Posters/banners: include "포스터", "배너" (e.g., "이벤트 안내 포스터")
- Only use these special types when the blog content clearly warrants them (max 1-2 per post)

## POSITION DESCRIPTION
- Describe where in the post this marker should be inserted
- Reference the nearest heading or paragraph content
- Be specific enough that a human can find the exact location

## OUTPUT FORMAT
Return ONLY a valid JSON array. Each element:
{"text":"한국어 마커 텍스트","position":"이 마커가 들어갈 위치 설명 (한국어)"}`;

  const userPrompt = `블로그 제목: "${blogTitle}"
${blogStructure ? `글 구조: ${blogStructure}` : ''}
총 문단 수: ${paragraphs.length}개
글 길이: ${blogText.length}자

블로그 글 전문:
${blogText.substring(0, 6000)}`;

  const raw = await callClaude(systemPrompt, userPrompt, 2000);
  const jsonStr = extractJsonArray(raw);
  if (!jsonStr) throw new Error('Haiku suggest markers: no JSON array found');
  const result = JSON.parse(jsonStr);

  // 후처리: 4~8개로 제한, 필수 필드 검증
  const validated = result
    .filter(item => item.text && item.position)
    .slice(0, 8);

  if (validated.length < 1) {
    throw new Error('Haiku suggest markers: no valid markers returned');
  }

  return validated;
}

// 모델 라우팅: type → API 호출
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

// ─── Haiku 마커 분석 (4-type 자동 분류) ───

async function callHaikuMarkerAnalysis(blogText, markers, isRegenerate) {
  const blogSummary = blogText.substring(0, 300).trim();
  const firstLine = blogText.split('\n').find(l => l.trim()) || '';
  const blogTitle = firstLine.trim().substring(0, 80);
  const headings = blogText.match(/【\d+\.?】[^\n]*/g) || [];
  const blogStructure = headings.map(h => h.trim()).join(' | ');

  const markerContext = markers.map((mk, i) => {
    const before = mk.before.substring(0, 200);
    const after = mk.after.substring(0, 200);
    return `마커 ${i + 1}: "${mk.text}"${mk.altText ? ` (alt: "${mk.altText}")` : ''}${mk.section ? `\n  소속 섹션: "${mk.section}"` : ''}\n  글 위치: ${mk.position}\n  앞 문맥 (200자): "${before}"\n  뒤 문맥 (200자): "${after}"`;
  }).join('\n\n');

  const systemPrompt = `You are a blog image prompt engineer. Classify each marker into one of 6 types and generate the appropriate prompt or structured data.

## STRICT ALLOCATION RULE (반드시 지켜야 할 배분 규칙)
${markers.length}장의 이미지를 **정확히** 다음 비율로 배분하세요:
- photo: **정확히 ${Math.min(5, markers.length)}장** (1번 썸네일 + 본문 사진 ${Math.min(4, markers.length - 1)}장)
- Satori 템플릿 (data/flow/checklist/venn): **정확히 ${Math.min(3, Math.max(0, markers.length - 5))}장** (정보 시각화)
- poster: 0장 (특별히 요청하지 않는 한 사용하지 않음)

이 비율은 **절대 규칙**입니다. 블로그 글에 숫자/비교/단계/목록 내용이 없더라도 반드시 3장은 Satori 유형으로 배정하세요.
첫 번째 마커는 반드시 photo (대표이미지/썸네일)입니다.

## 6 IMAGE TYPES

### 1. photo → model: "fluxr" (사실적 사진)
For: 사진, 배경, 풍경, 음식, 인물, 제품, 인테리어, 감성/분위기
- Describe subjects, lighting, angle, mood as cinematic/editorial photography
- Signs/menus → describe as blurred
- End with: ", photorealistic, clean composition, no text, no letters, photography style"
- prompt: 영어 80-150 words

### 2. infographic_data → model: "satori" (비교표/차트)
For: 수치 비교, 통계, 가격, 순위, 비율, 장단점 등 **숫자가 있는 비교**
- prompt: JSON 객체를 문자열로: {"title":"한국어 제목","subtitle":"범위","source":"출처","items":[{"label":"항목","value":"85","unit":"%"}]}
- items 3~6개. value는 숫자 문자열. 블로그 문맥에서 실제 데이터 추출

### 3. infographic_flow → model: "satori" (흐름도/프로세스)
For: 절차, 순서, 단계, 타임라인, 준비 과정 등 **순서가 있는 프로세스**
- prompt: JSON 객체를 문자열로: {"title":"한국어 제목","subtitle":"부제","steps":[{"label":"단계명","description":"설명"}]}
- steps 3~6개

### 4. checklist → model: "satori" (체크리스트)
For: 준비물, 필수 항목, 팁 모음, 주의사항, 확인 사항 등 **나열형 정보**
- prompt: JSON 객체를 문자열로: {"title":"한국어 제목","subtitle":"부제","items":[{"text":"항목 내용","checked":true}]}
- items 4~8개

### 5. venn → model: "satori" (벤다이어그램/관계도)
For: 개념 비교, 공통점/차이점, A vs B, 겹치는 영역 등 **관계/교집합**
- prompt: JSON 객체를 문자열로: {"title":"한국어 제목","subtitle":"부제","sets":[{"label":"집합A","description":"설명"}],"overlap":"공통점"}
- sets 2~3개

### 6. poster → model: "nb2" (포스터/배너)
For: 한글 타이포그래피, 공지, 배너
- Large Korean headline in quotes, bold typography, 2-3 colors
- prompt: 영어 80-150 words

## SATORI 유형 선택 가이드 (적극 발굴)
다음 신호가 문맥에 있으면 해당 유형 우선:
- 숫자/가격/비율/순위/퍼센트 → infographic_data
- "먼저/그다음/마지막으로", 순서/단계/과정/절차 → infographic_flow
- "준비물/필수/체크/확인/주의/팁" → checklist
- "A와 B의 차이", "공통점", 개념 비교 (숫자 없이) → venn

## PROMPT RULES
1. photo/poster → prompt는 100% 영어. photo는 "no text, no letters" 필수
2. satori 유형 → prompt는 JSON 객체를 **문자열화**하여 넣으세요
3. 블로그 문맥에서 실제 정보를 추출 (임의 데이터 금지)

${isRegenerate ? '\nREGENERATION: 다른 구성/시각으로 새로 생성하세요.' : ''}

## OUTPUT FORMAT
Return ONLY a valid JSON array. Each element:
{"type":"[photo|infographic_data|infographic_flow|checklist|venn|poster]","model":"[fluxr|satori|nb2]","reason":"[한국어 1문장]","prompt":"[영어 프롬프트 또는 JSON 문자열]"}`;

  const userPrompt = `블로그 제목: "${blogTitle}"
블로그 전체 주제 (첫 300자): ${blogSummary}${blogStructure ? `\n글 구조: ${blogStructure}` : ''}

마커 목록과 문맥:
${markerContext}

위 ${markers.length}개 마커 각각에 대해 JSON 배열을 출력하세요.`;

  const maxTokens = 2000 + markers.length * 500; // 마커당 ~500토큰 여유
  const raw = await callClaude(systemPrompt, userPrompt, maxTokens);
  const jsonStr = extractJsonArray(raw);
  if (!jsonStr) throw new Error('Haiku marker analysis: no JSON array found');
  const result = JSON.parse(jsonStr);

  if (result.length !== markers.length) {
    throw new Error(`Haiku returned ${result.length} items, expected ${markers.length}`);
  }

  // 후처리: 안전장치
  const validTypes = ['photo', 'infographic_data', 'infographic_flow', 'checklist', 'venn', 'poster'];
  const satoriTypes = ['infographic_data', 'infographic_flow', 'checklist', 'venn'];

  function getModel(type) {
    if (satoriTypes.includes(type)) return 'satori';
    if (type === 'poster') return 'nb2';
    return 'fluxr';
  }

  for (let idx = 0; idx < result.length; idx++) {
    const item = result[idx];
    if (!validTypes.includes(item.type)) item.type = 'photo';
    item.model = getModel(item.type);

    // satori 모델: prompt가 JSON이어야 함 → 파싱 검증
    if (item.model === 'satori') {
      try {
        const parsed = typeof item.prompt === 'string' ? JSON.parse(item.prompt) : item.prompt;
        item.prompt = parsed;
      } catch {
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

  // 첫 마커가 photo가 아니면 강제 변환
  if (result[0].type !== 'photo') {
    result[0].type = 'photo';
    result[0].model = 'fluxr';
    if (typeof result[0].prompt !== 'string' || !result[0].prompt.includes('no text')) {
      result[0].prompt = 'high quality Korean lifestyle blog photography, soft natural lighting, photorealistic, clean composition, shallow depth of field, no text, photography style';
    }
  }

  // ── 배분 강제 보정: Satori 정확히 3장, photo 정확히 5장 (8장 기준) ──
  const targetSatori = Math.min(3, Math.max(0, result.length - 5));
  const currentSatori = result.filter((r, i) => i > 0 && satoriTypes.includes(r.type)).length;

  if (currentSatori > targetSatori) {
    // Satori가 너무 많으면 → 뒤에서부터 photo로 전환
    let excess = currentSatori - targetSatori;
    for (let i = result.length - 1; i > 0 && excess > 0; i--) {
      if (satoriTypes.includes(result[i].type)) {
        result[i].type = 'photo';
        result[i].model = 'fluxr';
        result[i].prompt = 'high quality Korean lifestyle blog photography, soft natural lighting, photorealistic, clean composition, no text, no letters, photography style';
        result[i].reason = '배분 보정 → photo';
        excess--;
      }
    }
  } else if (currentSatori < targetSatori) {
    // Satori가 부족하면 → 뒤에서부터 photo를 checklist로 전환
    let deficit = targetSatori - currentSatori;
    for (let i = result.length - 1; i > 0 && deficit > 0; i--) {
      if (result[i].type === 'photo') {
        result[i].type = 'checklist';
        result[i].model = 'satori';
        result[i].prompt = { title: result[i].marker || '핵심 정리', subtitle: '', items: [{ text: '항목을 확인하세요', checked: true }] };
        result[i].reason = '배분 보정 → Satori 체크리스트';
        deficit--;
      }
    }
  }

  console.log(`[IMAGE-PRO] 배분 보정 완료: satori=${result.filter(r => satoriTypes.includes(r.type)).length}, photo=${result.filter(r => r.type === 'photo').length}, poster=${result.filter(r => r.type === 'poster').length}`);

  return result;
}

// ─── 개별 1장 재생성: Haiku 단일 마커 프롬프트 ───

async function callHaikuSingleMarkerPro(blogText, marker, targetType) {
  const blogSummary = blogText.substring(0, 300).trim();
  const firstLine = blogText.split('\n').find(l => l.trim()) || '';
  const blogTitle = firstLine.trim().substring(0, 80);

  const satoriTypes = ['infographic_data', 'infographic_flow', 'checklist', 'venn'];
  const isSatoriType = satoriTypes.includes(targetType);
  const isPhotoType = targetType === 'photo';

  const typeInstructions = {
    photo: `Cinematic/editorial photo prompt.
- Describe subjects, lighting, angle, mood
- Signs/menus → describe as blurred
- End with: ", photorealistic, clean composition, no text, no letters, photography style"`,
    infographic_data: `비교표 데이터 시각화 (Satori 렌더러).
- Output JSON: {"title":"한국어 제목","subtitle":"범위","source":"출처","items":[{"label":"항목","value":"숫자","unit":"단위"}]}
- 3-6 items. 블로그 문맥에서 실제 데이터 추출`,
    infographic_flow: `흐름도/프로세스 (Satori 렌더러).
- Output JSON: {"title":"한국어 제목","subtitle":"부제","steps":[{"label":"단계명","description":"설명"}]}
- 3-6 steps`,
    checklist: `체크리스트 (Satori 렌더러).
- Output JSON: {"title":"한국어 제목","subtitle":"부제","items":[{"text":"항목 내용","checked":true}]}
- 4-8 items`,
    venn: `벤다이어그램 관계도 (Satori 렌더러).
- Output JSON: {"title":"한국어 제목","subtitle":"부제","sets":[{"label":"집합명","description":"설명"}],"overlap":"공통점"}
- 2-3 sets`,
    poster: `Poster/banner for Imagen 3.
- Large centered Korean headline in quotes, subtitle below
- Bold typography, high contrast background, 2-3 colors max`,
  };

  const instruction = typeInstructions[targetType] || typeInstructions.photo;

  const systemPrompt = `You are a blog image prompt engineer. Generate ONE new ${isSatoriType ? 'JSON data object' : 'prompt'} for SINGLE IMAGE REGENERATION.
Type: ${targetType}. Create a COMPLETELY DIFFERENT ${isSatoriType ? 'data set' : 'composition and visual approach'}.

${instruction}

Rules:
${isSatoriType
    ? '- Output JSON object as a string value'
    : `- prompt 100% English${isPhotoType ? '' : ' (Korean text only inside double quotes)'}
- 80-150 English words
- Maintain Korean/East Asian aesthetic
${isPhotoType ? '- Do NOT add Korean text' : '- Do NOT add "no text" — text IS the point'}`}

Output: Return ONLY a JSON object: {"prompt": ${isSatoriType ? '"{\\"title\\":\\"...\\",\\"items\\":[...]}"' : '"English prompt 80-150 words..."'}}`;

  const userPrompt = `블로그 제목: "${blogTitle}"
블로그 요약: ${blogSummary}
마커: "${marker.text}"${marker.altText ? ` (alt: "${marker.altText}")` : ''}${marker.section ? `\n소속 섹션: "${marker.section}"` : ''}
앞 문맥: "${marker.before.substring(0, 200)}"
뒤 문맥: "${marker.after.substring(0, 200)}"

이 마커에 대해 ${targetType} 유형으로 새로운 프롬프트를 생성하세요.`;

  const raw = await callClaude(systemPrompt, userPrompt, 500);
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('Haiku single marker pro: no JSON found');
  const result = JSON.parse(jsonMatch[0]);
  return result.prompt;
}

// ─── 핸들러 ───

export default async function handler(req, res) {
  setCorsHeaders(res, req);

  if (req.method === 'OPTIONS') return res.status(200).end();

  // ─── suggest_markers 모드: 인증 불필요, 별도 rate limit ───
  if (req.method === 'POST' && req.body?.mode === 'suggest_markers') {
    let smKey = null; // catch에서 롤백 가능하도록 스코프를 바깥에 선언
    try {
      const { blogText } = req.body;
      if (!blogText || blogText.trim().length < 100) {
        return res.status(400).json({ error: '블로그 글을 100자 이상 입력해주세요.' });
      }
      if (blogText.length > 30000) {
        return res.status(400).json({ error: '블로그 글이 너무 깁니다. 30,000자 이내로 입력해주세요.' });
      }

      const isAdmin = await resolveAdmin(req);
      const ip = getClientIp(req);

      // IP당 일 10회 rate limit (관리자 면제)
      if (!isAdmin) {
        smKey = getSuggestMarkersKey(ip);
        const count = await getRedis().incr(smKey);
        await getRedis().expire(smKey, getTTLUntilMidnightKST());
        if (count > 10) {
          // 한도 초과 시 롤백 (429는 실제 사용이 아님)
          try { await getRedis().decr(smKey); } catch (_) {}
          smKey = null; // catch에서 중복 롤백 방지
          return res.status(429).json({
            error: '마커 추천 일일 한도(10회)를 초과했습니다. 내일 다시 이용해주세요.',
          });
        }
      }

      console.log(`[IMAGE-PRO] Mode: suggest_markers | blogText: ${blogText.length} chars | ip: ${ip}`);

      const markers = await callHaikuSuggestMarkers(blogText);

      console.log(`[IMAGE-PRO] Suggested ${markers.length} markers`);

      return res.status(200).json({ markers });
    } catch (error) {
      console.error('[IMAGE-PRO] suggest_markers error:', error.message);
      // AI 호출 실패 시 rate limit 롤백 (사용자 귀책 아님)
      if (smKey) try { await getRedis().decr(smKey); } catch (_) {}
      return res.status(500).json({ error: 'AI 마커 추천에 실패했습니다. 잠시 후 다시 시도해주세요.' });
    }
  }

  // ─── 인증: 관리자(서버 판별) OR 로그인 회원 ───
  const isAdmin = await resolveAdmin(req);

  let sessionEmail = null;

  if (!isAdmin) {
    const token = req.headers?.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : null;
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

  // ─── GET: 남은 횟수 조회 ───
  if (req.method === 'GET') {
    if (isAdmin) {
      return res.status(200).json({ remaining: 999, limit: FREE_DAILY_LIMIT, admin: true });
    }
    try {
      const ip = getClientIp(req);
      const key = getTodayKeyPro(ip);
      const count = Number((await getRedis().get(key)) || 0);
      const remainingCredits = Math.max(DAILY_LIMIT_SCALED - count, 0);
      const remaining = Math.floor(remainingCredits / FULL_COST);
      return res.status(200).json({ remaining, limit: FREE_DAILY_LIMIT });
    } catch {
      return res.status(200).json({ remaining: FREE_DAILY_LIMIT, limit: FREE_DAILY_LIMIT });
    }
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ─── POST: 횟수 제한 ───
  const reqMode = req.body?.mode;
  const creditCost = reqMode === 'regenerate_single' ? SINGLE_REGEN_COST : FULL_COST;
  let remaining = isAdmin ? 999 : FREE_DAILY_LIMIT;
  let rateLimitKey = null;

  if (!isAdmin) {
    const ip = getClientIp(req);
    rateLimitKey = getTodayKeyPro(ip);
    const newCount = await getRedis().incrby(rateLimitKey, creditCost);
    await getRedis().expire(rateLimitKey, getTTLUntilMidnightKST());

    if (newCount > DAILY_LIMIT_SCALED) {
      await getRedis().decrby(rateLimitKey, creditCost);
      return res.status(429).json({
        error: `프리미엄 이미지 일일 무료 크레딧을 모두 사용했습니다. 내일 다시 이용해주세요.`,
        remaining: 0,
      });
    }
    remaining = Math.floor(Math.max(DAILY_LIMIT_SCALED - newCount, 0) / FULL_COST);
  }

  try {
    const { mode, is_regenerate } = req.body;

    // ===== REGENERATE_SINGLE 모드: 개별 1장 재생성 (0.7크레딧) =====
    if (mode === 'regenerate_single') {
      const { blogText, markerText, originalPrompt, originalType, originalModel } = req.body;

      if (!markerText && !originalPrompt) {
        if (rateLimitKey) try { await getRedis().decrby(rateLimitKey, creditCost); } catch (_) {}
        return res.status(400).json({ error: '마커 정보 또는 프롬프트가 누락되었습니다.' });
      }

      const targetModel = originalModel || 'fluxr';
      const targetType = originalType || 'photo';
      let finalPrompt;

      if (markerText && blogText) {
        // Parse 모드 이미지: 마커 컨텍스트 추출 → Haiku 재생성
        const totalLen = blogText.length;
        const cleanCtx = (s) => s.replace(/\((사진|이미지):\s*[^)]+\)/g, '').replace(/#\S+/g, '').replace(/【\d+\.?】/g, '').replace(/\s{2,}/g, ' ').trim();
        const marker = { text: markerText, altText: '', before: '', after: '', position: 'middle', section: '' };
        const escaped = markerText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const found = blogText.match(new RegExp(`\\((사진|이미지):\\s*${escaped}[^)]*\\)`));
        if (found) {
          const pos = blogText.indexOf(found[0]);
          marker.before = cleanCtx(blogText.substring(Math.max(0, pos - 400), pos));
          marker.after = cleanCtx(blogText.substring(pos + found[0].length, Math.min(totalLen, pos + found[0].length + 400)));
          const ratio = pos / totalLen;
          marker.position = ratio < 0.25 ? 'early' : ratio < 0.75 ? 'middle' : 'ending';
          const beforeText = blogText.substring(0, pos);
          const secs = [...beforeText.matchAll(/【\d+\.?】[^\n]*/g)];
          marker.section = secs.length > 0 ? secs[secs.length - 1][0].trim() : '';
        }

        try {
          finalPrompt = await callHaikuSingleMarkerPro(blogText, marker, targetType);
        } catch (err) {
          console.warn('[IMAGE-PRO] Haiku single regen failed, using original prompt:', err.message);
          finalPrompt = originalPrompt || 'high quality Korean lifestyle blog photography, soft natural lighting, editorial style, no text, no letters, photography style';
        }
      } else {
        // Direct 모드: 기존 프롬프트 재사용 (시드 랜덤으로 다른 결과)
        finalPrompt = originalPrompt;
      }

      try {
        const url = await generateByModel(targetModel, finalPrompt, targetType);
        if (!url) throw new Error('No image URL');
        // R2 업로드 (non-fatal)
        const userId = (sessionEmail || getClientIp(req) || 'anonymous').replace(/[^a-zA-Z0-9]/g, '_');
        const r2Url = await uploadImageUrlToR2(url, `images-pro/${userId}/${getKSTDate()}/${Math.random().toString(36).substring(2, 10)}.png`);
        return res.status(200).json({
          mode: 'regenerate_single',
          image: { url, marker: markerText || '', prompt: typeof finalPrompt === 'object' ? JSON.stringify(finalPrompt) : finalPrompt, type: targetType, model: targetModel, r2Url },
          remaining,
          limit: FREE_DAILY_LIMIT,
        });
      } catch (err) {
        console.error(`[IMAGE-PRO] Single regen ${targetModel} error:`, err.message);
        // fallback: satori → Imagen 3, 그 외 → FLUX Realism
        if (targetModel !== 'fluxr') {
          try {
            let fbPrompt, fbModel;
            if (targetModel === 'satori') {
              fbModel = 'nb2';
              fbPrompt = 'high quality Korean lifestyle blog photography, soft natural lighting, editorial style, photorealistic, clean composition, no text, no letters, photography style';
            } else {
              fbModel = 'fluxr';
              fbPrompt = (typeof finalPrompt === 'string' ? finalPrompt : '').replace(/\s*,?\s*no text,?\s*no letters,?\s*photography style\s*$/i, '') +
                ', no text, no letters, photography style';
            }
            const url = await generateByModel(fbModel, fbPrompt, 'photo');
            if (url) {
              const userId = (sessionEmail || getClientIp(req) || 'anonymous').replace(/[^a-zA-Z0-9]/g, '_');
              const r2Url = await uploadImageUrlToR2(url, `images-pro/${userId}/${getKSTDate()}/${Math.random().toString(36).substring(2, 10)}.png`);
              return res.status(200).json({
                mode: 'regenerate_single',
                image: { url, marker: markerText || '', prompt: fbPrompt, type: 'photo', model: fbModel, r2Url },
                remaining,
                limit: FREE_DAILY_LIMIT,
              });
            }
          } catch (_) {}
        }
        if (rateLimitKey) try { await getRedis().decrby(rateLimitKey, creditCost); } catch (_) {}
        return res.status(500).json({ error: '이미지 재생성에 실패했습니다.' });
      }
    }

    // ===== PARSE 모드: 블로그 글에서 마커 파싱 → 자동 모델 라우팅 =====
    if (mode === 'parse') {
      const { blogText, thumbnailText } = req.body;
      const frontMarkers = req.body.markers;
      if (!blogText) {
        return res.status(400).json({ error: '블로그 글을 입력해주세요.' });
      }

      const totalLen = blogText.length;

      const cleanContext = (str) => str
        .replace(/\((사진|이미지):\s*[^)]+\)/g, '')
        .replace(/#\S+/g, '')
        .replace(/【\d+\.?】/g, '')
        .replace(/\s{2,}/g, ' ')
        .trim();

      let markers = [];

      console.log(`[IMAGE-PRO] Mode: parse | blogText: ${totalLen} chars | frontMarkers: ${frontMarkers?.length || 0} | is_regenerate: ${is_regenerate}`);

      if (Array.isArray(frontMarkers) && frontMarkers.length > 0) {
        const validMarkers = frontMarkers.filter(m => m && m.trim()).slice(0, MAX_MARKERS);
        markers = validMarkers.map((markerText) => {
          const text = markerText.trim();
          const escapedText = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const findRegex = new RegExp(`\\((사진|이미지):\\s*${escapedText}[^)]*\\)`);
          const found = blogText.match(findRegex);
          let before = '', after = '', position = 'middle', section = '';

          if (found) {
            const pos = blogText.indexOf(found[0]);
            const rawBefore = blogText.substring(Math.max(0, pos - 400), pos);
            const rawAfter = blogText.substring(pos + found[0].length, Math.min(totalLen, pos + found[0].length + 400));
            before = cleanContext(rawBefore);
            after = cleanContext(rawAfter);
            const positionRatio = pos / totalLen;
            position = positionRatio < 0.25 ? 'early' : positionRatio < 0.75 ? 'middle' : 'ending';
            const textBeforeMarker = blogText.substring(0, pos);
            const sectionMatches = [...textBeforeMarker.matchAll(/【\d+\.?】[^\n]*/g)];
            section = sectionMatches.length > 0 ? sectionMatches[sectionMatches.length - 1][0].trim() : '';
          } else {
            before = cleanContext(blogText.substring(0, Math.min(400, totalLen)));
            after = '';
            position = 'middle';
          }

          return { text, altText: '', before, after, position, section };
        });
      } else {
        const markerRegex = /\((사진|이미지):\s*([^)]+)\)/g;
        let m;

        while ((m = markerRegex.exec(blogText)) !== null) {
          const rawText = m[2].trim();
          let text = rawText;
          let altText = '';
          const altMatch = rawText.match(/^(.+?),\s*alt:\s*(.+)$/);
          if (altMatch) {
            text = altMatch[1].trim();
            altText = altMatch[2].trim();
          }
          const pos = m.index;
          const rawBefore = blogText.substring(Math.max(0, pos - 400), pos);
          const rawAfter = blogText.substring(pos + m[0].length, Math.min(totalLen, pos + m[0].length + 400));
          const before = cleanContext(rawBefore);
          const after = cleanContext(rawAfter);
          const positionRatio = pos / totalLen;
          const position = positionRatio < 0.25 ? 'early' : positionRatio < 0.75 ? 'middle' : 'ending';
          const textBeforeMarker = blogText.substring(0, pos);
          const sectionMatches = [...textBeforeMarker.matchAll(/【\d+\.?】[^\n]*/g)];
          const section = sectionMatches.length > 0 ? sectionMatches[sectionMatches.length - 1][0].trim() : '';
          markers.push({ text, altText, before, after, position, section });
        }
      }

      markers = markers.slice(0, MAX_MARKERS);

      if (markers.length === 0) {
        return res.status(400).json({ error: '블로그 글에서 (사진: ...) 또는 (이미지: ...) 마커를 찾을 수 없습니다.' });
      }

      console.log(`[IMAGE-PRO] Markers found: ${markers.length}`);

      // AI 추천 마커 감지: 글 본문에 (사진:...) 형태로 존재하지 않는 마커가 과반수이면 AI 추천 마커
      const markersNotInText = markers.filter(mk => {
        const escaped = mk.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return !blogText.match(new RegExp(`\\((사진|이미지):\\s*${escaped}`));
      }).length;
      const isSuggestedMarkers = markersNotInText > markers.length / 2;

      if (isSuggestedMarkers) {
        console.log(`[IMAGE-PRO] AI 추천 마커 감지 (${markersNotInText}/${markers.length} not in text) → photo 전용 모드`);
      }

      // ===== Haiku 6-type BALANCED 분석 =====
      let analysisResult;

      // AI 추천 마커: 트리거 단어 기반 라우팅 → Haiku에 번역/JSON 생성 요청
      if (isSuggestedMarkers) {
        const TRIGGER_DATA = /차트|그래프|통계표|비교표|수치\s*비교|데이터\s*시각화|가격\s*비교|순위/;
        const TRIGGER_FLOW = /흐름도|타임라인|로드맵|프로세스|단계도|절차|순서|과정/;
        const TRIGGER_CHECK = /체크리스트|준비물|필수\s*항목|확인\s*사항|주의사항|팁\s*모음/;
        const TRIGGER_VENN = /벤다이어그램|관계도|공통점|차이점|비교\s*분석/;
        const TRIGGER_POSTER = /포스터|배너|공지문/;

        function detectModelFromMarker(text) {
          if (TRIGGER_DATA.test(text)) return { type: 'infographic_data', model: 'satori' };
          if (TRIGGER_FLOW.test(text)) return { type: 'infographic_flow', model: 'satori' };
          if (TRIGGER_CHECK.test(text)) return { type: 'checklist', model: 'satori' };
          if (TRIGGER_VENN.test(text)) return { type: 'venn', model: 'satori' };
          if (TRIGGER_POSTER.test(text)) return { type: 'poster', model: 'nb2' };
          return { type: 'photo', model: 'fluxr' };
        }

        const routingInfo = markers.map(mk => ({ ...detectModelFromMarker(mk.text), marker: mk.text }));
        const satoriCount = routingInfo.filter(r => r.model === 'satori').length;
        const photoCount = routingInfo.filter(r => r.model === 'fluxr').length;

        console.log(`[IMAGE-PRO] AI 추천 마커 라우팅: photo=${photoCount}, satori=${satoriCount}, nb2=${routingInfo.filter(r=>r.model==='nb2').length}`);

        const firstLine = blogText.split('\n').find(l => l.trim()) || '';
        const blogTitle = firstLine.trim().substring(0, 80);
        const markerTexts = markers.map(mk => mk.text);

        const promptInstruction = markerTexts.map((t, i) => {
          const r = routingInfo[i];
          if (r.model === 'fluxr') return `${i + 1}. ${t} [PHOTO: describe as realistic photography. End with ", photorealistic, clean composition, no text, no letters, photography style"]`;
          if (r.type === 'infographic_data') return `${i + 1}. ${t} [DATA: output JSON {"title":"한국어","subtitle":"범위","source":"출처","items":[{"label":"항목","value":"숫자","unit":"단위"}]} 3-6 items]`;
          if (r.type === 'infographic_flow') return `${i + 1}. ${t} [FLOW: output JSON {"title":"한국어","subtitle":"","steps":[{"label":"단계명","description":"설명"}]} 3-6 steps]`;
          if (r.type === 'checklist') return `${i + 1}. ${t} [CHECKLIST: output JSON {"title":"한국어","subtitle":"","items":[{"text":"항목","checked":true}]} 4-8 items]`;
          if (r.type === 'venn') return `${i + 1}. ${t} [VENN: output JSON {"title":"한국어","subtitle":"","sets":[{"label":"집합","description":"설명"}],"overlap":"공통점"} 2-3 sets]`;
          return `${i + 1}. ${t} [POSTER: describe as poster with Korean text in quotes, layout, colors]`;
        }).join('\n');

        try {
          const translateRaw = await callClaude(
            'You are a Korean blog image content generator. For each item, follow the instruction in brackets. For [PHOTO/POSTER]: generate English prompt (1-2 sentences). For [DATA/FLOW/CHECKLIST/VENN]: generate a valid JSON object string with Korean text. Output ONLY a valid JSON array of strings.',
            `Blog topic: "${blogTitle}"\n\nGenerate content for these image descriptions:\n${promptInstruction}`,
            3000
          );
          const translateJsonStr = extractJsonArray(translateRaw);
          const translatedPrompts = translateJsonStr ? JSON.parse(translateJsonStr) : null;
          if (translatedPrompts && translatedPrompts.length === markers.length) {
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
          } else {
            throw new Error('Translation count mismatch');
          }
        } catch (translateErr) {
          console.warn('[IMAGE-PRO] AI 추천 마커 번역 실패, 기본 photo:', translateErr.message);
          analysisResult = markers.map((mk, i) => ({
            marker: mk.text, type: 'photo', model: 'fluxr',
            reason: 'AI 추천 마커 → 번역 실패 → 기본 사진',
            prompt: 'high quality Korean lifestyle blog photography, soft natural lighting, editorial style, photorealistic, clean composition, no text, no letters, photography style',
          }));
        }
      }

      if (!analysisResult) try {
        analysisResult = await callHaikuMarkerAnalysis(blogText, markers, is_regenerate);
        const typeCounts = {};
        for (const r of analysisResult) {
          typeCounts[r.type] = (typeCounts[r.type] || 0) + 1;
        }
        console.log(`[IMAGE-PRO] Haiku routing:`, JSON.stringify(typeCounts));
        for (const r of analysisResult) {
          console.log(`[IMAGE-PRO]   "${r.marker || '?'}" → ${r.type}/${r.model} — ${r.reason || ''}`);
        }
      } catch (err) {
        console.error('[IMAGE-PRO] Haiku analysis FAILED:', err.message);
        // fallback: 전부 photo/fluxr
        try {
          const firstLine = blogText.split('\n').find(l => l.trim()) || '';
          const blogTitle = firstLine.trim().substring(0, 80);
          const markerTexts = markers.map(mk => mk.text);
          const fallbackRaw = await callClaude(
            'You are a Korean-to-English translator for image generation. Translate each Korean image description into a specific, detailed English visual prompt (1-2 sentences). The prompts must describe the EXACT subject mentioned. Always end with: ", no text, no letters, photography style". Output ONLY a JSON array of English prompt strings.',
            `Blog topic: "${blogTitle}"\n\nTranslate these image descriptions:\n${markerTexts.map((t, i) => `${i + 1}. ${t}`).join('\n')}`,
            1500
          );
          const fallbackJsonStr = extractJsonArray(fallbackRaw);
          const fallbackPrompts = fallbackJsonStr ? JSON.parse(fallbackJsonStr) : null;
          if (fallbackPrompts && fallbackPrompts.length === markers.length) {
            analysisResult = fallbackPrompts.map((prompt, i) => ({
              marker: markers[i].text,
              type: 'photo',
              model: 'fluxr',
              reason: 'Haiku 분석 실패 → 기본 사진 모드',
              prompt,
            }));
          } else {
            throw new Error('Fallback translation returned wrong count');
          }
        } catch (fallbackErr) {
          console.error('[IMAGE-PRO] Fallback also FAILED:', fallbackErr.message);
          return res.status(500).json({ error: 'AI 이미지 분석에 실패했습니다. 잠시 후 다시 시도해주세요.' });
        }
      }

      // 원래 마커 순서대로 매핑
      const orderedItems = markers.map((mk, i) => {
        const found = analysisResult[i] || analysisResult.find(a => a.marker === mk.text);
        if (!found) {
          return {
            type: 'photo', model: 'fluxr',
            prompt: 'high quality Korean lifestyle blog photography, soft natural lighting, editorial style, no text, no letters, photography style',
            marker: mk.text, reason: '매핑 실패 → 기본값', originalIndex: i,
          };
        }
        return { ...found, marker: mk.text, originalIndex: i };
      });

      // photo 라우팅: 첫 번째(썸네일)만 FLUX Realism, 나머지 photo는 Imagen 3
      for (let i = 1; i < orderedItems.length; i++) {
        if (orderedItems[i].type === 'photo' && orderedItems[i].model === 'fluxr') {
          orderedItems[i].model = 'nb2';
        }
      }

      // 배치 생성 (4장씩, rate limit 방지)
      console.log(`[IMAGE-PRO] Generating ${orderedItems.length} images with auto-routing (batch=4)...`);

      const imageResults = [];
      for (let batchStart = 0; batchStart < orderedItems.length; batchStart += 4) {
        if (batchStart > 0) await new Promise(r => setTimeout(r, 300));
        const batch = orderedItems.slice(batchStart, batchStart + 4);
        const batchResults = await Promise.all(
          batch.map(async (item) => {
            const modelName = item.model || 'fluxr';
            const modelLabel = { fluxr: 'FLUX Realism', gpth: 'GPT Image high', nb2: 'Imagen 3', satori: 'Satori 템플릿' }[modelName] || modelName;
            try {
              const url = await generateByModel(modelName, item.prompt, item.type);
              console.log(`[IMAGE-PRO] ✓ "${item.marker}" → ${modelLabel} (${item.type})`);
              return {
                url, marker: item.marker, prompt: typeof item.prompt === 'object' ? JSON.stringify(item.prompt) : item.prompt,
                type: item.type, model: modelName, reason: item.reason,
                originalIndex: item.originalIndex,
              };
            } catch (err) {
              console.error(`[IMAGE-PRO] ✗ "${item.marker}" → ${modelLabel} FAILED:`, err.message);
              // Satori 실패 → Imagen 3로 대체 (사진 프롬프트 생성)
              // 그 외 실패 → FLUX Realism 폴백
              await new Promise(r => setTimeout(r, 1000));
              try {
                let retryPrompt;
                let retryModel;
                if (modelName === 'satori') {
                  // Satori 실패: Imagen 3 사진으로 대체
                  retryModel = 'nb2';
                  retryPrompt = 'high quality Korean lifestyle blog photography, soft natural lighting, editorial style, photorealistic, clean composition, no text, no letters, photography style';
                } else if (modelName !== 'fluxr') {
                  retryModel = 'fluxr';
                  retryPrompt = (typeof item.prompt === 'string' ? item.prompt : '').replace(/\s*,?\s*no text,?\s*no letters,?\s*photography style\s*$/i, '') +
                    ', no text, no letters, photography style';
                } else {
                  retryModel = 'fluxr';
                  retryPrompt = item.prompt;
                }
                const url = await generateByModel(retryModel, retryPrompt, 'photo');
                console.log(`[IMAGE-PRO] ↩ "${item.marker}" retry → ${retryModel === 'nb2' ? 'Imagen 3' : 'FLUX Realism'} OK`);
                return {
                  url, marker: item.marker, prompt: retryPrompt,
                  type: 'photo', model: retryModel,
                  reason: `${modelLabel} 실패 → ${retryModel === 'nb2' ? 'Imagen 3' : 'FLUX Realism'} 대체`,
                  originalIndex: item.originalIndex,
                };
              } catch (retryErr) {
                console.error(`[IMAGE-PRO] ✗ "${item.marker}" retry also FAILED`);
              }
              return { url: null, marker: item.marker, type: item.type, model: modelName, originalIndex: item.originalIndex };
            }
          })
        );
        imageResults.push(...batchResults);
      }

      const validImages = imageResults
        .sort((a, b) => a.originalIndex - b.originalIndex)
        .filter(img => img.url);

      if (validImages.length === 0) {
        return res.status(500).json({ error: '이미지 생성에 실패했습니다. 잠시 후 다시 시도해주세요.' });
      }

      // R2 업로드 (non-fatal)
      const userId = (sessionEmail || getClientIp(req) || 'anonymous').replace(/[^a-zA-Z0-9]/g, '_');
      const r2Images = await replaceUrlsWithR2(validImages, 'images-pro', userId);

      logUsage(sessionEmail, 'image-pro', 'parse', getClientIp(req));
      return res.status(200).json({
        mode: 'parse',
        images: r2Images,
        thumbnailText: thumbnailText || '',
        remaining,
        limit: FREE_DAILY_LIMIT,
      });
    }

    // ===== DIRECT 모드: 주제+분위기 → 8장 (FLUX Realism) =====
    const { topic, mood, thumbnailText } = req.body;
    if (!topic) {
      return res.status(400).json({ error: '블로그 주제를 입력해주세요.' });
    }

    const directSystem = is_regenerate
      ? 'You are an image prompt translator. This is a REGENERATION request. Convert the Korean blog topic into a rich, detailed English still-life or environment description (2-3 sentences). Describe ONLY inanimate objects, products, documents, tools, or empty spaces — frame as overhead flat-lay, macro close-up, or vacant environment. Name specific materials, colors, textures, arrangement. Camera: overhead bird-eye or extreme macro. Compose for square 1024x1024. Always end with: ", no text, no letters, photography style". Output only the prompt.'
      : 'You are an image prompt translator. Convert the Korean blog topic into a concise English still-life or environment description (1-2 sentences). Describe ONLY inanimate objects, documents, or empty spaces as overhead flat-lay, macro close-up, or vacant environment. Compose for square 1024x1024. Always end with: ", no text, no letters, photography style". Output only the prompt.';
    const englishTopic = await callClaude(
      directSystem,
      topic,
      is_regenerate ? 300 : 150
    );

    console.log('[IMAGE-PRO] Direct mode - topic:', topic, '→ prompt:', englishTopic.substring(0, 100));
    const moodStyle = moodPrompts[mood] || moodPrompts['bright'];
    const fullPrompt = `${englishTopic}, ${moodStyle}, high quality editorial still-life photography, inanimate objects only, uninhabited empty scene, overhead or macro camera angle, clean Korean aesthetic, no text, no letters, photography style`;

    // 8장 FLUX Realism 생성 (4장씩 배치, 딜레이 포함)
    const images = [];
    for (let i = 0; i < DIRECT_IMAGES; i += 4) {
      if (i > 0) await new Promise(r => setTimeout(r, 300));
      const batchSize = Math.min(4, DIRECT_IMAGES - i);
      const batchResults = await Promise.all(
        Array.from({ length: batchSize }, async (_, j) => {
          try {
            const url = await callFluxRealism(fullPrompt);
            return { url, prompt: fullPrompt, type: 'photo', model: 'fluxr' };
          } catch (err) {
            console.error(`[IMAGE-PRO] FLUX Realism error (direct ${i + j}):`, err);
            return { url: null, prompt: fullPrompt, type: 'photo', model: 'fluxr' };
          }
        })
      );
      images.push(...batchResults);
    }

    const validImages = images.filter(img => img.url);
    if (validImages.length === 0) {
      return res.status(500).json({ error: '이미지 생성에 실패했습니다.' });
    }

    // R2 업로드 (non-fatal)
    const directUserId = (sessionEmail || getClientIp(req) || 'anonymous').replace(/[^a-zA-Z0-9]/g, '_');
    const r2DirectImages = await replaceUrlsWithR2(validImages, 'images-pro', directUserId);

    logUsage(sessionEmail, 'image-pro', 'direct', getClientIp(req));
    return res.status(200).json({
      mode: 'direct',
      images: r2DirectImages,
      thumbnailText: thumbnailText || '',
      remaining,
      limit: FREE_DAILY_LIMIT,
    });

  } catch (error) {
    console.error('[IMAGE-PRO] API Error:', error);
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
}
