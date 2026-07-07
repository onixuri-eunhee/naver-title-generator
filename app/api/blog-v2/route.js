/**
 * 뚝딱툴 블로그 생성기 v2 — 훅엔진(회전·사용자별 회피) + 작업지시서 서버판.
 *
 * POST /api/blog-v2
 * body: { industry, keyword, targetReader, userStory?, tone?, region? }
 *
 * 흐름: 최근기록 조회 → 패턴 회전 배정 → 훅 블록+프롬프트 → Sonnet 5 →
 *   JSON 파싱 → 최근기록 적재(다음 글 회피) → 반환.
 * 검수(AI티·금지어)는 별도 패스에서 — 생성 프롬프트에 검증을 쌓지 않는다(rule-stacking).
 *
 * 🚨 기존 라우트 무수정. 신규 경로. 병의원·변호사는 시즌2가 담당(이 라우트 대상 아님).
 */

import {
  resolveAuthIdentity,
  getClientIp,
  getRedis,
  isCreditsActive,
  jsonResponse,
  handleOptions,
} from '@/lib/api-helpers';
import { logUsage, chargeCredits, refundCredits } from '@/lib/db';
import { callClaude } from '@/lib/season2/anthropic';
import { buildBlogV2Prompt, parseBlogV2Draft, BLOG_V2_MODEL } from '@/lib/blog-v2/prompt';
import {
  pickTitleCombos,
  pickFirstBank,
  buildHookBlock,
  getRecentHooks,
  pushRecentHooks,
} from '@/lib/hook-engine';

export const maxDuration = 120; // 단일 생성 호출(검수 패스는 별도 라우트)

const CREDIT_COST = 1;
const DAILY_LIMIT = 3;
const CHANNEL = 'blog';

// 입력 크기 상한(비용 폭주·타임아웃 방지)
const CAPS = { industry: 60, keyword: 120, targetReader: 120, userStory: 4000, tone: 60, region: 40 };

function getKSTDate() {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}
function getTTLUntilMidnightKST() {
  const kstNow = new Date(Date.now() + 9 * 3600 * 1000);
  const next = new Date(kstNow);
  next.setUTCHours(24, 0, 0, 0);
  return Math.max(Math.floor((next - kstNow) / 1000), 60);
}

export async function OPTIONS(request) {
  return handleOptions(request);
}

export async function POST(request) {
  let email = null;
  let creditCharged = false;
  let rateLimitKey = null;

  try {
    const identity = await resolveAuthIdentity(request);
    email = identity?.email || null;
    const whitelisted = identity?.isAdmin === true;
    if (!email) {
      return jsonResponse(request, { error: '로그인이 필요합니다.' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const { industry, keyword, targetReader, userStory, tone, region } = body;

    for (const field of ['industry', 'keyword', 'targetReader']) {
      if (!body[field] || typeof body[field] !== 'string') {
        return jsonResponse(request, { error: `${field}가 필요합니다.` }, { status: 400 });
      }
    }
    for (const [field, max] of Object.entries(CAPS)) {
      const v = body[field];
      if (typeof v === 'string' && v.length > max) {
        return jsonResponse(request, { error: `${field}이(가) 너무 깁니다(최대 ${max}자).` }, { status: 400 });
      }
    }

    // 과금·한도 게이트(시즌2와 동일 정책, 관리자 면제)
    if (!whitelisted) {
      if (isCreditsActive()) {
        const result = await chargeCredits(email, CREDIT_COST, 'blog-v2');
        if (!result) {
          return jsonResponse(request, { error: '크레딧이 부족합니다. 충전 후 이용해주세요.', code: 'INSUFFICIENT_CREDITS' }, { status: 402 });
        }
        creditCharged = true;
      } else {
        rateLimitKey = `ratelimit:blog-v2:${email}:${getKSTDate()}`;
        const newCount = await getRedis().incr(rateLimitKey);
        if (newCount === 1) await getRedis().expire(rateLimitKey, getTTLUntilMidnightKST());
        if (newCount > DAILY_LIMIT) {
          await getRedis().decr(rateLimitKey);
          return jsonResponse(request, { error: `일일 사용 한도(${DAILY_LIMIT}회)를 초과했습니다.`, remaining: 0 }, { status: 429 });
        }
      }
    }

    // 1) 훅엔진: 사용자별 최근기록 → 패턴 회전 배정(글 간 다양성은 시스템이 담당)
    const hasUserStory = typeof userStory === 'string' && userStory.trim().length > 0;
    const recent = await getRecentHooks(email, CHANNEL);
    const combos = pickTitleCombos({ hasUserStory, recentCombos: recent.combos, count: 3 });
    const bank = pickFirstBank({ hasUserStory, recentBanks: recent.banks.slice(0, 3) });
    const hookBlock = buildHookBlock({
      combos,
      bank,
      avoid: { titles: recent.titles, motifs: recent.motifs },
      hasUserStory,
    });

    // 2) 생성 (Sonnet 5 — temperature 보내면 400이라 생략)
    const system = buildBlogV2Prompt({ industry, keyword, targetReader, userStory, tone, region }, hookBlock);
    const raw = await callClaude({
      system,
      messages: [{ role: 'user', content: `키워드 "${keyword}"로 블로그 원고를 작성해줘.` }],
      model: BLOG_V2_MODEL,
      maxTokens: 8192,
      temperature: null,
    });

    const draft = parseBlogV2Draft(raw);
    if (!draft) {
      await releaseCharge(email, creditCharged, rateLimitKey);
      return jsonResponse(request, { error: '원고 생성 결과를 해석하지 못했습니다. 다시 시도해 주세요.' }, { status: 502 });
    }

    // 3) 최근기록 적재 — 다음 글의 회피 목록(non-fatal)
    await pushRecentHooks(email, CHANNEL, {
      combo: draft.usedPattern || combos[0]?.signature || '',
      bank: bank.id,
      title: draft.title,
      motifs: draft.motifs,
    });

    await logUsage(email, 'blog-v2', keyword.slice(0, 100), getClientIp(request));

    return jsonResponse(request, {
      draft,
      meta: { model: BLOG_V2_MODEL, assignedCombos: combos.map((c) => c.signature), bank: bank.label },
    });
  } catch (error) {
    console.error('[blog-v2] error:', error?.message || 'unknown');
    await releaseCharge(email, creditCharged, rateLimitKey);
    return jsonResponse(request, { error: '원고 생성 중 오류가 발생했습니다.' }, { status: 500 });
  }
}

/** 실패 경로 과금 되돌림(non-fatal) */
async function releaseCharge(email, creditCharged, rateLimitKey) {
  try {
    if (creditCharged && email) await refundCredits(email, CREDIT_COST, 'blog-v2-refund');
    else if (rateLimitKey) await getRedis().decr(rateLimitKey);
  } catch (e) {
    console.error('[blog-v2] releaseCharge failed:', e?.message || 'unknown');
  }
}
