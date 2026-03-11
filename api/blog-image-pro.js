import { Redis } from '@upstash/redis';

/*
 * 프리미엄 이미지 생성 (비공개 테스트)
 * GPT Image 1 medium (사진) + Satori (인포그래픽): 혼합 파이프라인
 * Canvas API: 썸네일 텍스트 오버레이 (프론트엔드)
 * Haiku: 마커 분석 + photo/infographic 분류 + 프롬프트/데이터 생성
 *
 * 기존 blog-image.js와 동일한 구조, FLUX → GPT Image 1 교체
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

async function callGptImage(prompt) {
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
      quality: 'medium',
      output_format: 'webp',
    }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(JSON.stringify(data));
  const b64 = data.data?.[0]?.b64_json;
  if (!b64) return null;
  return `data:image/webp;base64,${b64}`;
}

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

  const systemPrompt = `You are a blog image prompt engineer. Your CRITICAL job is classifying each marker as either "photo" or "infographic", then generating appropriate data.

## CLASSIFICATION RULES
Each marker must be classified as one of:
- **photo**: Real photograph — for scenes, products, OBJECTS, places, documents, environments
- **infographic**: Data visualization — for comparisons, lists, steps/procedures, statistics/numbers, graphs, ranges, explanations

Rules:
- The FIRST marker MUST always be "photo" (대표이미지)
- Maximum 4 infographic markers. Choose the best candidates based on data-heavy content.
- Infographic keywords: 비교, 순위, 단계, 수치, 그래프, 조건, 범위, 연계, 인상, 안정성, 지급조건
- When the marker describes data, conditions, comparisons, or processes → infographic
- When the marker describes a scene, object, or environment → photo

## PHOTO MARKERS — MANDATORY COMPOSITION RULES
Generate purely visual English prompts for GPT Image model. Every prompt MUST follow ALL of these rules:

### SUBJECT RULE: Inanimate objects and environments ONLY
- Every image depicts ONLY inanimate objects, documents, tools, products, furniture, architecture, nature, or empty spaces
- Frame every scene as a STILL LIFE, FLAT-LAY, PRODUCT SHOT, or EMPTY ENVIRONMENT
- The scene is always UNINHABITED — show the space as if photographed before or after hours, with zero living beings present

### CAMERA ANGLE RULE: Use angles that exclude human presence
- DEFAULT: overhead flat-lay (top-down 90-degree bird's-eye view looking straight down at objects on a surface)
- ALTERNATIVE 1: extreme close-up macro (fills frame with object texture/detail)
- ALTERNATIVE 2: wide-angle empty environment (hallway, room, exterior — shot at dawn/dusk when space is vacant)
- ALTERNATIVE 3: 45-degree tabletop product photography (objects arranged on surface, camera angled down)

### DOCUMENT/PAPER RULE: All papers shown as abstract visual elements
- Documents, forms, papers, receipts appear as STACKED, FANNED, or FOLDED arrangements — shot from overhead so content is a soft blur
- Describe paper surfaces with: "soft-focus printed patterns", "abstract paragraph shapes", "blurred ink impressions"
- Screens (laptop, phone, tablet) show SOLID COLOR GRADIENTS or are turned off with reflective dark glass

### PROMPT STRUCTURE (follow this exact order)
1. SUBJECT: name the specific objects/items (e.g., "insurance policy folder, calculator, ballpoint pen, reading glasses")
2. ARRANGEMENT: how objects are positioned (e.g., "arranged in a diagonal flat-lay on a white marble surface")
3. CAMERA: angle and lens (e.g., "shot from directly overhead, 50mm lens, shallow depth of field")
4. LIGHTING: specific light description (e.g., "soft diffused window light from upper left, gentle shadows")
5. STYLE: "editorial still-life photography, clean Korean aesthetic"
6. ALWAYS END WITH: "inanimate objects only, empty scene, all surfaces show abstract blurred patterns"

### TOPIC TRANSLATION EXAMPLES
- 보험상담 → "insurance policy documents, premium calculator, wooden stamp, ballpoint pen arranged on oak desk, overhead flat-lay, soft window light, editorial still-life"
- 암 진단비 → "medical diagnostic form with blurred printed lines, prescription bottle, stethoscope on clean white surface, extreme close-up macro shot, clinical lighting"
- 치료비 영수증 → "stack of fanned receipt papers with indistinct printed text, wooden clipboard, coins scattered nearby, overhead flat-lay on linen cloth, warm ambient light"
- 음식 리뷰 → "ceramic bowl of bibimbap with steel chopsticks resting on bamboo mat, extreme close-up overhead, steam rising, warm restaurant lighting"

Korean or East Asian context must be maintained. Compose for 1024x1024 square format.
${isRegenerate ? 'REGENERATION MODE: Generate MORE SPECIFIC prompts with different arrangements and angles.' : ''}

## INFOGRAPHIC MARKERS
Generate structured Korean data for Satori renderer. Choose one layout:

1. **comparison**: A vs B 비교표
   Required: "columns": ["A이름", "B이름"], "items": [{"label": "항목명", "values": ["A값", "B값"]}]
   items: 3~6개

2. **list**: 목록/순위/체크리스트
   Required: "items": [{"icon": "이모지", "text": "항목 내용"}]
   items: 4~8개

3. **steps**: 단계/절차/과정
   Required: "items": [{"step": "1", "title": "단계명", "desc": "설명(선택)"}]
   items: 3~5개

4. **stats**: 수치/통계/퍼센트
   Required: "items": [{"number": "85%", "label": "항목명", "sub": "부가설명(선택)"}]
   items: 2~4개

All infographic text MUST be in Korean. Title must be concise (15자 이내).

## Output Format
Return ONLY a valid JSON array:
[
  {"marker": "마커텍스트", "type": "photo", "prompt": "English prompt..."},
  {"marker": "마커텍스트", "type": "infographic", "layout": "comparison", "title": "비교 제목", "columns": ["A","B"], "items": [{"label":"항목","values":["값1","값2"]}]}
]`;

  const userPrompt = `블로그 제목: "${blogTitle}"
블로그 전체 주제 (첫 300자): ${blogSummary}${blogStructure ? `\n글 구조: ${blogStructure}` : ''}

마커 목록과 문맥:
${markerContext}

규칙:
- 8개 마커 각각을 photo 또는 infographic으로 분류
- 첫 번째 마커는 반드시 photo (블로그 대표이미지)
- infographic은 최대 4개까지 (데이터/비교/그래프/조건 마커는 적극적으로 infographic 분류)
- photo 프롬프트: 사물/문서/환경만 묘사. overhead flat-lay 또는 macro close-up 앵글 사용
- photo 프롬프트는 반드시 블로그 주제("${blogTitle}")와 직접 관련
- infographic 데이터는 반드시 한국어로`;

  const raw = await callClaude(systemPrompt, userPrompt, 4000);
  const jsonMatch = raw.match(/\[[\s\S]*?\](?=[^[\]]*$)/);
  if (!jsonMatch) throw new Error('Haiku marker analysis: no JSON array found');
  const result = JSON.parse(jsonMatch[0]);

  if (result.length !== markers.length) {
    throw new Error(`Haiku returned ${result.length} items, expected ${markers.length}`);
  }

  // 첫 마커가 infographic이면 photo로 강제 변환
  if (result[0].type === 'infographic') {
    result[0].type = 'photo';
    if (!result[0].prompt) {
      result[0].prompt = 'high quality Korean lifestyle blog photography, soft natural lighting, editorial style';
    }
  }

  // infographic 5개 이상이면 photo로 변환
  let infographicCount = 0;
  for (const item of result) {
    if (item.type === 'infographic') {
      infographicCount++;
      if (infographicCount > 4) {
        item.type = 'photo';
        if (!item.prompt) {
          item.prompt = 'high quality Korean lifestyle blog photography, soft natural lighting, editorial style';
        }
      }
    }
  }

  // infographic에 필수 필드 누락 시 photo로 fallback
  for (const item of result) {
    if (item.type === 'infographic') {
      if (!item.layout || !item.title || !item.items || !Array.isArray(item.items) || item.items.length === 0) {
        item.type = 'photo';
        if (!item.prompt) {
          item.prompt = 'high quality Korean lifestyle blog photography, soft natural lighting, editorial style';
        }
      }
    }
  }

  return result;
}

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

    // ===== PARSE 모드: 블로그 글에서 마커 파싱 → GPT Image =====
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

      // 마커가 정확히 8개가 아닌 경우: GPT Image 전용
      if (markers.length !== 8) {
        const firstLine = blogText.split('\n').find(l => l.trim()) || '';
        const blogTitle = firstLine.trim().substring(0, 80);
        const blogSummary = blogText.substring(0, 300).trim();
        const headings = blogText.match(/【\d+\.?】[^\n]*/g) || [];
        const blogStructure = headings.map(h => h.trim()).join(' | ');
        const allMarkerNames = markers.map(mk => mk.text);

        const markersList = markers.map((mk, i) => {
          let entry = `Image ${i + 1} of ${markers.length}:\n  Marker: "${mk.text}"`;
          if (mk.altText) entry += `\n  Alt text: "${mk.altText}"`;
          if (mk.section) entry += `\n  Section: "${mk.section}"`;
          entry += `\n  Position in article: ${mk.position}`;
          entry += `\n  Before (400 chars): "${mk.before}"`;
          entry += `\n  After (400 chars): "${mk.after}"`;
          return entry;
        }).join('\n\n');

        const claudeSystem = `You are a blog image prompt engineer. Your CRITICAL job is generating prompts that PRECISELY match each marker's topic and surrounding context.
${is_regenerate
  ? `This is a REGENERATION request — generate MORE SPECIFIC and MORE CONTEXTUALLY ACCURATE prompts.
