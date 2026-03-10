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
  return `ratelimit:hooks:${ip}:${getKSTDate()}`;
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

const SYSTEM_PROMPT = `당신은 SNS 후킹문구 전문 카피라이터다. 인스타그램/스레드/블로그의 첫 줄에서 스크롤을 멈추게 하는 후킹문구를 생성한다.

[절대 규칙]
1. 정확히 15개의 후킹문구를 생성한다.
2. 각 문구는 1줄, 15~40자 이내.
3. 업종과 키워드를 자연스럽게 반영한다.
4. 한국어 조사(은/는, 이/가, 을/를)를 정확히 사용한다.
5. 출력은 순수 텍스트만. 마크다운, 해시태그 금지.
6. 이모지는 문구당 0~1개까지만.
7. 15개 문구를 줄바꿈으로 구분하여 출력한다. 번호 없이.

[10가지 심리학 기반 후킹 공식 — 반드시 아래 공식을 골고루 활용]

1. 문제공감: 고객이 겪는 실제 불편/고통을 먼저 꺼낸다.
   예: "왜 살이 안 빠질까요?", "솔직히 힘드신 거, 당신 잘못이 아닙니다"

2. 손실회피: 모르면 손해, 잘못하면 망한다. 인간은 이익보다 손실에 2배 반응.
   예: "이거 모르면 계속 손해봅니다", "이 실수만 안 해도 달라집니다"

3. 호기심폭발: 정보 격차를 만든다. 알고 싶지만 모른다는 느낌이 클릭을 부른다.
   예: "업계 사람만 아는 비밀", "이걸 알고 나면 다시는 예전으로 못 돌아가요"

4. 상식비틀기: 다들 좋다는 것의 역습. 상식을 뒤집어 호기심 자극.
   예: "열심히 했는데 효과 없는 이유", "좋다는 게 오히려 독이 될 수 있습니다"

5. 욕망자극: 예뻐지고 싶다, 돈 벌고 싶다, 인정받고 싶다. 근본 욕구를 건드린다.
   예: "이것 하나로 매출이 달라집니다", "달라진 고객들의 공통점"

6. 권위부여: 경력, 실적, 고객 수 등 신뢰를 자연스럽게 심는다.
   예: "상위 1% 사장님이 실제로 쓰는 방법", "수천 명 상담에서 나온 공식"

7. 즉시성: "지금 당장", "바로 써먹을 수 있는" — 행동 유도.
   예: "지금 당장 해결하는 방법", "오늘부터 바꾸는 단 한 가지"

8. 구체성수치: 3가지, 5단계, 단 1분 — 수치가 신뢰도와 집중도를 높인다.
   예: "딱 3가지만 기억하면 됩니다", "10명 중 9명이 잘못하고 있어요"

9. 비밀은밀함: "전문가만 아는", "아무도 안 알려주는" — 독점적 정보 느낌.
   예: "절대 공개 안 하는 비법", "말 안 해주는 속사정"

10. 비교자극: A vs B. 인간의 뇌는 비교에 강하게 반응.
    예: "성공하는 사람 vs 실패하는 사람", "전 vs 후, 달라지는 것들"

[출력 형식]
후킹문구1
후킹문구2
...
후킹문구15`;

/**
 * 파싱: 줄바꿈으로 분리 + 빈 줄 제거 + 번호 제거 + 50자 초과 트리밍
 */
function parseResponse(raw) {
  const lines = raw
    .split('\n')
    .map(l => l.trim())
    // 번호 접두사 제거 (예: "1. ", "1) ") — 마침표/괄호 있는 경우만 제거, 공백만 있는 경우는 제거하지 않음
    .map(l => l.replace(/^\d{1,2}[\.)][\s]+/, '').trim())
    .filter(l => l.length > 0);

  // 50자 초과 시 트리밍
  const trimmed = lines.map(hook => {
    if (hook.length > 50) {
      return hook.slice(0, 50).replace(/[,\s]+$/, '');
    }
    return hook;
  });

  return trimmed;
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

  // try 블록 바깥에 선언 — catch 블록에서도 접근 가능해야 rate limit 복원 가능
  let rateLimitKey = null;

  try {
    const { industry, keyword } = req.body;

    if (!industry) {
      return res.status(400).json({ error: '업종을 입력해주세요.' });
    }
    if (!keyword) {
      return res.status(400).json({ error: '키워드를 입력해주세요.' });
    }

    // Rate limit (INCR-first, 화이트리스트 IP 스킵)
    const ip = getClientIp(req);
    const whitelisted = await getRedis().get(`admin:whitelist:${ip}`);

    if (!whitelisted && FREE_DAILY_LIMIT <= 0) {
      return res.status(429).json({
        error: '현재 무료 사용이 제한되어 있습니다.',
        remaining: 0,
      });
    }

    let remaining = whitelisted ? 999 : FREE_DAILY_LIMIT;

    if (!whitelisted) {
      rateLimitKey = getTodayKey(ip); // catch에서 참조 가능하도록 외부 변수에 할당
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

    const userMessage = `업종: ${industry}
키워드: ${keyword}

위 업종과 키워드에 맞는 SNS 후킹문구 15개를 생성해주세요.
10가지 심리 공식을 골고루 활용하고, 업종 특성에 맞는 구체적인 표현을 사용해주세요.`;

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
        temperature: 0.85,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userMessage }],
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Claude API Error (hooks):', data);
      if (rateLimitKey) try { await getRedis().decr(rateLimitKey); } catch (_) {}
      return res.status(500).json({ error: '후킹문구 생성 중 오류가 발생했습니다.' });
    }

    const raw = (data.content?.[0]?.text || '').trim();
    const results = parseResponse(raw);

    // 파싱 결과 검증: 최소 1개라도 있으면 성공
    if (results.length === 0) {
      console.error('Hook parsing failed. Raw:', raw);
      if (rateLimitKey) try { await getRedis().decr(rateLimitKey); } catch (_) {}
      return res.status(200).json({ results: [], remaining, limit: FREE_DAILY_LIMIT, fallback: true });
    }

    return res.status(200).json({ results, remaining, limit: FREE_DAILY_LIMIT });

  } catch (error) {
    console.error('Hooks API Error:', error);
    // 예외 발생 시 rate limit 카운트 복원 (INCR 이후 실패한 경우)
    if (rateLimitKey) {
      try { await getRedis().decr(rateLimitKey); } catch (_) {}
    }
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
}
