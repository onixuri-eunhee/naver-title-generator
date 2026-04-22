import {
  buildSystemPrompt as buildSystemPromptABis,
  buildUserPrompt as buildUserPromptABis,
  buildSystemPromptSlim,
} from '@/lib/shortform/prompt.js';
import { validateScriptQuality } from '@/lib/shortform/prompt-validator.js';
import { safeParseJson } from '@/lib/shortform/parse-claude-json.js';
import { getReasoningExamples } from '@/lib/shortform/reasoning-copy.js';
import { buildScriptPayload } from '@/lib/shortform/script-payload.js';

const MODEL = 'claude-opus-4-6';
const HAIKU_MODEL = 'claude-haiku-4-5-20251001';
const MAX_RETRIES = 2;
const BASE_DELAY_MS = 1000;
const JITTER_MAX_MS = 300;
// 개별 Claude 호출 하드 타임아웃. 워커 soft timeout(270s) 보다 짧아야 한다.
const CLAUDE_CALL_TIMEOUT_MS = 90 * 1000;

const VALID_CATEGORIES = ['wedding', 'food', 'realestate', 'ai_education', 'beauty', 'fitness', 'lifestyle', 'business', 'other'];
const VALID_SCRIPT_TYPES = ['question', 'list', 'story'];

function extractClaudeText(data) {
  return (data?.content || [])
    .filter((block) => block?.type === 'text' && block?.text)
    .map((block) => block.text)
    .join('\n')
    .trim();
}

function extractJsonObject(rawText) {
  const trimmed = rawText.trim();

  try {
    return JSON.parse(trimmed);
  } catch (_) {}

  const fenced = trimmed.match(/```json\s*([\s\S]*?)```/i) || trimmed.match(/```\s*([\s\S]*?)```/);
  if (fenced?.[1]) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch (_) {}
  }

  const start = trimmed.indexOf('{');
  if (start === -1) {
    throw new Error('Claude 응답에서 JSON 객체를 찾을 수 없습니다.');
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < trimmed.length; i += 1) {
    const char = trimmed[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === '{') depth += 1;
    if (char === '}') depth -= 1;
    if (depth === 0) {
      return JSON.parse(trimmed.slice(start, i + 1));
    }
  }

  throw new Error('Claude 응답 JSON 파싱에 실패했습니다.');
}

function simpleHash(str) {
  let h = 0;
  if (!str) return 0;
  for (let i = 0; i < str.length; i += 1) {
    h = ((h << 5) - h) + str.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

function resolveSlimPromptFlag(email) {
  const raw = process.env.SHORTFORM_SLIM_PROMPT_ROLLOUT ?? '0';
  const rollout = Number.parseInt(raw, 10);
  if (!Number.isFinite(rollout) || rollout <= 0) return false;
  if (rollout >= 100) return true;
  return (simpleHash(email || 'anon') % 100) < rollout;
}

export async function inferCategory(topic) {
  if (!process.env.ANTHROPIC_API_KEY || !topic) return 'other';
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: HAIKU_MODEL,
        max_tokens: 50,
        temperature: 0,
        messages: [{
          role: 'user',
          content: `주제: "${topic}"\n\n위 주제의 카테고리를 아래 9종 중 정확히 하나만 답하세요. 모르면 가장 가까운 것을 고르세요.\n${VALID_CATEGORIES.join(' / ')}\n\n답(한 단어만):`,
        }],
      }),
      signal: AbortSignal.timeout(15000),
    });
    const data = await res.json();
    const text = extractClaudeText(data).trim().toLowerCase();
    const match = VALID_CATEGORIES.find((category) => text.includes(category));
    return match || 'other';
  } catch (error) {
    console.warn('[shortform-script] inferCategory failed, fallback=other:', error?.message);
    return 'other';
  }
}

async function classifyScriptType(topic) {
  if (!process.env.ANTHROPIC_API_KEY || !topic) return 'question';
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: HAIKU_MODEL,
        max_tokens: 50,
        temperature: 0,
        messages: [{
          role: 'user',
          content: `주제: "${topic}"\n\n위 주제에 가장 어울리는 숏폼 스크립트 유형을 하나만 답하세요.\n- question: 질문으로 시작, 질문으로 끝나는 순환형\n- list: 핵심 포인트 나열 후 요약\n- story: 스토리텔링 흐름\n\n답(한 단어만):`,
        }],
      }),
      signal: AbortSignal.timeout(15000),
    });
    const data = await res.json();
    const text = extractClaudeText(data).trim().toLowerCase();
    const match = VALID_SCRIPT_TYPES.find((scriptType) => text.includes(scriptType));
    return match || 'question';
  } catch (error) {
    console.warn('[shortform-script] classifyScriptType failed, fallback=question:', error?.message);
    return 'question';
  }
}

