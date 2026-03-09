import { Redis } from '@upstash/redis';

const FREE_DAILY_LIMIT = 3;

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
      image_size: 'square_hd',
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
        image_size: 'square_hd',
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

  // GET: 남은 횟수 조회
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
    const { mode } = req.body;

    // 전체 재생성 — 프롬프트 구체화 후 전체 이미지 재생성, rate limit 차감 안 함
    if (mode === 'regenerate') {
      const { prompts: origPrompts, markers: origMarkers } = req.body;
      if (!origPrompts || !origPrompts.length) return res.status(400).json({ error: '프롬프트가 필요합니다.' });

      // Claude로 프롬프트 구체화
      let refinedPrompts;
      try {
        const promptsList = origPrompts.map((p, i) => `${i + 1}. ${p}`).join('\n');
        const refineSystem = 'You are an expert image prompt enhancer. Given existing image prompts that produced unsatisfying results, refine each prompt to be MORE specific, detailed, and visually compelling. Add specific details: lighting direction, camera angle, composition, texture, color palette, atmosphere. Keep the core subject the same but make the description much richer. IMPORTANT: Maintain Korean/East Asian context. Output ONLY a valid JSON array of refined English prompt strings. Example: ["refined1", "refined2"]';
        const refineUser = `These image prompts produced unsatisfying results. Refine each one to be more specific and produce higher quality images:\n\n${promptsList}`;
        const claudeRaw = await callClaude(refineSystem, refineUser, 2000);
        const jsonMatch = claudeRaw.match(/\[[\s\S]*\]/);
        refinedPrompts = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
      } catch (err) {
        console.error('Claude refine error:', err);
        refinedPrompts = null;
      }

      // 실패 시 원본 프롬프트에 디테일 추가
      if (!refinedPrompts || refinedPrompts.length !== origPrompts.length) {
        refinedPrompts = origPrompts.map(p => `${p}, detailed, sharp focus, professional photography, 8k resolution`);
      }
      refinedPrompts = refinedPrompts.map(p => `${p}, Korean style, East Asian, high quality, no text, no typography, no letters, no words, no signs, no watermark, purely visual`);

      // FLUX: 프롬프트별 2장씩 병렬 생성
      const images = [];
      // 고유 프롬프트만 추출 (마커당 2장이므로 중복 제거)
      const uniquePrompts = [];
      const uniqueMarkers = [];
      const seen = new Set();
      for (let i = 0; i < refinedPrompts.length; i++) {
        const orig = origPrompts[i];
        if (!seen.has(orig)) {
          seen.add(orig);
          uniquePrompts.push(refinedPrompts[i]);
          uniqueMarkers.push(origMarkers ? origMarkers[i] : null);
        }
      }

      for (let i = 0; i < uniquePrompts.length; i += 4) {
        const batch = uniquePrompts.slice(i, i + 4);
        const batchMarkers = uniqueMarkers.slice(i, i + 4);
        const batchResults = await Promise.all(
          batch.map(async (prompt, j) => {
            try {
              const response = await fetch('https://fal.run/fal-ai/flux/schnell', {
                method: 'POST',
                headers: {
                  Authorization: `Key ${process.env.FAL_KEY}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  prompt,
                  image_size: 'square_hd',
                  num_images: 2,
                  num_inference_steps: 4,
                }),
              });
              const data = await response.json();
              if (!response.ok || data.detail) throw new Error(JSON.stringify(data));
              return (data.images || []).map(img => ({
                url: img.url, marker: batchMarkers[j], prompt,
              }));
            } catch (err) {
              console.error(`FLUX regen error ${i + j}:`, err);
              return [{ url: null, marker: batchMarkers[j], prompt }];
            }
          })
        );
        for (const result of batchResults) images.push(...result);
      }

      const validImages = images.filter(img => img.url);
      if (validImages.length === 0) return res.status(500).json({ error: '이미지 재생성에 실패했습니다.' });
      return res.status(200).json({ images: validImages });
    }

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
          error: `일일 무료 사용 한도(${FREE_DAILY_LIMIT}회)를 초과했습니다. 내일 다시 이용해주세요.`,
          remaining: 0,
        });
      }
      remaining = FREE_DAILY_LIMIT - newCount;
    }

    // ===== PARSE 모드: 블로그 글에서 (사진: ...) 마커 파싱 =====
    if (mode === 'parse') {
      const { blogText, thumbnailText } = req.body;
      if (!blogText) {
        if (rateLimitKey) try { await getRedis().decr(rateLimitKey); } catch (_) {}
        return res.status(400).json({ error: '블로그 글을 입력해주세요.' });
      }

      // 마커 추출 (컨텍스트 400자)
      const markerRegex = /\(사진:\s*([^)]+)\)/g;
      const markers = [];
      let m;
      const totalLen = blogText.length;
      while ((m = markerRegex.exec(blogText)) !== null) {
        const text = m[1].trim();
        const pos = m.index;
        const before = blogText.substring(Math.max(0, pos - 400), pos).trim();
        const after = blogText.substring(pos + m[0].length, Math.min(totalLen, pos + m[0].length + 400)).trim();
        const positionRatio = pos / totalLen;
        const position = positionRatio < 0.25 ? 'early' : positionRatio < 0.75 ? 'middle' : 'ending';
        markers.push({ text, before, after, position });
      }

      if (markers.length === 0) {
        if (rateLimitKey) try { await getRedis().decr(rateLimitKey); } catch (_) {}
        return res.status(400).json({ error: '블로그 글에서 (사진: ...) 마커를 찾을 수 없습니다. 블로그 글 생성기에서 작성한 글을 붙여넣어주세요.' });
      }

      // 블로그 제목 추출 (첫 줄) + 요약 300자
      const firstLine = blogText.split('\n').find(l => l.trim()) || '';
      const blogTitle = firstLine.trim().substring(0, 80);
      const blogSummary = blogText.substring(0, 300).trim();
      const allMarkerNames = markers.map(mk => mk.text);

      // Claude Haiku: 구조화된 프롬프트로 모든 마커 한 번에 처리
      const markersList = markers.map((mk, i) =>
        `Image ${i + 1} of ${markers.length}:\n  Marker: "${mk.text}"\n  Position in article: ${mk.position}\n  Before (400 chars): "${mk.before}"\n  After (400 chars): "${mk.after}"`
      ).join('\n\n');

      const claudeSystem = `You are a blog image prompt engineer for Korean lifestyle blogs.

## Your Task
Generate English image prompts for FLUX Schnell model based on blog context.

## Context Understanding Rules
1. Read the blog title and summary to understand the overall topic and tone.
2. Read before/after text carefully to identify the SPECIFIC scene, object, or situation being described at that exact point.
3. Consider the image's position in the article flow:
   - early: set the scene broadly, show the overall environment
   - middle: show specific details, close-ups, or key moments
   - ending: convey mood, results, or conclusion atmosphere
4. Each image must be visually distinct from others in the same article.

## Prompt Structure (follow this template for each prompt)
"[Subject/Scene from context], [specific details from surrounding text], [setting/environment], [lighting/mood], [camera angle], clean Korean lifestyle blog photography style"

## Mandatory Rules
- Korean/East Asian context: Korean interiors, Korean food, Korean street scenes, Korean products.
- When people appear: specify "Korean person" with only back view, hands, or silhouette — NEVER faces.
- NEVER include any text, typography, letters, signs, labels, captions, or written words.
- Be hyper-specific: NOT "a cafe interior" but "a small Korean cafe with warm wood tables, brass pendant lights, and dried flower arrangements on a sunny afternoon, shot from the entrance looking in"
- Style consistency: warm natural lighting, shallow depth of field, editorial lifestyle photography feel.

## Output
Return ONLY a valid JSON array of prompt strings. No explanation.`;

      const claudeUser = `Blog title: "${blogTitle}"
Blog summary (300 chars): "${blogSummary}"

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
        // Fallback: 마커 텍스트 직접 사용
        prompts = markers.map(mk => `${mk.text}, Korean blog photo, high quality, no text, no watermark, no people faces`);
      }

      // 프롬프트 후처리
      prompts = prompts.map(p => `${p}, Korean style, East Asian, high quality, no text, no typography, no letters, no words, no signs, no watermark, purely visual`);

      // FLUX: 마커별 2장씩 병렬 생성 (최대 4개씩 배치)
      const images = [];
      for (let i = 0; i < prompts.length; i += 4) {
        const batch = prompts.slice(i, i + 4);
        const batchResults = await Promise.all(
          batch.map(async (prompt, j) => {
            try {
              const response = await fetch('https://fal.run/fal-ai/flux/schnell', {
                method: 'POST',
                headers: {
                  Authorization: `Key ${process.env.FAL_KEY}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  prompt,
                  image_size: 'square_hd',
                  num_images: 2,
                  num_inference_steps: 4,
                }),
              });
              const data = await response.json();
              if (!response.ok || data.detail) throw new Error(JSON.stringify(data));
              return (data.images || []).map(img => ({
                url: img.url, marker: markers[i + j].text, prompt,
              }));
            } catch (err) {
              console.error(`FLUX error for marker ${i + j}:`, err);
              return [{ url: null, marker: markers[i + j].text, prompt }];
            }
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

    // ===== DIRECT 모드: 주제+분위기 → 8장 고정 =====
    const { topic, mood, thumbnailText } = req.body;
    if (!topic) {
      if (rateLimitKey) try { await getRedis().decr(rateLimitKey); } catch (_) {}
      return res.status(400).json({ error: '블로그 주제를 입력해주세요.' });
    }

    // Claude: 주제 → 영어 프롬프트 변환
    const englishTopic = await callClaude(
      'You are an image prompt translator. Convert the given Korean blog topic into a concise English image description (1-2 sentences). Focus on visual elements only. No people faces. IMPORTANT: Always specify Korean or East Asian context — Korean settings, Korean food, Korean interior, Korean people when depicting humans. CRITICAL: Never include any text, typography, letters, signs, or written words in the description. Purely visual elements only. No explanations, just the prompt.',
      topic,
      150
    );

    const moodStyle = moodPrompts[mood] || moodPrompts['bright'];
    const fullPrompt = `${englishTopic}, ${moodStyle}, Korean style, East Asian, no text, no typography, no letters, no words, no signs, no watermark, purely visual`;

    // FLUX: 8장 생성
    const urls = await callFluxBatch(fullPrompt, 8);
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
