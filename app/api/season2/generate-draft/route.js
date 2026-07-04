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
  extractToken,
  resolveSessionEmail,
  getClientIp,
  jsonResponse,
  handleOptions,
} from '@/lib/api-helpers';
import { logUsage } from '@/lib/db';
import { buildPrompt, STRATEGIES } from '@/lib/season2/prompts';
import { INDUSTRIES } from '@/lib/season2/regulation-rules';
import {
  buildCheckSystemPrompt,
  parseVerdict,
  buildFixInstruction,
  MAX_FIX_ROUNDS,
} from '@/lib/season2/regulation-check';
import { callClaude, DRAFT_MODEL, CHECK_MODEL } from '@/lib/season2/anthropic';
import { safeParseJson } from '@/lib/shortform/parse-claude-json.js';

export async function OPTIONS(request) {
  return handleOptions(request);
}

/** tags를 항상 배열로 정규화(모델이 문자열/객체로 줄 수 있음 → join 폭발 방지). */
function normalizeTags(tags) {
  if (Array.isArray(tags)) return tags.map((t) => String(t)).filter(Boolean);
  if (typeof tags === 'string') {
    return tags.split(/[,#\n]/).map((t) => t.trim()).filter(Boolean);
  }
  return [];
}

/**
 * 원고 JSON 파싱. safeParseJson(4단계 fallback) 재활용.
 * 실패 시 쓰레기(raw JSON)를 body에 넣지 않고 null 반환 → 호출부가 에러 처리.
 * @returns {{title:string, body:string, tags:string[], intent:string, note:string} | null}
 */
function parseDraft(rawText) {
  const obj = safeParseJson(String(rawText || ''));
  if (!obj || typeof obj !== 'object' || typeof obj.body !== 'string' || !obj.body.trim()) {
    return null;
  }
  return {
    title: typeof obj.title === 'string' ? obj.title : '',
    body: obj.body,
    tags: normalizeTags(obj.tags),
    intent: typeof obj.intent === 'string' ? obj.intent : '',
    note: typeof obj.note === 'string' ? obj.note : '',
  };
}

export async function POST(request) {
  try {
    const token = extractToken(request);
    const email = await resolveSessionEmail(token);
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

    const slots = { industry, keyword, region, subfield, persona, references, benchmark };

    const userMsg = `키워드 "${keyword}"로 검색100 원고를 작성해줘.`;

    // 1) 원고 생성 (한국어 2000자 + JSON 래퍼 → 넉넉히 8192)
    const system = buildPrompt(strategy, slots);
    let draftText = await callClaude({ system, messages: [{ role: 'user', content: userMsg }], model: DRAFT_MODEL, maxTokens: 8192 });
    let draft = parseDraft(draftText);
    if (!draft) {
      // 생성 결과 파싱 불가(잘림·형식오류) → 쓰레기 body 대신 명확한 에러.
      return jsonResponse(request, { error: '원고 생성 결과를 해석하지 못했습니다. 다시 시도해 주세요.' }, { status: 502 });
    }

    // 2) 규제 검수 + 위반 시 재작성 루프
    const checkSystem = buildCheckSystemPrompt(industry);
    let verdict = await checkOnce(checkSystem, draft);
    let rounds = 0;
    let unfixable = false; // 위반은 있으나 quote가 없어 문구 특정 불가

    while (verdict.verdict === 'fail' && verdict.violations.length > 0 && rounds < MAX_FIX_ROUNDS) {
      const fix = buildFixInstruction(verdict.violations);
      if (!fix.instruction) { unfixable = true; break; } // 고칠 문구를 특정 못 함 → 무한 재시도 방지
      rounds += 1;
      draftText = await callClaude({
        system,
        messages: [
          { role: 'user', content: userMsg },
          { role: 'assistant', content: JSON.stringify(draft) },
          { role: 'user', content: fix.instruction },
        ],
        model: DRAFT_MODEL,
        maxTokens: 8192,
      });
      const next = parseDraft(draftText);
      if (!next) break; // 재작성 결과가 깨지면 직전 draft 유지하고 중단
      draft = next;
      verdict = await checkOnce(checkSystem, draft);
    }

    const blocked = verdict.verdict !== 'pass';
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
    return jsonResponse(request, { error: '원고 생성 중 오류가 발생했습니다.' }, { status: 500 });
  }
}

/** 원고를 규제 검수. 제목+본문+태그 대상. parseError면 1회 재검수(clean 원고 오차단 완화). */
async function checkOnce(checkSystem, draft) {
  const target = [draft.title, draft.body, (draft.tags || []).join(' ')].filter(Boolean).join('\n\n');
  const msg = { role: 'user', content: `아래 원고를 검수해라.\n\n${target}` };
  let verdict = parseVerdict(
    await callClaude({ system: checkSystem, messages: [msg], model: CHECK_MODEL, maxTokens: 1500, temperature: 0 })
  );
  if (verdict.parseError) {
    verdict = parseVerdict(
      await callClaude({ system: checkSystem, messages: [msg], model: CHECK_MODEL, maxTokens: 1500, temperature: 0 })
    );
  }
  return verdict;
}
