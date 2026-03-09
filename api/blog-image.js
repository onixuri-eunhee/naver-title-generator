import { Redis } from '@upstash/redis';

// 무료 사용자: 하루 3회
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
  return kst.toISOString().slice(0, 10); // YYYY-MM-DD (KST 기준)
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
  return Math.max(seconds, 60); // 최소 60초
}

export default async function handler(req, res) {
  // CORS 헤더
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // GET: 남은 횟수 조회
  if (req.method === 'GET') {
    try {
      const ip = getClientIp(req);
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
    // IP 기반 rate limit 체크
    const ip = getClientIp(req);
    const key = getTodayKey(ip);
    const count = (await getRedis().get(key)) || 0;

    if (count >= FREE_DAILY_LIMIT) {
      return res.status(429).json({
        error: `일일 무료 사용 한도(${FREE_DAILY_LIMIT}회)를 초과했습니다. 내일 다시 이용해주세요.`,
        remaining: 0,
      });
    }

    // 요청 body에서 파라미터 추출
    const { blogText, titleText } = req.body;

    if (!blogText || !titleText) {
      return res.status(400).json({ error: '블로그 글 텍스트와 이미지 제목이 필요합니다.' });
    }

    // Step 1: Claude API 호출 → 블로그 텍스트 분석 → 영문 DALL-E 프롬프트 3개 생성
    const claudeSystemPrompt = `You are an expert image prompt generator for Korean blog posts. Analyze the given Korean blog post and generate exactly 3 DALL-E image prompts in English.

Rules:
- All prompts must be in English
- Style: realistic photography style, high quality, bright and clean aesthetic, suitable for Korean blog
- NEVER include any text, letters, words, or typography in the image
- prompt_1: Background image for the blog thumbnail. Must have a clean center area suitable for text overlay. Slightly blurred or simple composition in the center. Related to the blog topic.
- prompt_2: Image for the top section of the blog body. Visually represents the core topic/theme of the blog post.
- prompt_3: Image for the bottom section of the blog body. Represents the conclusion, emotion, or takeaway of the blog post.

Respond ONLY with valid JSON in this exact format:
{
  "prompt_1": "...",
  "prompt_2": "...",
  "prompt_3": "..."
}`;

    const claudeResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        system: claudeSystemPrompt,
        messages: [
          {
            role: 'user',
            content: `다음 한국어 블로그 글을 분석하고 DALL-E 이미지 프롬프트 3개를 생성해주세요.\n\n블로그 글:\n${blogText.slice(0, 3000)}`,
          },
        ],
      }),
    });

    const claudeData = await claudeResponse.json();

    if (!claudeResponse.ok) {
      console.error('Claude API Error:', claudeData);
      return res.status(500).json({ error: '글 분석 중 오류가 발생했습니다.' });
    }

    // Claude 응답에서 JSON 파싱
    let prompts;
    try {
      const claudeText = claudeData.content[0].text;
      // JSON 블록 추출 (```json ... ``` 또는 순수 JSON)
      const jsonMatch = claudeText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON found');
      prompts = JSON.parse(jsonMatch[0]);
    } catch (parseErr) {
      console.error('Prompt parse error:', parseErr);
      return res.status(500).json({ error: '프롬프트 생성 결과를 파싱할 수 없습니다.' });
    }

    // Step 2: OpenAI DALL-E 3 API로 이미지 3장 생성 (병렬)
    const dalleRequests = [prompts.prompt_1, prompts.prompt_2, prompts.prompt_3].map(
      (prompt) =>
        fetch('https://api.openai.com/v1/images/generations', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          },
          body: JSON.stringify({
            model: 'dall-e-3',
            prompt: prompt,
            n: 1,
            size: '1792x1024',
            quality: 'standard',
          }),
        }).then((r) => r.json())
    );

    const dalleResults = await Promise.all(dalleRequests);

    // 에러 체크
    for (let i = 0; i < dalleResults.length; i++) {
      if (dalleResults[i].error) {
        console.error(`DALL-E Error (image ${i + 1}):`, dalleResults[i].error);
        return res.status(500).json({
          error: `이미지 ${i + 1} 생성 중 오류가 발생했습니다: ${dalleResults[i].error.message || '알 수 없는 오류'}`,
        });
      }
    }

    const images = dalleResults.map((r) => r.data[0].url);

    // 성공 시 카운트 증가 (KST 자정에 만료)
    await getRedis().incr(key);
    await getRedis().expire(key, getTTLUntilMidnightKST());

    const remaining = FREE_DAILY_LIMIT - count - 1;

    // Step 3: 결과 반환
    return res.status(200).json({
      prompts: {
        prompt_1: prompts.prompt_1,
        prompt_2: prompts.prompt_2,
        prompt_3: prompts.prompt_3,
      },
      images,
      remaining,
    });
  } catch (error) {
    console.error('API Error:', error);
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
}
