import { Redis } from '@upstash/redis';

/*
 * 이미지 생성 구조
 * DALL-E 3 (2장): 한글텍스트/인포그래픽 담당
 * FLUX Schnell (6장): 순수 이미지 담당
 * Canvas API: 썸네일 텍스트 오버레이 (무료)
 * Haiku: 마커 분석 + API 라우팅 판단
 *
 * 원가 구조 (1크레딧 기준)
 * DALL-E 3 2장:      120원
 * FLUX Schnell 6장:   27원
 * Haiku 8회 호출:     56원
 * 총 원가:           203원
 *
 * 가격 구조
 * 이미지: 20크레딧 = 9,900원 (크레딧당 495원)
 * 블로그: 30크레딧 = 9,900원 (크레딧당 330원)
 *
 * 마진
 * 이미지: 59% (292원/크레딧)
 * 블로그: 71% (235원/크레딧)
 */

const FREE_DAILY_LIMIT = 3;
const MAX_MARKERS = 10;         // 마커 최대 수
const DIRECT_IMAGES = 8;        // 직접 입력 모드 이미지 수
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

async function callDalle(prompt) {
  const response = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'dall-e-3',
      prompt,
      size: '1024x1024',
      quality: 'standard',
      n: 1,
    }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(JSON.stringify(data));
  return data.data[0].url;
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

