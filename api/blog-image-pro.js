import { Redis } from '@upstash/redis';
import { resolveAdmin, setCorsHeaders } from './_helpers.js';

export const config = { maxDuration: 60 };

/*
 * 프리미엄 이미지 생성 v2 (회원 전용 공개)
 * 자동 모델 라우팅: Haiku가 이미지 유형 판단 → 최적 모델 선택
 *
 * 모델 라우팅:
 *   photo → FLUX Realism LoRA
 *   infographic_data → GPT Image 1 high (gpt-image-1, quality: high)
 *   infographic_flow → Nano Banana 2 (fal-ai/nano-banana-2)
 *   poster → Nano Banana 2 (fal-ai/nano-banana-2)
 *
 * 인증: 관리자(서버 판별) OR 로그인 회원 (3/24까지 가입 시 1일 1회 무료)
 */

const FREE_DAILY_LIMIT = 1;
const FREE_CUTOFF = '2026-03-24T23:59:59+09:00';
const MAX_MARKERS = 8;
const DIRECT_IMAGES = 8;

// 크레딧 10배 스케일링 (소수점 회피: 0.7cr → 7단위, 1cr → 10단위)
const CREDIT_SCALE = 10;
const FULL_COST = 10;         // 전체 생성/재생성: 1 크레딧
const SINGLE_REGEN_COST = 7;  // 개별 1장 재생성: 0.7 크레딧
const DAILY_LIMIT_SCALED = FREE_DAILY_LIMIT * CREDIT_SCALE;

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
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.headers['x-real-ip'] ||
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

// FLUX Realism LoRA — 사실적 사진/배경/풍경/음식/인물/제품
async function callFluxRealism(prompt) {
  const response = await fetch('https://fal.run/fal-ai/flux-lora', {
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
      loras: [{ path: 'XLabs-AI/flux-RealismLora', scale: 1 }],
    }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(JSON.stringify(data));
  if (data.detail) console.warn('[IMAGE-PRO] FLUX Realism warning:', data.detail);
  const url = data.images?.[0]?.url || null;
  if (!url) console.error('[IMAGE-PRO] FLUX Realism: no URL in response:', JSON.stringify(data).substring(0, 300));
  return url;
}

// GPT Image 1 high — 차트/그래프/통계/수치 인포그래픽
async function callGptImageHigh(prompt) {
  const response = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-image-1',
      prompt,
      n: 1,
      size: '1024x1536',
      quality: 'high',
      output_format: 'webp',
    }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(JSON.stringify(data));
  const b64 = data.data?.[0]?.b64_json;
  if (!b64) return null;
  return `data:image/webp;base64,${b64}`;
}

