import { Redis } from '@upstash/redis';

const FREE_DAILY_LIMIT = 5;

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
  return `ratelimit:threads:${ip}:${getKSTDate()}`;
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

const typeGuide = {
  '정보형': '유용한 팁 전달. 첫 줄에 핵심 예고.',
  '공감형': '"나도 그래" 유도. 공통 감정 → 위로 마무리.',
  '반전형': '일반적 생각 → 예상 뒤집기 → 인사이트 1줄.',
  '고백형': '1인칭 솔직 경험담. 날 것의 문체.',
};

const toneGuide = {
  '친구체': '말투: ~했어, ~이야, ~거든 반말.',
  '해요체': '말투: ~해요, ~예요. 따뜻하고 부드럽게.',
  '단문체': '말투: 짧은 단문. 마침표 끊기. 감탄사 최소.',
  '격식체': '말투: ~합니다, ~입니다. 전문가 느낌.',
};

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
    const { type, tone, industry, target, topic, memo } = req.body;

    if (!topic) {
      return res.status(400).json({ error: '주제/소재를 입력해주세요.' });
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

    const systemPrompt = 'Threads SNS 카피라이터. 규칙: ①80~130자 ②1문장 1줄+줄바꿈 리듬 ③첫 줄에서 2초 안에 멈추게 ④해시태그 없음 ⑤글만 출력 ⑥한국어 맞춤법 정확히 지킬 것. 한글 자모 조합 오류 절대 금지(예: "모발"→"모펜", "관리"→"관래" 같은 오타 불가). 출력 전 모든 단어 맞춤법 검수 필수.';

    const userMessage = `유형: ${type || '정보형'} (${typeGuide[type] || typeGuide['정보형']})
${toneGuide[tone] || toneGuide['친구체']}
업종: ${industry || '무관'} / 타겟: ${target || '일반'}
소재: ${topic}
메모: ${memo || '없음'}

서로 다른 첫 줄과 구성으로 스레드 글 3개 작성. 각 글은 "---" 로만 구분.`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 600,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Claude API Error:', data);
      if (rateLimitKey) try { await getRedis().decr(rateLimitKey); } catch(_) {}
      return res.status(500).json({ error: '글 생성 중 오류가 발생했습니다.' });
    }

    // 응답 파싱: "---"로 split하여 3개 결과 추출
    const raw = (data.content?.[0]?.text || '').trim();
    const results = raw.split(/\n?---\n?/).map(s => s.trim()).filter(Boolean);
    while (results.length < 3) results.push('');

    return res.status(200).json({ results, remaining, limit: FREE_DAILY_LIMIT });

  } catch (error) {
    console.error('Threads API Error:', error);
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
}
