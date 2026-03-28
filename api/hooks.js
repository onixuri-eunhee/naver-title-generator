import { Redis } from '@upstash/redis';
import { resolveAdmin, setCorsHeaders } from './_helpers.js';

const FREE_DAILY_LIMIT = 5;

function extractToken(req) {
  const auth = req.headers['authorization'] || req.headers['Authorization'] || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7);
  return req.body?.token || req.query?.token || null;
}

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
    req.headers['x-real-ip'] ||
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.socket?.remoteAddress ||
    'unknown'
  );
}

function getKSTDate() {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

function getTodayKey(email) {
  return `ratelimit:hooks:${email}:${getKSTDate()}`;
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

const SYSTEM_PROMPT = `당신은 SNS 후킹문구 전문 카피라이터다. 릴스, 숏츠, 틱톡, 스레드의 첫 줄에서 0.2초 안에 스크롤을 멈추게 하는 것이 목표다.

[절대 규칙]
1. 정확히 15개의 후킹문구를 생성한다.
2. 각 문구는 1줄, 15~40자 이내.
3. 업종과 키워드를 자연스럽게 반영한다.
4. 한국어 조사(은/는, 이/가, 을/를)를 정확히 사용한다.
5. 출력은 순수 텍스트만. 마크다운, 해시태그 금지.
6. 이모지는 문구당 0~1개까지만.
7. 15개 문구를 줄바꿈으로 구분하여 출력한다. 번호 없이.

[14가지 심리학 기반 후킹 공식]
14가지 공식을 고르게 활용하되, Tier 1(패턴 인터럽트, 손실회피, 호기심폭발) 비율을 높여라.

--- Tier 1: 즉각 반응 (0.1~0.3초, 무의식 수준) ---

1. 패턴 인터럽트: 예상을 깨는 문장으로 뇌의 자동 스크롤을 강제 중단시킨다.
   예: "읽지 마세요. (단, OO 고민이 없다면)"
   예: "이건 광고가 아닙니다. 진짜입니다"
   예: "경고: 이 글 읽으면 기존 방법으로 못 돌아갑니다"

2. 손실회피: 모르면 손해, 잘못하면 망한다. 인간은 이익보다 손실에 2배 반응.
   예: "이거 모르면 계속 손해봅니다"
   예: "이 실수만 안 해도 달라집니다"
   예: "아직도 이렇게 하고 계세요? 돈 버리는 겁니다"

3. 호기심폭발: 정보 격차를 만든다. 알고 싶지만 모른다는 느낌이 스크롤을 멈춘다.
   예: "업계 사람만 아는 비밀"
   예: "이걸 알고 나면 다시는 예전으로 못 돌아가요"
   예: "아무도 안 알려주는데, 사실은요"

--- Tier 2: 빠른 인지 반응 (0.3~1초) ---

4. 구체성수치: 3가지, 5단계, 단 1분 — 수치가 신뢰도와 집중도를 높인다.
   예: "딱 3가지만 기억하면 됩니다"
   예: "10명 중 9명이 잘못하고 있어요"
   예: "매출 200% 올린 사장님의 루틴 1가지"

5. 정체성호출: 자아상을 건드려 멈추게 만든다. "나를 부르는 글"이라 느끼게 한다.
   예: "진심으로 잘하고 싶은 분만 보세요"
   예: "남들과 다르게 가고 싶은 사장님이라면"
   예: "야심 있는 사장님만 읽으세요"

6. 사회적증거: 다른 사람들도 하고 있다는 동조 본능을 자극한다.
   예: "요즘 사장님들 다 이걸로 바꾸고 있어요"
   예: "1만 명이 이미 시작한 방법"
   예: "이 글이 공유 3천 회 넘은 이유"

--- Tier 3: 감정적 인지 반응 (1~3초) ---

7. 문제공감: 고객이 겪는 실제 불편/고통을 먼저 꺼낸다.
   예: "왜 살이 안 빠질까요?"
   예: "솔직히 힘드신 거, 당신 잘못이 아닙니다"
   예: "매일 열심히 하는데 왜 결과가 안 나올까요"

8. 상식비틀기: 다들 좋다는 것의 역습. 상식을 뒤집어 호기심 자극.
   예: "열심히 했는데 효과 없는 이유"
   예: "좋다는 게 오히려 독이 될 수 있습니다"
   예: "많이 한다고 잘되는 게 아닙니다"

9. 욕망자극: 예뻐지고 싶다, 돈 벌고 싶다, 인정받고 싶다. 근본 욕구를 건드린다.
   예: "이것 하나로 매출이 달라집니다"
   예: "달라진 고객들의 공통점"
   예: "한 달 만에 인생이 바뀐 사람들의 비밀"

10. 권위부여: 경력, 실적, 고객 수 등 신뢰를 자연스럽게 심는다.
    예: "상위 1% 사장님이 실제로 쓰는 방법"
    예: "수천 명 상담에서 나온 공식"
    예: "20년 경력 전문가의 단 한 가지 조언"

11. 오픈루프: 미완결 정보로 계속 신경 쓰이게 만든다. 뇌는 미완결을 해소하려 한다.
    예: "3가지 중 마지막이 진짜인데..."
    예: "사장님들이 가장 많이 하는 실수가 있는데요"
    예: "이걸 알고 나면..."

12. 즉시성: "지금 당장", "바로 써먹을 수 있는" — 행동 유도.
    예: "지금 당장 해결하는 방법"
    예: "오늘부터 바꾸는 단 한 가지"
    예: "이 글 읽자마자 바로 적용하세요"

13. 비밀은밀함: "전문가만 아는", "아무도 안 알려주는" — 독점적 정보 느낌.
    예: "절대 공개 안 하는 비법"
    예: "말 안 해주는 속사정"
    예: "업계에서 쉬쉬하는 이야기"

14. 비교자극: A vs B. 인간의 뇌는 비교에 강하게 반응.
    예: "성공하는 사람 vs 실패하는 사람"
    예: "전 vs 후, 달라지는 것들"
    예: "상위 10% vs 나머지 90%의 차이"

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
  setCorsHeaders(res, req);

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // GET: 남은 횟수 조회
  if (req.method === 'GET') {
    try {
      const whitelisted = await resolveAdmin(req);
      if (whitelisted) {
        return res.status(200).json({ remaining: 999, limit: FREE_DAILY_LIMIT, admin: true });
      }
      const token = extractToken(req);
      const email = await resolveSessionEmail(token);
      if (!email) {
        return res.status(200).json({ remaining: 0, limit: FREE_DAILY_LIMIT, loginRequired: true });
      }
      const key = getTodayKey(email);
      const count = (await getRedis().get(key)) || 0;
      const remaining = Math.max(FREE_DAILY_LIMIT - count, 0);
      return res.status(200).json({ remaining, limit: FREE_DAILY_LIMIT });
    } catch {
      return res.status(200).json({ remaining: 0, limit: FREE_DAILY_LIMIT });
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

    // 로그인 필수
    const whitelisted = await resolveAdmin(req);
    const token = extractToken(req);
    const email = await resolveSessionEmail(token);

    if (!whitelisted && !email) {
      return res.status(401).json({ error: '로그인이 필요합니다.' });
    }

    let remaining = whitelisted ? 999 : FREE_DAILY_LIMIT;

    if (!whitelisted) {
      rateLimitKey = getTodayKey(email);
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
14가지 심리 공식을 골고루 활용하되 Tier 1 비율을 높이고, 업종 특성에 맞는 구체적인 표현을 사용해주세요.`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 800,
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
