// lib/cardnews/html-builder.js
//
// 카드뉴스 HTML 생성 파이프라인 (Phase D Chromium).
// Claude Sonnet 호출 → sanitize → validateCardCount → placeholder 치환.
// 카드 수 불일치 시 1회 재시도 (사용자 모름).

import { CARDNEWS_SYSTEM_PROMPT } from '../shared-prompts/cardnews-system-prompt.js';
import { sanitizeCardNewsHtml } from './sanitize.js';
import { resolveImagePlaceholders, validateCardCount } from './placeholder.js';
import { buildCardnewsUserMessage } from './prompt-builder.js';

const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';
const CLAUDE_MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 16000;
const TEMPERATURE = 0.75;
const API_TIMEOUT_MS = 90_000; // 90초 (최대 출력 15K 토큰 생성에 충분)

/**
 * Claude Sonnet 호출 1회. 에러는 raw throw (호출자가 재시도 결정).
 */
async function callClaudeForCardnewsHtml({ systemPrompt, userMessage }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY missing');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

  try {
    const res = await fetch(CLAUDE_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: MAX_TOKENS,
        temperature: TEMPERATURE,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`CLAUDE_API_${res.status}: ${errText.slice(0, 200)}`);
    }

    const data = await res.json();
    const content = data?.content?.[0]?.text;
    if (!content || typeof content !== 'string') {
      throw new Error('CLAUDE_EMPTY_HTML: no text content in response');
    }
    return content;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Claude 응답에서 HTML 추출. 마크다운 코드블록 래핑 제거.
 */
function stripMarkdownFences(text) {
  let t = String(text).trim();
  if (t.startsWith('```html')) t = t.slice(7);
  else if (t.startsWith('```')) t = t.slice(3);
  if (t.endsWith('```')) t = t.slice(0, -3);
  return t.trim();
}

/**
 * 카드뉴스 HTML 생성 엔드-투-엔드 파이프라인.
 *
 * @param {Object} opts
 * @param {Object|null} opts.brandKit
 * @param {Array} opts.images — [{ ratio, source, tag }]
 * @param {string[]} opts.imageUrls — placeholder 치환용 (images와 순서 일치)
 * @param {string} opts.blogText
 * @param {number} opts.slideCount
 * @returns {Promise<{ html: string, issues: string[], attempts: number }>}
 */
export async function buildCardnewsHtml({
  brandKit,
  images,
  imageUrls,
  blogText,
  slideCount,
}) {
  const userMessage = buildCardnewsUserMessage({
    brandKit,
    images,
    blogText,
    slideCount,
  });

  let lastError = null;
  const allIssues = [];

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const rawText = await callClaudeForCardnewsHtml({
        systemPrompt: CARDNEWS_SYSTEM_PROMPT,
        userMessage,
      });
      const rawHtml = stripMarkdownFences(rawText);

      if (!rawHtml || rawHtml.length < 100) {
        throw new Error('CLAUDE_EMPTY_HTML: trimmed to <100 chars');
      }

      const { html: sanitized, issues } = sanitizeCardNewsHtml(rawHtml);
      allIssues.push(...issues);

      const validation = validateCardCount(sanitized, slideCount);
      if (!validation.ok) {
        throw new Error(
          `CARD_COUNT_MISMATCH: expected ${validation.expected}, got ${validation.actual}`,
        );
      }

      const finalHtml = resolveImagePlaceholders(sanitized, imageUrls || []);

      return {
        html: finalHtml,
        issues: allIssues,
        attempts: attempt,
      };
    } catch (err) {
      lastError = err;
      if (attempt === 1) {
        console.warn(
          `[cardnews-html-builder] attempt 1 failed (${err?.message?.slice(0, 100)}), retrying...`,
        );
      }
    }
  }

  // 2회 실패
  throw lastError || new Error('CLAUDE_HTML_FAILED: unknown');
}
