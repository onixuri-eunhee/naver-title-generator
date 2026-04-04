/**
 * 황금키워드 찾기 API
 * POST /api/keywords
 *
 * 파이프라인: 입력 → Haiku 시드키워드 → 검색광고 API(검색량/경쟁도) → 블로그 포화도 → DataLab 트렌드 → 점수 산출
 */
import { Redis } from '@upstash/redis';
import { resolveAdmin, setCorsHeaders } from './_helpers.js';
import { logUsage } from './_db.js';
import crypto from 'crypto';

export const config = { maxDuration: 60 };

const FREE_DAILY_LIMIT = 3;
const DEBUG_VERSION = 'v26-performance-tidy';
const DISPLAY_MIN_MONTHLY_SEARCH = 300;

let redis;
function getRedis() {
  if (!redis) redis = new Redis({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN });
  return redis;
}

function getClientIp(req) {
  return req.headers['x-real-ip'] || req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
}

function getKSTDate() {
  return new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
}

function getTTLUntilMidnightKST() {
  const kstNow = new Date(Date.now() + 9 * 3600000);
  const nextMidnight = new Date(kstNow);
  nextMidnight.setUTCHours(0, 0, 0, 0);
  nextMidnight.setUTCDate(nextMidnight.getUTCDate() + 1);
  return Math.max(Math.ceil((nextMidnight - kstNow) / 1000), 60);
}

function extractToken(req) {
  const auth = req.headers['authorization'] || '';
  return auth.startsWith('Bearer ') ? auth.slice(7) : null;
}

async function resolveSessionEmail(token) {
  if (!token) return null;
  try {
    const session = await getRedis().get(`session:${token}`);
    if (session && session.email) return session.email;
  } catch (_) {}
  return null;
}

// ─── Claude Haiku: 시드키워드 생성 ───
async function generateSeedKeywords(field, role, target, questions) {
  const systemPrompt = `당신은 네이버 블로그 SEO 키워드 전문가입니다. 타겟 독자가 네이버에서 실제로 검색할 법한 시드 키워드를 생성하세요.

## 규칙
- 모든 키워드는 한국어 검색어 형태로 출력
- 숏테일(2단어)과 롱테일(3~5단어) 키워드를 섞을 것
- 정보형 키워드 포함: 방법, 추천, 비용, 후기, 비교, 차이
- 질문형 키워드 포함: ~하는 법, ~하는 방법, ~어디서
- 에버그린 키워드 포함: 순서/과정형, 이유/원인형, 선택기준/비교형, 체크리스트형
- 분야와 타겟 독자에 맞는 구체적 키워드 위주
- "자주 받는 질문"이 있으면 그 질문에서 파생되는 다양한 키워드로 범위를 확장할 것 (축소 금지)
- 짧은 검색 쿼리만 출력, 완전한 문장 금지
- 구두점(?, !, /, :, 따옴표, 화살표) 사용 금지
- 반드시 JSON 문자열 배열만 출력`;

  const userPrompt = `분야: ${field}
역할: ${role}
타겟 독자: ${target}
${questions ? `자주 받는 질문:\n${questions}` : ''}

위 정보를 바탕으로 타겟 독자가 네이버에서 검색할 법한 키워드 ${questions ? '30~40' : '20~30'}개를 JSON 배열로 출력하세요.`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1500,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error('Haiku error: ' + JSON.stringify(data));

  const raw = (data.content?.[0]?.text || '').trim();
  const match = raw.match(/\[[\s\S]*\]/);
  if (!match) throw new Error('Haiku: no JSON array');
  return JSON.parse(match[0]);
}

// ─── 네이버 검색 API: 자동완성 키워드 확장 ───
async function fetchAutoComplete(keyword) {
  try {
    const res = await fetch(`https://ac.search.naver.com/nx/ac?q=${encodeURIComponent(keyword)}&con=1&frm=nv&ans=2&r_format=json&r_enc=UTF-8&r_unicode=0&t_koreng=1&run=2&rev=4&q_enc=UTF-8`);
    if (!res.ok) return [];
    const data = await res.json();
    // 자동완성 제안어 추출
    const items = data.items || [];
    const suggestions = [];
    for (const group of items) {
      if (Array.isArray(group)) {
        for (const item of group) {
          if (Array.isArray(item) && item[0]) suggestions.push(item[0]);
          else if (typeof item === 'string') suggestions.push(item);
        }
      }
    }
    return suggestions.slice(0, 5);
  } catch (_) {
    return [];
  }
}

async function expandWithAutoComplete(seedKeywords) {
  const expanded = new Set(seedKeywords);
  // 상위 15개 시드에 대해 자동완성 조회 (병렬)
  const top15 = seedKeywords.slice(0, 15);
  const results = await Promise.all(top15.map(kw => fetchAutoComplete(kw)));
  for (const suggestions of results) {
    for (const s of suggestions) expanded.add(s);
  }
  return Array.from(expanded);
}

// ─── 분야 적합도 필터: 엉뚱한 키워드 제거 ───
// 너무 범용적인 단어는 필터 핵심 단어에서 제외
const GENERIC_WORDS = new Set([
  '추천', '비용', '가격', '방법', '후기', '비교', '차이', '종류', '순위', '정보',
  '사이트', '업체', '전문', '온라인', '오프라인', '서비스', '프로그램', '무료', '유료',
  '장점', '단점', '효과', '리뷰', '사용법', '이용', '신청', '예약', '상담', '견적',
  '준비', '과정', '절차', '기간', '시간', '주의', '팁', '노하우', '초보', '입문',
]);

const BROAD_THEME_WORDS = new Set([
  '웨딩', '결혼', '결혼식', '예식', '신부', '웨딩홀', '웨딩드레스', '드레스',
  '웨딩플래너', '웨딩스튜디오', '웨딩촬영', '웨딩박람회', '예식장',
]);

const INTENT_STOP_WORDS = new Set([
  ...GENERIC_WORDS,
  '나는', '타겟', '독자', '분야', '고객', '사람', '상태', '처음', '뭐부터',
  '정도', '관련', '대한', '위한', '같은', '직접', '추가', '질문', '자주',
  '많이', '하나', '라인', '한줄', '하나씩',
]);

