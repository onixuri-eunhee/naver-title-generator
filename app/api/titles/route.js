import {
  getRedis,
  extractToken,
  resolveSessionEmail,
  resolveAdmin,
  getClientIp,
  jsonResponse,
  handleOptions,
} from '@/lib/api-helpers';
import { logUsage } from '@/lib/db';

const FREE_DAILY_LIMIT = 5;

function getKSTDate() {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

function getTodayKey(email) {
  return `ratelimit:titles:${email}:${getKSTDate()}`;
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

[절대 규칙]
1. 각 패턴별로 정확히 2개의 제목을 생성한다. 총 24개.
2. 제목 구조: [핵심 키워드 + 후킹 문장]. 키워드가 먼저, 후킹이 뒤따른다.
3. 핵심 키워드는 반드시 제목 첫 10글자 이내에 배치한다.
4. 이용자가 키워드를 2개 이상 입력한 경우, 입력된 키워드 중에서 핵심 1개 + 연관 1개를 조합한다. 3개 이상 나열/도배 절대 금지.
   - 입력 키워드끼리 조합하는 것을 우선한다.
   - 외부 연관 키워드를 쓸 경우, 반드시 검색자가 실제로 궁금해할 범주(메뉴, 가격, 후기, 위치, 예약, 분위기 등) 안에서 선택한다.
   - 검색자의 의도와 무관한 사업자 관점 키워드(창업, 인테리어 견적, 폐업, 식재비, 프렌차이즈 수익률, 건물주 계약 등)를 끼워넣지 않는다.
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
Q1. 이 키워드를 검색하는 사람은 누구인가? (방문객/소비자 관점으로 생각하라)
Q2. 그 검색자가 궁금해하는 것은? (가격, 후기, 메뉴, 분위기 등 소비 관련 정보)
Q3. 이 제목을 보고 어떤 반응(클릭/저장)을 기대하는가?
Q4. 내가 검색 결과에서 이 제목을 보면 클릭할 것인가?

[12가지 패턴 — 모든 패턴은 "키워드 + 후킹 요소" 구조]

== 긍정 메시지 (고객이 얻을 이득) ==
P1. 이득+숫자형: 키워드 + 얻을 수 있는 이득 + 구체적 숫자.
   예: "필라테스 효과, 2개월 만에 허리 -3cm"
P2. 성공사례형: 키워드 + 구체적 변화/결과.
   예: "카페 창업 3개월, 순수익 500만원 비결"
P3. 전문가가이드형: 키워드 + 전문가 경력 + 핵심 정보.
   예: "피부 관리, 전문의가 먼저 보는 2가지"
P4. 방법+체크리스트형: 키워드 + 실용적 행동 지침 + 숫자.
   예: "인테리어 비용, 견적 전 체크할 3가지"

== 위협 메시지 (잃을 위기) ==
P5. 모르면손해형: 키워드 + 모르면 생기는 부정적 결과.
   예: "사업자 세금, 모르면 가산세 폭탄"
P6. 공통점경고형: 키워드 + 실패하는 사람들의 공통 패턴.
   예: "블로그 마케팅, 돈만 날리는 사장님들의 공통점"
P7. 의심하라형: 키워드 + 위험 신호 + 경고.
   예: "다이어트 식품, 이 성분 있으면 당장 버리세요"
P8. 공동의적형: 키워드 + 불합리한 상황 폭로.
   예: "보험 가입, 설계사가 절대 안 알려주는 것"

== 호기심 메시지 (예측 불가능) ==
P9. 가치입증형: 키워드 + 실적/수치 기반 호기심 유발.
   예: "이 네일샵에 예약이 3주 밀리는 진짜 이유"
P10. 상식파괴형: 키워드 + 기존 상식을 뒤집는 의외 정보.
   예: "상세페이지, 이 업종은 필요 없습니다"
P11. 질문&비교형: 키워드 + 비교 대상 + 궁금증 유발.
   예: "강남 미용실 추천, 1등과 10등 차이는 뭘까?"
P12. 타깃호출형: 키워드 + 특정 독자 정체성 호출.
   예: "진심으로 매출 올리고 싶은 사장님만 보세요"

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

function parseResponse(raw) {
  const results = {};
  const patternRegex = /P(\d{1,2}):\s*\n?/gi;
  const sections = raw.split(patternRegex);

  for (let i = 1; i < sections.length; i += 2) {
    const num = parseInt(sections[i], 10);
    if (num < 1 || num > 12) continue;
    const key = `p${num}`;
    const lines = (sections[i + 1] || '')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    const trimmed = lines.slice(0, 2).map((title) => {
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

export async function OPTIONS(request) {
  return handleOptions(request);
}

export async function GET(request) {
  try {
    const whitelisted = await resolveAdmin(request);
    if (whitelisted) {
      return jsonResponse(request, { remaining: 999, limit: FREE_DAILY_LIMIT, admin: true });
    }
    const token = extractToken(request);
    const email = await resolveSessionEmail(token);
    if (!email) {
      return jsonResponse(request, { remaining: 0, limit: FREE_DAILY_LIMIT, loginRequired: true });
    }
    const key = getTodayKey(email);
    const count = (await getRedis().get(key)) || 0;
    const remaining = Math.max(FREE_DAILY_LIMIT - count, 0);
    return jsonResponse(request, { remaining, limit: FREE_DAILY_LIMIT });
  } catch (_) {
    return jsonResponse(request, { remaining: 0, limit: FREE_DAILY_LIMIT });
  }
}

export async function POST(request) {
  let rateLimitKey = null;

  try {
    const body = await request.json().catch(() => ({}));
    let { keyword, category } = body;
    keyword = (keyword || '').substring(0, 100);
    category = (category || '').substring(0, 50);

    if (!keyword) {
      return jsonResponse(request, { error: '키워드를 입력해주세요.' }, { status: 400 });
    }

    const whitelisted = await resolveAdmin(request);
    const token = extractToken(request);
    const email = await resolveSessionEmail(token);

    if (!whitelisted && !email) {
      return jsonResponse(request, { error: '로그인이 필요합니다.' }, { status: 401 });
    }

    let remaining = whitelisted ? 999 : FREE_DAILY_LIMIT;

    if (!whitelisted) {
      rateLimitKey = getTodayKey(email);
      const newCount = await getRedis().incr(rateLimitKey);
      await getRedis().expire(rateLimitKey, getTTLUntilMidnightKST());

      if (newCount > FREE_DAILY_LIMIT) {
        await getRedis().decr(rateLimitKey);
        return jsonResponse(
          request,
          {
            error: `일일 무료 사용 한도(${FREE_DAILY_LIMIT}회)를 초과했습니다. 내일 다시 이용해주세요.`,
            remaining: 0,
          },
          { status: 429 }
        );
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
      if (rateLimitKey) {
        try { await getRedis().decr(rateLimitKey); } catch (_) {}
      }
      return jsonResponse(request, { error: '제목 생성 중 오류가 발생했습니다.' }, { status: 500 });
    }

    const raw = (data.content?.[0]?.text || '').trim();
    const results = parseResponse(raw);

    const hasResults = Object.keys(results).length > 0;
    if (!hasResults) {
      console.error('Title parsing failed. Raw:', raw);
      if (rateLimitKey) {
        try { await getRedis().decr(rateLimitKey); } catch (_) {}
      }
      return jsonResponse(request, { results: {}, remaining, limit: FREE_DAILY_LIMIT, fallback: true });
    }

    logUsage(email, 'title', null, getClientIp(request));
    return jsonResponse(request, { results, remaining, limit: FREE_DAILY_LIMIT });
  } catch (error) {
    console.error('Titles API Error:', error?.message || 'unknown');
    if (rateLimitKey) {
      try { await getRedis().decr(rateLimitKey); } catch (_) {}
    }
    return jsonResponse(request, { error: '서버 오류가 발생했습니다.' }, { status: 500 });
  }
}
