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

export async function OPTIONS(request) {
  return handleOptions(request);
}

/** 원고 JSON 파싱(코드펜스·잡담 허용). 실패 시 body만이라도 살림. */
function parseDraft(rawText) {
  const text = String(rawText || '').trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fence ? fence[1].trim() : text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start !== -1 && end > start) {
    try {
      return JSON.parse(candidate.slice(start, end + 1));
    } catch {
      /* fall through */
    }
  }
  return { title: '', body: text, tags: [], intent: '', note: 'JSON 파싱 실패' };
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

    // 1) 원고 생성
    const system = buildPrompt(strategy, slots);
    let draftText = await callClaude({
      system,
      messages: [{ role: 'user', content: `키워드 "${keyword}"로 검색100 원고를 작성해줘.` }],
      model: DRAFT_MODEL,
      maxTokens: 4096,
    });
    let draft = parseDraft(draftText);

    // 2) 규제 검수 + 위반 시 재작성 루프
    const checkSystem = buildCheckSystemPrompt(industry);
    let verdict = await checkOnce(checkSystem, draft);
    let rounds = 0;

    while (verdict.verdict === 'fail' && verdict.violations.length > 0 && rounds < MAX_FIX_ROUNDS) {
      rounds += 1;
      const fix = buildFixInstruction(verdict.violations);
      draftText = await callClaude({
        system,
        messages: [
          { role: 'user', content: `키워드 "${keyword}"로 검색100 원고를 작성해줘.` },
          { role: 'assistant', content: JSON.stringify(draft) },
          { role: 'user', content: fix },
        ],
        model: DRAFT_MODEL,
        maxTokens: 4096,
      });
      draft = parseDraft(draftText);
      verdict = await checkOnce(checkSystem, draft);
    }

    const blocked = verdict.verdict !== 'pass';

    await logUsage(email, 's2-generate-draft', strategy, getClientIp(request));

    return jsonResponse(request, {
      draft,
      regulation: { verdict: verdict.verdict, violations: verdict.violations, rounds, parseError: verdict.parseError || false },
      blocked,
      // blocked=true면 프론트에서 "위반 문구 남음 → 수정 or 책임확인 후 발행"(PRD 07)
      notice: blocked
        ? '규제 위반 소지 문구가 남아 있습니다. 문구를 수정하거나, 책임 확인 후에만 발행하세요.'
        : null,
      meta: { draftModel: DRAFT_MODEL, checkModel: CHECK_MODEL },
    });
  } catch (error) {
    console.error('[s2-generate-draft] error:', error?.message || 'unknown');
    return jsonResponse(request, { error: '원고 생성 중 오류가 발생했습니다.' }, { status: 500 });
  }
}

/** 원고를 규제 검수 1회. 제목+본문+태그를 검수 대상 텍스트로. */
async function checkOnce(checkSystem, draft) {
  const target = [draft.title, draft.body, (draft.tags || []).join(' ')].filter(Boolean).join('\n\n');
  const raw = await callClaude({
    system: checkSystem,
    messages: [{ role: 'user', content: `아래 원고를 검수해라.\n\n${target}` }],
    model: CHECK_MODEL,
    maxTokens: 1500,
    temperature: 0,
  });
  return parseVerdict(raw);
}
