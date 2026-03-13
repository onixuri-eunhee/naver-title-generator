import { Redis } from '@upstash/redis';

/*
 * 프리미엄 이미지 생성 v2 (비공개 테스트)
 * 자동 모델 라우팅: Haiku가 이미지 유형 판단 → 최적 모델 선택
 *
 * 모델 라우팅:
 *   photo → FLUX.2 pro (fal-ai/flux-2-pro)
 *   infographic_data → GPT Image 1 high (gpt-image-1, quality: high)
 *   infographic_flow → Nano Banana 2 (fal-ai/nano-banana-2)
 *   poster → Nano Banana 2 (fal-ai/nano-banana-2)
 *
 * Canvas API: 썸네일 텍스트 오버레이 (프론트엔드)
 * Haiku: 마커 분석 + 4-type 분류 + 프롬프트 생성
 */

const ADMIN_KEY = '8524';
const MAX_MARKERS = 10;
const DIRECT_IMAGES = 8;

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
  if (!response.ok || data.detail) throw new Error(JSON.stringify(data));
  return data.images?.[0]?.url || null;
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
      size: '1024x1024',
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
  if (!response.ok || data.detail) throw new Error(JSON.stringify(data));
  return data.images?.[0]?.url || null;
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
    return `마커 ${i + 1}: "${mk.text}"${mk.section ? `\n  소속 섹션: "${mk.section}"` : ''}\n  글 위치: ${mk.position}\n  앞 문맥 (200자): "${before}"\n  뒤 문맥 (200자): "${after}"`;
  }).join('\n\n');

  const systemPrompt = `You are a blog image prompt engineer with automatic model routing.
Your job: classify each marker into ONE of 4 types, select the best AI model, and generate the prompt.

## 4 IMAGE TYPES & MODEL ROUTING

### 1. photo → model: "fluxr"
For: 사진, 배경, 풍경, 음식, 인물, 제품, 인테리어, 사물
- The FIRST marker MUST always be "photo" (대표이미지)
- FLUX Realism LoRA for photorealistic results
- Focus on visual composition: describe subjects, lighting, angle, mood
- Use text-free photography styles: "shallow depth of field", "bokeh background", "close-up shot", "macro photography"
- If the scene naturally contains signs/menus/labels, describe them as blurred or abstract
- Always end with: ", photorealistic, clean composition, shallow depth of field, no text, photography style"

### 2. infographic_data → model: "gpth"
**COST GUARD: Only use this type when the marker text or surrounding context contains DATA KEYWORDS:**
통계, 데이터, 데이타, 수치, 확률, 퍼센트, %, 그래프, 차트, KPI, 증감, 추이, 비율, 전년대비
- If none of these keywords appear in the marker or its before/after context → use infographic_flow (nb2) instead
- Data-heavy visuals with numbers, percentages, charts
- GPT Image 1 high excels at structured data visualization

**MANDATORY CHART RULES for infographic_data prompts:**

(A) DATA LABELS — Every data point must have its numeric value directly on the chart:
  - Bar chart: value written inside or at the tip of each bar
  - Pie/donut chart: percentage written inside each segment
  - Line chart: value written above each data point node

(B) AXIS UNITS — Always specify unit labels:
  - Y-axis label must include unit (e.g., "비용(만원)", "비율(%)", "건수(명)")
  - X-axis item names must be complete Korean text
  - Include subtle grid lines for readability

(C) TIGHT COMPOSITION — Minimize white space:
  - Always include "no empty space, all elements tightly composed, chart fills 70% of image area"
  - Chart must dominate the image, not float in empty space

(D) SOURCE FOOTER — Bottom of image must show data source or reference year:
  - e.g., "Source: 한국소비자원 2024" or "기준: 2024년"

(E) COLOR CONTRAST — Emphasize key data:
  - Primary/highlighted items use bold saturated color
  - Secondary items use muted gray tones for contrast
  - Legend placed clearly at right side or bottom of chart

(F) TITLE STRUCTURE — Two-level title:
  - Main title: large bold Korean text
  - Subtitle: reference year, comparison period, or data scope in smaller text

### 3. infographic_flow → model: "nb2"
For: 타임라인, 로드맵, 단계, 흐름도, 프로세스, 한글 텍스트 위주 설명
- Sequential/flow content with Korean text labels
- Nano Banana 2 handles Korean text rendering well

### 4. poster → model: "nb2"
For: 한글 타이포그래피, 공지, 텍스트 위주 포스터, 배너
- Text-heavy Korean poster/banner designs
- Nano Banana 2 handles Korean typography well

## PROMPT RULES (CRITICAL — MUST FOLLOW ALL)

### Rule 1: prompt field MUST be 100% English
- Write the entire prompt in English only
- NO Korean characters (한글) anywhere in the prompt — ABSOLUTE PROHIBITION
- Korean text that needs to appear IN the image must be written in Korean within double quotes inside the English prompt
  Example: A clean infographic showing "월별 매출 추이" as the title, with bar chart...

### Rule 2: Photo type suffix
- For type "photo": ALWAYS append ", no text, no letters, photography style" at the end
- Photo prompts describe inanimate objects, still life, flat-lay, empty environments
- Camera angles: overhead flat-lay, macro close-up, wide-angle empty space, 45-degree tabletop

### Rule 3: Infographic/poster types — include Korean text
- For infographic_data/infographic_flow/poster: include Korean text strings in quotes within the prompt
- Describe the visual layout, structure, colors, and Korean labels
- Do NOT add "no text" suffix — text IS the point
- For infographic_data specifically: MUST follow ALL 6 MANDATORY CHART RULES (A)~(F) above — include data labels, axis units, tight composition, source footer, color contrast, and two-level title structure in the prompt

### Rule 4: Prompt length
- Each prompt: 80-150 English words
- Be specific: describe composition, colors, layout structure, lighting, style

### Rule 5: Context accuracy
- Read the marker text AND surrounding context (before/after) carefully
- The prompt must accurately represent what the marker is about
- Korean/East Asian aesthetic context must be maintained

${isRegenerate ? '\nREGENERATION MODE: Generate MORE SPECIFIC prompts with different compositions and visual approaches.' : ''}

## OUTPUT FORMAT
Return ONLY a valid JSON array. Each element:
{"type":"[photo|infographic_data|infographic_flow|poster]","model":"[fluxr|gpth|nb2]","reason":"[한국어 1문장 — 이 유형과 모델을 선택한 이유]","prompt":"[영어 전용 프롬프트 80-150 words]"}`;

  const userPrompt = `블로그 제목: "${blogTitle}"
블로그 전체 주제 (첫 300자): ${blogSummary}${blogStructure ? `\n글 구조: ${blogStructure}` : ''}

마커 목록과 문맥:
${markerContext}

규칙:
- ${markers.length}개 마커 각각을 4가지 유형 중 하나로 분류
- 첫 번째 마커는 반드시 photo/flux2 (블로그 대표이미지)
- 각 마커의 문맥을 읽고 가장 적합한 유형과 모델을 선택
- prompt는 반드시 영어로만 작성 (한글 텍스트는 따옴표 안에 포함)
- photo 프롬프트 끝에 ", no text, no letters, photography style" 필수
- infographic/poster 프롬프트에는 "no text" 붙이지 말 것`;

  const raw = await callClaude(systemPrompt, userPrompt, 4000);
  const jsonMatch = raw.match(/\[[\s\S]*?\](?=[^[\]]*$)/);
  if (!jsonMatch) throw new Error('Haiku marker analysis: no JSON array found');
  const result = JSON.parse(jsonMatch[0]);

  if (result.length !== markers.length) {
    throw new Error(`Haiku returned ${result.length} items, expected ${markers.length}`);
  }

  // 후처리: 안전장치
  const validTypes = ['photo', 'infographic_data', 'infographic_flow', 'poster'];
  const modelMap = { photo: 'fluxr', infographic_data: 'gpth', infographic_flow: 'nb2', poster: 'nb2' };

  // infographic_data 허용 키워드 (이 키워드가 마커+문맥에 없으면 nb2로 다운그레이드)
  const dataKeywords = /통계|데이터|데이타|수치|확률|퍼센트|%|그래프|차트|KPI|증감|추이|비율|전년대비/;

  for (let idx = 0; idx < result.length; idx++) {
    const item = result[idx];

    // 잘못된 type 보정
    if (!validTypes.includes(item.type)) {
      item.type = 'photo';
    }

    // infographic_data 키워드 검증: 마커 텍스트 + 앞뒤 문맥에 데이터 키워드 없으면 → infographic_flow로 다운그레이드
    if (item.type === 'infographic_data' && idx < markers.length) {
      const mk = markers[idx];
      const searchText = `${mk.text} ${mk.before} ${mk.after}`;
      if (!dataKeywords.test(searchText)) {
        console.log(`[IMAGE-PRO] ↓ "${mk.text}" infographic_data → infographic_flow (데이터 키워드 미검출)`);
        item.type = 'infographic_flow';
      }
    }

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

// ─── 핸들러 ───

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  // 관리자키 검증
  const adminKey = req.query?.key || req.body?.adminKey;
  if (adminKey !== ADMIN_KEY) {
    return res.status(403).json({ error: '접근 권한이 없습니다.' });
  }

  // GET: 상태 확인
  if (req.method === 'GET') {
    return res.status(200).json({ remaining: 999, limit: 999, admin: true });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { mode, is_regenerate } = req.body;

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
        // fallback: 전부 photo/flux2
        try {
          const firstLine = blogText.split('\n').find(l => l.trim()) || '';
          const blogTitle = firstLine.trim().substring(0, 80);
          const markerTexts = markers.map(mk => mk.text);
          const fallbackRaw = await callClaude(
            'You are a Korean-to-English translator for image generation. Translate each Korean image description into a specific, detailed English visual prompt (1-2 sentences). The prompts must describe the EXACT subject mentioned. Always end with: ", no text, no letters, photography style". Output ONLY a JSON array of English prompt strings.',
            `Blog topic: "${blogTitle}"\n\nTranslate these image descriptions:\n${markerTexts.map((t, i) => `${i + 1}. ${t}`).join('\n')}`,
            1500
          );
          const fallbackMatch = fallbackRaw.match(/\[[\s\S]*?\](?=[^[\]]*$)/);
          const fallbackPrompts = fallbackMatch ? JSON.parse(fallbackMatch[0]) : null;
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

      // 모델별 그룹화 후 병렬 생성
      console.log(`[IMAGE-PRO] Generating ${orderedItems.length} images with auto-routing...`);

      const imageResults = await Promise.all(
        orderedItems.map(async (item) => {
          const modelName = item.model || 'flux2';
          const modelLabel = { flux2: 'FLUX.2 pro', gpth: 'GPT Image high', nb2: 'Nano Banana 2' }[modelName] || modelName;
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
            // fallback: FLUX Realism으로 재시도
            if (modelName !== 'fluxr') {
              try {
                const fallbackPrompt = item.prompt.replace(/\s*,?\s*no text,?\s*no letters,?\s*photography style\s*$/i, '') +
                  ', no text, no letters, photography style';
                const url = await callFluxRealism(fallbackPrompt);
                console.log(`[IMAGE-PRO] ↩ "${item.marker}" fallback to FLUX Realism`);
                return {
                  url, marker: item.marker, prompt: fallbackPrompt,
                  type: 'photo', model: 'fluxr', reason: `${modelLabel} 실패 → FLUX Realism 대체`,
                  originalIndex: item.originalIndex,
                };
              } catch (fallbackErr) {
                console.error(`[IMAGE-PRO] ✗ "${item.marker}" FLUX Realism fallback also FAILED`);
              }
            }
            return { url: null, marker: item.marker, type: item.type, model: modelName, originalIndex: item.originalIndex };
          }
        })
      );

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
        remaining: 999,
        limit: 999,
      });
    }

    // ===== DIRECT 모드: 주제+분위기 → 8장 (FLUX.2 pro) =====
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

    // 8장 FLUX Realism 생성 (2장씩 배치)
    const images = [];
    for (let i = 0; i < DIRECT_IMAGES; i += 2) {
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
      remaining: 999,
      limit: 999,
    });

  } catch (error) {
    console.error('[IMAGE-PRO] API Error:', error);
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
}
