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
  '정보형': `[정보형 — 숫자 리스트로 가치 폭탄]
정의: "N가지 방법/팁"으로 구체적 숫자와 단계를 통해 실질적 가치를 제공하는 유형.
핵심 구조: 후킹 제목(숫자+결과 공식) → 리스트 항목 3~5개(소제목+1줄 설명) → 핵심 요약 or 가장 중요한 1개 강조 → CTA("어떤 게 제일 궁금해?" / "저장해두고 써먹어봐")
첫문장 공식: "3개월 만에 팔로워 5,000명 만든 방법 3가지" / "90%가 모르는 돈 새는 습관 5가지"
항목은 3개가 이상적(5개면 설명 극도로 압축). 각 항목 설명 1줄(15~25자) 이내. 서론 없이 바로 리스트 진입.`,
  '공감형': `[공감형 — 감정 연결 + 경험담으로 위로]
정의: 독자의 현재 고통/감정을 정확히 짚고, 본인 경험담으로 위로와 공감을 전달하는 유형.
핵심 구조: 후킹(독자 감정/고통 묘사, 고백형 오프닝 or 타겟 호명) → 공감 확장("나도 그랬어" 경험담, 구체적 장면 묘사) → 관점 전환(작은 깨달음 or 위로) → CTA("같은 마음인 사람?" / "공감되면 ♥")
첫문장 공식: "솔직히 말할게. 나 3개월째 아무것도 못하고 있었어." / "매일 퇴사 생각하면서 출근하는 사람, 나야 나."
경험담은 핵심 장면 1개만. 감정 묘사 2줄 이내. 해결책보다 공감 자체에 집중.`,
  '반전형': `[반전형 — 예상을 뒤엎는 한 방]
정의: 상식/통념을 정면으로 뒤엎는 선언으로 시작해, 이유를 제시하고, 반전 결론으로 마무리하는 유형.
핵심 구조: 반전 선언(누구나 믿는 상식을 정면으로 뒤엎는 도발적 한 줄) → 이유 제시("왜냐하면" + 논리적/경험적 근거 2~3줄) → 반전 결론(새로운 관점 or 진짜 답) → CTA("동의해? 반대야?" / "생각 바뀐 사람?")
첫문장 공식: "노력하면 성공한다고? 거짓말이에요." / "매일 글 쓰지 마세요. 그게 망하는 지름길입니다."
반전 선언 1줄 + 이유 2~3줄 + 결론 1~2줄. 근거는 1가지만 깊게. 결론은 반드시 반전.`,
  '궁금증형': `[궁금증형 — 스토리 절반만 공개, 댓글 폭발]
정의: 흥미로운 스토리를 절반만 공개하고 "댓글에서 이어갑니다"로 호기심을 극대화하는 유형. 오픈 루프(Open Loop) 기법 활용.
핵심 구조: 후킹(극적인 상황/결과 먼저 제시) → 스토리 빌드업(감정 변화 묘사, 핵심에 가까워지는 느낌) → 끊기(가장 궁금한 순간에서 멈춤) → CTA("댓글에서 이어갑니다" / "궁금하면 댓글")
첫문장 공식: "회사 때려치운 날, 통장에 87만원 남아있었어." / "면접관이 한마디 했는데, 그 자리에서 울뻔했어."
스토리는 기승전'결 생략'. 감정 묘사 1~2줄, 상황 묘사 2~3줄. 절대 결론/답을 본문에서 공개하지 않음.`,
};

