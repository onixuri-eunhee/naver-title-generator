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

    // 개별 재생성 — rate limit 차감 안 함
    if (mode === 'regenerate') {
      const { prompt } = req.body;
      if (!prompt) return res.status(400).json({ error: '프롬프트가 필요합니다.' });
      const url = await callFlux(prompt);
      if (!url) return res.status(500).json({ error: '이미지 재생성에 실패했습니다.' });
      return res.status(200).json({ url });
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

      // 마커 추출
      const markerRegex = /\(사진:\s*([^)]+)\)/g;
      const markers = [];
      let m;
      while ((m = markerRegex.exec(blogText)) !== null) {
        const text = m[1].trim();
        const pos = m.index;
        const before = blogText.substring(Math.max(0, pos - 200), pos).trim();
        const after = blogText.substring(pos + m[0].length, Math.min(blogText.length, pos + m[0].length + 200)).trim();
        markers.push({ text, before, after });
      }

      if (markers.length === 0) {
        if (rateLimitKey) try { await getRedis().decr(rateLimitKey); } catch (_) {}
        return res.status(400).json({ error: '블로그 글에서 (사진: ...) 마커를 찾을 수 없습니다. 블로그 글 생성기에서 작성한 글을 붙여넣어주세요.' });
      }

      const blogSummary = blogText.substring(0, 100).trim();

      // Claude Haiku: 모든 마커를 한 번에 처리
      const markersList = markers.map((mk, i) =>
        `${i + 1}. Image marker: "${mk.text}"\n   Before (200 chars): "${mk.before}"\n   After (200 chars): "${mk.after}"`
      ).join('\n\n');

      const claudeSystem = 'You are a blog image prompt generator for Korean lifestyle blogs. Your #1 priority is generating images that match the exact context of the blog content. Use the surrounding text to understand what specific scene, object, or situation is being described. Generate highly specific, contextually accurate English prompts. No generic images. No people\'s faces. IMPORTANT: This is for a Korean blog. When depicting people, always specify "Korean" or "East Asian" ethnicity. Use Korean settings, Korean food, Korean interior styles, etc. Output ONLY a valid JSON array of English prompt strings, one per marker. Example: ["prompt1", "prompt2"]';

      const claudeUser = `Blog summary: "${blogSummary}"\n\nGenerate ${markers.length} image prompts:\n\n${markersList}`;

      let prompts;
      try {
        const claudeRaw = await callClaude(claudeSystem, claudeUser, 1500);
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
      prompts = prompts.map(p => `${p}, Korean style, East Asian, high quality, no text, no watermark`);

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
      'You are an image prompt translator. Convert the given Korean blog topic into a concise English image description (1-2 sentences). Focus on visual elements only. No people faces. IMPORTANT: Always specify Korean or East Asian context — Korean settings, Korean food, Korean interior, Korean people when depicting humans. No explanations, just the prompt.',
      topic,
      150
    );

    const moodStyle = moodPrompts[mood] || moodPrompts['bright'];
    const fullPrompt = `${englishTopic}, ${moodStyle}, Korean style, East Asian, no text, no watermark`;

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