const PROVIDER_BIAS_WORDS = new Set([
  '플래너', '컨설팅', '컨설턴트', '업체', '상담', '대행', '브랜드', '샵',
]);

const PROVIDER_INTENT_KEYWORDS = [
  '자격증', '채용', '월급', '연봉', '취업', '학과', '하는일', '되는법', '직업',
];

const LOCATION_WORDS = new Set([
  '서울', '강남', '영등포', '신도림', '인천', '수원', '대전', '대구', '부산',
  '천안', '원주', '전주', '평택', '청담', '잠실', '강서', '서초', '송파',
  '분당', '일산', '용인', '부천', '안양', '성남', '광명',
]);

const QUESTION_STYLE_REGEX = /(방법|하는\s*법|어떻게|순서|체크리스트|리스트|비용|가격|견적|추천|비교|차이|언제|준비|예약|가능)/;
const AWKWARD_QUERY_REGEX = /(어떻게받나|전문가|정보$|팁$|후기$|어디서하나|몇번방문|입국횟수)/;

function normalizeKoreanText(text) {
  return String(text || '')
    .replace(/[^가-힣a-zA-Z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitTokens(text, { keepStopWords = false } = {}) {
  const normalized = normalizeKoreanText(text);
  if (!normalized) return [];
  return normalized
    .split(/\s+/)
    .filter(token => token.length >= 2)
    .filter(token => keepStopWords || !INTENT_STOP_WORDS.has(token));
}

function buildPhraseVariants(text) {
  const normalized = normalizeKoreanText(text);
  if (!normalized) return [];

  const variants = new Set();
  const compact = normalized.replace(/\s+/g, '');
  if (compact.length >= 4 && compact.length <= 18) variants.add(compact);

  const tokens = normalized.split(/\s+/).filter(token => token.length >= 2);
  for (let i = 0; i < tokens.length - 1; i++) {
    const bigram = `${tokens[i]}${tokens[i + 1]}`;
    if (bigram.length >= 4 && bigram.length <= 18) variants.add(bigram);
  }

  return Array.from(variants);
}

function uniqLimit(items, limit = 30) {
  return Array.from(new Set(items.filter(Boolean))).slice(0, limit);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function containsLocationToken(text) {
  const tokens = splitTokens(text, { keepStopWords: true });
  return tokens.some(token => LOCATION_WORDS.has(token));
}

function buildIntentMeta(intent = {}) {
  return {
    score: intent.score || 0,
    specificHits: intent.specificHits || [],
    contextHits: intent.contextHits || [],
    targetHits: intent.targetHits || [],
    phraseHits: intent.phraseHits || [],
    journeyHits: intent.journeyHits || [],
  };
}

function extractIntentSignals(field, role, target, questions, userSeeds, seedKeywords) {
  const themeTexts = [field, role];
  // questions는 시드 생성(확장)에만 사용하고, 필터링 토큰에는 포함하지 않는다
  const userTexts = [field, target, userSeeds];
  const aiSeedTexts = seedKeywords.slice(0, 12);
  const seedTexts = [userSeeds, ...aiSeedTexts];
  const contextTexts = [target];
  const allowLocationIntent = [field, target, userSeeds].some(containsLocationToken);

  const broadTokens = uniqLimit(
    [...themeTexts, ...seedTexts, ...contextTexts].flatMap(text =>
      splitTokens(text, { keepStopWords: true }).filter(token => BROAD_THEME_WORDS.has(token))
    ),
    20
  );

  const specificTokens = uniqLimit(
    [
      ...userTexts,
      ...aiSeedTexts.map(text => ({
        text,
        fromAiSeed: true,
      })),
    ].flatMap(entry => {
      const text = typeof entry === 'string' ? entry : entry.text;
      const fromAiSeed = typeof entry === 'string' ? false : entry.fromAiSeed;
      return splitTokens(text).filter(token => {
        if (BROAD_THEME_WORDS.has(token) || PROVIDER_BIAS_WORDS.has(token)) return false;
        if (!allowLocationIntent && fromAiSeed && LOCATION_WORDS.has(token)) return false;
        return true;
      });
    })
    .filter(Boolean)
    ,
    40
  );

  const contextTokens = uniqLimit(
    contextTexts.flatMap(text =>
      splitTokens(text).filter(token => !BROAD_THEME_WORDS.has(token) && !PROVIDER_BIAS_WORDS.has(token))
    ),
    25
  );

  const targetPriorityTokens = uniqLimit(
    splitTokens(target).filter(token => !BROAD_THEME_WORDS.has(token) && !PROVIDER_BIAS_WORDS.has(token)),
    20
  );
  const targetPriorityTokenSet = new Set(targetPriorityTokens);

  const phraseVariants = uniqLimit(
    [
      ...userTexts,
      ...aiSeedTexts.filter(text => allowLocationIntent || !containsLocationToken(text)),
    ].flatMap(text => buildPhraseVariants(text)),
    40
  );

  const journeyTokens = uniqLimit(
    [...userTexts, ...aiSeedTexts].flatMap(text =>
      splitTokens(text, { keepStopWords: true }).filter(token =>
        ['준비', '비용', '예산', '기간', '체크리스트', '순서', '리스트', '견적'].includes(token)
      )
    ),
    12
  );
  const journeyTokenSet = new Set(journeyTokens);

  const industryTokens = uniqLimit(
    [...themeTexts, ...aiSeedTexts, userSeeds].flatMap(text =>
      splitTokens(text).filter(token =>
        !BROAD_THEME_WORDS.has(token) &&
        !PROVIDER_BIAS_WORDS.has(token) &&
        !LOCATION_WORDS.has(token) &&
        !targetPriorityTokenSet.has(token) &&
        !journeyTokenSet.has(token)
      )
    ),
    20
  );
  const industryTokenSet = new Set(industryTokens);

  return {
    broadTokens,
    specificTokens,
    contextTokens,
    targetPriorityTokens,
    targetPriorityTokenSet,
    phraseVariants,
    journeyTokens,
    journeyTokenSet,
    industryTokens,
    industryTokenSet,
    allowLocationIntent,
    hasSpecificIntent: specificTokens.length > 0 || contextTokens.length > 0,
  };
}

function scoreRelevantKeyword(keyword, signals) {
  const normalized = normalizeKoreanText(keyword);
  const compact = normalized.replace(/\s+/g, '');
  const broadHits = signals.broadTokens.filter(token => normalized.includes(token));
  const specificHits = signals.specificTokens.filter(token => normalized.includes(token));
  const contextHits = signals.contextTokens.filter(token => normalized.includes(token));
  const targetHits = signals.targetPriorityTokens.filter(token => normalized.includes(token));
  const phraseHits = signals.phraseVariants.filter(phrase => compact.includes(phrase));
  const journeyHits = signals.journeyTokens.filter(token => normalized.includes(token));

  let score = broadHits.length + specificHits.length * 4 + contextHits.length * 5 + targetHits.length * 7 + phraseHits.length * 8 + journeyHits.length * 4;

  const providerIntentHits = PROVIDER_INTENT_KEYWORDS.filter(token => normalized.includes(token));
  const baseDomainHit = broadHits.length > 0 || specificHits.length > 0 || phraseHits.length > 0 || journeyHits.length > 0;
  if (!baseDomainHit) {
    return { relevant: false, score: 0, broadHits, specificHits, contextHits, targetHits, phraseHits, journeyHits, providerIntentHits };
  }

  if (providerIntentHits.length > 0 && targetHits.length === 0 && contextHits.length === 0 && phraseHits.length === 0) {
    return { relevant: false, score: 0, broadHits, specificHits, contextHits, targetHits, phraseHits, journeyHits, providerIntentHits };
  }

  if (/웨딩홀|박람회|호텔|스튜디오|업체|쇼핑몰|카페/.test(keyword) && phraseHits.length === 0 && contextHits.length === 0 && specificHits.length < 2) {
    score -= 3;
  }

  if (!signals.allowLocationIntent && /웨딩홀/.test(keyword) && targetHits.length === 0 && journeyHits.length === 0) {
    score -= 8;
  }

  if (/웨딩플래너|컨설팅/.test(keyword) && targetHits.length === 0 && contextHits.length === 0) {
    score -= 6;
  }

  if (/웨딩드레스/.test(keyword) && targetHits.length === 0 && contextHits.length === 0 && !compact.includes('결혼식준비') && !compact.includes('체크리스트') && !compact.includes('순서')) {
    score -= 4;
  }

  // 타겟/질문 키워드는 추가 가중치이지, 미포함이라고 탈락시키지 않는다.
  // 다만 완전히 일반 키워드는 약간만 뒤로 보낸다.
  if (signals.hasSpecificIntent && targetHits.length === 0 && contextHits.length === 0 && phraseHits.length === 0) {
    score -= 2;
  }

  return {
    relevant: score >= 1,
    score,
    broadHits,
    specificHits,
    contextHits,
    targetHits,
    phraseHits,
    journeyHits,
    providerIntentHits,
  };
}

function buildKeywordSections(results, signals) {
  const sectionDefs = [
    {
      id: 'question',
      title: '질문형 황금키워드',
      description: '고객이 실제로 검색창에 묻듯 입력할 만한 준비형 키워드입니다.',
      scoreKeyword(result) {
        const intentMeta = result.intentMeta || {};
        const questionMatch = QUESTION_STYLE_REGEX.test(result.keyword) ? 1 : 0;
        return questionMatch * 6 + (intentMeta.journeyHits?.length || 0) * 4 + (intentMeta.phraseHits?.length || 0) * 2;
      },
    },
    {
      id: 'segment',
      title: '특수 타겟 황금키워드',
      description: '타겟 독자의 상황, 지역, 생활 맥락이 반영된 틈새 키워드입니다.',
      scoreKeyword(result) {
        const intentMeta = result.intentMeta || {};
        return (intentMeta.targetHits?.length || 0) * 7 + (intentMeta.contextHits?.length || 0) * 5 + (intentMeta.phraseHits?.length || 0) * 2;
      },
    },
    {
      id: 'industry',
      title: '업계 워딩 황금키워드',
      description: '현업에서 쓰는 표현과 고객 검색어가 겹치는 실전형 키워드입니다.',
      scoreKeyword(result) {
        const normalizedKeyword = result._normalizedKeyword || normalizeKoreanText(result.keyword);
        const industryHits = (signals.industryTokens || []).filter(token => normalizedKeyword.includes(token));
        const intentMeta = result.intentMeta || {};
        return industryHits.length * 6 + (intentMeta.specificHits?.filter(hit => signals.industryTokenSet?.has(hit)).length || 0) * 3;
      },
    },
  ];

  return sectionDefs
    .map(section => {
      const keywords = results
        .map(result => ({
          ...result,
          _sectionScore: section.scoreKeyword(result),
        }))
        .filter(result => result._sectionScore > 0)
        .sort((a, b) => b._sectionScore - a._sectionScore || b.score - a.score || b.monthlySearch - a.monthlySearch)
        .slice(0, 6)
        .map(({ _sectionScore, _normalizedKeyword, ...result }) => result);

      return { ...section, keywords };
    })
    .filter(section => section.keywords.length > 0);
}

function determineMinSearchThreshold(signals, searchAdTotal) {
  const joinedSignals = [
    ...(signals.targetPriorityTokens || []),
    ...(signals.contextTokens || []),
    ...(signals.specificTokens || []),
    ...(signals.industryTokens || []),
  ].join(' ');

  const hasNicheContext = /해외|미국|한국|거주|교포|국제|원정|직계가족|소규모|스몰/.test(joinedSignals);
  const signalStrength = (signals.targetPriorityTokens?.length || 0) + (signals.contextTokens?.length || 0) + (signals.journeyTokens?.length || 0);

  let threshold = 300;
  if (hasNicheContext || signalStrength >= 8 || searchAdTotal <= 120) threshold = 100;
  if (hasNicheContext || signalStrength >= 12 || searchAdTotal <= 50) threshold = 50;
  return threshold;
}

function buildFeaturedGroups(results, filteredResults, signals, options = {}) {
  const hasQuestionDetail = Boolean(options.hasQuestionDetail);

  const baseKeywords = filteredResults
    .slice()
    .sort((a, b) => b.score - a.score || b.monthlySearch - a.monthlySearch)
    .slice(0, 10);

  let nicheKeywords = [];
  if (hasQuestionDetail) {
    nicheKeywords = results
      .map(result => {
        const intentMeta = result.intentMeta || {};
        const nicheScore =
          (intentMeta.targetHits?.length || 0) * 8 +
          (intentMeta.contextHits?.length || 0) * 6 +
          (intentMeta.journeyHits?.length || 0) * 5 +
          (intentMeta.phraseHits?.length || 0) * 4 +
          (QUESTION_STYLE_REGEX.test(result.keyword) ? 5 : 0) +
          Math.min(6, Math.floor((result.monthlySearch || 0) / 200));

        return { ...result, _nicheScore: nicheScore };
      })
      .filter(result => result._nicheScore > 0)
      .sort((a, b) => b._nicheScore - a._nicheScore || b.score - a.score || b.monthlySearch - a.monthlySearch)
      .slice(0, 10)
      .map(({ _nicheScore, ...result }) => result);
  }

  return {
    base: {
      title: '내 분야 기본 황금키워드',
      description: '검색량과 경쟁도를 기준으로 본 업종 전반에서 바로 활용하기 좋은 키워드입니다.',
      keywords: baseKeywords,
    },
    niche: {
      title: '고객 질문 반영 황금키워드',
      description: '고객 질문과 특수 워딩을 반영해 더 니치하게 좁힌 키워드입니다.',
      keywords: nicheKeywords,
      enabled: hasQuestionDetail,
    },
  };
}

function calculateRankingAdjustments(result) {
  const keyword = result.keyword || '';
  const normalized = normalizeKoreanText(keyword);
  const compact = normalized.replace(/\s+/g, '');
  const intentMeta = result.intentMeta || {};
  let adjustment = 0;
  const reasons = [];

  const lowSearch = result.monthlySearch || 0;
  if (lowSearch <= 10) {
    adjustment -= 4;
    reasons.push('초저검색량');
  } else if (lowSearch <= 20) {
    adjustment -= 2;
    reasons.push('저검색량');
  }

  if (AWKWARD_QUERY_REGEX.test(compact)) {
    adjustment -= 5;
    reasons.push('어색한문장');
  }

  if (/웨딩컨설팅|웨딩플래너/.test(compact)) {
    const customerSignal = (intentMeta.targetHits?.length || 0) + (intentMeta.contextHits?.length || 0) + (intentMeta.journeyHits?.length || 0);
    if (customerSignal === 0) {
      adjustment -= 6;
      reasons.push('공급자축');
    }
  }

  if (/정보|팁|후기/.test(compact) && (intentMeta.targetHits?.length || 0) === 0) {
    adjustment -= 2;
    reasons.push('일반정보형');
  }

  if ((intentMeta.targetHits?.length || 0) > 0) {
    adjustment += 3;
    reasons.push('타겟일치');
  }
  if ((intentMeta.contextHits?.length || 0) > 0) {
    adjustment += 2;
    reasons.push('문맥일치');
  }
  if ((intentMeta.journeyHits?.length || 0) > 0) {
    adjustment += 2;
    reasons.push('준비의도');
  }

  return { adjustment, reasons };
}

function normalizeSearchAdSeedKeywords(seedKeywords) {
  const safeSeeds = [];
  const droppedSeeds = [];
  const seen = new Set();

  for (const rawKeyword of seedKeywords) {
    const raw = String(rawKeyword || '');
    const cleaned = raw
      .replace(/[^가-힣a-zA-Z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 50);
    const query = cleaned.replace(/\s+/g, '').slice(0, 50);

    if (query.length < 2) {
      if (rawKeyword) droppedSeeds.push({ raw, cleaned, query });
      continue;
    }
    if (seen.has(query)) continue;
    seen.add(query);
    safeSeeds.push({ raw, cleaned, query });
  }

  return { safeSeeds, droppedSeeds };
}

// ─── 검색광고 API: 연관키워드 + 검색량 + 경쟁도 ───
// ★ 원래 작동하던 코드 그대로 복원 (디버그/테스트 전부 제거)
async function fetchSearchAdKeywords(seedKeywords) {
  const API_KEY = (process.env.NAVER_AD_API_KEY || '').replace(/\\n|\n/g, '').trim();
  const SECRET = (process.env.NAVER_AD_SECRET_KEY || '').trim();
  const CUSTOMER_ID = (process.env.NAVER_AD_CUSTOMER_ID || '').trim();

  const timestamp = String(Date.now());
  const method = 'GET';
  const uri = '/keywordstool';
  const hmac = crypto.createHmac('sha256', SECRET);
  hmac.update(`${timestamp}.${method}.${uri}`);
  const signature = hmac.digest('base64');

  const allResults = new Map();
  const { safeSeeds, droppedSeeds } = normalizeSearchAdSeedKeywords(seedKeywords);
  allResults._safeSeedCount = safeSeeds.length;
  allResults._safeSeedsSample = safeSeeds.slice(0, 5);
  allResults._droppedSeedsSample = droppedSeeds.slice(0, 5);

  // 한 시드씩 호출해 유효하지 않은 시드가 전체 배치를 깨지 않도록 격리
  for (let i = 0; i < safeSeeds.length; i += 1) {
    const seed = safeSeeds[i];
    const hintKeywords = encodeURIComponent(seed.query);
    if (!hintKeywords) continue;
    if (i === 0) {
      allResults._firstBatch = {
        raw: seed.raw,
        cleaned: seed.cleaned,
        query: seed.query,
        lengths: {
          cleaned: seed.cleaned.length,
          query: seed.query.length,
        },
      };
    }

    try {
      const ts = String(Date.now());
      const h = crypto.createHmac('sha256', SECRET);
      h.update(`${ts}.${method}.${uri}`);
      const sig = h.digest('base64');

      const res = await fetch(`https://api.searchad.naver.com${uri}?hintKeywords=${hintKeywords}&showDetail=1`, {
        headers: {
          'X-Timestamp': ts,
          'X-API-KEY': API_KEY,
          'X-Customer': CUSTOMER_ID,
          'X-Signature': sig,
        },
      });

      if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        console.error(`[KEYWORDS] SearchAd batch ${i/5} error: ${res.status} ${errBody.slice(0, 200)}`);
        // 첫 배치 에러를 디버그에 저장
        if (i === 0) allResults._firstError = {
          status: res.status,
          body: errBody.slice(0, 150),
          url: `${uri}?hintKeywords=${hintKeywords.slice(0, 120)}&showDetail=1`,
        };
        continue;
      }

      const data = await res.json();
      for (const item of (data.keywordList || [])) {
        if (!allResults.has(item.relKeyword)) {
          const pcSearch = item.monthlyPcQcCnt === '< 10' ? 5 : Number(item.monthlyPcQcCnt) || 0;
          const mobileSearch = item.monthlyMobileQcCnt === '< 10' ? 5 : Number(item.monthlyMobileQcCnt) || 0;
          allResults.set(item.relKeyword, {
            keyword: item.relKeyword,
            monthlySearch: pcSearch + mobileSearch,
            pcSearch,
            mobileSearch,
            competition: item.compIdx || 'low',
          });
        }
      }
    } catch (err) {
      console.error(`[KEYWORDS] SearchAd batch error:`, err.message);
    }

    // API rate limit 보호
    if (i + 1 < safeSeeds.length) await sleep(120);
  }

  return allResults;
}

// ─── 네이버 검색 API: 블로그 발행량 (포화도) ───
async function fetchBlogCount(keyword) {
  const params = new URLSearchParams({ query: keyword, display: '1', sort: 'sim' });
  let lastFailure = null;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const res = await fetch(`https://openapi.naver.com/v1/search/blog.json?${params}`, {
        headers: {
          'X-Naver-Client-Id': process.env.NAVER_CLIENT_ID,
          'X-Naver-Client-Secret': process.env.NAVER_CLIENT_SECRET,
        },
      });

      if (res.ok) {
        const data = await res.json();
        return { count: data.total || 0, ok: true, status: res.status };
      }

      const body = await res.text().catch(() => '');
      lastFailure = { keyword, status: res.status, body: body.slice(0, 120), attempt: attempt + 1 };

      // 429/5xx는 짧게 재시도
      if ((res.status === 429 || res.status >= 500) && attempt < 2) {
        await sleep(180 * (attempt + 1));
        continue;
      }
      break;
    } catch (error) {
      lastFailure = { keyword, error: error.message, attempt: attempt + 1 };
      if (attempt < 2) {
        await sleep(180 * (attempt + 1));
        continue;
      }
      break;
    }
  }

  return { count: -1, ok: false, failure: lastFailure };
}

async function fetchBlogCounts(keywords) {
  const results = new Map();
  const failures = [];
  // 5개씩 병렬 (API rate limit 고려)
  for (let i = 0; i < keywords.length; i += 5) {
    const batch = keywords.slice(i, i + 5);
    const counts = await Promise.all(batch.map(kw => fetchBlogCount(kw)));
    batch.forEach((kw, j) => {
      results.set(kw, counts[j].count);
      if (!counts[j].ok) failures.push(counts[j].failure || { keyword: kw, status: 'unknown' });
    });
    if (i + 5 < keywords.length) await sleep(180);
  }

  return {
    counts: results,
    failures,
  };
}

// ─── DataLab 트렌드 API ───
async function fetchTrends(keywords) {
  const results = new Map();
  // DataLab은 최대 5개 그룹 동시 조회
  for (let i = 0; i < keywords.length; i += 5) {
    const batch = keywords.slice(i, i + 5);
    const keywordGroups = batch.map(kw => ({
      groupName: kw,
      keywords: [kw],
    }));

    try {
      const endDate = new Date().toISOString().slice(0, 10);
      const startDate = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);

      const res = await fetch('https://openapi.naver.com/v1/datalab/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Naver-Client-Id': process.env.NAVER_DATALAB_CLIENT_ID,
          'X-Naver-Client-Secret': process.env.NAVER_DATALAB_CLIENT_SECRET,
        },
        body: JSON.stringify({
          startDate,
          endDate,
          timeUnit: 'month',
          keywordGroups,
        }),
      });

      if (!res.ok) {
        console.error(`[KEYWORDS] DataLab error: ${res.status}`);
        continue;
      }

      const data = await res.json();
      for (const group of (data.results || [])) {
        const periods = group.data || [];
        if (periods.length >= 2) {
          const recent = periods[periods.length - 1].ratio;
          const prev = periods[periods.length - 2].ratio;
          const change = prev > 0 ? ((recent - prev) / prev) * 100 : 0;
          results.set(group.title, {
            trend: change > 10 ? 'rising' : change < -10 ? 'falling' : 'stable',
            trendChange: Math.round(change),
            trendData: periods.map(p => Math.round(p.ratio)),
          });
        } else {
          results.set(group.title, { trend: 'stable', trendChange: 0, trendData: [] });
        }
      }
    } catch (err) {
      console.error(`[KEYWORDS] DataLab batch error:`, err.message);
    }

    if (i + 5 < keywords.length) await sleep(200);
  }
  return results;
}

