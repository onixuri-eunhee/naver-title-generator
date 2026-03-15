import { Redis } from '@upstash/redis';
import { resolveAdmin, setCorsHeaders } from './_helpers.js';

/*
 * 블로그 글 하단 인라인 이미지 생성 API
 * FLUX Schnell × N장 (기본 4, 최대 8), 9:16 세로형 (576×1024)
 * blog-image.js와 동일 Redis 키 공유 (1크레딧 차감)
 */

const GUEST_DAILY_LIMIT = 3;
const MEMBER_DAILY_LIMIT = 5;
const CREDIT_SCALE = 10;
const FULL_COST = 10; // 1크레딧

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
  return `ratelimit:blogimage:v2:${ip}:${getKSTDate()}`;
}

function getTodayKeyByEmail(email) {
  return `ratelimit:blogimage:${email}:${getKSTDate()}`;
}

function extractToken(req) {
  const auth = req.headers['authorization'] || req.headers['Authorization'] || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7);
  return req.body?.token || req.query?.token || null;
}

async function resolveSessionEmail(token) {
  if (!token) return null;
  try {
    const session = await getRedis().get(`session:${token}`);
    if (session && session.email) return session.email;
  } catch (e) {}
  return null;
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

async function callClaude(systemPrompt, userMessage, maxTokens = 400) {
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
      image_size: { width: 576, height: 1024 },
      num_images: 1,
      num_inference_steps: 4,
    }),
  });
  const data = await response.json();
  if (!response.ok || data.detail) throw new Error(JSON.stringify(data));
  return data.images?.[0]?.url || null;
}

export default async function handler(req, res) {
  setCorsHeaders(res, req);

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let rateLimitKey = null;

  try {
    const { text, imageCount: rawCount } = req.body;
    if (!text || text.trim().length < 50) {
      return res.status(400).json({ error: '블로그 글이 너무 짧습니다.' });
    }
    const imageCount = Math.min(Math.max(parseInt(rawCount) || 4, 1), 8);

    // ─── Rate Limit ───
    const whitelisted = await resolveAdmin(req);
    const token = extractToken(req);
    const email = await resolveSessionEmail(token);
    const ip = getClientIp(req);
    const dailyLimit = email ? MEMBER_DAILY_LIMIT : GUEST_DAILY_LIMIT;
    const dailyLimitScaled = dailyLimit * CREDIT_SCALE;

    if (!whitelisted && dailyLimit <= 0) {
      return res.status(429).json({ error: '현재 무료 사용이 제한되어 있습니다.', remaining: 0 });
    }

    let remaining = whitelisted ? 999 : dailyLimit;

    if (!whitelisted) {
      rateLimitKey = email ? getTodayKeyByEmail(email) : getTodayKey(ip);
      const newCount = await getRedis().incrby(rateLimitKey, FULL_COST);
      await getRedis().expire(rateLimitKey, getTTLUntilMidnightKST());

      if (newCount > dailyLimitScaled) {
        await getRedis().decrby(rateLimitKey, FULL_COST);
        return res.status(429).json({
          error: `일일 무료 사용 한도(${dailyLimit}크레딧)를 초과했습니다. 내일 다시 이용해주세요.`,
          remaining: 0,
        });
      }
      remaining = Math.round((dailyLimitScaled - newCount) / CREDIT_SCALE * 10) / 10;
    }

    // ─── Haiku: 블로그 텍스트 → 4개 영어 프롬프트 ───
    const blogSnippet = text.substring(0, 500).trim();

    const systemPrompt = `You are a blog image prompt engineer. Given blog text, extract ${imageCount} key visual scenes and write FLUX image prompts.
Rules:
- Output ONLY a JSON array of ${imageCount} items: [{"prompt":"..."},...]
- Exactly ${imageCount} items
- Each prompt: 20-40 English words describing a vertical 9:16 photo scene
- No text, no writing, no signs in the images
- Cinematic photography style, Korean/East Asian aesthetic`;

    const userPrompt = blogSnippet;
    const haikuMaxTokens = 200 + imageCount * 50;

    let prompts;
    try {
      const raw = await callClaude(systemPrompt, userPrompt, haikuMaxTokens);
      const jsonMatch = raw.match(/\[[\s\S]*?\](?=[^[\]]*$)/);
      if (!jsonMatch) throw new Error('No JSON array');
      const parsed = JSON.parse(jsonMatch[0]);
      if (!Array.isArray(parsed) || parsed.length < imageCount) throw new Error(`Not ${imageCount} items`);
      prompts = parsed.slice(0, imageCount).map(p => (typeof p === 'string' ? p : p.prompt) || '');
    } catch (err) {
      console.warn('[QUICK-IMAGE] Haiku prompt generation failed:', err.message);
      const fallbacks = [
        'high quality Korean lifestyle blog photography, soft natural lighting, editorial style',
        'aesthetic Korean interior space, warm ambient lighting, cozy atmosphere',
        'modern Korean workspace, clean minimal design, bright daylight',
        'Korean urban cityscape, soft bokeh, cinematic mood photography',
        'Korean food styling flat lay, warm tones, appetizing presentation',
        'Korean nature landscape, mountains and sky, serene peaceful mood',
        'Korean street photography, vibrant urban life, candid moment',
        'Korean traditional aesthetic, modern interpretation, elegant composition',
      ];
      prompts = fallbacks.slice(0, imageCount);
    }

    console.log('[QUICK-IMAGE] Prompts:', prompts.map(p => p.substring(0, 50)));

    // ─── FLUX Schnell × N장 (9:16 세로형) ───
    const fullPrompts = prompts.map(p =>
      `${p}, high quality editorial photography, vertical 9:16 composition${FLUX_NO_TEXT}`
    );

    const results = await Promise.all(
      fullPrompts.map(async (prompt, i) => {
        try {
          const url = await callFlux(prompt);
          return { url, prompt };
        } catch (err) {
          console.error(`[QUICK-IMAGE] FLUX error ${i}:`, err.message);
          return { url: null, prompt };
        }
      })
    );

    const images = results.filter(r => r.url);
    if (images.length === 0) {
      if (rateLimitKey) try { await getRedis().decrby(rateLimitKey, FULL_COST); } catch (_) {}
      return res.status(500).json({ error: '이미지 생성에 실패했습니다. 잠시 후 다시 시도해주세요.' });
    }

    return res.status(200).json({
      images,
      remaining,
      limit: dailyLimit,
    });

  } catch (error) {
    console.error('[QUICK-IMAGE] Error:', error);
    if (rateLimitKey) try { await getRedis().decrby(rateLimitKey, FULL_COST); } catch (_) {}
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
}
