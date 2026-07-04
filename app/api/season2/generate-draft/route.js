/**
 * 시즌2 첫 슬라이스: 검색100 원고 생성 + 규제 검수 오케스트레이션.
 *
 * POST /api/season2/generate-draft
 * body: { industry, keyword, region?, subfield?, persona?, references?, benchmark?, strategy? }
 *
 * 흐름(PRD 03·04): 프롬프트 빌드 → 원고 생성 → 규제 검수 →
 *   위반 있으면 해당 문구만 재작성 후 재검수(최대 MAX_FIX_ROUNDS) →
 *   그래도 위반이면 blocked=true(발행 차단, 사용자 책임확인 필요).
 *
 * 🚨 기존 라우트 무수정. 신규 경로.
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
import { buildPrompt, parseDraft, STRATEGIES } from '@/lib/season2/prompts';
import { INDUSTRIES } from '@/lib/season2/regulation-rules';
import { runCheck, buildFixInstruction, MAX_FIX_ROUNDS } from '@/lib/season2/regulation-check';
import { callClaude, DRAFT_MODEL, CHECK_MODEL } from '@/lib/season2/anthropic';

// 여러 Claude 호출(생성+검수+재작성)이 순차 실행 → 넉넉한 실행시간. (peer: blog-image-pro=300)
export const maxDuration = 300;

const CREDIT_COST = 1;          // 글 1편 = 크레딧 1 (기존 blog-generate와 동일)
const DAILY_LIMIT = 3;          // 크레딧 비활성 시 무료 일일 한도 (PRD 하루 3편)

// 입력 크기 상한(멀티메가 프롬프트로 인한 비용 폭주·타임아웃 방지). 초과 시 400.
const CAPS = { keyword: 120, region: 40, subfield: 80, persona: 4000, references: 20000, benchmark: 8000 };

function getKSTDate() {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}
function getTTLUntilMidnightKST() {
  const kstNow = new Date(Date.now() + 9 * 3600 * 1000);
  const next = new Date(kstNow);
  next.setUTCHours(24, 0, 0, 0);
  return Math.max(Math.floor((next - kstNow) / 1000), 60);
}
function rateKey(email) {
  return `ratelimit:s2-draft:${email}:${getKSTDate()}`;
}

export async function OPTIONS(request) {
  return handleOptions(request);
}

export async function POST(request) {
  let email = null;
  let creditCharged = false;
  let rateLimitKey = null;

  try {
    // 세션 조회 1회로 email + 관리자 여부를 함께 얻는다(이중 Redis 조회 제거).
    const identity = await resolveAuthIdentity(request);
    email = identity?.email || null;
    const whitelisted = identity?.isAdmin === true;
    if (!email) {
      return jsonResponse(request, { error: '로그인이 필요합니다.' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const {
      industry,
      keyword,
      region,
      subfield,
      persona,
      references,
      benchmark,
      strategy = 'search100',
    } = body;

    if (!INDUSTRIES.includes(industry)) {
      return jsonResponse(request, { error: `industry는 ${INDUSTRIES.join('/')} 중 하나.` }, { status: 400 });
    }
    if (!keyword || typeof keyword !== 'string') {
      return jsonResponse(request, { error: 'keyword가 필요합니다.' }, { status: 400 });
    }
    if (!STRATEGIES.includes(strategy)) {
      return jsonResponse(request, { error: `strategy는 ${STRATEGIES.join('/')} 중 하나.` }, { status: 400 });
    }
    if (strategy !== 'search100') {
      return jsonResponse(request, { error: '현재 슬라이스는 search100만 지원합니다.' }, { status: 400 });
    }
    // 입력 크기 상한 — 멀티메가 프롬프트로 인한 비용 폭주·타임아웃 방지.
    for (const [field, max] of Object.entries(CAPS)) {
      const v = body[field];
      if (typeof v === 'string' && v.length > max) {
        return jsonResponse(request, { error: `${field}이(가) 너무 깁니다(최대 ${max}자).` }, { status: 400 });
      }
    }

    // 과금·한도 게이트 (기존 /api/generate와 동일 정책). 관리자는 면제.
    if (!whitelisted) {
      if (isCreditsActive()) {
        const result = await chargeCredits(email, CREDIT_COST, 's2-generate-draft');
        if (!result) {
          return jsonResponse(request, { error: '크레딧이 부족합니다. 충전 후 이용해주세요.', code: 'INSUFFICIENT_CREDITS' }, { status: 402 });
        }
        creditCharged = true;
      } else {
        rateLimitKey = rateKey(email);
        const newCount = await getRedis().incr(rateLimitKey);
        if (newCount === 1) await getRedis().expire(rateLimitKey, getTTLUntilMidnightKST());
        if (newCount > DAILY_LIMIT) {
          await getRedis().decr(rateLimitKey);
          return jsonResponse(request, { error: `일일 사용 한도(${DAILY_LIMIT}회)를 초과했습니다.`, remaining: 0 }, { status: 429 });
        }
      }
    }

    const slots = { industry, keyword, region, subfield, persona, references, benchmark };

    const userMsg = `키워드 "${keyword}"로 검색100 원고를 작성해줘.`;

    // 1) 원고 생성 (한국어 2000자 + JSON 래퍼 → 넉넉히 8192)
    const system = buildPrompt(strategy, slots);
    let draftText = await callClaude({ system, messages: [{ role: 'user', content: userMsg }], model: DRAFT_MODEL, maxTokens: 8192 });
    let draft = parseDraft(draftText);
    if (!draft) {
      // 생성 결과 파싱 불가(잘림·형식오류) → 과금 되돌리고 명확한 에러.
      await releaseCharge(email, creditCharged, rateLimitKey);
      return jsonResponse(request, { error: '원고 생성 결과를 해석하지 못했습니다. 다시 시도해 주세요.' }, { status: 502 });
    }

    // 2) 규제 검수 + 위반 시 재작성 루프 (검수 정책은 runCheck가 소유)
    let verdict = await runCheck(draft, industry);
    let rounds = 0;
    let unfixable = false; // 위반은 있으나 quote가 없어 문구 특정 불가

    while (verdict.verdict === 'fail' && verdict.violations.length > 0 && rounds < MAX_FIX_ROUNDS) {
      const fixInstruction = buildFixInstruction(verdict.violations);
      if (!fixInstruction) { unfixable = true; break; } // 고칠 문구를 특정 못 함 → 무한 재시도 방지
      rounds += 1;
      draftText = await callClaude({
        system,
        messages: [
          { role: 'user', content: userMsg },
          { role: 'assistant', content: JSON.stringify(draft) },
          { role: 'user', content: fixInstruction },
        ],
        model: DRAFT_MODEL,
        maxTokens: 8192,
      });
      const next = parseDraft(draftText);
      if (!next) break; // 재작성 결과가 깨지면 직전 draft 유지하고 중단
      draft = next;
      verdict = await runCheck(draft, industry);
    }

    const blocked = verdict.verdict !== 'pass';
    // 검수기가 fail이라면서 위반 문구를 하나도 안 준 경우 = 자동으로 고칠 수 없음(루프도 안 돎).
    if (blocked && !verdict.parseError && verdict.violations.length === 0) {
      unfixable = true;
    }
    // 검수 자체가 실패(parseError)한 것과 진짜 위반을 구분해 사용자에게 정직하게.
    let notice = null;
    if (verdict.parseError) {
      notice = '규제 자동 검수가 완료되지 않았습니다. 발행 전 내용을 직접 확인해 주세요.';
    } else if (blocked) {
      notice = unfixable
        ? '규제 위반 소지가 감지됐으나 문구를 자동 특정하지 못했습니다. 직접 확인 후 발행하세요.'
        : '규제 위반 소지 문구가 남아 있습니다. 문구를 수정하거나, 책임 확인 후에만 발행하세요.';
    }

    await logUsage(email, 's2-generate-draft', strategy, getClientIp(request));

    return jsonResponse(request, {
      draft,
      regulation: {
        verdict: verdict.verdict,
        violations: verdict.violations,
        rounds,
        parseError: verdict.parseError || false,
        unfixable,
      },
      blocked,
      notice,
      meta: { draftModel: DRAFT_MODEL, checkModel: CHECK_MODEL },
    });
  } catch (error) {
    console.error('[s2-generate-draft] error:', error?.message || 'unknown');
    // 생성 실패 시 과금 되돌림(차감/한도 카운트).
    await releaseCharge(email, creditCharged, rateLimitKey);
    return jsonResponse(request, { error: '원고 생성 중 오류가 발생했습니다.' }, { status: 500 });
  }
}

/** 실패 경로에서 차감 크레딧 환불 또는 일일 카운트 되돌림(non-fatal). */
async function releaseCharge(email, creditCharged, rateLimitKey) {
  try {
    if (creditCharged && email) await refundCredits(email, CREDIT_COST, 's2-generate-draft-refund');
    else if (rateLimitKey) await getRedis().decr(rateLimitKey);
  } catch (e) {
    console.error('[s2-generate-draft] releaseCharge failed:', e?.message || 'unknown');
  }
}
