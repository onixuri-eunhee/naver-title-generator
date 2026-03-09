import { Redis } from '@upstash/redis';

/*
 * 원가 구조 (1크레딧 기준)
 * Haiku API 8회 호출: 56원
 * fal.ai FLUX Schnell 8장: 36원
 * 총 원가: 92원
 *
 * 판매가: 330원 (9,900원 ÷ 30크레딧)
 * 마진: 238원 (72%)
 *
 * 충전 플랜
 * 30크레딧  = 9,900원  (크레딧당 330원)
 * 100크레딧 = 29,900원 (크레딧당 299원, 9% 할인)
 * 200크레딧 = 49,900원 (크레딧당 250원, 24% 할인)
 *
 * 1크레딧 = 이미지 8장 생성
 * 재생성: 1크레딧 (강화된 프롬프트로 8장 전체 재생성)
 * 개별 재생성: 없음
 */

const FREE_DAILY_LIMIT = 3;
const TOTAL_IMAGES = 8;         // 1크레딧당 생성 이미지 수 (고정)
const IMAGE_SIZE = 'square_hd'; // 1024×1024 (고정)

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

function getTodayKey(ip) {
  return `ratelimit:blogimage:${ip}:${getKSTDate()}`;
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

async function callFlux(prompt) {
  const response = await fetch('https://fal.run/fal-ai/flux/schnell', {
    method: 'POST',
    headers: {
      Authorization: `Key ${process.env.FAL_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      prompt,
      image_size: IMAGE_SIZE,
      num_images: 1,
      num_inference_steps: 4,
    }),
  });
  const data = await response.json();
  if (!response.ok || data.detail) throw new Error(JSON.stringify(data));
  return data.images?.[0]?.url || null;
}

async function callFluxBatch(prompt, count) {
  const images = [];
  const batches = count <= 4 ? [count] : [4, count - 4];
  for (const batchSize of batches) {
    const response = await fetch('https://fal.run/fal-ai/flux/schnell', {
      method: 'POST',
      headers: {
        Authorization: `Key ${process.env.FAL_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt,
        image_size: IMAGE_SIZE,
        num_images: batchSize,
        num_inference_steps: 4,
      }),
    });
    const data = await response.json();
    if (!response.ok || data.detail) {
      if (images.length === 0) throw new Error(JSON.stringify(data));
      break;
    }
    if (data.images) {
      for (const img of data.images) images.push(img.url);
    }
  }
  return images;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  // GET: 남은 크레딧 조회
  if (req.method === 'GET') {
    try {
      const ip = getClientIp(req);
      const whitelisted = await getRedis().get(`admin:whitelist:${ip}`);
      if (whitelisted) {
        return res.status(200).json({ remaining: 999, limit: FREE_DAILY_LIMIT, admin: true });
      }
      if (FREE_DAILY_LIMIT <= 0) {
        return res.status(200).json({ remaining: 0, limit: 0 });
      }
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

  try {
    const { mode, is_regenerate } = req.body;

    // Rate limit (화이트리스트 IP 스킵)
    const ip = getClientIp(req);
    const whitelisted = await getRedis().get(`admin:whitelist:${ip}`);

    if (!whitelisted && FREE_DAILY_LIMIT <= 0) {
      return res.status(429).json({ error: '현재 무료 사용이 제한되어 있습니다.', remaining: 0 });
    }

    let remaining = whitelisted ? 999 : FREE_DAILY_LIMIT;
    let rateLimitKey = null;

    if (!whitelisted && FREE_DAILY_LIMIT > 0) {
      rateLimitKey = getTodayKey(ip);
      const newCount = await getRedis().incr(rateLimitKey);
      await getRedis().expire(rateLimitKey, getTTLUntilMidnightKST());

      if (newCount > FREE_DAILY_LIMIT) {
        await getRedis().decr(rateLimitKey);
        return res.status(429).json({
          error: `일일 무료 사용 한도(${FREE_DAILY_LIMIT}크레딧)를 초과했습니다. 내일 다시 이용해주세요.`,
          remaining: 0,
        });
      }
      remaining = FREE_DAILY_LIMIT - newCount;
    }

    // ===== PARSE 모드: 블로그 글에서 마커 파싱 =====
    if (mode === 'parse') {
      const { blogText, thumbnailText } = req.body;
      if (!blogText) {
        if (rateLimitKey) try { await getRedis().decr(rateLimitKey); } catch (_) {}
        return res.status(400).json({ error: '블로그 글을 입력해주세요.' });
      }

      // 마커 추출 (사진/이미지 형식 모두 지원)
      const markerRegex = /\((사진|이미지):\s*([^)]+)\)/g;
      const markers = [];
      let m;
      const totalLen = blogText.length;

      // 소제목 추출
      const headings = blogText.match(/【\d+\.?】[^\n]*/g) || [];
      const blogStructure = headings.map(h => h.trim()).join(' | ');

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
        const cleanContext = (str) => str
          .replace(/\((사진|이미지):\s*[^)]+\)/g, '')
          .replace(/#\S+/g, '')
          .replace(/【\d+\.?】/g, '')
          .replace(/\s{2,}/g, ' ')
          .trim();
        const before = cleanContext(rawBefore);
        const after = cleanContext(rawAfter);

        const positionRatio = pos / totalLen;
        const position = positionRatio < 0.25 ? 'early' : positionRatio < 0.75 ? 'middle' : 'ending';

        const textBeforeMarker = blogText.substring(0, pos);
        const sectionMatches = [...textBeforeMarker.matchAll(/【\d+\.?】[^\n]*/g)];
        const section = sectionMatches.length > 0
          ? sectionMatches[sectionMatches.length - 1][0].trim()
          : '';

        markers.push({ text, altText, before, after, position, section });
      }

      if (markers.length === 0) {
        if (rateLimitKey) try { await getRedis().decr(rateLimitKey); } catch (_) {}
        return res.status(400).json({ error: '블로그 글에서 (사진: ...) 또는 (이미지: ...) 마커를 찾을 수 없습니다. 블로그 글 생성기에서 작성한 글을 붙여넣어주세요.' });
      }

      const firstLine = blogText.split('\n').find(l => l.trim()) || '';
      const blogTitle = firstLine.trim().substring(0, 80);
      const blogSummary = blogText.substring(0, 300).trim();
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

      // 시스템 프롬프트: 일반 vs 재생성(강화)
      const claudeSystem = `${is_regenerate
        ? `You are a blog image prompt engineer for Korean lifestyle blogs.
This is a REGENERATION request — the user was not satisfied with the previous images.
You must generate MORE SPECIFIC and MORE CONTEXTUALLY ACCURATE prompts than before.
- Describe exact location, lighting, colors, composition, props
- Be extremely specific about the scene (not just 'cafe' but 'modern minimalist Seoul cafe interior with marble countertop, pour-over coffee equipment, soft morning light through large windows')
- Reference the surrounding blog text as much as possible
- No generic stock photo style. No people's faces.`
        : `You are a blog image prompt engineer for Korean lifestyle blogs.
Your #1 priority is generating images that match the exact context of the blog content.
Use the surrounding text to understand what specific scene, object, or situation is being described.
No generic images. No people's faces.`}

## Your Task
Generate English image prompts for FLUX Schnell model based on blog context.

## Context Understanding Rules
1. Read the blog title and summary to understand the overall topic and tone.
2. Read before/after text carefully to identify the SPECIFIC scene, object, or situation being described at that exact point.
3. Consider the image's position in the article flow — use the matching camera style:
   - early: wide establishing shot from entrance or doorway, showing the overall environment and space, eye-level or slightly elevated angle, deep depth of field to capture the full scene
   - middle: close-up or macro detail shot, showing a specific object, texture, or food, shallow depth of field, 45-degree overhead or straight-on angle, emphasis on tactile details
   - ending: atmospheric mood shot with soft focus, warm golden tones, low angle or slightly blurred background, conveying satisfaction, relaxation, or a sense of conclusion
4. Each image must be visually distinct from others in the same article.

## Korean Cultural Context Translation
When converting Korean marker text to English prompts, translate the cultural context into SPECIFIC visual details that FLUX can render:
- Korean food: include specific tableware (stainless steel chopsticks, small banchan dishes, stone pot), restaurant setting details (wooden tables, soju glasses, Korean menu boards as blurred background)
- Korean cafe: bright minimalist interior, white/wood tones, dried flowers, Hangul signage as blurred background element, latte art in ceramic cup
- Korean fitness/pilates: bright studio with light wood floor, reformer machine, mirror wall, Korean woman's hands or back view in activewear
- Korean beauty/skincare: glass-skin texture close-up, cushion compact, sheet mask packaging, vanity with LED mirror, Korean cosmetic bottles
- Korean street/neighborhood: narrow alley with potted plants, small Korean shops with awnings, warm street lighting, traditional and modern mixed architecture
- Korean home interior: compact apartment, warm ondol floor, minimalist furniture, natural light from large window, indoor plants

## Prompt Structure (follow this template for each prompt)
"[Subject/Scene from context], [specific details from surrounding text], [setting/environment with Korean cultural details], [lighting/mood], [camera angle matching position], clean Korean lifestyle blog photography style"

## Mandatory Rules
- Korean/East Asian context: Korean interiors, Korean food, Korean street scenes, Korean products.
- When people appear: specify "Korean person" with only back view, hands, or silhouette — NEVER faces.
- NEVER include any text, typography, letters, signs, labels, captions, or written words.
- Be hyper-specific: NOT "a cafe interior" but "a small Korean cafe with warm wood tables, brass pendant lights, and dried flower arrangements on a sunny afternoon, shot from the entrance looking in"
- Style consistency: warm natural lighting, shallow depth of field, editorial lifestyle photography feel.

## Examples

### Example 1 (food blog, middle position)
Input:
  Marker: "봉골레 파스타 이미지 추천"
  Position: middle
  Before: "...마늘 향이 확 올라오는 순간 '아 여기다' 싶었어요. 바지락이 통통하고..."
Output:
  "A steaming bowl of vongole pasta with plump clams on a warm wooden table in a small Korean restaurant, garlic oil glistening on al dente spaghetti, brass chopstick rest beside the plate, soft warm pendant lighting from above, close-up shot at 45-degree angle, shallow depth of field, Korean food photography style"

### Example 2 (fitness blog, early position)
Input:
  Marker: "리포머 기구 운동 이미지 추천"
  Position: early
  Before: "처음 필라테스 스튜디오에 들어갔을 때 넓은 공간이 인상적이었어요..."
Output:
  "A bright Korean Pilates studio interior with rows of reformer machines on light maple wood floor, large mirrors along the wall reflecting natural sunlight from floor-to-ceiling windows, clean white walls, wide establishing shot from the entrance doorway, deep depth of field, airy and inviting atmosphere"

### Example 3 (beauty blog, ending position)
Input:
  Marker: "스킨케어 루틴 마무리 이미지 추천"
  Position: ending
  Before: "...이렇게 2주 동안 꾸준히 했더니 피부결이 확실히 달라졌어요..."
Output:
  "A Korean vanity shelf with neatly arranged skincare bottles and a jade roller, soft morning light streaming through sheer curtains, dewy glass-skin reflection visible on a small round mirror, warm golden tones, atmospheric mood shot with gentle bokeh, sense of calm completion"

## Output
Return ONLY a valid JSON array of prompt strings. No explanation.`;

      const claudeUser = `Blog title: "${blogTitle}"
Blog summary (300 chars): "${blogSummary}"${blogStructure ? `\nArticle structure: "${blogStructure}"` : ''}

All image markers in order: ${JSON.stringify(allMarkerNames)}

---
${markersList}`;

      let prompts;
      try {
        const claudeRaw = await callClaude(claudeSystem, claudeUser, 2000);
        const jsonMatch = claudeRaw.match(/\[[\s\S]*\]/);
        prompts = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
      } catch (err) {
        console.error('Claude parse error:', err);
        prompts = null;
      }

      if (!prompts || prompts.length !== markers.length) {
        prompts = markers.map(mk => `${mk.text}, Korean blog photo, high quality, no text, no watermark, no people faces`);
      }

      prompts = prompts.map(p => `${p}, Korean lifestyle photography, no text, no watermark`);

      // FLUX: 마커별 이미지 수 분배 (총 TOTAL_IMAGES장 고정)
      const perMarker = Math.floor(TOTAL_IMAGES / prompts.length);
      const extraImages = TOTAL_IMAGES % prompts.length;

      const images = [];
      for (let i = 0; i < prompts.length; i += 4) {
        const batch = prompts.slice(i, i + 4);
        const batchResults = await Promise.all(
          batch.map(async (prompt, j) => {
            const markerIndex = i + j;
            const numForMarker = perMarker + (markerIndex < extraImages ? 1 : 0);
            const subBatches = numForMarker <= 4 ? [numForMarker] : [4, numForMarker - 4];
            const markerImages = [];
            for (const subCount of subBatches) {
              try {
                const response = await fetch('https://fal.run/fal-ai/flux/schnell', {
                  method: 'POST',
                  headers: {
                    Authorization: `Key ${process.env.FAL_KEY}`,
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify({
                    prompt,
                    image_size: IMAGE_SIZE,
                    num_images: subCount,
                    num_inference_steps: 4,
                  }),
                });
                const data = await response.json();
                if (!response.ok || data.detail) throw new Error(JSON.stringify(data));
                for (const img of (data.images || [])) {
                  markerImages.push({ url: img.url, marker: markers[markerIndex].text, prompt });
                }
              } catch (err) {
                console.error(`FLUX error for marker ${markerIndex}:`, err);
                if (markerImages.length === 0) {
                  markerImages.push({ url: null, marker: markers[markerIndex].text, prompt });
                }
              }
            }
            return markerImages;
          })
        );
        for (const result of batchResults) images.push(...result);
      }

      const validImages = images.filter(img => img.url);
      if (validImages.length === 0) {
        if (rateLimitKey) try { await getRedis().decr(rateLimitKey); } catch (_) {}
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

    // ===== DIRECT 모드: 주제+분위기 → TOTAL_IMAGES장 고정 =====
    const { topic, mood, thumbnailText } = req.body;
    if (!topic) {
      if (rateLimitKey) try { await getRedis().decr(rateLimitKey); } catch (_) {}
      return res.status(400).json({ error: '블로그 주제를 입력해주세요.' });
    }

    // Claude: 주제 → 영어 프롬프트 변환 (일반 vs 재생성)
    const directSystem = is_regenerate
      ? 'You are an image prompt translator. This is a REGENERATION request — generate MORE SPECIFIC and DETAILED prompts. Convert the Korean blog topic into a rich, detailed English image description (2-3 sentences). Describe exact location, lighting, colors, composition, and props. Focus on visual elements only. No people faces. Always specify Korean context. No text/typography. No explanations, just the prompt.'
      : 'You are an image prompt translator. Convert the given Korean blog topic into a concise English image description (1-2 sentences). Focus on visual elements only. No people faces. IMPORTANT: Always specify Korean or East Asian context — Korean settings, Korean food, Korean interior, Korean people when depicting humans. CRITICAL: Never include any text, typography, letters, signs, or written words in the description. Purely visual elements only. No explanations, just the prompt.';
    const englishTopic = await callClaude(
      directSystem,
      topic,
      is_regenerate ? 300 : 150
    );

    const moodStyle = moodPrompts[mood] || moodPrompts['bright'];
    const fullPrompt = `${englishTopic}, ${moodStyle}, Korean lifestyle photography, no text, no watermark`;

    // FLUX: TOTAL_IMAGES장 생성
    const urls = await callFluxBatch(fullPrompt, TOTAL_IMAGES);
    if (urls.length === 0) {
      if (rateLimitKey) try { await getRedis().decr(rateLimitKey); } catch (_) {}
      return res.status(500).json({ error: '이미지 생성에 실패했습니다.' });
    }

    return res.status(200).json({
      mode: 'direct',
      images: urls.map(url => ({ url, prompt: fullPrompt })),
      thumbnailText: thumbnailText || '',
      remaining,
      limit: FREE_DAILY_LIMIT,
    });

  } catch (error) {
    console.error('Blog Image API Error:', error);
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
}
