import {
  getRedis,
  resolveAdmin,
  getClientIp,
  isCreditsActive,
  jsonResponse,
  handleOptions,
} from '@/lib/api-helpers';
import { replaceUrlsWithR2, uploadImageUrlToR2 } from '@/lib/r2';
import { logUsage, chargeCredits, refundCredits, getUserCredits } from '@/lib/db';
import { registerFromUrl } from '@/lib/user-images';
import { checkQuota } from '@/lib/user-quota';
import { renderToBase64 } from '@/lib/satori-renderer';
import { renderTemplate } from '@/lib/satori-templates';

export const maxDuration = 300;

/*
 * 프리미엄 이미지 생성 v2 (회원 전용 공개)
 * 자동 모델 라우팅: Haiku가 이미지 유형 판단 → 최적 모델 선택
 */

const FREE_DAILY_LIMIT = 3;
const FREE_CUTOFF = '2026-04-24T23:59:59+09:00';
const MAX_MARKERS = 8;
const DIRECT_IMAGES = 8;

const FULL_COST = 3;
const SINGLE_REGEN_COST = 1;
const DAILY_LIMIT_SCALED = FREE_DAILY_LIMIT * FULL_COST;

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

// ─── gpt-image-2 통합 (2026-07-07 대표 결정: 유료 전환 → AI 이미지 전 모델 gpt-image-2 high) ───
// 이유: 한글 렌더 가장 안정 + 품질 최고(스킬 blog-publisher-v2 실측). FLUX·Imagen3·gpt-image-1.5 대체.
// satori(표·차트 코드 렌더)는 AI 모델이 아니므로 유지 — 한글·수치 100% 정확, 비용 0.

const GPT_IMAGE_SIZES = {
  square: '1024x1024',    // 썸네일(1번 마커 고정)
  landscape: '1536x1024', // 넓은 장면·공간·비교
  portrait: '1024x1536',  // 인물·세로 소재
};

async function callGptImage(prompt, orientation = 'landscape') {
  const size = GPT_IMAGE_SIZES[orientation] || GPT_IMAGE_SIZES.landscape;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120000); // high는 느리다 — 넉넉히
  try {
    const response = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-image-2',
        prompt,
        n: 1,
        size,
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
    if (err.name === 'AbortError') throw new Error('GPT Image 120s timeout');
    throw err;
  }
}

// ─── Vertex AI Imagen 3 ───
// 인증은 @/lib/vertex-auth.js의 getGoogleAccessToken() 사용

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

async function callHaikuSuggestMarkers(blogText) {
  const firstLine = blogText.split('\n').find((l) => l.trim()) || '';
  const blogTitle = firstLine.trim().substring(0, 80);
  const headings = blogText.match(/【\d+\.?】[^\n]*/g) || [];
  const blogStructure = headings.map((h) => h.trim()).join(' | ');
  const paragraphs = blogText.split(/\n\s*\n/).filter((p) => p.trim().length > 30);

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

  const validated = result
    .filter((item) => item.text && item.position)
    .slice(0, 8);

  if (validated.length < 1) {
    throw new Error('Haiku suggest markers: no valid markers returned');
  }

  return validated;
}

async function generateByModel(model, prompt, type, orientation) {
  // satori(코드 렌더)만 별도. 나머지는 전부 gpt-image-2 —
  // 구 모델 문자열(fluxr/gpth/nb2)도 흡수해 옛 재생성 요청과 호환.
  if (model === 'satori') {
    const data = typeof prompt === 'string' ? JSON.parse(prompt) : prompt;
    const { vnode, w, h } = renderTemplate(type, data);
    return await renderToBase64(vnode, w, h);
  }
  return await callGptImage(prompt, orientation);
}

