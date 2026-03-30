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
  const systemPrompt = `You are a Korean SEO keyword expert. Generate 20-30 seed keywords that the target audience would search on Naver.

## RULES
- Keywords must be in Korean
- Mix of short-tail (2 words) and long-tail (3-5 words) keywords
- Include informational keywords (방법, 추천, 비용, 후기, 비교, 차이)
- Include question-type keywords (하는 법, 하는 방법, 어디서)
- Be specific to the field and target audience
- Extract key traits from target description and combine with the field (e.g. if target is overseas Korean, include keywords like 해외 한국 결혼식)
- IMPORTANT: Output keywords as plain Korean text only. No special characters like ~, ?, !, /, quotes, or arrows.
- Output ONLY a JSON array of strings, nothing else`;

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
  const top5 = seedKeywords.slice(0, 15);
  const results = await Promise.all(top5.map(kw => fetchAutoComplete(kw)));
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

function extractCoreWords(field, seedKeywords) {
  // 분야명 + 시드키워드를 합쳐서 핵심 단어 추출
  const allText = [field, ...seedKeywords].join(' ');
  // 공백/구분자로 1차 분리
  const rawWords = allText.split(/[\s,/·]+/).filter(w => w.length >= 2);

  // 2글자 이상 서브스트링도 추출 (복합어 대응: "웨딩컨설팅" → "웨딩", "컨설팅")
  const subWords = [];
  for (const w of rawWords) {
    if (w.length >= 4) {
      // 2글자씩 슬라이딩 윈도우로 서브스트링 추출
      for (let i = 0; i <= w.length - 2; i++) {
        const sub = w.substring(i, i + 2);
        if (!GENERIC_WORDS.has(sub)) subWords.push(sub);
      }
      // 3글자 서브스트링도
      for (let i = 0; i <= w.length - 3; i++) {
        const sub = w.substring(i, i + 3);
        if (!GENERIC_WORDS.has(sub)) subWords.push(sub);
      }
    }
  }

  const freq = new Map();
  // 분야명 단어에 높은 가중치
  const fieldWords = field.split(/[\s,/·]+/).filter(w => w.length >= 2);
  for (const w of fieldWords) freq.set(w, (freq.get(w) || 0) + 20);
  // 분야명 서브스트링도 높은 가중치
  for (const w of fieldWords) {
    if (w.length >= 4) {
      for (let i = 0; i <= w.length - 2; i++) freq.set(w.substring(i, i + 2), (freq.get(w.substring(i, i + 2)) || 0) + 15);
    }
  }
  // 원본 단어 (범용 제외)
  for (const w of rawWords) {
    if (!GENERIC_WORDS.has(w)) freq.set(w, (freq.get(w) || 0) + 3);
  }
  // 서브스트링 (낮은 가중치)
  for (const w of subWords) freq.set(w, (freq.get(w) || 0) + 1);

  // 빈도 순 정렬 후 상위 50개
  return Array.from(freq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 50)
    .map(([w]) => w);
}

function isRelevantKeyword(keyword, coreWords) {
  const kw = keyword.toLowerCase();
  return coreWords.some(w => kw.includes(w.toLowerCase()));
}

// ─── 검색광고 API: 연관키워드 + 검색량 + 경쟁도 ───
async function fetchSearchAdKeywords(seedKeywords) {
  const API_KEY = process.env.NAVER_AD_API_KEY;
  const SECRET = process.env.NAVER_AD_SECRET_KEY;
  const CUSTOMER_ID = process.env.NAVER_AD_CUSTOMER_ID;

  const timestamp = String(Date.now());
  const method = 'GET';
  const uri = '/keywordstool';
  const hmac = crypto.createHmac('sha256', SECRET);
  hmac.update(`${timestamp}.${method}.${uri}`);
  const signature = hmac.digest('base64');

  const allResults = new Map();
  const _apiErrors = []; // 진단용

  // 시드키워드 정제 후 배치 호출 (특수문자 → API 400 에러 방지)
  const safeSeeds = seedKeywords
    .map(kw => kw.replace(/[^가-힣a-zA-Z0-9\s]/g, '').trim())
    .filter(kw => kw.length >= 2);

  console.log(`[KEYWORDS] SafeSeeds: ${safeSeeds.length} from ${seedKeywords.length}. Sample: [${safeSeeds.slice(0,3).join(', ')}]`);

  for (let i = 0; i < safeSeeds.length; i += 5) {
    const batch = safeSeeds.slice(i, i + 5).map(kw => kw.slice(0, 50)); // 키워드당 50자 제한
    // 각 키워드를 개별 인코딩, 쉼표는 리터럴로 유지 (URLSearchParams 사용 금지)
    const hintKeywords = batch.map(kw => encodeURIComponent(kw)).join(',');
    const queryString = `hintKeywords=${hintKeywords}&showDetail=1`;

    try {
      const ts = String(Date.now());
      const h = crypto.createHmac('sha256', SECRET);
      h.update(`${ts}.${method}.${uri}`);
      const sig = h.digest('base64');

      const res = await fetch(`https://api.searchad.naver.com${uri}?${queryString}`, {
        headers: {
          'X-Timestamp': ts,
          'X-API-KEY': API_KEY,
          'X-Customer': CUSTOMER_ID,
          'X-Signature': sig,
        },
      });

      if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        console.error(`[KEYWORDS] SearchAd API error: ${res.status} ${errBody.slice(0, 200)}`);
        _apiErrors.push({ batch: i/5, status: res.status, body: errBody.slice(0, 100) });
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
      _apiErrors.push({ batch: i/5, error: err.message });
    }

    // API rate limit 보호
    if (i + 5 < safeSeeds.length) await new Promise(r => setTimeout(r, 200));
  }

  allResults._apiErrors = _apiErrors;
  allResults._safeSeedsSample = safeSeeds.slice(0, 5);
  return allResults;
}

