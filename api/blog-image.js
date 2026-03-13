import { Redis } from '@upstash/redis';

/*
 * 이미지 생성 구조
 * FLUX Schnell 전용 (photo only) — 텍스트 없는 맥락 사진만 생성
 * Canvas API: 썸네일 텍스트 오버레이 (프론트엔드)
 * Haiku: 마커 분석 + 맥락 기반 영어 프롬프트 생성
 */

const FREE_DAILY_LIMIT = 3;
const MAX_MARKERS = 10;
const DIRECT_IMAGES = 8;
const IMAGE_SIZE = 'square_hd'; // 1024×1024

// FLUX no-text suffix (단일 정의, 모든 모드에서 공유)
const FLUX_NO_TEXT = ', no text, no writing, no signs, no letters, no characters, pure visual only';

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

async function callHaikuMarkerAnalysis(blogText, markers, isRegenerate) {
  // 블로그 주제 파악을 위해 첫 300자 + 제목/소제목 추출
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

  const systemPrompt = `You are a blog image prompt engineer for FLUX Schnell (1024x1024 square, photo only).
Generate English photo prompts for ALL markers. No infographics, no charts, no text — pure visual photography only.

## PHOTO PROMPT RULES
- Describe as cinematic/editorial photography matching each marker's meaning
- Read before/after context carefully — prompt MUST match the specific subject discussed
- Even if the marker mentions data/charts/comparisons, generate a mood/atmosphere photo related to the topic instead
- Include: materials, colors, textures, arrangement, lighting, camera angle
- Signs/menus → describe as blurred background elements
- End with: ", no text, no letters, photography style"
- Each prompt: 80-150 English words
- prompt MUST be 100% English (NO Korean)
- Maintain Korean/East Asian aesthetic
${isRegenerate ? '- REGENERATION MODE: MORE SPECIFIC prompts with different compositions and visual approaches.' : ''}

## Output Format
Return ONLY a valid JSON array:
[{"marker": "마커텍스트", "prompt": "English prompt 80-150 words..."}]`;

  const userPrompt = `블로그 제목: "${blogTitle}"
블로그 전체 주제 (첫 300자): ${blogSummary}${blogStructure ? `\n글 구조: ${blogStructure}` : ''}

마커 목록과 문맥:
${markerContext}

위 ${markers.length}개 마커 각각에 대해 JSON 배열을 출력하세요.`;

  const raw = await callClaude(systemPrompt, userPrompt, 4000);
  const jsonMatch = raw.match(/\[[\s\S]*?\](?=[^[\]]*$)/);
  if (!jsonMatch) throw new Error('Haiku marker analysis: no JSON array found');
  const result = JSON.parse(jsonMatch[0]);

  // 결과 개수 검증
  if (result.length !== markers.length) {
    throw new Error(`Haiku returned ${result.length} items, expected ${markers.length}`);
  }

  // ─── 안전 검증: 모든 항목을 photo로 강제 ───
  for (const item of result) {
    item.type = 'photo';
    if (!item.prompt) {
      item.prompt = 'high quality Korean lifestyle blog photography, soft natural lighting, editorial style';
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
      const whitelisted = await getRedis().get(`admin:whitelist:${ip}`) || req.query?.admin === '8524';
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

  let rateLimitKey = null;

  try {
    const { mode, is_regenerate } = req.body;

    // Rate limit (화이트리스트 IP 또는 admin 키 스킵)
    const ip = getClientIp(req);
    const whitelisted = await getRedis().get(`admin:whitelist:${ip}`) || req.query?.admin === '8524';

    if (!whitelisted && FREE_DAILY_LIMIT <= 0) {
      return res.status(429).json({ error: '현재 무료 사용이 제한되어 있습니다.', remaining: 0 });
    }

    let remaining = whitelisted ? 999 : FREE_DAILY_LIMIT;

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

    // ===== PARSE 모드: 블로그 글에서 마커 파싱 → FLUX 전용 =====
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

      console.log(`[IMAGE] Mode: parse | blogText: ${totalLen} chars | frontMarkers: ${frontMarkers?.length || 0} | is_regenerate: ${is_regenerate}`);

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
            console.warn(`[IMAGE] Marker NOT FOUND in blogText: "${text.substring(0, 40)}..." — using first 400 chars as context`);
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
        console.warn('[IMAGE] No markers found in blogText');
        if (rateLimitKey) try { await getRedis().decr(rateLimitKey); } catch (_) {}
        return res.status(400).json({ error: '블로그 글에서 (사진: ...) 또는 (이미지: ...) 마커를 찾을 수 없습니다. 블로그 글 생성기에서 작성한 글을 붙여넣어주세요.' });
      }

      console.log(`[IMAGE] Markers found: ${markers.length} | contexts: ${markers.map(m => `"${m.text.substring(0, 20)}…" before:${m.before.length}ch after:${m.after.length}ch`).join(', ')}`);

      // 마커가 정확히 8개가 아닐 경우: FLUX 전용 로직 (fallback)
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

        const claudeSystem = `You are a blog image prompt engineer. Generate prompts that PRECISELY match each marker's topic and surrounding context.
${is_regenerate
  ? `REGENERATION MODE: Generate MORE SPECIFIC prompts with different compositions and visual approaches.`
  : `Read the before/after text carefully to understand the specific subject being discussed.`}

## Rules
- Generate English-only prompts for FLUX Schnell (1024x1024 square). Translate Korean markers to PRECISE English visual descriptions.
- Describe as cinematic/editorial photography. Each prompt: 80-150 English words.
- Every prompt MUST directly depict the subject of the blog and marker.
- Be hyper-specific: materials, textures, colors, arrangement, lighting, camera angle.
- Signs/menus → describe as "soft blurred background elements".
- End with: ", no text, no letters, photography style"
- Maintain Korean/East Asian aesthetic.

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
          console.error('[IMAGE] Claude parse error:', err);
          prompts = null;
        }

        if (!prompts || prompts.length !== markers.length) {
          console.warn(`[IMAGE] Non-8 marker path: Claude returned ${prompts?.length || 0} prompts for ${markers.length} markers — using generic English fallback`);
          // fallback: 순수 영어 generic 프롬프트로 대체 (한글을 FLUX에 넣지 않으면서 이미지 생성은 계속)
          prompts = markers.map(() => `high quality Korean lifestyle blog photography, soft natural lighting, editorial style`);
        }

        console.log('[IMAGE] Non-8 prompts generated:', prompts.map(p => p.substring(0, 60)));
        prompts = prompts.map(p => `${p}, high quality editorial photography, square composition${FLUX_NO_TEXT}`);

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

      // ===== 마커 8개: photo/infographic 혼합 파이프라인 =====
      let analysisResult;
      let allPhoto = false; // fallback 시 전부 photo
      try {
        analysisResult = await callHaikuMarkerAnalysis(blogText, markers, is_regenerate);
        const photoCount = analysisResult.filter(r => r.type === 'photo').length;
        const infraCount = analysisResult.filter(r => r.type === 'infographic').length;
        console.log(`[IMAGE] Haiku analysis SUCCESS - photo:${photoCount} infographic:${infraCount}`, JSON.stringify(analysisResult.map(r => ({ marker: r.marker, type: r.type, layout: r.layout, prompt: r.prompt?.substring(0, 60) }))));
      } catch (err) {
        console.error('[IMAGE] Haiku marker analysis FAILED:', err.message);
        // fallback: 간단한 Haiku 호출로 마커별 영어 번역 시도 (전부 photo)
        allPhoto = true;
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
            console.log('[IMAGE] Fallback translation SUCCESS (all photo)');
            analysisResult = fallbackPrompts.map((prompt, i) => ({
              marker: markers[i].text,
              type: 'photo',
              prompt,
            }));
          } else {
            throw new Error('Fallback translation returned wrong count');
          }
        } catch (fallbackErr) {
          console.error('[IMAGE] Fallback translation also FAILED:', fallbackErr.message);
          if (rateLimitKey) try { await getRedis().decr(rateLimitKey); } catch (_) {}
          return res.status(500).json({ error: 'AI 이미지 분석에 실패했습니다. 잠시 후 다시 시도해주세요.' });
        }
      }

      // 원래 마커 순서대로 매핑 + originalIndex 부여
      const orderedItems = markers.map((mk, i) => {
        const found = analysisResult.find(a => a.marker === mk.text) || analysisResult[i];
        if (!found) {
          return { type: 'photo', prompt: 'high quality Korean lifestyle blog photography, soft natural lighting, editorial style', marker: mk.text, originalIndex: i };
        }
        return { ...found, marker: mk.text, originalIndex: i };
      });

      console.log(`[IMAGE] Pipeline: ${orderedItems.length} photos (FLUX Schnell)`);

      // ─── FLUX 배치 처리 (4장씩) ───
      const allResults = [];
      for (let i = 0; i < orderedItems.length; i += 4) {
        const batch = orderedItems.slice(i, i + 4);
        const batchResults = await Promise.all(
          batch.map(async (item) => {
            const prompt = item.prompt || 'high quality Korean lifestyle blog photography, soft natural lighting, editorial style';
            const fullPrompt = `${prompt}, high quality editorial photography, square composition${FLUX_NO_TEXT}`;
            try {
              const url = await callFlux(fullPrompt);
              return { url, marker: item.marker, prompt: fullPrompt, type: 'photo', originalIndex: item.originalIndex };
            } catch (err) {
              console.error(`[IMAGE] FLUX error for marker "${item.marker}":`, err);
              return { url: null, marker: item.marker, prompt: fullPrompt, type: 'photo', originalIndex: item.originalIndex };
            }
          })
        );
        allResults.push(...batchResults);
      }

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
      ? 'You are an image prompt translator. This is a REGENERATION request — generate MORE SPECIFIC and DETAILED prompts. Convert the Korean blog topic into a rich, detailed English image description (2-3 sentences). Describe the EXACT subject of the topic with specific materials, colors, composition, and props. Focus on visual elements only. No people faces. CRITICAL: Never include any text, typography, letters, signs, or written words. Compose for square 1024x1024 format. No explanations, just the prompt.'
      : 'You are an image prompt translator. Convert the given Korean blog topic into a concise English image description (1-2 sentences) that depicts the EXACT subject. Focus on visual elements only. No people faces. CRITICAL: Never include any text, typography, letters, signs, or written words. Compose for square 1024x1024 format. Purely visual elements only. No explanations, just the prompt.';
    const englishTopic = await callClaude(
      directSystem,
      topic,
      is_regenerate ? 300 : 150
    );

    console.log('[IMAGE] Direct mode - topic:', topic, '→ prompt:', englishTopic.substring(0, 100));
    const moodStyle = moodPrompts[mood] || moodPrompts['bright'];
    const fullPrompt = `${englishTopic}, ${moodStyle}${FLUX_NO_TEXT}`;

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
    if (rateLimitKey) try { await getRedis().decr(rateLimitKey); } catch (_) {}
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
}