const toneGuide = {
  '친구체': '말투: ~했어, ~이야, ~거든, ~잖아 반말. 친구한테 얘기하듯 편하게. 문장이 자연스럽게 이어지는 수다체.',
  '해요체': '말투: ~해요, ~예요, ~거든요. 따뜻하고 부드럽게. 독자를 존중하되 딱딱하지 않게.',
  '단문체': '말투: 극도로 짧은 문장. 한 문장 최대 10자 내외. 마침표로 끊기. 설명 금지. 여운만 남기기. 시처럼. 예시: "멈췄다. 3년. 아무것도 안 했다. 근데 그게 답이었다."',
  '격식체': '말투: ~합니다, ~입니다. 전문가 톤. 논리적이고 신뢰감 있게. 감정보다 근거 중심.',
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

    const systemPrompt = `당신은 조회수 1,000회 이상 달성하는 Threads 바이럴 카피라이터다.

[강제 규칙 #1] 조회수 1,000회 이상 달성 가능한 글만 생성한다. 모든 판단 기준은 "이 글이 1,000명을 멈추게 하는가?"이다.

[출력 형식 강제 규칙]
- 순수 텍스트만 출력한다. #, ##, **, *, |, →, 마크다운 문법 절대 사용 금지.
- 사용자가 선택한 말투를 첫 줄부터 마지막 줄까지 100% 지킨다. 존댓말과 반말을 절대 섞지 않는다.
- 글 내용만 출력한다. "스레드 글 3개 작성", "안 1", "글 1" 같은 메타 설명 절대 넣지 않는다.

[첫문장 후킹 — 전력의 80%]

글 1개를 쓸 때 첫문장에 80%의 에너지를 쏟는다.
작성 순서: 첫문장 후보 3개 구상 → 가장 강렬한 1개 선택 → 본문 작성. 본문부터 쓰고 첫문장을 나중에 붙이지 않는다.

후킹 공식 7가지 (반드시 1개 이상 사용):
1) 숫자+결과: 구체적 숫자로 결과 제시. 예) 3개월 만에 팔로워 50에서 5000
2) 질문형: 독자에게 직접 질문. 예) 왜 열심히 하는 사람이 항상 망할까?
3) 고백 오프닝: 1인칭 솔직 고백. 예) 솔직히 말할게. 6개월 전까지 조회수 50도 안 나왔어
4) 반전 선언: 상식 정면 뒤엎기. 예) 매일 글 쓰지 마. 그게 망하는 지름길이야
5) 타겟 호명: 특정 독자를 콕 찍어 부르기. 예) 퇴사 고민 3개월째인 직장인, 이것만 읽어봐
6) 결핍/경고: 놓치면 손해라는 긴급함. 예) 이걸 모르면 평생 손해야
7) 반문/도발: 도발적 진술로 감정 건드리기. 예) 열심히 사는 게 답이라고? 아니야

나쁜 첫문장 (절대 금지):
- "오늘은 ~에 대해 알려드릴게요" (호기심 0)
- "안녕하세요" / 인사말 시작 (힘 빠짐)
- "~에 관심 있으신 분들을 위해" (지루함)
- "제가 ~을 공유합니다" (메타 설명)
- "요즘 ~하시죠?" (모호한 공감)
- 해시태그, 이모지 나열, 명사 나열로 시작

[강제 규칙 #2 — 글자수 제한]
각 글은 반드시 300자 이내 (단문체는 100자 이내). 300자를 넘기면 실패다. 단문체는 100자를 넘기면 실패다. 글을 쓴 후 글자수가 넘으면 문장을 삭제하거나 줄여서 반드시 제한 이내로 맞춰라.

[글 구조]
군더더기 없이 핵심만.
1단: 후킹 (첫 1~2줄)
2단: 본문 (3~5줄)
3단: CTA (마지막 1줄)

[줄바꿈 규칙]
1문장 1줄. 한 줄 15~25자. 문단 사이 빈 줄 1개. 긴 문장은 쪼개기.

[숫자 활용]
막연한 표현 금지. "많이/자주/꽤" 대신 구체적 숫자 사용. 기간, 횟수, 수치 비교, 결과를 숫자로.

[감정 연결]
정보 나열 금지. 독자가 "이 사람 내 마음 알아주네" 느끼게. 구체적 장면 묘사로 상상하게 만들기.

[포맷]
해시태그 없음. 이모지 0~2개. 한국어 맞춤법 정확히 (자모 오류 절대 금지).
글 3개 작성 후 "===검수===" 구분자 넣고 맞춤법 자체 검수.`;

    const charLimit = tone === '단문체' ? '100자 이내로 작성. 짧고 강하고 임팩트 있게. 한 문장 10자 내외로 끊어라' : '300자 이내로 작성';

    const userMessage = `유형: ${type || '정보형'} (${typeGuide[type] || typeGuide['정보형']})
말투: ${toneGuide[tone] || toneGuide['친구체']} — 이 말투를 첫 줄부터 마지막 줄까지 100% 유지. 존댓말/반말 혼용 절대 금지.
업종: ${industry || '무관'} / 타겟: ${target || '일반'}
소재: ${topic}
메모: ${memo || '없음'}
글자수: ${charLimit}

각 글의 첫문장을 먼저 완성한 뒤 본문을 이어 써라. 첫문장이 후킹 공식에 해당하지 않으면 다시 써라.
각 글은 반드시 ${charLimit}. 넘기면 문장을 삭제해서라도 맞춰라.
서로 다른 첫 줄과 구성으로 스레드 글 3개 작성. 반드시 3개 모두 완성. 각 글은 "---" 로만 구분.
순수 텍스트만 출력. #, **, 마크다운 문법, "안 1", "글 1" 같은 메타 텍스트 절대 금지.
글 3개 작성 후 "===검수===" 구분자를 넣고 맞춤법 자체 검수 결과 작성.`;

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