// ─── 등급 판정 ───
function getGrade(score) {
  if (score >= 70) return { grade: 'blue', label: '블루오션', description: '지금 바로 글 쓰세요!' };
  if (score >= 55) return { grade: 'green', label: '틈새 공략', description: '충분히 도전할 만해요' };
  if (score >= 40) return { grade: 'yellow', label: '경쟁 있음', description: '글 품질이 좋아야 해요' };
  return { grade: 'red', label: '레드오션', description: '상위 노출 어려워요' };
}

// ─── 황금점수 산출 (v2: 등급 라벨 기반) ───
function calculateGoldenScore(keyword, monthlySearch, pcSearch, mobileSearch, competition, blogCount, trendInfo) {
  const breakdown = {};
  const blogCountAvailable = blogCount >= 0; // -1이면 미수집

  // 1. 검색량 (25점) — 6단계 세분화
  if (monthlySearch < 200) breakdown.search = 8;
  else if (monthlySearch < 500) breakdown.search = 22;
  else if (monthlySearch < 2000) breakdown.search = 25;
  else if (monthlySearch < 5000) breakdown.search = 20;
  else if (monthlySearch < 10000) breakdown.search = 15;
  else breakdown.search = 10;

  // 2. 포화도 (30점) — 가장 중요한 지표
  const actualBlogCount = blogCountAvailable ? blogCount : 0;
  const saturation = monthlySearch > 0 ? actualBlogCount / monthlySearch : 999;
  if (!blogCountAvailable) {
    breakdown.saturation = 10; // 미수집: 중립값
  } else if (saturation <= 3) breakdown.saturation = 30;
  else if (saturation <= 8) breakdown.saturation = 25;
  else if (saturation <= 15) breakdown.saturation = 18;
  else if (saturation <= 30) breakdown.saturation = 10;
  else if (saturation <= 50) breakdown.saturation = 5;
  else breakdown.saturation = 0;

  // 3. 경쟁도 (10점) — 광고 경쟁도이므로 배점 축소
  const compMap = { low: 10, medium: 5, high: 1 };
  breakdown.competition = compMap[competition] || 5;

  // 4. 트렌드 (15점) — 5단계 세분화
  const trend = trendInfo?.trend || 'unknown';
  const trendChange = trendInfo?.trendChange || 0;
  if (trend === 'unknown') {
    breakdown.trend = 7; // 미수집: 중립값
  } else if (trendChange >= 20) breakdown.trend = 15;
  else if (trendChange >= 10) breakdown.trend = 12;
  else if (trendChange >= -10) breakdown.trend = 7;
  else if (trendChange >= -20) breakdown.trend = 3;
  else breakdown.trend = 0;

  // 5. 보너스 (20점)
  breakdown.bonus = 0;
  if (/하는\s*법|하는\s*방법|차이|비교|추천|어떻게|언제|얼마/.test(keyword)) breakdown.bonus += 5;
  if (keyword.split(/\s+/).length >= 3) breakdown.bonus += 4;
  // 모바일 비율 70% 이상이면 블로그 노출에 유리
  const totalSearch = (pcSearch || 0) + (mobileSearch || 0);
  if (totalSearch > 0 && (mobileSearch || 0) / totalSearch >= 0.7) breakdown.bonus += 5;
  // 에버그린 패턴 보너스
  if (/순서|과정|체크리스트|확인사항|선택\s*기준|안\s*되는\s*이유|안\s*느는\s*이유/.test(keyword)) breakdown.bonus += 4;
  breakdown.bonus = Math.min(breakdown.bonus, 20);

  const score = breakdown.search + breakdown.saturation + breakdown.competition + breakdown.trend + breakdown.bonus;
  const gradeInfo = getGrade(score);

  return {
    score,
    breakdown,
    saturation: blogCountAvailable ? Math.round(saturation * 10) / 10 : -1,
    blogCountAvailable,
    ...gradeInfo,
  };
}