// Nano Banana 2 — 타임라인/로드맵/한글 텍스트/포스터
async function callNanoBanana2(prompt) {
  const response = await fetch('https://fal.run/fal-ai/nano-banana-2', {
    method: 'POST',
    headers: {
      Authorization: `Key ${process.env.FAL_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      prompt,
      image_size: { width: 1024, height: 1024 },
      num_images: 1,
    }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(JSON.stringify(data));
  if (data.detail) console.warn('[IMAGE-PRO] Nano Banana 2 warning:', data.detail);
  return data.images?.[0]?.url || null;
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

// 모델 라우팅: type → API 호출
async function generateByModel(model, prompt) {
  switch (model) {
    case 'fluxr':
      return await callFluxRealism(prompt);
    case 'gpth':
      return await callGptImageHigh(prompt);
    case 'nb2':
      return await callNanoBanana2(prompt);
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

  const systemPrompt = `You are a blog image prompt engineer with automatic model routing.
Classify each marker into ONE of 4 types, select the best AI model, and generate the prompt.

## CRITICAL: PHOTO-FIRST RULE
DEFAULT is ALWAYS "photo". These images will have text overlaid by the frontend — so images MUST be clean photos WITHOUT embedded text.

Only use infographic_data/infographic_flow/poster when the marker text EXPLICITLY contains these EXACT trigger words:
- infographic_data: 차트, 그래프, 통계표, 비교표, 수치 비교, 데이터 시각화
- infographic_flow: 흐름도, 타임라인, 로드맵, 프로세스 도식, 단계도
- poster: 포스터, 배너, 공지문

If the marker describes a concept, product, scene, mood, activity, food, place, or anything visual → ALWAYS use "photo".
Even if the blog discusses data/statistics, the IMAGE should be a photo unless the marker EXPLICITLY asks for a chart.

## 4 IMAGE TYPES & MODEL ROUTING

### 1. photo → model: "fluxr" (DEFAULT — use this 90%+ of the time)
For: 사진, 배경, 풍경, 음식, 인물, 제품, 인테리어, 사물, 개념 시각화
- FIRST marker MUST be "photo" (대표이미지)
- Describe subjects, lighting, angle, mood as cinematic/editorial photography
- Signs/menus in scene → describe as blurred
- Camera: overhead, macro, wide-angle, 45-degree, eye-level
- End with: ", photorealistic, clean composition, no text, no letters, photography style"

### 2. infographic_data → model: "gpth" (ONLY when marker explicitly says 차트/그래프/비교표)
For: data-heavy visuals with numbers, percentages, charts, tables, comparisons (GPT Image 1 high)

**CHART RULES (infographic_data — MUST follow all, 2:3 vertical layout):**
(A) DATA LABELS: Show numeric value on every data point (bar tips, pie segments, line nodes)
(B) AXIS UNITS: Y-axis includes unit (e.g. "비용(만원)"), X-axis full Korean labels, subtle grid lines
(C) COMPOSITION: Chart fills 70%+ of image, no floating empty space
(D) SOURCE: Footer with data source/year (e.g. "Source: 한국소비자원 2024")
(E) COLOR: Key data bold saturated, secondary muted gray. Legend at right or bottom
(F) PADDING: 15% top + 10% bottom padding. Title/chart must not touch edges
(G) TITLE: Two-level — large bold Korean main title + smaller subtitle (year/scope)

### 3. infographic_flow → model: "nb2" (ONLY when marker explicitly says 흐름도/타임라인/로드맵)
For: 타임라인, 로드맵, 단계, 흐름도, 프로세스, 한글 텍스트 위주 설명
- Describe as top-to-bottom or left-to-right flow with numbered Korean labels
- Use arrows/connectors between steps, soft gradient background, 3-5 step nodes
- Include Korean text in quotes. Color: main step bold, sub-step muted

### 4. poster → model: "nb2" (ONLY when marker explicitly says 포스터/배너/공지문)
For: 한글 타이포그래피, 공지, 텍스트 위주 포스터, 배너
- Large centered Korean headline in quotes, supporting subtitle below
- Bold typography, high contrast background, minimal decoration
- Specify font style (sans-serif, bold), 2-3 colors max

## PROMPT RULES (CRITICAL)

### Rule 1: prompt MUST be 100% English
- NO Korean except image-text in double quotes (e.g. "월별 매출 추이" as title)
- ABSOLUTE PROHIBITION on Korean outside quotes

### Rule 2: Photo prompts
- photo type: suffix defined above — always include it
- Do NOT add Korean text to photo prompts

### Rule 3: Infographic/poster types
- Include Korean text in quotes within the prompt. Describe layout, structure, colors
- Do NOT add "no text" — text IS the point
- infographic_data: MUST follow ALL CHART RULES (A)~(G) above

### Rule 4: Prompt length
- Each prompt: 80-150 English words
- Be specific: composition, colors, layout, lighting, style

### Rule 5: Context accuracy
- Read marker text + before/after context carefully. Prompt must match the marker's meaning
- Maintain Korean/East Asian aesthetic

${isRegenerate ? '\nREGENERATION MODE: Generate MORE SPECIFIC prompts with different compositions and visual approaches.' : ''}

## OUTPUT FORMAT
Return ONLY a valid JSON array. Each element:
{"type":"[photo|infographic_data|infographic_flow|poster]","model":"[fluxr|gpth|nb2]","reason":"[한국어 1문장]","prompt":"[영어 전용 80-150 words]"}`;

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
  const validTypes = ['photo', 'infographic_data', 'infographic_flow', 'poster'];
  const modelMap = { photo: 'fluxr', infographic_data: 'gpth', infographic_flow: 'nb2', poster: 'nb2' };

  for (let idx = 0; idx < result.length; idx++) {
    const item = result[idx];

    // 잘못된 type 보정
    if (!validTypes.includes(item.type)) {
      item.type = 'photo';
    }

    // Haiku 분류 신뢰 — COST GUARD 제거 (퀄리티 우선)

    // model이 type과 불일치하면 강제 보정
    item.model = modelMap[item.type];

    // prompt 누락 시 기본값
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
    if (!result[0].prompt.includes('no text')) {
      result[0].prompt += ', photorealistic, clean composition, shallow depth of field, no text, photography style';
    }
  }

  return result;
}

// ─── 개별 1장 재생성: Haiku 단일 마커 프롬프트 ───

async function callHaikuSingleMarkerPro(blogText, marker, targetType) {
  const blogSummary = blogText.substring(0, 300).trim();
  const firstLine = blogText.split('\n').find(l => l.trim()) || '';
  const blogTitle = firstLine.trim().substring(0, 80);

  const typeInstructions = {
    photo: `Cinematic/editorial photo prompt.
- Describe subjects, lighting, angle, mood
- Signs/menus → describe as blurred
- End with: ", photorealistic, clean composition, no text, no letters, photography style"`,
    infographic_data: `Data visualization for GPT Image (2:3 vertical layout).
CHART RULES: (A) Data labels on every point (B) Y-axis units, X-axis Korean labels (C) Chart fills 70%+ (D) Source footer (E) Bold key data, muted secondary (F) 15% top + 10% bottom padding (G) Two-level Korean title`,
    infographic_flow: `Flow/timeline for Nano Banana 2.
- Top-to-bottom or left-to-right flow, numbered Korean labels
- Arrows/connectors, soft gradient background, 3-5 step nodes
- Include Korean text in quotes`,
    poster: `Poster/banner for Nano Banana 2.
- Large centered Korean headline in quotes, subtitle below
- Bold typography, high contrast background, 2-3 colors max`,
  };

  const instruction = typeInstructions[targetType] || typeInstructions.photo;
  const isPhotoType = targetType === 'photo';

  const systemPrompt = `You are a blog image prompt engineer. Generate ONE new prompt for SINGLE IMAGE REGENERATION.
Type: ${targetType}. Create a COMPLETELY DIFFERENT composition and visual approach.

${instruction}

Rules:
- prompt 100% English${isPhotoType ? '' : ' (Korean text only inside double quotes for infographic/poster)'}
- 80-150 English words
- Maintain Korean/East Asian aesthetic
${isPhotoType ? '- Do NOT add Korean text' : '- Do NOT add "no text" — text IS the point'}

Output: Return ONLY a JSON object: {"prompt": "English prompt 80-150 words..."}`;

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

  // ─── 인증: 관리자(서버 판별) OR 로그인 회원 ───
  const isAdmin = await resolveAdmin(req);

  let sessionEmail = null;

  if (!isAdmin) {
    const token = req.body?.token || req.headers?.authorization?.replace('Bearer ', '');
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
      return res.status(403).json({ error: '3/24까지 가입한 회원만 무료 체험이 가능합니다.' });
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
      const remaining = Math.max(Math.round((DAILY_LIMIT_SCALED - count) / CREDIT_SCALE * 10) / 10, 0);
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

  // 개별 재생성은 테스트 기간 무료 (프론트에서 이미지당 1회 제한)
  if (reqMode !== 'regenerate_single' && !isAdmin) {
    const ip = getClientIp(req);
    rateLimitKey = getTodayKeyPro(ip);
    const newCount = await getRedis().incrby(rateLimitKey, creditCost);
    await getRedis().expire(rateLimitKey, getTTLUntilMidnightKST());

    if (newCount > DAILY_LIMIT_SCALED) {
      await getRedis().decrby(rateLimitKey, creditCost);
      return res.status(429).json({
        error: `프리미엄 이미지 일일 무료 한도(${FREE_DAILY_LIMIT}회)를 초과했습니다. 내일 다시 이용해주세요.`,
        remaining: 0,
      });
    }
    remaining = Math.round((DAILY_LIMIT_SCALED - newCount) / CREDIT_SCALE * 10) / 10;
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
        const url = await generateByModel(targetModel, finalPrompt);
        if (!url) throw new Error('No image URL');
        return res.status(200).json({
          mode: 'regenerate_single',
          image: { url, marker: markerText || '', prompt: finalPrompt, type: targetType, model: targetModel },
          remaining,
          limit: FREE_DAILY_LIMIT,
        });
      } catch (err) {
        console.error(`[IMAGE-PRO] Single regen ${targetModel} error:`, err.message);
        // fallback: FLUX Realism
        if (targetModel !== 'fluxr') {
          try {
            const fbPrompt = (finalPrompt || '').replace(/\s*,?\s*no text,?\s*no letters,?\s*photography style\s*$/i, '') +
              ', no text, no letters, photography style';
            const url = await callFluxRealism(fbPrompt);
            if (url) {
              return res.status(200).json({
                mode: 'regenerate_single',
                image: { url, marker: markerText || '', prompt: fbPrompt, type: 'photo', model: 'fluxr' },
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

      // ===== Haiku 4-type 분석 (마커 수 무관) =====
      let analysisResult;
      try {
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

      // 2장씩 배치 생성 (rate limit 방지)
      console.log(`[IMAGE-PRO] Generating ${orderedItems.length} images with auto-routing (batch=2)...`);

      const imageResults = [];
      for (let batchStart = 0; batchStart < orderedItems.length; batchStart += 2) {
        if (batchStart > 0) await new Promise(r => setTimeout(r, 500)); // rate limit 방지 딜레이
        const batch = orderedItems.slice(batchStart, batchStart + 2);
        const batchResults = await Promise.all(
          batch.map(async (item) => {
            const modelName = item.model || 'fluxr';
            const modelLabel = { fluxr: 'FLUX Realism', gpth: 'GPT Image high', nb2: 'Nano Banana 2' }[modelName] || modelName;
            try {
              const url = await generateByModel(modelName, item.prompt);
              console.log(`[IMAGE-PRO] ✓ "${item.marker}" → ${modelLabel} (${item.type})`);
              return {
                url, marker: item.marker, prompt: item.prompt,
                type: item.type, model: modelName, reason: item.reason,
                originalIndex: item.originalIndex,
              };
            } catch (err) {
              console.error(`[IMAGE-PRO] ✗ "${item.marker}" → ${modelLabel} FAILED:`, err.message);
              // 1회 재시도 (모든 모델)
              await new Promise(r => setTimeout(r, 1000));
              try {
                let retryPrompt = item.prompt;
                let retryModel = modelName;
                if (modelName !== 'fluxr') {
                  retryPrompt = item.prompt.replace(/\s*,?\s*no text,?\s*no letters,?\s*photography style\s*$/i, '') +
                    ', no text, no letters, photography style';
                  retryModel = 'fluxr';
                }
                const url = await generateByModel(retryModel, retryPrompt);
                console.log(`[IMAGE-PRO] ↩ "${item.marker}" retry ${retryModel === modelName ? 'same model' : 'FLUX Realism'} OK`);
                return {
                  url, marker: item.marker, prompt: retryPrompt,
                  type: retryModel === 'fluxr' ? 'photo' : item.type,
                  model: retryModel,
                  reason: retryModel !== modelName ? `${modelLabel} 실패 → FLUX Realism 대체` : item.reason,
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

      return res.status(200).json({
        mode: 'parse',
        images: validImages,
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

    // 8장 FLUX Realism 생성 (2장씩 배치, 딜레이 포함)
    const images = [];
    for (let i = 0; i < DIRECT_IMAGES; i += 2) {
      if (i > 0) await new Promise(r => setTimeout(r, 500));
      const batchSize = Math.min(2, DIRECT_IMAGES - i);
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

    return res.status(200).json({
      mode: 'direct',
      images: validImages,
      thumbnailText: thumbnailText || '',
      remaining,
      limit: FREE_DAILY_LIMIT,
    });

  } catch (error) {
    console.error('[IMAGE-PRO] API Error:', error);
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
}
