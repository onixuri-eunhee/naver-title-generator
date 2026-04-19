// lib/cardnews/caption-builder.js
//
// Chromium 경로 카드뉴스의 인스타그램 업로드용 캡션을 Haiku로 별도 생성.
// HTML 생성 Claude Sonnet 호출과 응답을 분리해 포맷 복잡도 줄임.
// 실패 시 빈 문자열 반환 — 캡션 누락해도 카드뉴스 생성 자체는 성공 처리.

const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';
const CLAUDE_MODEL = 'claude-haiku-4-5-20251001';
const MAX_TOKENS = 600;
const TIMEOUT_MS = 30_000;
const BLOG_TEXT_MAX = 2000;

/**
 * @param {Object} opts
 * @param {string} opts.blogText
 * @param {number} opts.slideCount
 * @returns {Promise<string>} 인스타 캡션 (실패 시 '')
 */
export async function buildInstagramCaption({ blogText, slideCount }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return '';

  const blog = String(blogText || '').slice(0, BLOG_TEXT_MAX);
  const count = Number(slideCount) || 7;

  const prompt = `다음 블로그 글을 ${count}장 카드뉴스로 제작했습니다. 인스타그램에 카드뉴스를 업로드할 때 같이 쓸 캡션 1개를 작성하세요.

[규칙]
- 길이: 200자 내외 (최대 2200자)
- 첫 줄: 카드뉴스 훅과 연결되는 한 문장 (인스타는 "더보기" 누르기 전 첫 125자만 노출)
- 본문: 카드뉴스 핵심 가치 1~2문장
- CTA: "저장해두세요" 같은 인스타 관습 표현 (본문 링크 클릭 불가)
- 해시태그: 본문 아래 별도 줄에 5~10개 몰아 넣기
- 이모지 금지. 한국어 자연스럽게. 일반론("~이 중요합니다") 금지.

[블로그 글]
${blog}

순수 캡션 텍스트로만 답하세요. 설명, 따옴표, 마크다운 금지.`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

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
        temperature: 0.6,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: controller.signal,
    });

    if (!res.ok) return '';

    const data = await res.json();
    const text = data?.content?.[0]?.text;
    if (typeof text !== 'string') return '';

    // 따옴표 감싸기 제거 (Haiku가 종종 "..." 으로 감쌈)
    let cleaned = text.trim();
    if (
      (cleaned.startsWith('"') && cleaned.endsWith('"')) ||
      (cleaned.startsWith("'") && cleaned.endsWith("'"))
    ) {
      cleaned = cleaned.slice(1, -1).trim();
    }
    return cleaned.slice(0, 2200);
  } catch {
    return '';
  } finally {
    clearTimeout(timer);
  }
}
