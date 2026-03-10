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
  '정보형': '숫자형 리스트(N가지 방법). 후킹 제목 → 1.항목+설명 → 2.항목+설명 → 3.항목+설명 → 팔로우/댓글 유도 CTA. 3~5가지가 가장 효과적.',
  '공감형': '독자의 현재 감정/상황을 정확히 짚어주기. 문제 상황 제시 → 공감과 이해 → 관점 전환 또는 해결 방향 → 격려 메시지. 진정성 있는 본인 경험 담기.',
  '반전형': '예상을 뒤엎는 메시지로 호기심 유도. 예상 밖의 경고/제안 → 이유 제시 → 반전 포인트. 짧고 강렬하게.',
  '고백형': '1인칭 솔직 경험담. 날 것의 실패→깨달음→성장 스토리. 독자가 본인 이야기처럼 느끼게.',
  '통찰형': '새로운 관점이나 깨달음 제공. 독특한 관점 제시 → 이유/근거 설명 → 본인 경험/다짐 → 독자 참여 유도. 다른 사람들이 놓친 지점을 짚기.',
  '비틀기형': '상식/통념 뒤집기. 일반적인 생각 제시 → 반대 의견 → 진짜 이유 설명 → 따뜻한 결론. 독자가 고개 끄덕이게.',
  '궁금증형': '스토리 절반만 공개+댓글 유도. 흥미로운 상황 제시 → 감정 변화 언급 → 핵심 내용 예고 → "댓글에서 이어갑니다" 유도. 호기심을 남겨두고 끊기.',
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

    const systemPrompt = `Threads SNS 전문 카피라이터. 수백 개의 바이럴 스레드를 분석하고 컨설팅한 경험 기반.

## 후킹 원칙 (가장 중요)
- 첫 줄에서 스크롤을 멈추게 만들어야 함. 2초 안에 "읽어야겠다" 결정
- 후킹 4유형 중 최소 1개 반드시 사용:
  · 공감형: "3개월째 다이어트 실패 중인 분들" — 독자의 현재 고통을 정확히 짚기
  · 욕망형: "월 300만원 부업 수입 만드는 법" — 독자가 원하는 결과를 직접 제시
  · 흥미형: "제가 6개월 만에 달라진 비결" — 궁금증 유발, 스토리 예고
  · 정보형: "이걸 모르면 평생 손해봅니다" — 놓치면 안 되는 느낌
- 잘못된 후킹: "오늘은 ~~에 대해 알려드릴게요" (❌ 호기심 0)
- 올바른 후킹: "저도 6개월 전까지 조회수 50도 안 나왔어요. 근데 이것 하나 바꿨더니..." (✅)

## 권위와 숫자 (신뢰도 폭발)
- 기간 명시: "3개월 만에", "단 7일 만에"
- 횟수 강조: "50번 실패한 끝에", "100개 글 분석"
- 수치 비교: "조회수 50에서 5천으로"
- 구체적 결과: "첫 달 수익 37만원"
- 막연한 표현 금지 → 구체적 숫자로

## 글 구조 (3단계)
1단계: 위기/문제 제시 — 독자의 현재 고통을 정확히 짚기 (공감대 형성)
2단계: 해결 과정 — 단계별 방법 or 본인 경험 (가치 제공)
3단계: 자연스러운 CTA — 팔로우/댓글/공유 유도 ("이런 경험 있는 사람?" "댓글로 알려줘")

## 감정 연결 (정보 < 감정)
- 정보만 나열하면 읽고 잊어버림
- 감정이 움직이면 저장하고 공유하고 팔로우함
- "이 사람 내 마음을 알아주네" 느낌을 줘야 함
- 독자가 상상하게 만들기 — 구체적 장면 묘사

## 포맷 규칙
- 80~150자 (핵심만, 꽉 채우지 않기)
- 1문장 1줄 + 줄바꿈 리듬 (모바일 최적화, 한 줄 15-20자)
- 문단 사이 빈 줄로 가독성 확보
- 해시태그 없음
- 한국어 맞춤법 정확히 (한글 자모 오류 절대 금지)
- 글 3개 작성 후 "===검수===" 구분자 넣고 맞춤법 자체 검수`;

    const userMessage = `유형: ${type || '정보형'} (${typeGuide[type] || typeGuide['정보형']})
${toneGuide[tone] || toneGuide['친구체']}
업종: ${industry || '무관'} / 타겟: ${target || '일반'}
소재: ${topic}
메모: ${memo || '없음'}

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
        max_tokens: 1200,
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