async function callHaikuMarkerAnalysis(blogText, markers, isRegenerate) {
  const blogSummary = blogText.substring(0, 100).trim();

  const markerContext = markers.map((mk, i) => {
    const before = mk.before.substring(0, 200);
    const after = mk.after.substring(0, 200);
    return `마커 ${i + 1}: "${mk.text}"\n  앞 문맥: "${before}"\n  뒤 문맥: "${after}"`;
  }).join('\n\n');

  const systemPrompt = `You are a blog image classifier and prompt generator for Korean lifestyle blogs.
For each image marker, you must:
1. Classify the image type:
   - 'dalle': if the image requires Korean text overlay, infographic, data visualization,
     comparison table, step-by-step guide, or any text-heavy visual
   - 'flux': if the image is a pure photo/lifestyle scene with no text required

2. Generate an appropriate English prompt based on the type:
   - For 'dalle': include specific Korean text content to display, layout instructions,
     clean design, white background preferred
   - For 'flux': purely visual scene, no text, photorealistic, natural lighting.
     NEVER include any text, signs, or writing in the prompt.
     If the scene naturally contains signs or text (like storefronts, menus, billboards),
     explicitly add 'no visible text on signs, blurred signage' to the prompt.

3. Use surrounding context (before/after 200 chars) to make prompts highly specific.
${isRegenerate ? `
This is a REGENERATION request - user was not satisfied.
Generate MORE SPECIFIC and MORE CONTEXTUALLY ACCURATE prompts.
- Describe exact location, lighting, colors, composition, props
- For dalle: make text content more specific and layout cleaner
- For flux: be extremely specific about the scene
Same rule: dalle 2개, flux 6개 배정 유지` : ''}

Output JSON array only:
[{
  "marker": "마커텍스트",
  "type": "dalle" or "flux",
  "prompt": "English prompt",
  "korean_text": "포함할 한글 텍스트 (dalle만 해당, 없으면 null)"
}]`;

  const userPrompt = `블로그 전체 주제 (첫 100자): ${blogSummary}

마커 목록과 문맥:
${markerContext}

규칙:
- 반드시 dalle 2개, flux 6개로 배정할 것
- dalle 2개는 텍스트/인포그래픽이 가장 필요한 마커 우선 선택
- flux 6개 중 첫 번째는 반드시 블로그 대표이미지용으로 배정`;

  const raw = await callClaude(systemPrompt, userPrompt, 3000);
  const jsonMatch = raw.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error('Haiku marker analysis: no JSON array found');
  const result = JSON.parse(jsonMatch[0]);

  // dalle/flux 카운트 검증
  const dalleCount = result.filter(r => r.type === 'dalle').length;
  const fluxCount = result.filter(r => r.type === 'flux').length;
  if (dalleCount !== 2 || fluxCount !== 6) {
    console.warn(`Haiku returned dalle:${dalleCount}, flux:${fluxCount} — adjusting to 2/6`);
    // 강제 조정: type이 없거나 비율이 맞지 않으면 앞 2개를 dalle로
    const sorted = [...result];
    let dalleAssigned = 0;
    for (const item of sorted) {
      if (item.type === 'dalle' && dalleAssigned < 2) {
        dalleAssigned++;
      } else if (item.type === 'dalle' && dalleAssigned >= 2) {
        item.type = 'flux';
      }
    }
    if (dalleAssigned < 2) {
      for (const item of sorted) {
        if (item.type !== 'dalle' && dalleAssigned < 2) {
          item.type = 'dalle';
          dalleAssigned++;
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

    // ===== PARSE 모드: 블로그 글에서 마커 파싱 → DALL-E 3 + FLUX 하이브리드 =====
    if (mode === 'parse') {
      const { blogText, thumbnailText } = req.body;
      const frontMarkers = req.body.markers;
      if (!blogText) {
        if (rateLimitKey) try { await getRedis().decr(rateLimitKey); } catch (_) {}
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
        if (rateLimitKey) try { await getRedis().decr(rateLimitKey); } catch (_) {}
        return res.status(400).json({ error: '블로그 글에서 (사진: ...) 또는 (이미지: ...) 마커를 찾을 수 없습니다. 블로그 글 생성기에서 작성한 글을 붙여넣어주세요.' });
      }

      // 마커가 정확히 8개가 아닐 경우: 기존 FLUX 전용 로직 (fallback)
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

        const claudeSystem = `${is_regenerate
          ? `You are a blog image prompt engineer for Korean lifestyle blogs.
This is a REGENERATION request — the user was not satisfied with the previous images.
You must generate MORE SPECIFIC and MORE CONTEXTUALLY ACCURATE prompts than before.
- Describe exact location, lighting, colors, composition, props
- Be extremely specific about the scene
- Reference the surrounding blog text as much as possible
- No generic stock photo style. No people's faces.`
          : `You are a blog image prompt engineer for Korean lifestyle blogs.
Your #1 priority is generating images that match the exact context of the blog content.
Use the surrounding text to understand what specific scene, object, or situation is being described.
No generic images. No people's faces.`}

## Your Task
Generate English image prompts for FLUX Schnell model based on blog context.
Each prompt should be hyper-specific, referencing the surrounding text context.
Korean/East Asian context required. No text/typography in images. No faces.

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

        const fallbackNoText = ', No text, no letters, no signs, no Korean characters, no writing of any kind, pure visual only';
        const fallbackHeroNoText = ', Absolutely no text, no letters, no signs, no Korean writing, no Chinese characters, no any writing or typography anywhere in the image. Pure clean visual photography only.';
        prompts = prompts.map((p, idx) => `${p}, Korean lifestyle photography, no text, no watermark${idx === 0 ? fallbackHeroNoText : fallbackNoText}`);

        const images = [];
        for (let i = 0; i < prompts.length; i += 4) {
          const batch = prompts.slice(i, i + 4);
          const batchResults = await Promise.all(
            batch.map(async (prompt, j) => {
              const markerIndex = i + j;
              try {
                const url = await callFlux(prompt);
                return { url, marker: markers[markerIndex].text, prompt, type: 'flux' };
              } catch (err) {
                console.error(`FLUX error for marker ${markerIndex}:`, err);
                return { url: null, marker: markers[markerIndex].text, prompt, type: 'flux' };
              }
            })
          );
          images.push(...batchResults);
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

      // ===== 마커 8개: DALL-E 3 (2장) + FLUX Schnell (6장) 하이브리드 =====
      let analysisResult;
      try {
        analysisResult = await callHaikuMarkerAnalysis(blogText, markers, is_regenerate);
      } catch (err) {
        console.error('Haiku marker analysis error:', err);
        // fallback: 전부 FLUX로
        analysisResult = markers.map(mk => ({
          marker: mk.text,
          type: 'flux',
          prompt: `${mk.text}, Korean blog photo, high quality, no text, no watermark, no people faces`,
          korean_text: null,
        }));
      }

      // 원래 마커 순서대로 매핑
      const orderedAnalysis = markers.map((mk, i) => {
        const found = analysisResult.find(a => a.marker === mk.text) || analysisResult[i];
        return { ...found, originalIndex: i, markerObj: mk };
      });

      const dalleItems = orderedAnalysis.filter(a => a.type === 'dalle');
      const fluxItems = orderedAnalysis.filter(a => a.type === 'flux');

      // DALL-E 3: 2장 병렬 호출
      const dalleResults = await Promise.all(
        dalleItems.map(async (item) => {
          try {
            const url = await callDalle(item.prompt);
            return {
              url,
              marker: item.markerObj.text,
              prompt: item.prompt,
              type: 'dalle',
              korean_text: item.korean_text || null,
              originalIndex: item.originalIndex,
            };
          } catch (err) {
            console.error(`DALL-E error for marker "${item.markerObj.text}":`, err);
            return {
              url: null,
              marker: item.markerObj.text,
              prompt: item.prompt,
              type: 'dalle',
              korean_text: item.korean_text || null,
              originalIndex: item.originalIndex,
            };
          }
        })
      );

      // FLUX: 6장 (4개 + 2개 배치)
      const fluxResults = [];
      const fluxNoTextSuffix = ', No text, no letters, no signs, no Korean characters, no writing of any kind, pure visual only';
      const fluxHeroSuffix = ', Absolutely no text, no letters, no signs, no Korean writing, no Chinese characters, no any writing or typography anywhere in the image. Pure clean visual photography only.';
      let isFirstFlux = true;
      for (let i = 0; i < fluxItems.length; i += 4) {
        const batch = fluxItems.slice(i, i + 4);
        const batchResults = await Promise.all(
          batch.map(async (item) => {
            const suffix = isFirstFlux ? fluxHeroSuffix : fluxNoTextSuffix;
            isFirstFlux = false;
            const fullPrompt = `${item.prompt}, Korean lifestyle photography, no text, no watermark${suffix}`;
            try {
              const url = await callFlux(fullPrompt);
              return {
                url,
                marker: item.markerObj.text,
                prompt: fullPrompt,
                type: 'flux',
                korean_text: null,
                originalIndex: item.originalIndex,
              };
            } catch (err) {
              console.error(`FLUX error for marker "${item.markerObj.text}":`, err);
              return {
                url: null,
                marker: item.markerObj.text,
                prompt: fullPrompt,
                type: 'flux',
                korean_text: null,
                originalIndex: item.originalIndex,
              };
            }
          })
        );
        fluxResults.push(...batchResults);
      }

      // 결과 합산 후 원래 마커 순서로 정렬
      const allResults = [...dalleResults, ...fluxResults];
      allResults.sort((a, b) => a.originalIndex - b.originalIndex);

      const validImages = allResults.filter(img => img.url);
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

    // ===== DIRECT 모드: 주제+분위기 → DIRECT_IMAGES장 고정 (FLUX 전용) =====
    const { topic, mood, thumbnailText } = req.body;
    if (!topic) {
      if (rateLimitKey) try { await getRedis().decr(rateLimitKey); } catch (_) {}
      return res.status(400).json({ error: '블로그 주제를 입력해주세요.' });
    }

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

    const urls = await callFluxBatch(fullPrompt, DIRECT_IMAGES);
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