async function callHaikuMarkerAnalysis(blogText, markers, isRegenerate) {
  const firstLine = blogText.split('\n').find((l) => l.trim()) || '';
  const blogTitle = firstLine.trim().substring(0, 80);
  const headings = blogText.match(/【\d+\.?】[^\n]*/g) || [];
  const blogStructure = headings.map((h) => h.trim()).join(' | ');

  const markerContext = markers.map((mk, i) => {
    // 문맥 400자 — 200자로는 연관성이 얕아 엉뚱한 이미지가 나온다(2026-07-07 대표 지적).
    const before = mk.before.substring(0, 400);
    const after = mk.after.substring(0, 400);
    return `마커 ${i + 1}: "${mk.text}"${mk.altText ? ` (alt: "${mk.altText}")` : ''}${mk.section ? `\n  소속 섹션: "${mk.section}"` : ''}\n  글 위치: ${mk.position}\n  앞 문맥 (400자): "${before}"\n  뒤 문맥 (400자): "${after}"`;
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

### 1. photo → model: "gpt2" (사실적 사진 — gpt-image-2)
For: 사진, 배경, 풍경, 음식, 인물, 제품, 인테리어, 감성/분위기
- Describe subjects, lighting, angle, mood as cinematic/editorial photography
- 🔑 마커의 한국어 설명이 구체적 장면이면 그 장면을 그대로 영어로 옮겨라 — 일반적인 분위기 사진으로 뭉개지 마라 (연관성이 생명)
- 🔑 photo끼리 다양성: 각 photo는 서로 다른 피사체·카메라 각도·시간대·색温으로. 같은 구도나 소재를 두 번 쓰지 마라 (유사 이미지 반복 방지)
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

### 6. poster → model: "gpt2" (포스터/배너 — gpt-image-2는 한글 렌더 가능)
For: 한글 타이포그래피, 공지, 배너
- Large Korean headline in quotes (한글 문구를 정확히 그대로 — gpt-image-2 high는 한글이 깨지지 않는다), bold typography, 2-3 colors
- prompt: 영어 80-150 words (한글 headline 텍스트만 한국어 유지)

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

## ORIENTATION (각 이미지의 방향 — 반드시 지정)
- 마커 1번(썸네일): 항상 "square"
- 본문 photo: 내용에 맞게 — 넓은 장면·공간·풍경·여러 사물 = "landscape" / 인물·세로로 긴 소재(문서·건물·전신) = "portrait"
- satori 유형: "landscape" 고정

## OUTPUT FORMAT
Return ONLY a valid JSON array. Each element:
{"type":"[photo|infographic_data|infographic_flow|checklist|venn|poster]","model":"[gpt2|satori]","orientation":"[square|landscape|portrait]","reason":"[한국어 1문장]","prompt":"[영어 프롬프트 또는 JSON 문자열]"}`;

  const userPrompt = `블로그 제목: "${blogTitle}"
블로그 전체 주제 (첫 300자): ${blogText.substring(0, 300).trim()}${blogStructure ? `\n글 구조: ${blogStructure}` : ''}

마커 목록과 문맥:
${markerContext}

위 ${markers.length}개 마커 각각에 대해 JSON 배열을 출력하세요.`;

  const maxTokens = 2000 + markers.length * 500;
  const raw = await callClaude(systemPrompt, userPrompt, maxTokens);
  const jsonStr = extractJsonArray(raw);
  if (!jsonStr) throw new Error('Haiku marker analysis: no JSON array found');
  const result = JSON.parse(jsonStr);

  if (result.length !== markers.length) {
    throw new Error(`Haiku returned ${result.length} items, expected ${markers.length}`);
  }

  const validTypes = ['photo', 'infographic_data', 'infographic_flow', 'checklist', 'venn', 'poster'];
  const satoriTypes = ['infographic_data', 'infographic_flow', 'checklist', 'venn'];

  function getModel(type) {
    if (satoriTypes.includes(type)) return 'satori';
    return 'gpt2'; // photo·poster 전부 gpt-image-2 (2026-07-07 통일)
  }
  const VALID_ORIENTATIONS = ['square', 'landscape', 'portrait'];

  for (let idx = 0; idx < result.length; idx++) {
    const item = result[idx];
    if (!validTypes.includes(item.type)) item.type = 'photo';
    item.model = getModel(item.type);
    // 방향 보정: 썸네일(1번)=정사각 고정, 나머지는 Haiku 지정값(없거나 이상하면 가로)
    item.orientation = idx === 0 ? 'square'
      : (VALID_ORIENTATIONS.includes(item.orientation) ? item.orientation : 'landscape');

    if (item.model === 'satori') {
      try {
        const parsed = typeof item.prompt === 'string' ? JSON.parse(item.prompt) : item.prompt;
        item.prompt = parsed;
      } catch {
        console.warn(`[IMAGE-PRO] Satori JSON parse failed for marker ${idx + 1}, fallback to photo`);
        item.type = 'photo';
        item.model = 'gpt2';
        if (!item.prompt || typeof item.prompt !== 'string') {
          item.prompt = 'high quality Korean lifestyle blog photography, soft natural lighting, photorealistic, clean composition, no text, no letters, photography style';
        }
      }
    }

    if (!item.prompt) {
      item.prompt = 'high quality Korean lifestyle blog photography, soft natural lighting, photorealistic, clean composition, shallow depth of field, no text, photography style';
      item.type = 'photo';
      item.model = 'gpt2';
    }
  }

  if (result[0].type !== 'photo') {
    result[0].type = 'photo';
    result[0].model = 'gpt2';
    if (typeof result[0].prompt !== 'string' || !result[0].prompt.includes('no text')) {
      result[0].prompt = 'high quality Korean lifestyle blog photography, soft natural lighting, photorealistic, clean composition, shallow depth of field, no text, photography style';
    }
  }

  const targetSatori = Math.min(3, Math.max(0, result.length - 5));
  const currentSatori = result.filter((r, i) => i > 0 && satoriTypes.includes(r.type)).length;

  if (currentSatori > targetSatori) {
    let excess = currentSatori - targetSatori;
    for (let i = result.length - 1; i > 0 && excess > 0; i--) {
      if (satoriTypes.includes(result[i].type)) {
        result[i].type = 'photo';
        result[i].model = 'gpt2';
        result[i].prompt = 'high quality Korean lifestyle blog photography, soft natural lighting, photorealistic, clean composition, no text, no letters, photography style';
        result[i].reason = '배분 보정 → photo';
        excess--;
      }
    }
  } else if (currentSatori < targetSatori) {
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

  console.log(`[IMAGE-PRO] 배분 보정 완료: satori=${result.filter((r) => satoriTypes.includes(r.type)).length}, photo=${result.filter((r) => r.type === 'photo').length}, poster=${result.filter((r) => r.type === 'poster').length}`);

  return result;
}

async function callHaikuSingleMarkerPro(blogText, marker, targetType) {
  const blogSummary = blogText.substring(0, 300).trim();
  const firstLine = blogText.split('\n').find((l) => l.trim()) || '';
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

async function authenticate(request) {
  const isAdmin = await resolveAdmin(request);
  if (isAdmin) return { isAdmin: true, sessionEmail: null };

  const authHeader = request.headers.get('authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) {
    return { error: jsonResponse(request, { error: '로그인이 필요합니다.' }, { status: 401 }) };
  }
  const session = await getRedis().get(`session:${token}`);
  if (!session) {
    return { error: jsonResponse(request, { error: '세션이 만료되었습니다. 다시 로그인해주세요.' }, { status: 401 }) };
  }
  const userData = await getRedis().get(`user:${session.email}`);
  if (!userData) {
    return { error: jsonResponse(request, { error: '회원 정보를 찾을 수 없습니다.' }, { status: 401 }) };
  }
  if (!isCreditsActive() && new Date(userData.createdAt) > new Date(FREE_CUTOFF)) {
    return { error: jsonResponse(request, { error: '4/24까지 가입한 회원만 무료 체험이 가능합니다.' }, { status: 403 }) };
  }
  return { isAdmin: false, sessionEmail: session.email };
}

export async function OPTIONS(request) {
  return handleOptions(request);
}

export async function GET(request) {
  const auth = await authenticate(request);
  if (auth.error) return auth.error;

  if (auth.isAdmin) {
    return jsonResponse(request, { remaining: 999, limit: FREE_DAILY_LIMIT, admin: true, creditsActive: isCreditsActive() });
  }
  try {
    if (isCreditsActive()) {
      const credits = auth.sessionEmail ? await getUserCredits(auth.sessionEmail) : 0;
      return jsonResponse(request, { remaining: credits, creditCost: FULL_COST, creditsActive: true });
    }
    const ip = getClientIp(request);
    const key = getTodayKeyPro(ip);
    const count = Number((await getRedis().get(key)) || 0);
    const remainingCredits = Math.max(DAILY_LIMIT_SCALED - count, 0);
    const remaining = Math.floor(remainingCredits / FULL_COST);
    return jsonResponse(request, { remaining, limit: FREE_DAILY_LIMIT, creditsActive: false });
  } catch {
    return jsonResponse(request, { remaining: FREE_DAILY_LIMIT, limit: FREE_DAILY_LIMIT, creditsActive: isCreditsActive() });
  }
}

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  // ─── suggest_markers 모드: 인증 불필요, 별도 rate limit ───
  if (body?.mode === 'suggest_markers') {
    let smKey = null;
    try {
      const { blogText } = body;
      if (!blogText || blogText.trim().length < 100) {
        return jsonResponse(request, { error: '블로그 글을 100자 이상 입력해주세요.' }, { status: 400 });
      }
      if (blogText.length > 30000) {
        return jsonResponse(request, { error: '블로그 글이 너무 깁니다. 30,000자 이내로 입력해주세요.' }, { status: 400 });
      }

      const isAdmin = await resolveAdmin(request);
      const ip = getClientIp(request);

      if (!isAdmin) {
        smKey = getSuggestMarkersKey(ip);
        const count = await getRedis().incr(smKey);
        await getRedis().expire(smKey, getTTLUntilMidnightKST());
        if (count > 10) {
          try { await getRedis().decr(smKey); } catch (_) {}
          smKey = null;
          return jsonResponse(request, {
            error: '마커 추천 일일 한도(10회)를 초과했습니다. 내일 다시 이용해주세요.',
          }, { status: 429 });
        }
      }

      console.log(`[IMAGE-PRO] Mode: suggest_markers | blogText: ${blogText.length} chars | ip: ${ip}`);

      const markers = await callHaikuSuggestMarkers(blogText);

      console.log(`[IMAGE-PRO] Suggested ${markers.length} markers`);

      return jsonResponse(request, { markers });
    } catch (error) {
      console.error('[IMAGE-PRO] suggest_markers error:', error.message);
      if (smKey) { try { await getRedis().decr(smKey); } catch (_) {} }
      return jsonResponse(request, { error: 'AI 마커 추천에 실패했습니다. 잠시 후 다시 시도해주세요.' }, { status: 500 });
    }
  }

  // ─── 인증 ───
  const auth = await authenticate(request);
  if (auth.error) return auth.error;
  const isAdmin = auth.isAdmin;
  const sessionEmail = auth.sessionEmail;

  // ─── POST: 횟수 제한 / 크레딧 차감 ───
  const reqMode = body?.mode;
  // shortform_quick: 숏폼 Step 5 전용 라이트 모드 — count만큼만 생성, 1 credit/장
  const shortformCount = reqMode === 'shortform_quick'
    ? Math.max(1, Math.min(2, Number(body?.count) || 1))
    : 0;
  const creditCost = reqMode === 'regenerate_single'
    ? SINGLE_REGEN_COST
    : reqMode === 'shortform_quick'
      ? shortformCount // 1 credit/장
      : FULL_COST;
  let remaining = isAdmin ? 999 : FREE_DAILY_LIMIT;
  let rateLimitKey = null;
  let creditCharged = false;

  if (!isAdmin) {
    if (isCreditsActive()) {
      const result = await chargeCredits(sessionEmail, creditCost, reqMode === 'regenerate_single' ? 'image-pro-regen' : 'image-pro');
      if (!result) {
        return jsonResponse(request, {
          error: '크레딧이 부족합니다. 충전 후 이용해주세요.',
          required: creditCost,
          code: 'INSUFFICIENT_CREDITS',
        }, { status: 402 });
      }
      creditCharged = true;
      remaining = result.remaining;
    } else {
      const ip = getClientIp(request);
      rateLimitKey = getTodayKeyPro(ip);
      const newCount = await getRedis().incrby(rateLimitKey, creditCost);
      await getRedis().expire(rateLimitKey, getTTLUntilMidnightKST());

      if (newCount > DAILY_LIMIT_SCALED) {
        await getRedis().decrby(rateLimitKey, creditCost);
        return jsonResponse(request, {
          error: `프리미엄 이미지 일일 무료 크레딧을 모두 사용했습니다. 내일 다시 이용해주세요.`,
          remaining: 0,
        }, { status: 429 });
      }
      remaining = Math.floor(Math.max(DAILY_LIMIT_SCALED - newCount, 0) / FULL_COST);
    }
  }

  try {
    const { mode, is_regenerate } = body;

    // ===== REGENERATE_SINGLE 모드 =====
    if (mode === 'regenerate_single') {
      const { blogText, markerText, originalPrompt, originalType, originalModel } = body;

      if (!markerText && !originalPrompt) {
        if (rateLimitKey) { try { await getRedis().decrby(rateLimitKey, creditCost); } catch (_) {} }
        return jsonResponse(request, { error: '마커 정보 또는 프롬프트가 누락되었습니다.' }, { status: 400 });
      }

      // 구 모델명(fluxr/nb2/gpth)이 와도 generateByModel이 gpt2로 흡수. satori만 satori 유지.
      const targetModel = originalModel === 'satori' ? 'satori' : 'gpt2';
      const targetType = originalType || 'photo';
      const targetOrientation = ['square', 'landscape', 'portrait'].includes(body.orientation) ? body.orientation : 'landscape';
      let finalPrompt;

      if (markerText && blogText) {
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
        finalPrompt = originalPrompt;
      }

      try {
        const url = await generateByModel(targetModel, finalPrompt, targetType, targetOrientation);
        if (!url) throw new Error('No image URL');
        const userId = (sessionEmail || getClientIp(request) || 'anonymous').replace(/[^a-zA-Z0-9]/g, '_');
        const r2Url = await uploadImageUrlToR2(url, `images-pro/${userId}/${getKSTDate()}/${Math.random().toString(36).substring(2, 10)}.png`);
        return jsonResponse(request, {
          mode: 'regenerate_single',
          image: { url, marker: markerText || '', prompt: typeof finalPrompt === 'object' ? JSON.stringify(finalPrompt) : finalPrompt, type: targetType, model: targetModel, r2Url },
          remaining,
          limit: FREE_DAILY_LIMIT,
        });
      } catch (err) {
        console.error(`[IMAGE-PRO] Single regen ${targetModel} error:`, err.message);
        // satori 실패 → 같은 자리 사진(gpt2)으로 1회 폴백. gpt2 실패는 그대로 에러(중복 과금 방지).
        if (targetModel === 'satori') {
          try {
            const fbPrompt = 'high quality Korean lifestyle blog photography, soft natural lighting, editorial style, photorealistic, clean composition, no text, no letters, photography style';
            const url = await generateByModel('gpt2', fbPrompt, 'photo', targetOrientation);
            if (url) {
              const userId = (sessionEmail || getClientIp(request) || 'anonymous').replace(/[^a-zA-Z0-9]/g, '_');
              const r2Url = await uploadImageUrlToR2(url, `images-pro/${userId}/${getKSTDate()}/${Math.random().toString(36).substring(2, 10)}.png`);
              return jsonResponse(request, {
                mode: 'regenerate_single',
                image: { url, marker: markerText || '', prompt: fbPrompt, type: 'photo', model: 'gpt2', r2Url },
                remaining,
                limit: FREE_DAILY_LIMIT,
              });
            }
          } catch (_) {}
        }
        if (rateLimitKey) { try { await getRedis().decrby(rateLimitKey, creditCost); } catch (_) {} }
        return jsonResponse(request, { error: '이미지 재생성에 실패했습니다.' }, { status: 500 });
      }
    }

    // ===== SHORTFORM_QUICK 모드 (숏폼 Step 5 전용) =====
    // - count(1~2)만큼만 생성 — DIRECT 모드의 8장 낭비 제거
    // - 1 credit/장 과금 (위에서 이미 shortformCount로 차감됨)
    // - 생성된 이미지를 user_images 보관함에 자동 등록 (쿼터 초과 시 생성만 반환)
    if (mode === 'shortform_quick') {
      const { topic, mood } = body;
      if (!topic || !topic.trim()) {
        if (rateLimitKey) { try { await getRedis().decrby(rateLimitKey, creditCost); } catch (_) {} }
        if (creditCharged && sessionEmail) {
          await refundCredits(sessionEmail, creditCost, 'shortform-quick-invalid');
        }
        return jsonResponse(request, { error: '주제가 필요합니다.' }, { status: 400 });
      }

      const quickSystem = 'You are an image prompt translator. Convert the Korean topic into a concise English still-life or environment description (1-2 sentences). Describe ONLY inanimate objects, documents, or empty spaces as overhead flat-lay, macro close-up, or vacant environment. Compose for square 1024x1024. Always end with: ", no text, no letters, photography style". Output only the prompt.';
      const englishTopic = await callClaude(quickSystem, topic, 150);
      const moodStyle = moodPrompts[mood] || moodPrompts['bright'];
      const basePrompt = `${englishTopic}, ${moodStyle}, high quality editorial still-life photography, inanimate objects only, uninhabited empty scene, overhead or macro camera angle, clean Korean aesthetic, no text, no letters, photography style`;

      const variationHints = [
        'wide angle composition',
        'close-up detail shot',
      ];

      console.log(`[IMAGE-PRO] Mode: shortform_quick | count: ${shortformCount} | topic: ${topic}`);

      const urls = [];
      for (let i = 0; i < shortformCount; i++) {
        const variedPrompt = `${basePrompt}, ${variationHints[i % variationHints.length]}`;
        try {
          const url = await callGptImage(variedPrompt, 'portrait'); // 숏폼=세로
          if (url) urls.push(url);
        } catch (err) {
          console.error(`[IMAGE-PRO] shortform_quick GPT Image 2 error slot ${i}:`, err?.message || err);
        }
      }

      if (urls.length === 0) {
        if (rateLimitKey) { try { await getRedis().decrby(rateLimitKey, creditCost); } catch (_) {} }
        if (creditCharged && sessionEmail) {
          await refundCredits(sessionEmail, creditCost, 'shortform-quick-all-failed');
        }
        return jsonResponse(request, { error: '이미지 생성에 실패했습니다.' }, { status: 500 });
      }

      // 부분 성공 시 미생성분만큼 크레딧 환불
      if (urls.length < shortformCount && creditCharged && sessionEmail) {
        const refundAmount = shortformCount - urls.length;
        await refundCredits(sessionEmail, refundAmount, 'shortform-quick-partial');
      }

      // 보관함 자동 등록 — 쿼터 초과/에러는 비치명(이미지 자체는 반환)
      const savedImages = [];
      for (const url of urls) {
        try {
          // 쿼터 사전 체크 (대략 400KB 가정)
          const quota = await checkQuota(sessionEmail, 400 * 1024);
          if (!quota.ok) {
            console.warn('[IMAGE-PRO] shortform_quick: user quota exceeded, skipping auto-save');
            savedImages.push({ public_url: url, saved: false, reason: 'quota-exceeded' });
            continue;
          }
          const row = await registerFromUrl({
            email: sessionEmail,
            sourceUrl: url,
            tag: 'shortform-ai',
          });
          savedImages.push({ id: row.id, public_url: row.public_url, thumb_url: row.thumb_url, saved: true });
        } catch (err) {
          console.warn('[IMAGE-PRO] shortform_quick auto-save failed:', err.message);
          savedImages.push({ public_url: url, saved: false, reason: err.message });
        }
      }

      await logUsage(sessionEmail, 'image-pro', 'shortform-quick', getClientIp(request));
      return jsonResponse(request, {
        mode: 'shortform_quick',
        images: savedImages,
        count: savedImages.length,
        credits: creditCost,
      });
    }

    // ===== PARSE 모드 =====
    if (mode === 'parse') {
      const { blogText, thumbnailText } = body;
      const frontMarkers = body.markers;
      if (!blogText) {
        return jsonResponse(request, { error: '블로그 글을 입력해주세요.' }, { status: 400 });
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
        const validMarkers = frontMarkers.filter((m) => m && m.trim()).slice(0, MAX_MARKERS);
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
        return jsonResponse(request, { error: '블로그 글에서 (사진: ...) 또는 (이미지: ...) 마커를 찾을 수 없습니다.' }, { status: 400 });
      }

      console.log(`[IMAGE-PRO] Markers found: ${markers.length}`);

      const markersNotInText = markers.filter((mk) => {
        const escaped = mk.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return !blogText.match(new RegExp(`\\((사진|이미지):\\s*${escaped}`));
      }).length;
      const isSuggestedMarkers = markersNotInText > markers.length / 2;

      if (isSuggestedMarkers) {
        console.log(`[IMAGE-PRO] AI 추천 마커 감지 (${markersNotInText}/${markers.length} not in text) → photo 전용 모드`);
      }

      let analysisResult;

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
          if (TRIGGER_POSTER.test(text)) return { type: 'poster', model: 'gpt2' };
          return { type: 'photo', model: 'gpt2' };
        }

        const routingInfo = markers.map((mk) => ({ ...detectModelFromMarker(mk.text), marker: mk.text }));
        const satoriCount = routingInfo.filter((r) => r.model === 'satori').length;
        const photoCount = routingInfo.filter((r) => r.model === 'gpt2' && r.type === 'photo').length;

        console.log(`[IMAGE-PRO] AI 추천 마커 라우팅: photo=${photoCount}, satori=${satoriCount}, poster=${routingInfo.filter((r) => r.type === 'poster').length}`);

        const firstLine = blogText.split('\n').find((l) => l.trim()) || '';
        const blogTitle = firstLine.trim().substring(0, 80);
        const markerTexts = markers.map((mk) => mk.text);

        const promptInstruction = markerTexts.map((t, i) => {
          const r = routingInfo[i];
          if (r.model === 'gpt2' && r.type === 'photo') return `${i + 1}. ${t} [PHOTO: describe as realistic photography. End with ", photorealistic, clean composition, no text, no letters, photography style"]`;
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
          console.warn('[IMAGE-PRO] AI 추천 마커 번역 실패, 마커별 개별 프롬프트:', translateErr.message);
          analysisResult = markers.map((mk, i) => {
            const r = routingInfo[i];
            const markerText = mk.text.replace(/[^\uAC00-\uD7A3a-zA-Z0-9\s]/g, '').trim();
            let fallbackPrompt;
            if (r.model === 'satori') {
              fallbackPrompt = {
                title: markerText || '정보 요약',
                subtitle: '',
                items: [{ label: markerText, value: '', unit: '' }],
              };
            } else {
              fallbackPrompt = `editorial photography of "${markerText}", high quality Korean lifestyle scene, soft natural lighting, photorealistic, clean composition, variation ${i + 1}, no text, no letters, photography style`;
            }
            return {
              marker: mk.text, type: r.type, model: r.model,
              reason: `AI 추천 마커 → 번역 실패 → 마커 기반 폴백`,
              prompt: fallbackPrompt,
            };
          });
        }
      }

      if (!analysisResult) {
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
          try {
            const firstLine = blogText.split('\n').find((l) => l.trim()) || '';
            const blogTitle = firstLine.trim().substring(0, 80);
            const markerTexts = markers.map((mk) => mk.text);
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
                model: 'gpt2',
                orientation: i === 0 ? 'square' : 'landscape',
                reason: 'Haiku 분석 실패 → 기본 사진 모드',
                prompt,
              }));
            } else {
              throw new Error('Fallback translation returned wrong count');
            }
          } catch (fallbackErr) {
            console.error('[IMAGE-PRO] Fallback also FAILED:', fallbackErr.message);
            return jsonResponse(request, { error: 'AI 이미지 분석에 실패했습니다. 잠시 후 다시 시도해주세요.' }, { status: 500 });
          }
        }
      }

      const orderedItems = markers.map((mk, i) => {
        const found = analysisResult[i] || analysisResult.find((a) => a.marker === mk.text);
        if (!found) {
          return {
            type: 'photo', model: 'gpt2', orientation: i === 0 ? 'square' : 'landscape',
            prompt: 'high quality Korean lifestyle blog photography, soft natural lighting, editorial style, no text, no letters, photography style',
            marker: mk.text, reason: '매핑 실패 → 기본값', originalIndex: i,
          };
        }
        return { ...found, marker: mk.text, originalIndex: i };
      });

      // 어떤 분석 경로(Haiku/AI추천/번역폴백)로 왔든 방향 보정: 1번=정사각(썸네일), 나머지 기본 가로.
      for (let i = 0; i < orderedItems.length; i++) {
        orderedItems[i].orientation = i === 0 ? 'square'
          : (['landscape', 'portrait'].includes(orderedItems[i].orientation) ? orderedItems[i].orientation : 'landscape');
      }

      console.log(`[IMAGE-PRO] Generating ${orderedItems.length} images with gpt-image-2 (batch=4)...`);

      const imageResults = [];
      for (let batchStart = 0; batchStart < orderedItems.length; batchStart += 4) {
        if (batchStart > 0) await new Promise((r) => setTimeout(r, 300));
        const batch = orderedItems.slice(batchStart, batchStart + 4);
        const batchResults = await Promise.all(
          batch.map(async (item) => {
            const modelName = item.model || 'gpt2';
            const modelLabel = { gpt2: 'GPT Image 2', satori: 'Satori 템플릿' }[modelName] || 'GPT Image 2';
            try {
              const url = await generateByModel(modelName, item.prompt, item.type, item.orientation);
              console.log(`[IMAGE-PRO] ✓ "${item.marker}" → ${modelLabel} (${item.type})`);
              return {
                url, marker: item.marker, prompt: typeof item.prompt === 'object' ? JSON.stringify(item.prompt) : item.prompt,
                type: item.type, model: modelName, reason: item.reason,
                originalIndex: item.originalIndex,
              };
            } catch (err) {
              console.error(`[IMAGE-PRO] ✗ "${item.marker}" → ${modelLabel} FAILED:`, err.message);
              await new Promise((r) => setTimeout(r, 1000));
              try {
                // 재시도: satori 실패 → 같은 자리 photo(gpt2)로, gpt2 실패 → 1회 재호출
                const retryPrompt = modelName === 'satori'
                  ? 'high quality Korean lifestyle blog photography, soft natural lighting, editorial style, photorealistic, clean composition, no text, no letters, photography style'
                  : (typeof item.prompt === 'string' ? item.prompt : JSON.stringify(item.prompt));
                const url = await generateByModel('gpt2', retryPrompt, 'photo', item.orientation);
                console.log(`[IMAGE-PRO] ↩ "${item.marker}" retry → GPT Image 2 OK`);
                return {
                  url, marker: item.marker, prompt: retryPrompt,
                  type: 'photo', model: 'gpt2',
                  reason: `${modelLabel} 실패 → GPT Image 2 재시도`,
                  originalIndex: item.originalIndex,
                };
              } catch (retryErr) {
                console.error(`[IMAGE-PRO] ✗ "${item.marker}" retry also FAILED:`, retryErr?.message || retryErr);
              }
              return { url: null, marker: item.marker, type: item.type, model: modelName, originalIndex: item.originalIndex };
            }
          })
        );
        imageResults.push(...batchResults);
      }

      const validImages = imageResults
        .sort((a, b) => a.originalIndex - b.originalIndex)
        .filter((img) => img.url);

      if (validImages.length === 0) {
        return jsonResponse(request, { error: '이미지 생성에 실패했습니다. 잠시 후 다시 시도해주세요.' }, { status: 500 });
      }

      const userId = (sessionEmail || getClientIp(request) || 'anonymous').replace(/[^a-zA-Z0-9]/g, '_');
      const r2Images = await replaceUrlsWithR2(validImages, 'images-pro', userId);

      await logUsage(sessionEmail, 'image-pro', 'parse', getClientIp(request));
      return jsonResponse(request, {
        mode: 'parse',
        images: r2Images,
        thumbnailText: thumbnailText || '',
        remaining,
        limit: FREE_DAILY_LIMIT,
      });
    }

    // ===== DIRECT 모드 =====
    const { topic, mood, thumbnailText } = body;
    if (!topic) {
      return jsonResponse(request, { error: '블로그 주제를 입력해주세요.' }, { status: 400 });
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

    const variationHints = [
      'wide angle composition',
      'close-up detail shot',
      'overhead flat-lay view',
      'side angle perspective',
      'macro extreme close-up',
      'environmental wide shot',
      '45-degree angle composition',
      'soft focus background',
    ];

    async function generateOne(slotIdx) {
      const variedPrompt = `${fullPrompt}, ${variationHints[slotIdx]}`;
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          if (attempt > 1) await new Promise((r) => setTimeout(r, 500));
          const url = await callGptImage(variedPrompt, 'square');
          if (url) return { url, prompt: variedPrompt, type: 'photo', model: 'gpt2' };
        } catch (err) {
          console.error(`[IMAGE-PRO] GPT Image 2 error (direct ${slotIdx} attempt ${attempt}):`, err?.message || err);
        }
      }
      return { url: null, prompt: variedPrompt, type: 'photo', model: 'gpt2' };
    }

    const images = [];
    for (let i = 0; i < DIRECT_IMAGES; i += 4) {
      if (i > 0) await new Promise((r) => setTimeout(r, 300));
      const batchSize = Math.min(4, DIRECT_IMAGES - i);
      const batchResults = await Promise.all(
        Array.from({ length: batchSize }, (_, j) => generateOne(i + j))
      );
      images.push(...batchResults);
    }

    console.log(`[IMAGE-PRO] Direct mode: ${images.filter((img) => img.url).length}/${DIRECT_IMAGES} succeeded`);

    const validImages = images.filter((img) => img.url);
    if (validImages.length === 0) {
      return jsonResponse(request, { error: '이미지 생성에 실패했습니다.' }, { status: 500 });
    }

    const directUserId = (sessionEmail || getClientIp(request) || 'anonymous').replace(/[^a-zA-Z0-9]/g, '_');
    const r2DirectImages = await replaceUrlsWithR2(validImages, 'images-pro', directUserId);

    await logUsage(sessionEmail, 'image-pro', 'direct', getClientIp(request));
    return jsonResponse(request, {
      mode: 'direct',
      images: r2DirectImages,
      thumbnailText: thumbnailText || '',
      remaining,
      limit: FREE_DAILY_LIMIT,
    });
  } catch (error) {
    console.error('[IMAGE-PRO] API Error:', error);
    if (creditCharged && sessionEmail) {
      await refundCredits(sessionEmail, creditCost, 'image-pro-error-refund');
    }
    return jsonResponse(request, { error: '서버 오류가 발생했습니다.' }, { status: 500 });
  }
}
