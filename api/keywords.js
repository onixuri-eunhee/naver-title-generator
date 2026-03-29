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
- Include question-type keywords (~하는 법, ~하는 방법, ~어디서)
- Be specific to the field and target audience
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
  const top15 = seedKeywords.slice(0, 15);
  const results = await Promise.all(top15.map(kw => fetchAutoComplete(kw)));
  for (const suggestions of results) {
    for (const s of suggestions) expanded.add(s);
  }
  return Array.from(expanded);
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

  // 시드키워드를 5개씩 배치 호출 (API 제한)
  for (let i = 0; i < seedKeywords.length; i += 5) {
    const batch = seedKeywords.slice(i, i + 5);
    const params = new URLSearchParams({
      hintKeywords: batch.join(','),
      showDetail: '1',
    });

    try {
      const ts = String(Date.now());
      const h = crypto.createHmac('sha256', SECRET);
      h.update(`${ts}.${method}.${uri}`);
      const sig = h.digest('base64');

      const res = await fetch(`https://api.searchad.naver.com${uri}?${params}`, {
        headers: {
          'X-Timestamp': ts,
          'X-API-KEY': API_KEY,
          'X-Customer': CUSTOMER_ID,
          'X-Signature': sig,
        },
      });

      if (!res.ok) {
        console.error(`[KEYWORDS] SearchAd API error: ${res.status}`);
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
    if (i + 5 < seedKeywords.length) await new Promise(r => setTimeout(r, 200));
  }

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
    if (!res.ok) return 0;
    const data = await res.json();
    return data.total || 0;
  } catch (_) {
    return 0;
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

// ─── 황금점수 산출 ───
function calculateGoldenScore(keyword, monthlySearch, competition, blogCount, trendInfo) {
  let score = 0;
  const breakdown = {};

  // 1. 검색량 (30점)
  if (monthlySearch < 100) breakdown.search = 8;
  else if (monthlySearch < 1000) breakdown.search = 22;
  else if (monthlySearch < 5000) breakdown.search = 30;
  else if (monthlySearch < 10000) breakdown.search = 25;
  else breakdown.search = 18;

  // 2. 경쟁도 (20점)
  const compMap = { low: 20, medium: 10, high: 3 };
  breakdown.competition = compMap[competition] || 10;

  // 3. 포화도 (20점) — 블로그 발행량 / 월간 검색수
  const saturation = monthlySearch > 0 ? blogCount / monthlySearch : 999;
  if (saturation <= 5) breakdown.saturation = 20;
  else if (saturation <= 15) breakdown.saturation = 15;
  else if (saturation <= 30) breakdown.saturation = 10;
  else if (saturation <= 50) breakdown.saturation = 5;
  else breakdown.saturation = 0;

  // 4. 트렌드 (20점)
  const trend = trendInfo?.trend || 'stable';
  breakdown.trend = trend === 'rising' ? 20 : trend === 'stable' ? 10 : 0;

  // 5. 보너스 (10점)
  breakdown.bonus = 0;
  // 질문형
  if (/하는\s*법|하는\s*방법|차이|비교|추천|어떻게|언제|얼마/.test(keyword)) breakdown.bonus += 3;
  // 롱테일 (3어절 이상)
  if (keyword.split(/\s+/).length >= 3) breakdown.bonus += 2;
  // 쇼핑 연관은 별도 체크 불필요 (이미 검색량에 반영)
  breakdown.bonus = Math.min(breakdown.bonus, 10);

  score = breakdown.search + breakdown.competition + breakdown.saturation + breakdown.trend + breakdown.bonus;

  return { score, breakdown, saturation: Math.round(saturation * 10) / 10 };
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

    // 검색량 100 이상만 필터 (상위 80개)
    const candidates = Array.from(searchData.values())
      .filter(k => k.monthlySearch >= 50)
      .sort((a, b) => b.monthlySearch - a.monthlySearch)
      .slice(0, 80);

    if (candidates.length === 0) {
      if (rateLimitKey) try { await getRedis().decr(rateLimitKey); } catch (_) {}
      return res.status(200).json({
        keywords: [],
        totalFound: 0,
        seedKeywords,
        message: '검색량이 있는 키워드를 찾지 못했습니다. 다른 분야나 타겟으로 시도해보세요.',
      });
    }

    // Phase 3: 블로그 발행량 (상위 40개만 — API 호출 절약)
    console.log(`[KEYWORDS] Phase 3: Fetching blog counts`);
    const top40 = candidates.slice(0, 40).map(k => k.keyword);
    const blogCounts = await fetchBlogCounts(top40);

    // Phase 4: DataLab 트렌드 (상위 25개만)
    console.log(`[KEYWORDS] Phase 4: Fetching trends`);
    const top25 = candidates.slice(0, 25).map(k => k.keyword);
    const trends = await fetchTrends(top25);

    // Phase 5: 점수 산출
    console.log(`[KEYWORDS] Phase 5: Scoring`);
    const results = candidates.map(k => {
      const blogCount = blogCounts.get(k.keyword) || 0;
      const trendInfo = trends.get(k.keyword) || { trend: 'stable', trendChange: 0, trendData: [] };
      const { score, breakdown, saturation } = calculateGoldenScore(
        k.keyword, k.monthlySearch, k.competition, blogCount, trendInfo
      );

      return {
        keyword: k.keyword,
        score,
        monthlySearch: k.monthlySearch,
        pcSearch: k.pcSearch,
        mobileSearch: k.mobileSearch,
        competition: k.competition,
        blogCount,
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
    });

  } catch (error) {
    console.error('[KEYWORDS] Error:', error.message, error.stack);
    if (rateLimitKey) try { await getRedis().decr(rateLimitKey); } catch (_) {}
    return res.status(500).json({ error: '키워드 분석 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.' });
  }
}
