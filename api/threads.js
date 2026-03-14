import { Redis } from '@upstash/redis';
import { resolveAdmin, setCorsHeaders } from './_helpers.js';

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
  '정보형': `[정보형]
구조: 후킹 제목(숫자+결과) -> 리스트 3~5개(소제목+1줄 설명) -> 핵심 요약 -> CTA
첫문장 공식: [기간]+[결과 숫자]+[방법 N가지] 또는 [비율]%가 모르는 [소재] N가지
항목 3개 이상적. 각 항목 설명 1줄 이내. 서론 없이 바로 리스트 진입.`,
  '공감형': `[공감형]
구조: 후킹(감정/고통 묘사, 고백 or 타겟 호명) -> 공감 확장(경험담, 장면 묘사) -> 관점 전환(깨달음/위로) -> CTA
첫문장 공식: 솔직 고백(나도 ~했어) 또는 타겟 호명(~하는 사람, 나야 나)
경험담은 핵심 장면 1개만. 감정 묘사 2줄 이내. 해결책보다 공감 자체에 집중.`,
  '반전형': `[반전형]
구조: 반전 선언(상식을 뒤엎는 한 줄) -> 이유 제시(근거 2~3줄) -> 반전 결론 -> CTA
첫문장 공식: [상식]이라고? 거짓말이다 또는 [행동] 하지 마. 그게 망하는 길이다
반전 선언 1줄 + 이유 2~3줄 + 결론 1~2줄. 근거 1가지만 깊게.`,
  '궁금증형': `[궁금증형]
구조: 후킹(극적 상황/결과 먼저) -> 스토리 빌드업(감정 변화) -> 끊기(가장 궁금한 순간에 멈춤) -> CTA
첫문장 공식: [극적 상황]+[구체적 숫자/디테일] 또는 [누군가]+[한마디/행동]+[감정 반응]
기승전'결 생략'. 감정 1~2줄, 상황 2~3줄. 결론/답을 본문에서 절대 공개 금지.`,
};

const toneGuide = {
  '친구체': '어미: ~했어, ~이야, ~거든, ~잖아. 친구한테 얘기하듯 편한 수다체.',
  '해요체': '어미: ~해요, ~예요, ~거든요. 따뜻하고 부드럽게. 독자 존중하되 딱딱하지 않게.',
  '단문체': '어미: 마침표로 끊기. 극도로 짧게. 임팩트만 남겨라.',
  '격식체': '어미: ~합니다, ~입니다. 전문가 톤. 논리적이고 신뢰감. 감정보다 근거.',
};

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

    // Rate limit (INCR-first, 관리자 스킵)
    const whitelisted = await resolveAdmin(req);

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

    const systemPrompt = `당신은 Threads 바이럴 카피라이터다. 조회수 1,000회 이상을 목표로 하되, 사용자 소재를 왜곡하지 않는다.

[우선순위 — 반드시 이 순서대로 지킨다]
1순위: 사용자가 입력한 업종/타겟/소재/메모를 글의 핵심으로 반영한다. 이것을 무시한 글은 실패다.
2순위: 유형별 구조와 말투 가이드를 정확히 따른다.
3순위: 글자수 가이드를 지킨다 (서버에서 최종 보정한다).
4순위: 바이럴 최적화 (후킹, 감정 연결, 숫자 활용).

[출력 형식 — 위반 시 전체 무효]
순수 텍스트만 출력한다. 마크다운(#, **, *), 해시태그, 메타 설명("안 1", "글 1") 절대 금지.
이모지 0~2개. 한국어 맞춤법 정확히 지킨다.

[말투 — 위반 시 전체 무효]
선택된 말투의 어미를 첫 줄부터 마지막 줄까지 100% 유지한다. 존댓말과 반말을 섞는 순간 실패다.

[첫문장 — 전력의 80%]
첫문장을 먼저 완성한 후 본문을 쓴다. 유형 가이드의 첫문장 공식을 우선 적용한다.
해당하지 않으면 참고: 숫자+결과 / 질문형 / 고백 오프닝 / 반전 선언 / 타겟 호명 / 결핍 경고 / 반문 도발
금지 첫문장: "오늘은 ~에 대해", 인사말, "~에 관심 있으신 분들", "제가 ~을 공유합니다", "요즘 ~하시죠?"

[글 구조]
유형 가이드의 구조를 따른다.

[줄바꿈]
1문장 1줄. 한 줄 15~25자 (단문체는 제외). 문단 사이 빈 줄 1개.

[내용 원칙]
막연한 표현("많이/자주/꽤") 대신 구체적 숫자를 쓴다.
정보 나열이 아니라 독자의 감정을 건드리는 장면 묘사로 쓴다.`;

    const charLimit = tone === '단문체' ? '짧게 써라. 임팩트만 남겨라.' : '300자 이내로 작성';

    const userMessage = `업종: ${industry || '무관'}
타겟: ${target || '일반'}
소재: ${topic}
메모: ${memo || '없음'}

유형: ${type || '정보형'}
${typeGuide[type] || typeGuide['정보형']}

말투: ${toneGuide[tone] || toneGuide['친구체']}
글자수: ${charLimit}

[작업 지시]
서로 다른 첫 줄과 구성으로 스레드 글 3개 작성.
각 글의 첫문장을 유형 가이드의 첫문장 공식으로 먼저 완성한 뒤 본문을 써라.
각 글은 "---"로만 구분.
글 3개 작성 후 "===검수===" 구분자를 넣고 맞춤법 자체 검수.`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
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

    // 응답 파싱: 검수 섹션 분리 후 "---"로 split
    const raw = (data.content?.[0]?.text || '').trim();

    // ===검수=== 구분자로 글과 검수 결과 분리
    const [contentPart, reviewPart] = raw.split(/===검수===/);
    const results = (contentPart || '').trim().split(/\n?---\n?/).map(s => s.trim()).filter(Boolean);
    while (results.length < 3) results.push('');

    // 글자수 서버 후처리: 단문체 100자 / 기본 300자 하드리밋
    const hardLimit = tone === '단문체' ? 100 : 300;
    for (let i = 0; i < results.length; i++) {
      if (results[i].replace(/\s/g, '').length > hardLimit) {
        const lines = results[i].split('\n').filter(l => l.trim());
        let trimmed = '';
        for (const line of lines) {
          const next = trimmed ? trimmed + '\n' + line : line;
          if (next.replace(/\s/g, '').length > hardLimit) break;
          trimmed = next;
        }
        results[i] = trimmed;
      }
    }

    // 검수 결과에서 오타→수정 패턴 추출 및 적용
    if (reviewPart) {
      const corrections = [...reviewPart.matchAll(/["""]?([^"""\s→]+)["""]?\s*→\s*["""]?([^"""\s,.\n]+)["""]?/g)];
      corrections.forEach(([, wrong, correct]) => {
        if (wrong && correct && wrong !== correct && wrong !== '오타' && wrong !== '오타단어') {
          for (let i = 0; i < results.length; i++) {
            if (results[i].includes(wrong)) {
              results[i] = results[i].split(wrong).join(correct);
              console.log(`[맞춤법 수정] 글${i+1}: "${wrong}" → "${correct}"`);
            }
          }
        }
      });
    }

    return res.status(200).json({ results, remaining, limit: FREE_DAILY_LIMIT });

  } catch (error) {
    console.error('Threads API Error:', error);
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
}
