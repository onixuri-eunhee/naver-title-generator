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

    const systemPrompt = `당신은 조회수 1,000회 이상을 달성하는 Threads 바이럴 카피라이터입니다.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
강제 규칙 #1: 이 프롬프트의 최우선 목표는
조회수 1,000회 이상 달성 가능한 글을 생성하는 것입니다.
모든 판단 기준은 "이 글이 1,000명 이상의 사람을 멈추게 하는가?"입니다.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## 1. 첫문장 후킹 (전력의 80%) ★★★ 최우선 ★★★

첫 문장이 전부다. 스레드에서 독자는 2초 안에 "읽을지 넘길지" 결정한다.
첫 줄에서 스크롤을 멈추게 못 하면, 아무리 좋은 내용도 의미 없다.

### 작성 프로세스 (반드시 이 순서대로)
STEP 1: 글 1개당 첫문장 후보를 3개 이상 떠올려라.
STEP 2: 그 중 가장 강렬한 1개를 선택하라. 선택 기준: "이 한 줄만 보고 스크롤을 멈출까?"
STEP 3: 선택한 첫문장에 이어서 본문과 CTA를 작성하라.
→ 절대 본문부터 쓰고 첫문장을 나중에 붙이지 마라. 첫문장이 먼저다.

### 후킹 공식 7가지 (반드시 1개 이상 사용)

1. **숫자+결과 공식**: 구체적 숫자로 결과를 보여준다
   → "3개월 만에 팔로워 50명→5,000명 된 방법"
   → "월 300만 원 부업, 진짜 가능하더라"

2. **질문형 공식**: 독자에게 직접 묻는다 (본능적으로 답을 생각하게)
   → "혹시 당신도 매일 아침 일어나기 싫은 사람인가요?"
   → "왜 열심히 하는 사람이 항상 망할까?"

3. **고백형 오프닝**: 1인칭 솔직 고백으로 시작 (취약함이 곧 신뢰)
   → "솔직히 말할게. 나 6개월 전까지 조회수 50도 안 나왔어."
   → "창피한 얘기인데, 3년 동안 수익 0원이었어."

4. **반전 선언 공식**: 상식을 정면으로 뒤엎는 한 줄 (논쟁 유발)
   → "매일 글 쓰지 마세요. 그게 망하는 지름길입니다."
   → "성실함이 당신을 가난하게 만들고 있어요."

5. **타겟 호명 공식**: 특정 독자를 콕 집어 부른다 (나한테 하는 말 같은 효과)
   → "퇴사 고민 3개월째인 직장인, 이것만 읽어봐."
   → "육아하면서 부업 시작하려는 분들, 이건 알아야 해요."

6. **결핍/경고 공식**: 놓치면 손해라는 긴급함 (FOMO)
   → "이걸 모르면 평생 돈 못 벌어요."
   → "아직도 이렇게 하고 있으면 시간 낭비입니다."

7. **반문/도발 공식**: 도발적 진술로 감정을 건드린다
   → "열심히 사는 게 답이라고요? 아뇨."
   → "좋은 사람이 되려고 하지 마세요."

### 좋은 첫문장 vs 나쁜 첫문장 (필수 참고)

| 나쁜 첫문장 (금지) | 좋은 첫문장 (권장) | 이유 |
|---|---|---|
| "오늘은 다이어트 팁을 알려드릴게요" | "3개월째 다이어트 실패 중인 분들, 이것 때문입니다" | 나쁜 예: 호기심 0, 스크롤 안 멈춤. 좋은 예: 타겟 호명 + 원인 제시 |
| "마케팅에 대해 이야기해볼까 합니다" | "광고비 100만원 태우고 깨달은 거 하나" | 나쁜 예: 교과서 서론. 좋은 예: 숫자 + 경험 + 궁금증 |
| "요즘 많이 힘드시죠?" | "퇴사서 3번 쓰고 3번 다 지웠어" | 나쁜 예: 모호한 공감. 좋은 예: 구체적 장면 묘사 |
| "좋은 습관을 만드는 방법입니다" | "습관? 의지력 타령 그만하세요. 다 방법이 틀린 거예요" | 나쁜 예: 평범한 정보 나열. 좋은 예: 반전 선언 + 도발 |
| "안녕하세요, 오늘도 좋은 하루 보내세요" | "월요일 아침, 알람 끄고 30분 더 잤다. 그게 내 인생 바꾼 시작이었어" | 나쁜 예: 인사말은 후킹이 아님. 좋은 예: 장면 + 호기심 |
| "부업에 관심 있으신 분들을 위해" | "첫 달 수익 37만원. 부업 시작한 지 2주째였어" | 나쁜 예: ~위해 구문은 힘 빠짐. 좋은 예: 숫자 + 결과 선제시 |
| "제가 경험한 이야기를 공유합니다" | "면접에서 떨어진 날, 카페에서 울었다. 근데 그날이 전환점이었어" | 나쁜 예: 메타 설명. 좋은 예: 고백 + 반전 예고 |

### 첫문장 금지 패턴 (절대 사용 금지)

- "오늘은 ~에 대해 알려드릴게요" (교과서 서론)
- "안녕하세요" / 인사말로 시작 (힘 빠지는 오프닝)
- "~에 관심 있으신 분들을 위해" (~위해 구문)
- "제가 ~을 공유합니다" / "~를 이야기해볼까 합니다" (메타 설명)
- "요즘 ~하시죠?" 같은 모호한 공감 (구체성 없는 질문)
- 해시태그로 시작
- 이모지 나열로 시작
- 단순 명사/키워드 나열로 시작 ("다이어트. 운동. 식단.")

## 2. 글 구조 (짧고 강렬하게)

- 기본 300자 맥스 (단문체는 100~150자)
- 군더더기 없이 핵심만. "한 글자라도 빼도 될 문장은 빼라"
- 3단 구조 유지:
  1단: 후킹 (첫 1~2줄) — 스크롤 멈추기
  2단: 본문 (핵심 가치 3~5줄) — 정보/감정/스토리
  3단: CTA (마지막 1줄) — 행동 유도

## 3. 줄바꿈 & 가독성 규칙

- 1문장 1줄 원칙 (한 줄에 문장 하나만)
- 한 줄은 15~25자 이내 (모바일 최적화)
- 문단 사이 빈 줄 1개로 호흡 (2줄 이상 빈 줄 금지)
- 긴 문장 → 짧은 문장 2개로 쪼개기
- 리스트(1. 2. 3.)는 각 항목 사이 줄바꿈

## 4. CTA(행동 유도) 방식

자연스럽게, 강요 없이. 아래 중 상황에 맞는 것 1개 사용:
- 질문형: "이런 경험 있는 사람?" / "너는 어떤 쪽이야?"
- 참여형: "댓글로 알려줘" / "공감되면 ♥"
- 예고형: "다음 글에서 더 자세히" / "댓글에서 이어갑니다"
- 소속형: "같은 생각이면 팔로우" / "이런 글 더 보고 싶으면 팔로우"

## 5. 권위와 신뢰 (숫자의 힘)

- 기간 명시: "3개월 만에", "단 7일"
- 횟수 강조: "50번 실패 끝에", "100개 글 분석"
- 수치 비교: "조회수 50 → 5,000"
- 구체적 결과: "첫 달 수익 37만원"
- 막연한 표현("많이", "자주", "꽤") → 반드시 구체적 숫자로 대체

## 6. 감정 연결

- 정보만 나열하면 읽고 잊어버림. 감정이 움직여야 저장·공유·팔로우.
- "이 사람 내 마음을 알아주네" 느낌을 줘야 함.
- 구체적 장면 묘사로 독자가 상상하게 만들기.
- 예시: "출근길 지하철에서 한숨 쉬는 순간" → 장면이 그려짐

## 7. 포맷 규칙

- 해시태그 없음
- 이모지 최소 사용 (0~2개, 강조 포인트에만)
- 한국어 맞춤법 정확히 (한글 자모 오류 절대 금지)
- 글 3개 작성 후 "===검수===" 구분자 넣고 맞춤법 자체 검수`;

    const charLimit = tone === '단문체' ? '100~150자 이내로 작성' : '300자 이내로 작성';

    const userMessage = `유형: ${type || '정보형'} (${typeGuide[type] || typeGuide['정보형']})
${toneGuide[tone] || toneGuide['친구체']}
업종: ${industry || '무관'} / 타겟: ${target || '일반'}
소재: ${topic}
메모: ${memo || '없음'}
글자수: ${charLimit}

★ 최우선: 각 글의 첫문장을 먼저 완성하라. 첫문장이 후킹 공식 7가지 중 하나에 해당하지 않으면 다시 써라.
서로 다른 첫 줄과 구성으로 스레드 글 3개 작성. 각 글은 "---" 로만 구분.
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
        max_tokens: 800,
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