// ─── 메인 핸들러 ───
export default async function handler(req, res) {
  setCorsHeaders(res, req);
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('X-Keywords-Version', DEBUG_VERSION);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  // 인증
  const isAdmin = await resolveAdmin(req);
  const token = extractToken(req);
  const email = await resolveSessionEmail(token);

  if (!isAdmin && !email) {
    return res.status(401).json({ error: '로그인이 필요합니다.' });
  }

  // Rate limit
  const ip = getClientIp(req);
  let rateLimitKey = null;

  if (!isAdmin) {
    rateLimitKey = `ratelimit:keywords:${email || ip}:${getKSTDate()}`;
    const count = await getRedis().incr(rateLimitKey);
    await getRedis().expire(rateLimitKey, getTTLUntilMidnightKST());

    if (count > FREE_DAILY_LIMIT) {
      await getRedis().decr(rateLimitKey);
      return res.status(429).json({
        error: `황금키워드 일일 한도(${FREE_DAILY_LIMIT}회)를 초과했습니다. 내일 다시 이용해주세요.`,
        remaining: 0,
      });
    }
  }

  const { field, role, target, questions, userSeeds } = req.body;
  const hasQuestionDetail = Boolean(String(questions || '').trim() || String(userSeeds || '').trim());

  if (!field || !role || !target) {
    if (rateLimitKey) try { await getRedis().decr(rateLimitKey); } catch (_) {}
    return res.status(400).json({ error: '내 분야, 나는, 타겟 독자를 모두 입력해주세요.' });
  }

  try {
    // Phase 1: AI 시드키워드
    console.log(`[KEYWORDS] Phase 1: Generating seed keywords for "${field}"`);
    let seedKeywords = await generateSeedKeywords(field, role, target, questions);

    // 사용자 직접 시드키워드 병합
    const userSeedList = [];
    if (userSeeds) {
      const manual = userSeeds.split(/[,\n]/).map(s => s.trim()).filter(s => s.length > 0);
      for (const kw of manual) {
        userSeedList.push(kw);
        if (!seedKeywords.includes(kw)) seedKeywords.push(kw);
      }
    }
    const userSeedSet = new Set(userSeedList.map(s => normalizeKoreanText(s).replace(/\s+/g, '')));
    console.log(`[KEYWORDS] Seeds (AI+manual): ${seedKeywords.length}, userSeeds: ${userSeedList.length}`);
    const intentSeedKeywords = [...seedKeywords];

    // Phase 1.5: 자동완성으로 시드 확장
    console.log(`[KEYWORDS] Phase 1.5: Expanding with autocomplete`);
    seedKeywords = await expandWithAutoComplete(seedKeywords);
    console.log(`[KEYWORDS] Seeds (expanded): ${seedKeywords.length}`);

    // Phase 2: 검색광고 API — 연관키워드 + 검색량 + 경쟁도
    console.log(`[KEYWORDS] Phase 2: Fetching search volumes`);
    const searchData = await fetchSearchAdKeywords(seedKeywords);
    console.log(`[KEYWORDS] SearchAd: ${searchData.size} keywords found`);

    // Phase 2.5: 입력 의도 기반 관련성 필터
    const intentSignals = extractIntentSignals(field, role, target, questions, userSeeds, intentSeedKeywords);
    console.log(`[KEYWORDS] Intent specific tokens: ${intentSignals.specificTokens.slice(0, 10).join(', ')}...`);

    const rawCandidates = Array.from(searchData.values()).filter(k => k.monthlySearch > 0);
    const minMonthlySearch = determineMinSearchThreshold(intentSignals, searchData.size);
    let allCandidates = rawCandidates.filter(k => k.monthlySearch >= minMonthlySearch);
    let thresholdFallbackUsed = false;
    if (allCandidates.length === 0 && rawCandidates.length > 0) {
      thresholdFallbackUsed = true;
      allCandidates = rawCandidates;
    }
    const scoredCandidates = allCandidates.map(candidate => ({
      ...candidate,
      _intent: scoreRelevantKeyword(candidate.keyword, intentSignals),
    }));
    // userSeeds에서 파생된 키워드는 관련성 필터 바이패스 (사용자가 직접 넣은 건 무조건 포함)
    const relevantCandidates = scoredCandidates
      .filter(candidate => {
        if (candidate._intent.relevant) return true;
        const compactKw = normalizeKoreanText(candidate.keyword).replace(/\s+/g, '');
        return userSeedSet.size > 0 && Array.from(userSeedSet).some(seed => compactKw.includes(seed) || seed.includes(compactKw));
      })
      .sort((a, b) => b._intent.score - a._intent.score || b.monthlySearch - a.monthlySearch);
    const baseDisplayCandidates = scoredCandidates
      .filter(candidate =>
        candidate.monthlySearch >= DISPLAY_MIN_MONTHLY_SEARCH &&
        ((candidate._intent.broadHits?.length || 0) > 0 || (candidate._intent.journeyHits?.length || 0) > 0)
      )
      .sort((a, b) => b.monthlySearch - a.monthlySearch || b._intent.score - a._intent.score)
      .slice(0, 40);

    let candidates;
    let fallbackUsed = false;
    if (relevantCandidates.length > 0 || baseDisplayCandidates.length > 0) {
      const candidateMap = new Map();
      relevantCandidates.slice(0, 60).forEach(candidate => candidateMap.set(candidate.keyword, candidate));
      baseDisplayCandidates.forEach(candidate => {
        if (!candidateMap.has(candidate.keyword)) candidateMap.set(candidate.keyword, candidate);
      });
      candidates = Array.from(candidateMap.values());
    } else {
      fallbackUsed = true;
      candidates = scoredCandidates
        .sort((a, b) => b.monthlySearch - a.monthlySearch)
        .slice(0, 3);
    }
    candidates = candidates
      .sort((a, b) => (b._intent?.score || 0) - (a._intent?.score || 0) || b.monthlySearch - a.monthlySearch)
      .slice(0, 80);

    console.log(`[KEYWORDS] Filtered: ${allCandidates.length} candidates after threshold ${minMonthlySearch} → ${relevantCandidates.length} relevant, ${candidates.length} total`);
    console.log(`[KEYWORDS] Intent token sample: ${intentSignals.specificTokens.slice(0, 5).join(', ')}`);
    if (candidates.length > 0) console.log(`[KEYWORDS] First candidate: "${candidates[0].keyword}" (${candidates[0].monthlySearch})`);
    if (relevantCandidates.length === 0 && allCandidates.length > 0) console.log(`[KEYWORDS] WARNING: 0 relevant from ${allCandidates.length} candidates. First all: "${allCandidates[0].keyword}"`);

    // 진단 정보 (디버깅용, 관리자에게만)
    const _debug = isAdmin ? {
      _v: DEBUG_VERSION,
      firstBatchUrl: searchData._firstError?.url || 'no_error',
      firstBatchError: searchData._firstError || null,
      firstBatch: searchData._firstBatch || null,
      apiKeyLen: (process.env.NAVER_AD_API_KEY || '').length,
      seedCount: seedKeywords.length,
      seedSample: seedKeywords.slice(0, 3),
      safeSeedCount: searchData._safeSeedCount || 0,
      safeSeedsSample: searchData._safeSeedsSample || [],
      droppedSeedsSample: searchData._droppedSeedsSample || [],
      searchAdTotal: searchData.size,
      minMonthlySearch,
      thresholdFallbackUsed,
      intentSpecificSample: intentSignals.specificTokens.slice(0, 10),
      intentContextSample: intentSignals.contextTokens.slice(0, 10),
      targetPrioritySample: intentSignals.targetPriorityTokens.slice(0, 10),
      journeySample: intentSignals.journeyTokens.slice(0, 10),
      industrySample: intentSignals.industryTokens.slice(0, 10),
      allowLocationIntent: intentSignals.allowLocationIntent,
      topIntentMatches: relevantCandidates.slice(0, 5).map(candidate => ({
        keyword: candidate.keyword,
        score: candidate._intent.score,
        specificHits: candidate._intent.specificHits.slice(0, 4),
        contextHits: candidate._intent.contextHits.slice(0, 4),
        targetHits: candidate._intent.targetHits.slice(0, 4),
        phraseHits: candidate._intent.phraseHits.slice(0, 2),
        journeyHits: candidate._intent.journeyHits.slice(0, 3),
      })),
      allCandidates: allCandidates.length,
      relevantCandidates: relevantCandidates.length,
      baseDisplayCandidates: baseDisplayCandidates.length,
      finalCandidates: candidates.length,
      fallbackUsed,
    } : undefined;

    if (candidates.length === 0) {
      if (rateLimitKey) try { await getRedis().decr(rateLimitKey); } catch (_) {}
      return res.status(200).json({
        keywords: [],
        sections: [],
        totalFound: 0,
        seedKeywords,
        message: '검색량이 있는 키워드를 찾지 못했습니다. 다른 분야나 타겟으로 시도해보세요.',
        _debug,
      });
    }

    // Phase 3: 블로그 발행량 (전체 후보 — 포화도 데이터 완전 커버)
    console.log(`[KEYWORDS] Phase 3: Fetching blog counts (${candidates.length} keywords)`);
    const blogKeywords = candidates.map(k => k.keyword);
    const blogCountResult = await fetchBlogCounts(blogKeywords);
    const blogCounts = blogCountResult.counts;
    const blogFailureCount = blogCountResult.failures.length;
    if (blogFailureCount > 0) {
      console.warn(`[KEYWORDS] Blog count failures: ${blogFailureCount}/${blogKeywords.length}`);
    }

    // Phase 4: DataLab 트렌드 (상위 40개)
    console.log(`[KEYWORDS] Phase 4: Fetching trends`);
    const top40 = candidates.slice(0, 40).map(k => k.keyword);
    const trends = await fetchTrends(top40);

    // Phase 5: 점수 산출 (v2: 등급 라벨 기반)
    console.log(`[KEYWORDS] Phase 5: Scoring`);
    const results = candidates.map(k => {
      const blogCount = blogCounts.has(k.keyword) ? blogCounts.get(k.keyword) : -1;
      const intentMeta = buildIntentMeta(k._intent);
      const normalizedKeyword = normalizeKoreanText(k.keyword);
      const trendInfo = trends.has(k.keyword)
        ? trends.get(k.keyword)
        : { trend: 'unknown', trendChange: 0, trendData: [] };
      const { score, breakdown, saturation, blogCountAvailable } = calculateGoldenScore(
        k.keyword, k.monthlySearch, k.pcSearch, k.mobileSearch, k.competition, blogCount, trendInfo
      );

      const intentBonus = Math.min(12, Math.max(0, Math.floor(intentMeta.score / 3)));
      const baseResult = {
        keyword: k.keyword,
        _normalizedKeyword: normalizedKeyword,
        rawScore: score,
        intentBonus,
        monthlySearch: k.monthlySearch,
        pcSearch: k.pcSearch,
        mobileSearch: k.mobileSearch,
        competition: k.competition,
        blogCount: blogCountAvailable ? blogCount : -1,
        blogCountAvailable,
        saturation,
        trend: trendInfo.trend,
        trendChange: trendInfo.trendChange,
        trendData: trendInfo.trendData,
        breakdown,
        intentMeta,
      };
      const rankingAdjustment = calculateRankingAdjustments(baseResult);
      const boostedScore = score + intentBonus + rankingAdjustment.adjustment;
      const boostedGrade = getGrade(boostedScore);
      return {
        keyword: k.keyword,
        _normalizedKeyword: normalizedKeyword,
        score: boostedScore,
        rawScore: score,
        intentBonus,
        rankingAdjustment: rankingAdjustment.adjustment,
        rankingAdjustmentReasons: rankingAdjustment.reasons,
        grade: boostedGrade.grade,
        label: boostedGrade.label,
        gradeDescription: boostedGrade.description,
        monthlySearch: k.monthlySearch,
        pcSearch: k.pcSearch,
        mobileSearch: k.mobileSearch,
        competition: k.competition,
        blogCount: blogCountAvailable ? blogCount : -1,
        blogCountAvailable,
        saturation,
        trend: trendInfo.trend,
        trendChange: trendInfo.trendChange,
        trendData: trendInfo.trendData,
        breakdown,
        intentMeta: baseResult.intentMeta,
      };
    })
    .sort((a, b) => b.score - a.score);

    const publicResults = results.map(({ _normalizedKeyword, ...result }) => result);
    const filteredResults = publicResults.filter(result => result.monthlySearch >= DISPLAY_MIN_MONTHLY_SEARCH);
    const sections = buildKeywordSections(results, intentSignals);
    const featuredGroups = buildFeaturedGroups(publicResults, filteredResults, intentSignals, { hasQuestionDetail });
    if (_debug) {
      _debug.displayMinMonthlySearch = DISPLAY_MIN_MONTHLY_SEARCH;
      _debug.preDisplayCount = results.length;
      _debug.hasQuestionDetail = hasQuestionDetail;
      _debug.blogFailureCount = blogFailureCount;
      _debug.blogFailureSample = blogCountResult.failures.slice(0, 5);
      _debug.baseFeaturedCount = featuredGroups.base.keywords.length;
      _debug.nicheFeaturedCount = featuredGroups.niche.keywords.length;
      _debug.topRanked = results.slice(0, 5).map(result => ({
        keyword: result.keyword,
        score: result.score,
        rawScore: result.rawScore,
        intentBonus: result.intentBonus,
        rankingAdjustment: result.rankingAdjustment,
        rankingAdjustmentReasons: result.rankingAdjustmentReasons,
      }));
    }

    if (filteredResults.length === 0) {
      if (rateLimitKey) try { await getRedis().decr(rateLimitKey); } catch (_) {}
      return res.status(200).json({
        keywords: [],
        sections,
        featuredGroups,
        totalFound: 0,
        seedKeywords,
        message: `월간 검색수 ${DISPLAY_MIN_MONTHLY_SEARCH} 이상인 키워드를 찾지 못했습니다. 입력을 더 넓게 쓰거나 조건을 조정해보세요.`,
        _debug,
      });
    }

    const remaining = isAdmin ? 999 : FREE_DAILY_LIMIT - (await getRedis().get(rateLimitKey) || 0);

    logUsage(email, 'keyword', null, ip);

    console.log(`[KEYWORDS] Done! Top: "${results[0]?.keyword}" (${results[0]?.score}pt)`);

    const noticeMessages = [];
    if (fallbackUsed) noticeMessages.push('분야 적합 키워드가 부족해 일부 결과만 제한적으로 표시했습니다.');
    if (minMonthlySearch < 50) noticeMessages.push(`특수 타겟 검색을 반영해 검색량 하한을 ${minMonthlySearch}으로 낮췄습니다.`);
    if (thresholdFallbackUsed) noticeMessages.push('검색량이 낮은 틈새 키워드까지 포함해 결과를 확장했습니다.');
    if (blogFailureCount > 0) noticeMessages.push('일부 포화도 데이터는 네이버 응답 지연으로 미수집될 수 있습니다.');

    return res.status(200).json({
      keywords: filteredResults,
      featuredGroups,
      sections,
      totalFound: filteredResults.length,
      seedKeywords,
      remaining: Math.max(0, remaining),
      limit: FREE_DAILY_LIMIT,
      notice: [`월간 검색수 ${DISPLAY_MIN_MONTHLY_SEARCH} 이상만 표시합니다.`].concat(noticeMessages).join(' ').trim() || undefined,
      _debug,
    });

  } catch (error) {
    console.error('[KEYWORDS] Error:', error.message, error.stack);
    if (rateLimitKey) try { await getRedis().decr(rateLimitKey); } catch (_) {}
    return res.status(500).json({ error: '키워드 분석 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.' });
  }
}
