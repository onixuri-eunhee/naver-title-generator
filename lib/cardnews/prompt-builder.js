// lib/cardnews/prompt-builder.js
//
// Claude Sonnet에 보낼 카드뉴스 user message 조립.
// system prompt는 lib/shared-prompts/cardnews-system-prompt.js 가 제공.

const BLOG_TEXT_MAX = 8000;

/**
 * @param {Object} opts
 * @param {Object|null} opts.brandKit  — { primary_color, secondary_color, store_name, industry, logo_url, instagram }
 * @param {Array<{ ratio: string, source: string, tag: string }>} opts.images
 * @param {string} opts.blogText
 * @param {number} opts.slideCount
 * @returns {string}
 */
export function buildCardnewsUserMessage({ brandKit, images, blogText, slideCount }) {
  const kit = brandKit || {};
  const imgs = Array.isArray(images) ? images : [];
  const truncatedBlog = String(blogText ?? '').slice(0, BLOG_TEXT_MAX);
  const count = Number(slideCount) || 5;

  // Brand Kit 섹션
  const brandLines = [];
  brandLines.push(`[Brand Kit — :root 변수로 주입]`);
  if (kit.primary_color) brandLines.push(`--brand-accent: ${kit.primary_color};`);
  if (kit.secondary_color) brandLines.push(`--brand-secondary: ${kit.secondary_color};`);
  brandLines.push(`--brand-text: #0a0a0a;`);
  brandLines.push(`--brand-bg: #ffffff;`);
  if (kit.logo_url) brandLines.push(`--brand-logo-url: "${kit.logo_url}";`);
  brandLines.push(`폰트: Pretendard Variable`);
  if (kit.industry) brandLines.push(`업종: ${kit.industry}`);
  if (kit.store_name) brandLines.push(`가게명: ${kit.store_name}`);
  if (kit.instagram) brandLines.push(`SNS: @${String(kit.instagram).replace(/^@/, '')}`);

  // 이미지 목록
  const imgLines = [];
  imgLines.push(`[사용 가능한 이미지]`);
  if (imgs.length === 0) {
    imgLines.push(`(제공된 이미지 없음 — 순수 타이포그래피로 디자인)`);
  } else {
    imgs.forEach((img, i) => {
      const ratio = img?.ratio || 'unknown';
      const source = img?.source || 'user_upload';
      const tag = img?.tag || '(태그 없음)';
      imgLines.push(`- img:${i} (ratio: ${ratio}, source: ${source}, tag: "${tag}")`);
    });
    imgLines.push(`이미지 비율이 카드(4x5)와 다르면 object-fit: cover로 처리.`);
    imgLines.push(`이미지 불필요하면 사용 안 해도 됩니다.`);
  }

  // 블로그 글
  const blogSection = [`[블로그 글]`, truncatedBlog];

  // 요청
  const requestLines = [
    `[요청]`,
    `총 ${count}장 카드뉴스 HTML 생성:`,
    `- 1번: cover (강한 훅)`,
    `- 2 ~ ${count - 1}번: content (본문 포인트)`,
    `- ${count}번: CTA (팔로우/저장)`,
    ``,
    `SEDA 원칙으로 카드별 핵심 추출. 카드 ${count}장 모두 시각적으로 다르게 디자인하세요 (동일 배경·레이아웃 반복 금지).`,
  ];

  return [
    brandLines.join('\n'),
    '',
    imgLines.join('\n'),
    '',
    blogSection.join('\n'),
    '',
    requestLines.join('\n'),
  ].join('\n');
}
