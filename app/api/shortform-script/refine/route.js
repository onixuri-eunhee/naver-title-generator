/**
 * POST /api/shortform-script/refine — 칩 기반 부분 재생성.
 *
 * Phase A-bis Worker #3. Spec §4.6 / §5.2 / §5.4 / §6.
 *
 * 처리:
 *   1. 인증
 *   2. X-Request-Id 헤더 추출 (없으면 서버 생성)
 *   3. validateSettings(settings) — 실패 시 422 (환불 없음)
 *   4. field inline 여부 체크 (ctaTone/voiceSpeed는 422)
 *   5. getChipCost(field) — 0.2 / 0.3 / 0.5
 *   6. chargeCredit (idempotent)
 *   7. buildSystemPrompt + Claude 호출 (partial re-gen)
 *   8. safeParseJson + retry (JSON 파싱 실패 1회만 strict 블록 주입)
 *   9. 5xx catch → refundCredit → 502 + renderErrorMessage
 *  10. 200 응답: { updatedScript, costCharged, updatedSections, reasoning, balance, requestId }
 *
 * 정책 (spec §6):
 *   - 4xx는 환불 없음
 *   - 5xx는 자동 환불 + refundReason 로깅
 *   - MAX_RETRIES = 2, exponential 1s/2s + jitter 300ms
 */

import crypto from 'node:crypto';
import {
  resolveAdmin,
  extractToken,
  resolveSessionEmail,
  jsonResponse,
  handleOptions,
} from '@/lib/api-helpers';
import {
  validateSettings,
  getChipCost,
  getRefineRoute,
  migrateSettings,
  CHIP_SCHEMA,
} from '@/lib/shortform/settings.js';
import { buildSystemPrompt, buildUserPrompt } from '@/lib/shortform/prompt.js';
import { safeParseJson } from '@/lib/shortform/parse-claude-json.js';
import { renderErrorMessage } from '@/lib/shortform/error-messages.js';
import { getReasoningExamples } from '@/lib/shortform/reasoning-copy.js';
import { chargeCredit, refundCredit } from '@/lib/credit-service.js';

export const maxDuration = 60;

const MODEL = 'claude-sonnet-4-6';
const MAX_RETRIES = 2;
const BASE_DELAY_MS = 1000;
const JITTER_MAX_MS = 300;

// inline 필드 — refine 라우트로 들어오면 422 (클라이언트 버그 방지)
const INLINE_FIELDS = new Set(['ctaTone', 'voiceSpeed']);

// refine 가능 필드
const REFINABLE_FIELDS = new Set(['category', 'scriptType', 'firstThreeSeconds']);

export async function OPTIONS(request) {
  return handleOptions(request);
}