Describe exact subject, materials, colors, composition, props. Try different angles and compositions.`
  : `Your #1 priority is generating images that show the EXACT subject described in each marker and its context.
Read the before/after text carefully to understand what specific item, product, or scene is being discussed.`}

## MANDATORY COMPOSITION RULES
- Every image is a STILL LIFE, FLAT-LAY, PRODUCT SHOT, or EMPTY ENVIRONMENT — inanimate objects and vacant spaces only
- Camera: overhead flat-lay (90-degree bird's-eye), extreme close-up macro, or wide-angle empty space
- Documents/papers: describe as stacked/fanned arrangements showing soft-focus abstract printed patterns
- Screens: dark reflective glass or solid color gradients
- Generate English-only prompts for GPT Image model. All marker text is Korean — translate to PRECISE English visual descriptions.
- Every prompt MUST directly depict the subject of the blog and marker.
- Compose for 1024x1024 square format.
- Be hyper-specific: describe exact materials, textures, colors, arrangement, and lighting.

## Topic-specific framing
- Insurance/finance: overhead flat-lay of policy folder, calculator, stamp, pen on wooden desk surface
- Medical/health: macro close-up of medicine bottles, stethoscope draped over clipboard, empty corridor at dawn
- Consultation: overhead shot of desk surface with laptop (screen showing color gradient), documents, coffee cup
- Food/restaurant: extreme close-up overhead of plated dish, chopsticks, ceramic bowls
- Beauty/skincare: flat-lay of product bottles, tools, ingredients on marble surface

## Output
Return ONLY a valid JSON array of English prompt strings.`;

        const claudeUser = `Blog title: "${blogTitle}"
Blog summary (300 chars): "${blogSummary}"${blogStructure ? `\nArticle structure: "${blogStructure}"` : ''}

All image markers in order: ${JSON.stringify(allMarkerNames)}

---
${markersList}`;

        let prompts;
        try {
          const claudeRaw = await callClaude(claudeSystem, claudeUser, 2000);
          const jsonMatch = claudeRaw.match(/\[[\s\S]*?\](?=[^[\]]*$)/);
          prompts = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
        } catch (err) {
          console.error('[IMAGE-PRO] Claude parse error:', err);
          prompts = null;
        }

        if (!prompts || prompts.length !== markers.length) {
          prompts = markers.map(() => `high quality Korean lifestyle blog photography, soft natural lighting, editorial style`);
        }

        prompts = prompts.map(p => `${p}, high quality editorial still-life photography, square 1024x1024 composition, inanimate objects only, uninhabited empty scene, overhead or macro camera angle, all visible surfaces and papers show soft-focus abstract patterns with indistinct marks, clean Korean aesthetic`);

        // GPT Image 병렬 생성 (2장씩 배치)
        const images = [];
        for (let i = 0; i < prompts.length; i += 2) {
          const batch = prompts.slice(i, i + 2);
          const batchResults = await Promise.all(
            batch.map(async (prompt, j) => {
              const markerIndex = i + j;
              try {
                const url = await callGptImage(prompt);
                return { url, marker: markers[markerIndex].text, prompt, type: 'photo' };
              } catch (err) {
                console.error(`[IMAGE-PRO] GPT Image error for marker ${markerIndex}:`, err);
                return { url: null, marker: markers[markerIndex].text, prompt, type: 'photo' };
              }
            })
          );
          images.push(...batchResults);
        }

        const validImages = images.filter(img => img.url);
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

      // ===== 마커 8개: photo/infographic 혼합 파이프라인 =====
      let analysisResult;
      try {
        analysisResult = await callHaikuMarkerAnalysis(blogText, markers, is_regenerate);
        const photoCount = analysisResult.filter(r => r.type === 'photo').length;
        const infraCount = analysisResult.filter(r => r.type === 'infographic').length;
        console.log(`[IMAGE-PRO] Haiku analysis - photo:${photoCount} infographic:${infraCount}`);
      } catch (err) {
        console.error('[IMAGE-PRO] Haiku marker analysis FAILED:', err.message);
        // fallback: 전부 photo
        try {
          const firstLine = blogText.split('\n').find(l => l.trim()) || '';
          const blogTitle = firstLine.trim().substring(0, 80);
          const markerTexts = markers.map(mk => mk.text);
          const fallbackRaw = await callClaude(
            'You are a Korean-to-English translator for image generation. Translate each Korean image description into a specific, detailed English visual prompt (1-2 sentences). The prompts must describe the EXACT subject mentioned. No text/writing/signs in images. Output ONLY a JSON array of English prompt strings.',
            `Blog topic: "${blogTitle}"\n\nTranslate these image descriptions:\n${markerTexts.map((t, i) => `${i + 1}. ${t}`).join('\n')}`,
            1500
          );
          const fallbackMatch = fallbackRaw.match(/\[[\s\S]*?\](?=[^[\]]*$)/);
          const fallbackPrompts = fallbackMatch ? JSON.parse(fallbackMatch[0]) : null;
          if (fallbackPrompts && fallbackPrompts.length === markers.length) {
            analysisResult = fallbackPrompts.map((prompt, i) => ({
              marker: markers[i].text,
              type: 'photo',
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
        const found = analysisResult.find(a => a.marker === mk.text) || analysisResult[i];
        if (!found) {
          return { type: 'photo', prompt: 'high quality Korean lifestyle blog photography, soft natural lighting, editorial style', marker: mk.text, originalIndex: i };
        }
        return { ...found, marker: mk.text, originalIndex: i };
      });

      const photoItems = orderedItems.filter(item => item.type !== 'infographic');
      const infographicItems = orderedItems.filter(item => item.type === 'infographic');

      console.log(`[IMAGE-PRO] Pipeline: ${photoItems.length} photos (GPT Image) + ${infographicItems.length} infographics (Satori)`);

      // 병렬 실행: GPT Image(photo) + Satori(infographic)
      const [photoResults, infographicResults] = await Promise.all([
        // GPT Image 배치 처리 (2장씩)
        (async () => {
          const results = [];
          for (let i = 0; i < photoItems.length; i += 2) {
            const batch = photoItems.slice(i, i + 2);
            const batchResults = await Promise.all(
              batch.map(async (item) => {
                const prompt = item.prompt || 'high quality Korean lifestyle blog photography, soft natural lighting, editorial style';
                const fullPrompt = `${prompt}, high quality editorial still-life photography, square 1024x1024 composition, inanimate objects only, uninhabited empty scene, overhead or macro camera angle, all visible surfaces and papers show soft-focus abstract patterns with indistinct marks, clean Korean aesthetic`;
                try {
                  const url = await callGptImage(fullPrompt);
                  return { url, marker: item.marker, prompt: fullPrompt, type: 'photo', originalIndex: item.originalIndex };
                } catch (err) {
                  console.error(`[IMAGE-PRO] GPT Image error for "${item.marker}":`, err);
                  return { url: null, marker: item.marker, prompt: fullPrompt, type: 'photo', originalIndex: item.originalIndex };
                }
              })
            );
            results.push(...batchResults);
          }
          return results;
        })(),

        // Satori 인포그래픽 (기존과 동일)
        Promise.all(
          infographicItems.map(async (item) => {
            try {
              const { renderInfographic } = await import('./infographic-renderer.js');
              const dataUrl = await renderInfographic(item);
              console.log(`[IMAGE-PRO] Infographic rendered: "${item.marker}" layout=${item.layout}`);
              return { url: dataUrl, marker: item.marker, type: 'infographic', layout: item.layout, originalIndex: item.originalIndex };
            } catch (err) {
              console.error(`[IMAGE-PRO] Satori error for "${item.marker}":`, err.message);
              // Fallback: GPT Image로 사진 생성
              try {
                const fallbackPrompt = `high quality editorial still-life of objects related to ${item.title || item.marker}, overhead flat-lay on clean surface, soft natural lighting, inanimate objects only, uninhabited empty scene, all visible surfaces show soft-focus abstract patterns, clean Korean aesthetic`;
                const url = await callGptImage(fallbackPrompt);
                return { url, marker: item.marker, prompt: fallbackPrompt, type: 'photo', originalIndex: item.originalIndex };
              } catch (gptErr) {
                console.error(`[IMAGE-PRO] GPT Image fallback also failed for "${item.marker}":`, gptErr);
                return { url: null, marker: item.marker, type: 'photo', originalIndex: item.originalIndex };
              }
            }
          })
        ),
      ]);

      const allResults = [...photoResults, ...infographicResults]
        .sort((a, b) => a.originalIndex - b.originalIndex);

      const validImages = allResults.filter(img => img.url);
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

    // ===== DIRECT 모드: 주제+분위기 → 8장 (GPT Image) =====
    const { topic, mood, thumbnailText } = req.body;
    if (!topic) {
      return res.status(400).json({ error: '블로그 주제를 입력해주세요.' });
    }

    const directSystem = is_regenerate
      ? 'You are an image prompt translator. This is a REGENERATION request. Convert the Korean blog topic into a rich, detailed English still-life or environment description (2-3 sentences). Describe ONLY inanimate objects, products, documents, tools, or empty spaces — frame as overhead flat-lay, macro close-up, or vacant environment. Name specific materials, colors, textures, arrangement. Camera: overhead bird-eye or extreme macro. Documents/papers: describe as showing soft-focus abstract printed patterns. Screens: dark reflective glass or solid color gradient. Compose for square 1024x1024. Output only the prompt.'
      : 'You are an image prompt translator. Convert the Korean blog topic into a concise English still-life or environment description (1-2 sentences). Describe ONLY inanimate objects, documents, or empty spaces as overhead flat-lay, macro close-up, or vacant environment. Documents show soft-focus abstract patterns. Compose for square 1024x1024. Output only the prompt.';
    const englishTopic = await callClaude(
      directSystem,
      topic,
      is_regenerate ? 300 : 150
    );

    console.log('[IMAGE-PRO] Direct mode - topic:', topic, '→ prompt:', englishTopic.substring(0, 100));
    const moodStyle = moodPrompts[mood] || moodPrompts['bright'];
    const fullPrompt = `${englishTopic}, ${moodStyle}, high quality editorial still-life photography, inanimate objects only, uninhabited empty scene, overhead or macro camera angle, all visible surfaces and papers show soft-focus abstract patterns with indistinct marks, clean Korean aesthetic`;

    // 8장 GPT Image 생성 (2장씩 배치)
    const images = [];
    for (let i = 0; i < DIRECT_IMAGES; i += 2) {
      const batchSize = Math.min(2, DIRECT_IMAGES - i);
      const batchResults = await Promise.all(
        Array.from({ length: batchSize }, async (_, j) => {
          try {
            const url = await callGptImage(fullPrompt);
            return { url, prompt: fullPrompt };
          } catch (err) {
            console.error(`[IMAGE-PRO] GPT Image error (direct ${i + j}):`, err);
            return { url: null, prompt: fullPrompt };
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
