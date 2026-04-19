// lib/cardnews/sanitize.js
//
// Claude 생성 HTML의 security sanitize.
// Chromium은 JS 비활성 상태로 렌더하지만 추가 방어 레이어:
// <script>, iframe/object/embed, on* 이벤트 속성, javascript: URL 제거.
// stylesheet/img 호스트 화이트리스트.

import * as cheerio from 'cheerio';

const ALLOWED_STYLESHEET_HOSTS = new Set([
  'cdn.jsdelivr.net',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
]);

const ALLOWED_IMG_HOSTS = new Set([
  'cdn.ddukddaktool.co.kr',
]);

const DANGEROUS_TAGS = ['script', 'iframe', 'object', 'embed'];

/**
 * @param {string} rawHtml
 * @returns {{ html: string, issues: string[] }}
 */
export function sanitizeCardNewsHtml(rawHtml) {
  const input = String(rawHtml ?? '');
  const issues = [];

  // cheerio가 빈 문자열·깨진 HTML에도 안전하게 동작
  let $;
  try {
    $ = cheerio.load(input, { decodeEntities: false });
  } catch {
    return { html: '', issues: ['parse_failed'] };
  }

  // 1. 위험 태그 전체 제거
  for (const tag of DANGEROUS_TAGS) {
    $(tag).each((_, el) => {
      issues.push(`tag_removed:${tag}`);
      $(el).remove();
    });
  }

  // 2. meta http-equiv 제거 (refresh 악용 방지)
  $('meta[http-equiv]').each((_, el) => {
    issues.push('meta_http_equiv_removed');
    $(el).remove();
  });

  // 3. <link rel="stylesheet"> 호스트 화이트리스트
  $('link[rel="stylesheet"]').each((_, el) => {
    const href = $(el).attr('href') || '';
    try {
      const url = new URL(href);
      if (!ALLOWED_STYLESHEET_HOSTS.has(url.hostname)) {
        issues.push(`stylesheet_blocked:${url.hostname}`);
        $(el).remove();
      }
    } catch {
      issues.push('stylesheet_invalid_href');
      $(el).remove();
    }
  });

  // 4. on* 이벤트 속성 제거
  $('*').each((_, el) => {
    if (el.type !== 'tag' || !el.attribs) return;
    for (const attr of Object.keys(el.attribs)) {
      if (attr.toLowerCase().startsWith('on')) {
        $(el).removeAttr(attr);
        issues.push(`on_attr_removed:${attr}`);
      }
    }
  });

  // 5. javascript: URL 제거 (href, src)
  $('[href], [src]').each((_, el) => {
    for (const attr of ['href', 'src']) {
      const val = $(el).attr(attr);
      if (typeof val === 'string' && /^\s*javascript:/i.test(val)) {
        $(el).removeAttr(attr);
        issues.push(`javascript_url_removed:${attr}`);
      }
    }
  });

  // 6. img src 화이트리스트
  $('img').each((_, el) => {
    const src = $(el).attr('src') || '';
    if (!src) return;
    // placeholder 통과
    if (src.startsWith('{{img:')) return;
    // data URL
    if (src.startsWith('data:image/')) return;
    // 그 외는 호스트 체크
    try {
      const url = new URL(src);
      if (!ALLOWED_IMG_HOSTS.has(url.hostname)) {
        issues.push(`img_host_blocked:${url.hostname}`);
        $(el).removeAttr('src');
      }
    } catch {
      issues.push('img_invalid_src');
      $(el).removeAttr('src');
    }
  });

  return { html: $.html(), issues };
}
