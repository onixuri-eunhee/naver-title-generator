// lib/cardnews/placeholder.js
//
// Chromium 렌더 전 HTML 후처리 헬퍼 2종:
// 1. resolveImagePlaceholders — {{img:N}} → 실 CDN URL
// 2. validateCardCount — Claude가 요청한 슬라이드 수를 정확히 만들었는지 검증

// 1×1 투명 PNG (fallback — N이 범위 벗어날 때)
export const TRANSPARENT_PLACEHOLDER_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

/**
 * {{img:N}} placeholder 를 실제 URL로 치환.
 * N이 imageUrls 배열 범위를 벗어나면 transparent 1×1 data URL로 대체 (렌더 실패 방지).
 *
 * @param {string} html
 * @param {string[]} imageUrls
 * @returns {string}
 */
export function resolveImagePlaceholders(html, imageUrls) {
  const urls = Array.isArray(imageUrls) ? imageUrls : [];
  return String(html ?? '').replace(/\{\{img:(\d+)\}\}/g, (_match, idx) => {
    const n = Number(idx);
    const url = urls[n];
    return typeof url === 'string' && url ? url : TRANSPARENT_PLACEHOLDER_DATA_URL;
  });
}

/**
 * `.card` 클래스를 가진 요소 개수가 expected와 일치하는지 검증.
 * cheerio 없이 간단한 regex 기반 — sanitize에서 이미 cheerio 한 번 돌렸으므로
 * 이 단계는 빠른 sanity check.
 *
 * @param {string} html
 * @param {number} expected
 * @returns {{ ok: boolean, actual: number, expected: number }}
 */
export function validateCardCount(html, expected) {
  const input = String(html ?? '');
  // class 속성에 'card' 토큰이 포함된 태그 개수
  // matches: class="card ...", class="... card ...", class="card"
  const matches = input.match(/class\s*=\s*["'][^"']*\bcard\b[^"']*["']/gi) || [];
  const actual = matches.length;
  return { ok: actual === expected, actual, expected };
}
