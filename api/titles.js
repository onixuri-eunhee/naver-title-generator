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
  return `ratelimit:titles:${ip}:${getKSTDate()}`;
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

const SYSTEM_PROMPT = `당신은 네이버 블로그 제목 전문 카피라이터다. 클릭율(CTR)을 극대화하는 블로그 제목을 생성한다.

[절대 규칙]
1. 각 패턴별로 정확히 2개의 제목을 생성한다. 총 24개.
2. 모든 제목에 사용자 키워드를 자연스럽게 포함한다.
3. 제목 길이: 20~35자 (모바일 검색 결과에서 잘리지 않도록).
4. 한국어 조사(은/는, 이/가, 을/를, 으로/로)를 정확히 사용한다.
5. 숫자를 활용할 때는 키워드 맥락에 맞는 구체적 숫자를 쓴다.
6. 출력은 순수 텍스트만. 마크다운, 이모지, 해시태그 금지.
7. 각 제목은 줄바꿈으로 구분한다.

[12가지 패턴]

== 긍정 메시지 (고객이 얻을 이득) ==
P1. 이득+숫자형: 핵심 정보 N가지를 약속하는 제목. "~알아야 할 N가지", "~핵심 정리"
P2. 성공사례형: 실제 경험/후기를 암시하는 제목. "~해봤더니", "~사장님의 공통점", "실제 후기"
P3. 전문가가이드형: 전문가 권위를 활용한 제목. "N년 경력", "전문가가 말하는", "가장 먼저 확인하는"
P4. 방법+체크리스트형: 실용적 행동 지침. "~체크리스트", "~N분 안에", "~주의사항"

== 위협 메시지 (잃을 위기) ==
P5. 모르면손해형: FOMO 자극. "아직도 모르고 계세요?", "이것 놓치면 손해"
P6. 공통점경고형: 실패 패턴 경고. "돈 날리는 사람들의 공통점", "반드시 놓치는 것"
P7. 의심하라형: 위험 신호 경고. "당장 의심해봐야", "반드시 읽어보세요"
P8. 공동의적형: 불합리한 상황 폭로. "내 돈이 새고 있다", "큰일 납니다"

== 호기심 메시지 (예측 불가능) ==
P9. 가치입증형: 실적/수치로 호기심 유발. "누적 N명이 선택한", "왜 찾아오는 걸까요?"
P10. 상식파괴형: 기존 상식을 뒤집는 반전. "사실은 정반대", "불편한 진실"
P11. 질문&비교형: 비교/질문으로 궁금증 유발. "A vs B", "뭐가 다를까요?"
P12. 타깃호출형: 특정 독자를 직접 호출. "~하시는 분만 보세요", "~분들에게만"

[출력 형식]
P1:
제목1
제목2
P2:
제목1
제목2
...
P12:
제목1
제목2`;

/**
 * 파싱: P1: ~ P12: 형식의 텍스트를 { p1: [t1, t2], ... p12: [t1, t2] } 로 변환
 */
function parseResponse(raw) {
  const results = {};
  // P1: ~ P12: 패턴별로 분리
  const patternRegex = /P(\d{1,2}):\s*\n/gi;
  const sections = raw.split(patternRegex);

  // sections: ['', '1', '제목1\n제목2\n', '2', '제목1\n제목2\n', ...]
  for (let i = 1; i < sections.length; i += 2) {
    const num = parseInt(sections[i], 10);
    if (num < 1 || num > 12) continue;
    const key = `p${num}`;
    const lines = (sections[i + 1] || '')
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 0);

    // 제목 40자 초과 시 트리밍
    const trimmed = lines.slice(0, 2).map(title => {
      if (title.length > 40) {
        return title.slice(0, 40).replace(/[,\s]+$/, '');
      }
      return title;
    });

    results[key] = trimmed;
  }

  return results;
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
    const { keyword, category } = req.body;

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

    const userMessage = `업종: ${category || '무관'}
키워드: ${keyword}

위 업종과 키워드에 맞는 네이버 블로그 제목을 12패턴 x 2개 = 총 24개 생성해주세요.
키워드를 제목 앞쪽에 자연스럽게 배치하고, 업종 맥락을 반영해주세요.`;

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
      console.error('Claude API Error (titles):', data);
      if (rateLimitKey) try { await getRedis().decr(rateLimitKey); } catch (_) {}
      return res.status(500).json({ error: '제목 생성 중 오류가 발생했습니다.' });
    }

    const raw = (data.content?.[0]?.text || '').trim();
    const results = parseResponse(raw);

    // 파싱 결과 검증: 최소 1개 패턴이라도 있으면 성공
    const hasResults = Object.keys(results).length > 0;
    if (!hasResults) {
      console.error('Title parsing failed. Raw:', raw);
      if (rateLimitKey) try { await getRedis().decr(rateLimitKey); } catch (_) {}
      return res.status(200).json({ results: {}, remaining, limit: FREE_DAILY_LIMIT, fallback: true });
    }

    return res.status(200).json({ results, remaining, limit: FREE_DAILY_LIMIT });

  } catch (error) {
    console.error('Titles API Error:', error);
    // 예외 발생 시 rate limit 카운트 복원 (INCR 이후 실패한 경우)
    if (rateLimitKey) {
      try { await getRedis().decr(rateLimitKey); } catch (_) {}
    }
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
}