export async function generateClaudeScript({
  topic,
  blogText,
  tone,
  targetDurationSec,
  concept,
  targetSceneCount,
  personaMemo,
  settings,
  layoutMode,
  email,
  benchmark,
  preResolvedCategory,  // script-legacy 에서 코퍼스 lookup 용으로 먼저 결정된 카테고리
}) {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is not configured.');
  }

  let category = preResolvedCategory || settings.category;
  let scriptType = settings.scriptType;
  if (category === 'auto') {
    category = await inferCategory(topic || (blogText || '').slice(0, 100));
    console.log(`[SHORTFORM-SCRIPT] inferCategory -> ${category}`);
  }
  if (scriptType === 'auto') {
    scriptType = await classifyScriptType(topic || (blogText || '').slice(0, 100));
    console.log(`[SHORTFORM-SCRIPT] classifyScriptType -> ${scriptType}`);
  }

  const reasoningExamples = getReasoningExamples(category);
  const useSlimPrompt = resolveSlimPromptFlag(email);

  const runOnce = async (retryAttempt) => {
    const systemPrompt = useSlimPrompt
      ? buildSystemPromptSlim({ targetSceneCount })
      : buildSystemPromptABis({
          category,
          scriptType,
          firstThreeSeconds: settings.firstThreeSeconds || 'auto',
          reasoningExamples,
          contentType: 'short',
          visualStyle: layoutMode === 'kinetic' ? 'kinetic' : (concept?.visualStyle || 'image'),
          retryAttempt,
        });

    const userPrompt = buildUserPromptABis({
      topic,
      tone,
      targetSceneCount,
      targetDurationSec,
      blogText,
      personaMemo,
      benchmark,
    });

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 4000,
        temperature: 0.7,
        system: [
          { type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } },
        ],
        messages: [{ role: 'user', content: userPrompt }],
      }),
      signal: AbortSignal.timeout(CLAUDE_CALL_TIMEOUT_MS),
    });

    const data = await response.json();
    if (!response.ok) {
      const error = new Error(`Claude HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }

    const rawText = extractClaudeText(data);
    const parsed = safeParseJson(rawText);
    if (!parsed || !Array.isArray(parsed.scenes)) {
      try {
        return extractJsonObject(rawText);
      } catch (_) {}
      const error = new Error('claude_json_parse_failed');
      error.code = 'claude_json_parse_failed';
      throw error;
    }
    return parsed;
  };

  let lastErr;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      const parsed = await runOnce(attempt);
      const validation = validateScriptQuality(parsed);
      const emailPrefix = (email || 'anon').slice(0, 3) + '***';
      console.log(
        '[SHORTFORM-METRICS]',
        JSON.stringify({
          mode: useSlimPrompt ? 'slim' : 'full',
          attempt,
          ok: validation.ok,
          errors: validation.errors,
          warnings: validation.warnings,
          stats: validation.stats,
          emailPrefix,
          timestamp: new Date().toISOString(),
        }),
      );

      const captionErrors = (validation.errors || []).filter((error) =>
        error.startsWith('caption_'),
      );
      const shouldRetry =
        attempt < MAX_RETRIES &&
        ((useSlimPrompt && !validation.ok) || captionErrors.length > 0);
      if (shouldRetry) {
        const error = new Error(`validation_failed:${validation.errors.join(',')}`);
        error.code = 'slim_validation_failed';
        throw error;
      }

      const payload = buildScriptPayload(parsed, concept, targetSceneCount);
      payload._resolvedCategory = category;
      payload._resolvedScriptType = scriptType;
      return payload;
    } catch (error) {
      lastErr = error;
      const retriable =
        error?.code === 'claude_json_parse_failed' ||
        error?.code === 'slim_validation_failed' ||
        (typeof error?.status === 'number' && (error.status >= 500 || error.status === 429)) ||
        error?.name === 'TimeoutError' ||
        error?.name === 'AbortError' ||
        /ECONNRESET|ETIMEDOUT|fetch failed|aborted|timeout/i.test(error?.message || '');
      if (!retriable || attempt === MAX_RETRIES) throw error;
      const delay = BASE_DELAY_MS * (2 ** attempt) + Math.random() * JITTER_MAX_MS;
      console.warn(
        `[shortform-script] retry attempt=${attempt + 1} delay=${Math.round(delay)}ms: ${error?.message}`,
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastErr;
}
