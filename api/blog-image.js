import { Redis } from '@upstash/redis';

const FREE_DAILY_LIMIT = 0; // 0 = 사용 차단 (테스트 기간)

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
    const { blogText, titleText } = req.body;

    if (!blogText || !titleText) {
      return res.status(400).json({ error: '블로그 글 텍스트와 이미지 제목이 필요합니다.' });
    }

    // Rate limit (INCR-first, 화이트리스트 IP 스킵)
    const ip = getClientIp(req);
    const whitelisted = await getRedis().get(`admin:whitelist:${ip}`);

    if (!whitelisted && FREE_DAILY_LIMIT <= 0) {
      return res.status(429).json({
        error: '현재 테스트 기간으로 무료 사용이 제한되어 있습니다.',
        remaining: 0,
      });
    }

    let remaining = whitelisted ? 999 : FREE_DAILY_LIMIT;
    let rateLimitKey = null;

    if (!whitelisted) {
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

    // Step 1: Claude → 블로그 분석 → DALL-E 프롬프트 1개 + Unsplash 키워드 3개
    const claudeSystemPrompt = `You are an expert image analyst for Korean blog posts. Analyze the given Korean blog post and generate:
1. One DALL-E image prompt in English for a blog thumbnail background
2. Three Unsplash search keywords in English for finding body images

Rules for DALL-E prompt:
- English only
- Style: realistic photography, high quality, bright and clean aesthetic, suitable for Korean blog
- NEVER include any text, letters, words, or typography in the image
- Must have a clean center area suitable for text overlay
- Slightly blurred or simple composition in the center
- Related to the blog topic

Rules for Unsplash keywords:
- English only, 1-3 words each
- Keywords should represent different visual aspects of the blog content
- Suitable for finding high-quality stock photos

Respond ONLY with valid JSON:
{
  "dalle_prompt": "...",
  "unsplash_keywords": ["keyword1", "keyword2", "keyword3"]
}`;

    const claudeResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 500,
        system: claudeSystemPrompt,
        messages: [{ role: 'user', content: `다음 한국어 블로그 글을 분석해주세요.\n\n${blogText.slice(0, 3000)}` }],
      }),
    });

    const claudeData = await claudeResponse.json();

    if (!claudeResponse.ok) {
      console.error('Claude API Error:', claudeData);
      if (rateLimitKey) try { await getRedis().decr(rateLimitKey); } catch(_) {}
      return res.status(500).json({ error: '글 분석 중 오류가 발생했습니다.' });
    }

    let analysisResult;
    try {
      const claudeText = claudeData.content?.[0]?.text || '';
      const jsonMatch = claudeText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON found');
      analysisResult = JSON.parse(jsonMatch[0]);
    } catch (parseErr) {
      console.error('Parse error:', parseErr);
      if (rateLimitKey) try { await getRedis().decr(rateLimitKey); } catch(_) {}
      return res.status(500).json({ error: '분석 결과를 처리할 수 없습니다.' });
    }

    // Step 2: DALL-E 3 → 썸네일 배경 1장 (1024×1024)
    const dalleResponse = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'dall-e-3',
        prompt: analysisResult.dalle_prompt,
        n: 1,
        size: '1024x1024',
        quality: 'standard',
      }),
    });

    const dalleData = await dalleResponse.json();

    if (dalleData.error) {
      console.error('DALL-E Error:', dalleData.error);
      if (rateLimitKey) try { await getRedis().decr(rateLimitKey); } catch(_) {}
      return res.status(500).json({ error: '썸네일 이미지 생성에 실패했습니다. 잠시 후 다시 시도해주세요.' });
    }

    const thumbnailUrl = dalleData.data?.[0]?.url;

    // Step 3: Unsplash → 본문 이미지 7장 (키워드 3개: 3+2+2)
    const keywords = analysisResult.unsplash_keywords || [];
    const perPageCounts = [3, 2, 2];

    const unsplashRequests = keywords.slice(0, 3).map((kw, i) =>
      fetch(
        `https://api.unsplash.com/search/photos?query=${encodeURIComponent(kw)}&per_page=${perPageCounts[i] || 2}&orientation=landscape`,
        { headers: { Authorization: `Client-ID ${process.env.UNSPLASH_ACCESS_KEY}` } }
      ).then(r => r.json())
    );

    const unsplashResults = await Promise.allSettled(unsplashRequests);

    const bodyImages = [];
    for (const result of unsplashResults) {
      if (result.status === 'fulfilled' && result.value?.results) {
        for (const photo of result.value.results) {
          bodyImages.push({
            url: photo.urls?.regular,
            thumb: photo.urls?.small,
            downloadUrl: photo.links?.download_location,
            photographer: photo.user?.name,
            photographerUrl: photo.user?.links?.html,
          });
        }
      }
    }

    return res.status(200).json({
      dallePrompt: analysisResult.dalle_prompt,
      thumbnailUrl,
      unsplashKeywords: keywords,
      bodyImages: bodyImages.slice(0, 7),
      remaining,
      limit: FREE_DAILY_LIMIT,
    });
  } catch (error) {
    console.error('API Error:', error);
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
}