// ─── 네이버 검색 API: 블로그 발행량 (포화도) ───
async function fetchBlogCount(keyword) {
  try {
    const params = new URLSearchParams({ query: keyword, display: '1', sort: 'sim' });
    const res = await fetch(`https://openapi.naver.com/v1/search/blog.json?${params}`, {
      headers: {
        'X-Naver-Client-Id': process.env.NAVER_CLIENT_ID,
        'X-Naver-Client-Secret': process.env.NAVER_CLIENT_SECRET,
      },
    });
    if (!res.ok) return -1; // API 실패 시 -1 (미수집 표시)
    const data = await res.json();
    return data.total || 0;
  } catch (_) {
    return -1; // 네트워크 에러 시 -1 (미수집 표시)
  }
}

async function fetchBlogCounts(keywords) {
  const results = new Map();
  // 10개씩 병렬 (API rate limit 고려)
  for (let i = 0; i < keywords.length; i += 10) {
    const batch = keywords.slice(i, i + 10);
    const counts = await Promise.all(batch.map(kw => fetchBlogCount(kw)));
    batch.forEach((kw, j) => results.set(kw, counts[j]));
    if (i + 10 < keywords.length) await new Promise(r => setTimeout(r, 100));
  }
  return results;
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

    if (i + 5 < keywords.length) await new Promise(r => setTimeout(r, 200));
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
  if (monthlySearch < 200) breakdown.search = 15;
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

  // 3. 경쟁도 (15점)
  const compMap = { low: 15, medium: 8, high: 2 };
  breakdown.competition = compMap[competition] || 8;

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

  // 5. 보너스 (15점)
  breakdown.bonus = 0;
  if (/하는\s*법|하는\s*방법|차이|비교|추천|어떻게|언제|얼마/.test(keyword)) breakdown.bonus += 4;
  if (keyword.split(/\s+/).length >= 3) breakdown.bonus += 3;
  // 모바일 비율 70% 이상이면 블로그 노출에 유리
  const totalSearch = (pcSearch || 0) + (mobileSearch || 0);
  if (totalSearch > 0 && (mobileSearch || 0) / totalSearch >= 0.7) breakdown.bonus += 4;
  breakdown.bonus = Math.min(breakdown.bonus, 15);

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

  if (!field || !role || !target) {
    if (rateLimitKey) try { await getRedis().decr(rateLimitKey); } catch (_) {}
    return res.status(400).json({ error: '내 분야, 나는, 타겟 독자를 모두 입력해주세요.' });
  }

  try {
    // Phase 1: AI 시드키워드
    console.log(`[KEYWORDS] Phase 1: Generating seed keywords for "${field}"`);
    let seedKeywords = await generateSeedKeywords(field, role, target, questions);

    // 사용자 직접 시드키워드 병합
    if (userSeeds) {
      const manual = userSeeds.split(/[,\n]/).map(s => s.trim()).filter(s => s.length > 0);
      for (const kw of manual) {
        if (!seedKeywords.includes(kw)) seedKeywords.push(kw);
      }
    }
    console.log(`[KEYWORDS] Seeds (AI+manual): ${seedKeywords.length}`);

    // Phase 1.5: 자동완성으로 시드 확장
    console.log(`[KEYWORDS] Phase 1.5: Expanding with autocomplete`);
    seedKeywords = await expandWithAutoComplete(seedKeywords);
    console.log(`[KEYWORDS] Seeds (expanded): ${seedKeywords.length}`);

    // Phase 2: 검색광고 API — 연관키워드 + 검색량 + 경쟁도
    console.log(`[KEYWORDS] Phase 2: Fetching search volumes`);
    const searchData = await fetchSearchAdKeywords(seedKeywords);
    console.log(`[KEYWORDS] SearchAd: ${searchData.size} keywords found`);

    // Phase 2.5: 분야 적합도 필터 (엉뚱한 키워드 제거)
    const coreWords = extractCoreWords(field, seedKeywords);
    console.log(`[KEYWORDS] Core words: ${coreWords.slice(0, 10).join(', ')}...`);

    const allCandidates = Array.from(searchData.values()).filter(k => k.monthlySearch >= 50);
    const relevantCandidates = allCandidates.filter(k => isRelevantKeyword(k.keyword, coreWords));

    // 적합 키워드 우선, 최소 5개 보장 (부족분만 비적합에서 채움)
    const MIN_RESULTS = 5;
    let candidates;
    if (relevantCandidates.length >= MIN_RESULTS) {
      // 적합 키워드만 사용
      candidates = relevantCandidates;
    } else {
      // 적합 키워드 + 부족분을 비적합에서 보충
      const relevantSet = new Set(relevantCandidates.map(k => k.keyword));
      const filler = allCandidates
        .filter(k => !relevantSet.has(k.keyword))
        .sort((a, b) => b.monthlySearch - a.monthlySearch)
        .slice(0, MIN_RESULTS - relevantCandidates.length);
      candidates = [...relevantCandidates, ...filler];
    }
    candidates = candidates
      .sort((a, b) => b.monthlySearch - a.monthlySearch)
      .slice(0, 80);

    console.log(`[KEYWORDS] Filtered: ${allCandidates.length} → ${relevantCandidates.length} relevant, ${candidates.length} total`);
    console.log(`[KEYWORDS] Core words sample: ${coreWords.slice(0, 5).join(', ')}`);
    if (candidates.length > 0) console.log(`[KEYWORDS] First candidate: "${candidates[0].keyword}" (${candidates[0].monthlySearch})`);
    if (relevantCandidates.length === 0 && allCandidates.length > 0) console.log(`[KEYWORDS] WARNING: 0 relevant from ${allCandidates.length} candidates. First all: "${allCandidates[0].keyword}"`);

    // 진단 정보 (디버깅용, 관리자에게만)
    const _debug = isAdmin ? {
      _v: 'v6-manual-url',
      safeSeedsSample: searchData._safeSeedsSample || [],
      seedCount: seedKeywords.length,
      searchAdTotal: searchData.size,
      searchAdErrors: searchData._apiErrors || [],
      allCandidates: allCandidates.length,
      relevantCandidates: relevantCandidates.length,
      finalCandidates: candidates.length,
      coreWordsTop10: coreWords.slice(0, 10),
      sampleAllKeywords: allCandidates.slice(0, 5).map(k => k.keyword),
    } : undefined;

    if (candidates.length === 0) {
      if (rateLimitKey) try { await getRedis().decr(rateLimitKey); } catch (_) {}
      return res.status(200).json({
        keywords: [],
        totalFound: 0,
        seedKeywords,
        message: '검색량이 있는 키워드를 찾지 못했습니다. 다른 분야나 타겟으로 시도해보세요.',
        _debug,
      });
    }

    // Phase 3: 블로그 발행량 (전체 후보 — 포화도 데이터 완전 커버)
    console.log(`[KEYWORDS] Phase 3: Fetching blog counts (${candidates.length} keywords)`);
    const blogKeywords = candidates.map(k => k.keyword);
    const blogCounts = await fetchBlogCounts(blogKeywords);

    // Phase 4: DataLab 트렌드 (상위 40개)
    console.log(`[KEYWORDS] Phase 4: Fetching trends`);
    const top40 = candidates.slice(0, 40).map(k => k.keyword);
    const trends = await fetchTrends(top40);

    // Phase 5: 점수 산출 (v2: 등급 라벨 기반)
    console.log(`[KEYWORDS] Phase 5: Scoring`);
    const results = candidates.map(k => {
      const blogCount = blogCounts.has(k.keyword) ? blogCounts.get(k.keyword) : -1;
      const trendInfo = trends.has(k.keyword)
        ? trends.get(k.keyword)
        : { trend: 'unknown', trendChange: 0, trendData: [] };
      const { score, breakdown, saturation, blogCountAvailable, grade, label, description } = calculateGoldenScore(
        k.keyword, k.monthlySearch, k.pcSearch, k.mobileSearch, k.competition, blogCount, trendInfo
      );

      return {
        keyword: k.keyword,
        score,
        grade,
        label,
        gradeDescription: description,
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
      };
    })
    .sort((a, b) => b.score - a.score);

    const remaining = isAdmin ? 999 : FREE_DAILY_LIMIT - (await getRedis().get(rateLimitKey) || 0);

    logUsage(email, 'keyword', null, ip);

    console.log(`[KEYWORDS] Done! Top: "${results[0]?.keyword}" (${results[0]?.score}pt)`);

    return res.status(200).json({
      keywords: results,
      totalFound: results.length,
      seedKeywords,
      remaining: Math.max(0, remaining),
      limit: FREE_DAILY_LIMIT,
      _debug,
    });

  } catch (error) {
    console.error('[KEYWORDS] Error:', error.message, error.stack);
    if (rateLimitKey) try { await getRedis().decr(rateLimitKey); } catch (_) {}
    return res.status(500).json({ error: '키워드 분석 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.' });
  }
}
