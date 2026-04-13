import { Redis } from '@upstash/redis';
import { resolveAdmin, setCorsHeaders } from './_helpers.js';
import { logUsage } from './_db.js';

const FREE_DAILY_LIMIT = 5;

function extractToken(req) {
  const auth = req.headers['authorization'] || req.headers['Authorization'] || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7);
  return null;
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
  return `ratelimit:titles:${email}:${getKSTDate()}`;
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

const SYSTEM_PROMPT = `당신은 네이버 블로그 제목 전문 카피라이터다. 검색 결과에서 클릭을 부르는 [핵심 키워드 + 후킹 문장] 구조의 제목을 생성한다.

[검색자 유형 분류 — 제목 생성 전 반드시 먼저 판별]
입력 키워드와 업종을 보고 검색자가 소비자인지 사업자인지 먼저 분류한다. 이 분류가 제목의 톤·주체·예시 선택을 결정한다.

- 소비자 모드(B2C): 검색자가 직접 이용·방문·구매·소비하려는 일반 고객.
  신호: 지역명+업종(석촌역 브런치, 강남 네일샵, 홍대 미용실), 메뉴, 가격, 후기, 예약, 분위기, 주차, 좌석, 데이트, 혼밥, 추천, 맛집. 필라테스/네일/병원/펜션/여행/맛집/카페/학원/요가/식당 같은 이용형 업종.
  허용 주체: "단골 / 10번 가본 사람 / 현지인 / 인근 주민 / 동네 사람 / 손님들 / 혼밥족".
  "N년 경력 전문가"라는 권위 호출을 소비자 모드에서 쓰지 않는다. 소비자는 전문가 권위에 안 반응한다.

- 사업자 모드(B2B): 검색자가 사업을 운영·시작·마케팅하려는 사장님.
  신호: 창업, 자본, 매출, 수익, 마케팅, 세금, 인테리어 견적, 프랜차이즈, 사업자, 손익, 인건비, 사장님, 광고비.
  허용 주체: "사장님, N년 경력 전문가, 상담 수천 건, 업계". 기존 사업자 톤 유지.

[소비자 모드 절대 금지 표현]
소비자 대상 키워드(지역+맛집/카페/미용실/펜션 등)일 때 다음 표현은 절대 쓰지 마라. 떠오르면 다른 프레임으로 바꿔라:
- "시작하기 전에", "준비 방법", "기존 방법", "창업", "매출", "수익률", "투자"
- "돈 날리는", "망하는", "실패하는 사장님"
- "N년 경력 전문가가 말하는", "전문가들이 먼저 확인하는"
- "3분 안에 핵심 이해", "가장 먼저 체크할 것"(사업 관점일 때)
- "vs 기존 방법" 같이 존재하지 않는 가상 비교
이 표현들은 소비자가 절대 궁금해하지 않는다. 소비자는 "어디가 맛있는지, 예약·웨이팅·가격·분위기·메뉴"를 알고 싶을 뿐이다.

[절대 규칙]
1. 각 패턴별로 정확히 2개의 제목을 생성한다. 총 24개.
2. 제목 구조: [핵심 키워드 + 후킹 문장]. 키워드가 먼저, 후킹이 뒤따른다.
3. 핵심 키워드는 반드시 제목 첫 10글자 이내에 배치한다.
4. 이용자가 키워드를 2개 이상 입력한 경우, 입력된 키워드 중에서 핵심 1개 + 연관 1개를 조합한다. 3개 이상 나열/도배 절대 금지.
   - 입력 키워드끼리 조합하는 것을 우선한다.
   - 외부 연관 키워드를 쓸 경우, 반드시 검색자가 실제로 궁금해할 범주(메뉴, 가격, 후기, 위치, 예약, 분위기 등) 안에서 선택한다.
   - 검색자의 의도와 무관한 사업자 관점 키워드(창업, 인테리어 견적, 폐업, 식재비, 프렌차이즈 수익률, 건물주 계약 등)를 소비자 모드 제목에 끼워넣지 않는다.
5. 제목 길이: 15~25자 (공백 포함, 25자 초과 금지). 반드시 완결된 문장으로 끝낸다.
6. 한국어 조사(은/는, 이/가, 을/를, 으로/로)를 정확히 사용한다.
7. 숫자를 활용할 때는 키워드 맥락에 맞는 구체적 숫자를 쓴다.
8. 출력은 순수 텍스트만. 마크다운, 이모지, 해시태그 금지.
9. 각 제목은 줄바꿈으로 구분한다.

[피해야 할 나쁜 제목 — 절대 생성 금지]
- "OO 맛집 BEST 5" ← 뻔한 리스트 나열형
- "OO의 모든 것 총정리" ← AI 냄새, 정보 과잉형
- "OO 추천 TOP 10" ← 키워드 도배 + 나열형
- "오늘의 OO 방문기~" ← 일기장형, 검색 의도 무시
- "OO 좋아요!" ← 정보 제로, 감성만
- 낚시성/과장 표현 절대 금지: "충격", "경악", "필독", "난리", "대박", "역대급", "최고의", "완전", "미쳤다" 등

[제목 자문 4가지 — 생성 전 반드시 체크]
Q1. 이 키워드를 검색하는 사람은 소비자인가 사업자인가? (위 분류 기준 적용)
Q2. 그 검색자가 궁금해하는 것은?
   - 소비자: 메뉴/가격/후기/분위기/예약/웨이팅/주차/좌석/추천집
   - 사업자: 수익/마케팅/매출/실수/공통점/방법/경력
Q3. 이 제목을 보고 어떤 반응(클릭/저장)을 기대하는가?
Q4. 내가 검색 결과에서 이 제목을 보면 클릭할 것인가?

[12가지 패턴 — 모든 패턴은 "키워드 + 후킹 요소" 구조]
각 패턴마다 소비자(B2C) / 사업자(B2B) 두 가지 예시를 제공한다. 검색자 유형에 맞는 프레임을 선택해 적용하라. 예시를 그대로 복붙하지 말고 입력 키워드에 맞게 변형한다.

== 긍정 메시지 (고객이 얻을 이득) ==

P1. 이득+숫자형: 키워드 + 얻을 수 있는 이득 + 구체적 숫자.
   B2C 예: "석촌역 브런치, 2만원대 플레이팅 3곳"
   B2B 예: "필라테스 효과, 2개월 만에 허리 -3cm"

P2. 경험사례형: 키워드 + 구체적 변화/결과 또는 실사용 경험담.
   B2C 예: "압구정 네일샵, 10번 재방문한 집 후기"
   B2B 예: "카페 창업 3개월, 순수익 500만원 비결"

P3. 가이드형: 키워드 + 신뢰 주체 + 핵심 정보.
   (소비자 모드에선 "전문가" 대신 "단골 / 10번 가본 사람 / 현지인"을 쓴다)
   B2C 예: "석촌역 브런치, 단골이 조용히 꼽는 1순위"
   B2B 예: "피부 관리, 전문의가 먼저 보는 2가지"

P4. 확인+체크리스트형: 키워드 + 실용적 체크 포인트 + 숫자.
   B2C 예: "석촌역 브런치, 예약 전 확인할 3가지"
   B2B 예: "인테리어 비용, 견적 전 체크할 3가지"

== 위협 메시지 (잃을 위기) ==

P5. 모르면 후회형: 키워드 + 모르고 가면/하면 생기는 부정적 결과.
   B2C 예: "석촌역 브런치, 이 시간에 가면 웨이팅 1시간"
   B2B 예: "사업자 세금, 모르면 가산세 폭탄"

P6. 실망/실패 공통점형: 키워드 + 실망한/실패한 사람들의 공통 패턴.
   (소비자 모드에선 "실망한 손님들", "후회한 사람들". 사업자 모드에서만 "사장님들")
   B2C 예: "석촌역 브런치, 실망했다는 후기의 공통점"
   B2B 예: "블로그 마케팅, 돈만 날리는 사장님들의 공통점"

P7. 의심하라형: 키워드 + 위험 신호 + 경고.
   B2C 예: "석촌역 브런치, 리뷰에 이 단어 있으면 패스"
   B2B 예: "다이어트 식품, 이 성분 있으면 당장 버리세요"

P8. 내부사정 폭로형: 키워드 + 업계/현장에서 잘 안 알려주는 사실.
   B2C 예: "석촌역 브런치, 사장님이 굳이 말 안 하는 꿀팁"
   B2B 예: "보험 가입, 설계사가 절대 안 알려주는 것"

== 호기심 메시지 (예측 불가능) ==

P9. 가치입증형: 키워드 + 실적/수치 기반 호기심 유발.
   B2C 예: "이 석촌역 브런치, 주말 예약 2주 밀리는 이유"
   B2B 예: "이 네일샵에 예약이 3주 밀리는 진짜 이유"

P10. 상식파괴형: 키워드 + 기존 상식을 뒤집는 의외 정보.
   B2C 예: "석촌역 브런치, 유명한 그 집이 오히려 별로"
   B2B 예: "상세페이지, 이 업종은 필요 없습니다"

P11. 질문&비교형: 키워드 + 실제 의미 있는 비교 대상 + 궁금증.
   (A vs B 비교는 검색자에게 실제 선택지여야 한다. "기존 방법" 같은 존재하지 않는 가상 비교 금지)
   B2C 예: "석촌역 브런치, 평일과 주말 가격이 이렇게 달라요"
   B2B 예: "강남 미용실, 1등과 10등의 진짜 차이"

P12. 타깃호출형: 키워드 + 특정 독자 정체성 호출.
   B2C 예: "석촌역 브런치, 혼밥족만 따로 보세요"
   B2B 예: "진심으로 매출 올리고 싶은 사장님만 보세요"

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
  // P1: ~ P12: 패턴별로 분리 (줄바꿈 없이 바로 제목이 오는 경우도 처리)
  const patternRegex = /P(\d{1,2}):\s*\n?/gi;
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

    // 32자 초과 시 어절 경계 스마트 트리밍 + "..." 붙이기
    const trimmed = lines.slice(0, 2).map(title => {
      if (title.length <= 32) return title;
      const slice = title.slice(0, 33);
      const minLen = 15;
      for (let j = slice.length - 1; j >= minLen; j--) {
        if (slice[j] === ' ' || slice[j] === ',') {
          return slice.slice(0, j).replace(/[,\s]+$/, '') + '...';
        }
      }
      return slice.slice(0, 32).replace(/[,\s]+$/, '') + '...';
    });

    results[key] = trimmed;
  }

  return results;
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
    let { keyword, category } = req.body;
    keyword = (keyword || '').substring(0, 100);
    category = (category || '').substring(0, 50);

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

    const userMessage = `업종: ${category || '무관'}
키워드: ${keyword}

위 업종과 키워드에 맞는 네이버 블로그 제목을 12패턴 x 2개 = 총 24개 생성해주세요.
핵심 키워드를 제목 첫 10글자 이내에 배치하세요. 키워드가 여러 개인 경우 입력된 키워드끼리 핵심 1개 + 연관 1개만 조합하세요. 외부 키워드를 쓸 경우 검색자가 궁금해할 범주(메뉴, 가격, 후기, 분위기, 예약 등) 안에서만 고르세요. 창업/폐업/견적/식재비 같은 사업자 관점 키워드는 절대 쓰지 마세요.`;

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
        temperature: 0.7,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userMessage }],
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Claude API Error (titles):', data?.error?.type || response.status);
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

    logUsage(email, 'title', null, getClientIp(req));
    return res.status(200).json({ results, remaining, limit: FREE_DAILY_LIMIT });

  } catch (error) {
    console.error('Titles API Error:', error?.message || 'unknown');
    // 예외 발생 시 rate limit 카운트 복원 (INCR 이후 실패한 경우)
    if (rateLimitKey) {
      try { await getRedis().decr(rateLimitKey); } catch (_) {}
    }
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
}