export async function POST(request) {
  // 1. 인증
  const isAdmin = await resolveAdmin(request);
  const email = await resolveSessionEmail(extractToken(request));
  if (!isAdmin && !email) {
    return jsonResponse(request, { error: '로그인이 필요합니다.' }, { status: 401 });
  }
  const userId = email || 'admin';

  // 2. 요청 ID — X-Request-Id 헤더 또는 서버 생성
  const requestId =
    request.headers.get('x-request-id') ||
    request.headers.get('X-Request-Id') ||
    crypto.randomUUID();

  // 3. 바디 파싱
  const body = await request.json().catch(() => ({}));
  const {
    originalScript,
    originalInputs,
    field,
    newValue,
    settings: rawSettings,
  } = body || {};

  if (!originalScript || typeof originalScript !== 'object') {
    return jsonResponse(
      request,
      { error: 'invalid_input', details: 'originalScript가 필요합니다.' },
      { status: 400 },
    );
  }

  // 4. field 검증 — inline은 422 (환불 없음)
  if (!field || typeof field !== 'string') {
    return jsonResponse(
      request,
      { error: 'invalid_input', details: 'field가 필요합니다.' },
      { status: 400 },
    );
  }
  if (INLINE_FIELDS.has(field)) {
    return jsonResponse(
      request,
      {
        error: 'inline_field_not_allowed',
        details: `${field}는 클라이언트 로컬 상태만으로 반영하세요 (API 호출 불필요).`,
      },
      { status: 422 },
    );
  }
  if (!REFINABLE_FIELDS.has(field)) {
    return jsonResponse(
      request,
      { error: 'unsupported_field', details: `field '${field}'는 지원되지 않습니다.` },
      { status: 422 },
    );
  }

  // 5. newValue 검증 — CHIP_SCHEMA option id 와 일치해야 함
  const chip = CHIP_SCHEMA[field];
  const validValue =
    chip?.options?.some((o) => o.id === newValue) ?? false;
  if (!validValue) {
    return jsonResponse(
      request,
      {
        error: 'invalid_new_value',
        details: `field=${field}의 newValue '${newValue}'는 허용된 옵션이 아닙니다.`,
      },
      { status: 422 },
    );
  }

  // 6. settings 검증 (migrate 후 validate)
  const settings = migrateSettings(rawSettings);
  const { ok: settingsOk, errors: settingsErrors } = validateSettings(settings);
  if (!settingsOk) {
    return jsonResponse(
      request,
      { error: 'invalid_settings', details: settingsErrors },
      { status: 422 },
    );
  }

  // 7. refine 라우트 일치 여부 (category→category-refine 등)
  const expectedRoute = getRefineRoute(field);
  if (!expectedRoute) {
    return jsonResponse(
      request,
      { error: 'not_a_refine_field', details: `field '${field}'는 refine 대상이 아닙니다.` },
      { status: 422 },
    );
  }

  // 8. 비용 산출
  const cost = getChipCost(field);
  if (cost <= 0) {
    // refine 라우트가 있지만 비용 0인 케이스는 없어야 함 — 안전망
    return jsonResponse(
      request,
      { error: 'zero_cost_refine', details: 'refine 라우트지만 비용이 0입니다.' },
      { status: 422 },
    );
  }

  // 9. 차감 (idempotent)
  let chargeResult;
  try {
    chargeResult = await chargeCredit({
      userId,
      requestId,
      amount: cost,
      phase: `refine:${field}`,
    });
  } catch (err) {
    if (err?.code === 'insufficient_credits') {
      return jsonResponse(
        request,
        {
          error: 'insufficient_credits',
          details: `크레딧이 부족해요. 현재 잔액: ${err.balance ?? 0}`,
          balance: err.balance ?? 0,
        },
        { status: 402 },
      );
    }
    console.error('[refine] chargeCredit failed:', err?.message);
    return jsonResponse(
      request,
      { error: 'charge_failed', details: err?.message || 'unknown' },
      { status: 500 },
    );
  }

  // 10. 본 작업 — Claude 호출로 partial re-gen
  try {
    const updatedSettings = { ...settings, [field]: newValue };
    const updated = await refineScriptWithClaude({
      field,
      newValue,
      originalScript,
      originalInputs: originalInputs || {},
      settings: updatedSettings,
    });

    return jsonResponse(request, {
      updatedScript: updated.script,
      updatedSections: updated.updatedSections,
      reasoning: updated.reasoning,
      costCharged: chargeResult.deduplicated ? 0 : chargeResult.charged,
      balance: chargeResult.balance,
      requestId,
      settings: updatedSettings,
    });
  } catch (err) {
    const cls = classifyError(err);
    console.error(`[refine] ${cls.code}:`, err?.message);

    if (cls.shouldRefund) {
      // 5xx — 자동 환불
      try {
        const refund = await refundCredit({
          userId,
          requestId: `${requestId}:refund`, // 차감과 환불은 다른 PK (같은 요청 내 양방향)
          amount: cost,
          refundReason: cls.code,
          phase: `refine:${field}`,
        });
        return jsonResponse(
          request,
          {
            error: 'refine_failed',
            errCode: cls.code,
            refunded: refund.refunded,
            balance: refund.balance,
            retryable: cls.retryable,
            message: renderErrorMessage('refine_failed', {
              refunded: refund.refunded,
              balance: refund.balance,
            }),
            requestId,
          },
          { status: 502 },
        );
      } catch (refundErr) {
        console.error('[refine] refundCredit failed:', refundErr?.message);
        return jsonResponse(
          request,
          {
            error: 'refine_failed',
            errCode: cls.code,
            refunded: 0,
            retryable: false,
            message: renderErrorMessage('refine_failed', { refunded: 0, balance: 0 }),
            details: '환불 처리 중에도 문제가 생겼습니다. 고객지원으로 문의해 주세요.',
            requestId,
          },
          { status: 502 },
        );
      }
    }

    // 4xx — 환불 없음
    return jsonResponse(
      request,
      {
        error: 'refine_failed',
        errCode: cls.code,
        message: renderErrorMessage('claude_4xx', {}),
        retryable: false,
        requestId,
      },
      { status: 422 },
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal: Claude 호출 + retry + safeParseJson
// ─────────────────────────────────────────────────────────────────────────────

async function refineScriptWithClaude({ field, newValue, originalScript, originalInputs, settings }) {
  const reasoningExamples = getReasoningExamples(settings.category);

  const runOnce = async (retryAttempt) => {
    const systemPrompt = buildSystemPrompt({
      category: settings.category,
      scriptType: settings.scriptType,
      firstThreeSeconds: settings.firstThreeSeconds,
      reasoningExamples,
      contentType: originalInputs.contentType === 'long' ? 'long' : 'short',
      retryAttempt,
    });

    const basePrompt = buildUserPrompt({
      topic: originalInputs.topic || '',
      tone: originalInputs.tone || 'casual',
      targetSceneCount: originalScript.scenes?.length || 7,
      targetDurationSec: originalInputs.targetDurationSec,
      blogText: originalInputs.blogText,
      personaMemo: originalInputs.personaMemo,
      benchmark: originalInputs.benchmark || null,
    });

    const refineInstruction = buildRefineInstruction({ field, newValue, originalScript });
    const userPrompt = `${basePrompt}\n\n${refineInstruction}`;

    const raw = await callClaude({ systemPrompt, userPrompt });
    const parsed = safeParseJson(extractClaudeText(raw));
    if (!parsed || !Array.isArray(parsed.scenes)) {
      const e = new Error('claude_json_parse_failed');
      e.code = 'claude_json_parse_failed';
      throw e;
    }
    return parsed;
  };

  // withRetry — JSON 파싱 실패 시 retryAttempt 증가, 5xx는 exponential backoff
  let lastErr;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const parsed = await runOnce(attempt);
      return {
        script: {
          ...originalScript,
          scenes: parsed.scenes,
          metadata: parsed.metadata || originalScript.metadata,
        },
        updatedSections: computeUpdatedSections({ field, originalScript, newScenes: parsed.scenes }),
        reasoning: parsed.metadata?.reasoning || reasoningExamples.copies?.[0] || '',
      };
    } catch (err) {
      lastErr = err;
      const cls = classifyError(err);
      if (!cls.retryable || attempt === MAX_RETRIES) throw err;
      const delay = BASE_DELAY_MS * Math.pow(2, attempt) + Math.random() * JITTER_MAX_MS;
      console.warn(`[refine] retry attempt=${attempt + 1} cls=${cls.code} delay=${Math.round(delay)}ms`);
      await sleep(delay);
    }
  }
  throw lastErr;
}

/**
 * field별 Claude 지시문. 원본 scenes를 주고 최소 변경만 요구.
 */
function buildRefineInstruction({ field, newValue, originalScript }) {
  const serializedScenes = JSON.stringify(
    (originalScript.scenes || []).map((s) => ({
      script: s.script,
      section: s.section,
      visual: s.visual,
      hookText: s.hookText,
      hookType: s.hookType,
    })),
    null,
    2,
  );

  const fieldHints = {
    firstThreeSeconds: [
      `[부분 재생성] field=firstThreeSeconds → ${newValue}`,
      '- scenes[0]만 재생성하세요. scenes[1..n-1]은 원본 유지.',
      '- 새 첫 씬은 위 [첫 3초] 섹션 규칙(글자수/스타일)을 따르세요.',
      '- scenes[0].hookText / hookType / reasoning도 갱신.',
    ].join('\n'),
    category: [
      `[부분 재생성] field=category → ${newValue}`,
      '- 본문(scenes[1..n-2])은 그대로 유지.',
      '- scenes[0]의 hookText·hookType·reasoning은 새 카테고리에 맞게 재조정.',
      '- 마지막 씬(CTA) visual/톤은 새 카테고리에 맞게 재조정 가능.',
    ].join('\n'),
    scriptType: [
      `[부분 재생성] field=scriptType → ${newValue}`,
      '- scenes[0..n-2]는 원본 유지.',
      '- 마지막 씬(scenes[n-1])만 새 scriptType의 루프 훅 규칙대로 재생성:',
      '  - question: scenes[0] 질문 재사용',
      '  - list: 본문 키워드 3개 flash 요약 + "처음부터 다시 보실까요?"',
      '  - story: 루프 훅 없이 자연스러운 마무리',
    ].join('\n'),
  };

  const instr = fieldHints[field] || `[부분 재생성] field=${field} → ${newValue}`;

  return `${instr}

[원본 scenes]
${serializedScenes}

위 원본을 base로, 변경 지시만 반영하고 나머지는 그대로 두세요. 출력은 전체 scenes 배열의 JSON입니다.`;
}

/**
 * field별로 "어떤 섹션이 바뀌었을까"를 힌트로 반환 (UI 부분 하이라이트용).
 * 실제 diff는 클라이언트가 계산하지만, 서버가 의도를 함께 내려주면 UX가 정확.
 */
function computeUpdatedSections({ field, originalScript, newScenes }) {
  const originalScenes = originalScript.scenes || [];
  const lastIdx = Math.max(newScenes.length - 1, 0);
  if (field === 'firstThreeSeconds') return [0];
  if (field === 'scriptType') return [lastIdx];
  if (field === 'category') {
    // hookType/CTA 톤 재조정 가능 → 0 + 마지막 씬
    return Array.from(new Set([0, lastIdx])).filter((i) => i < newScenes.length);
  }
  // 폴백: 길이 달라진 인덱스만
  const diffs = [];
  for (let i = 0; i < Math.max(originalScenes.length, newScenes.length); i++) {
    if ((originalScenes[i]?.script || '') !== (newScenes[i]?.script || '')) diffs.push(i);
  }
  return diffs;
}

async function callClaude({ systemPrompt, userPrompt }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    const e = new Error('ANTHROPIC_API_KEY is not configured');
    e.code = 'config_missing';
    throw e;
  }

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 4000,
      temperature: 0.6,
      system: [
        { type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } },
      ],
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error(`Claude HTTP ${res.status}`);
    e.status = res.status;
    e.body = data;
    throw e;
  }
  return data;
}

function extractClaudeText(data) {
  return (data?.content || [])
    .filter((b) => b?.type === 'text' && b?.text)
    .map((b) => b.text)
    .join('\n')
    .trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// Error classification — 5xx/retryable 판정
// 간단한 로컬 헬퍼. 추후 lib/shortform/error-classifier.js로 추출 가능.
// ─────────────────────────────────────────────────────────────────────────────
function classifyError(err) {
  const status = err?.status;
  const msg = err?.message || '';

  if (err?.code === 'claude_json_parse_failed') {
    return { code: 'claude_json_parse_failed', retryable: true, shouldRefund: false };
  }
  if (typeof status === 'number') {
    if (status >= 500) return { code: 'claude_5xx', retryable: true, shouldRefund: true };
    if (status === 429) return { code: 'claude_5xx', retryable: true, shouldRefund: true };
    if (status >= 400) return { code: 'claude_4xx', retryable: false, shouldRefund: false };
  }
  if (/ECONNRESET|ETIMEDOUT|network|fetch failed/i.test(msg)) {
    return { code: 'timeout', retryable: true, shouldRefund: true };
  }
  return { code: 'unknown', retryable: false, shouldRefund: true };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
