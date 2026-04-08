/**
 * 기존 HTML 파일의 하드코딩된 navbar/footer를 shared-ui.js 인젝션으로 교체하는 스크립트.
 *
 * 사용법:
 *   node scripts/inject-shared-ui.mjs                     # 모든 대상 처리
 *   node scripts/inject-shared-ui.mjs blog-writer.html    # 특정 파일만
 *
 * - 원본을 .bak 파일로 백업 후 덮어씀
 * - 이미 shared-ui.js가 적용된 파일은 건너뜀
 */

import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(import.meta.dirname, '..');

// 페이지별 active 라벨 매핑
const PAGE_ACTIVE_MAP = {
  'index.html': '제목',
  'blog-writer.html': '블로그 글',
  'blog-image-pro.html': '(프)이미지',
  'blog-image.html': '(프)이미지',
  'hook-generator.html': '후킹',
  'threads.html': '스레드',
  'threads-writer.html': '스레드',
  'card-news.html': '카드뉴스',
  'keyword-finder.html': '황금키워드',
  'shortform.html': '숏폼',
  'mypage.html': '',
  'pricing.html': '크레딧 충전',
  'login.html': '',
  'signup.html': '',
  'guide.html': '사용법',
  'about.html': '',
  'contact.html': '',
  'column.html': '칼럼',
  'hooking-psychology.html': '',
  'naver-blog-title-importance.html': '',
  'terms.html': '',
  'privacy.html': '',
  'privacy-meta.html': '',
  'refund-policy.html': '',
  'payment-success.html': '',
  'payment-fail.html': '',
  '404.html': '',
};

// 칼럼 파일 추가
for (let i = 1; i <= 34; i++) {
  const num = String(i).padStart(3, '0');
  PAGE_ACTIVE_MAP[`column-${num}.html`] = '칼럼';
}

// navbar 패턴: <nav class="navbar">...any content...</nav>
const NAV_RE = /<nav\s+class="navbar"[\s\S]*?<\/nav>/i;

// footer 패턴: <footer>...any content...</footer> (but not shared-ui placeholder)
const FOOTER_RE = /<footer>(?!<!-- shared)[\s\S]*?<\/footer>/i;

function processFile(filename) {
  const filepath = resolve(ROOT, filename);
  if (!existsSync(filepath)) {
    console.log(`  [SKIP] ${filename} — 파일 없음`);
    return;
  }

  let html = readFileSync(filepath, 'utf-8');

  // 이미 shared-ui.js가 적용된 파일
  if (html.includes('shared-ui.js')) {
    console.log(`  [SKIP] ${filename} — 이미 적용됨`);
    return;
  }

  const active = PAGE_ACTIVE_MAP[filename];
  if (active === undefined) {
    console.log(`  [SKIP] ${filename} — 매핑 없음`);
    return;
  }

  let changed = false;
  const dataActive = active ? ` data-active="${active}"` : '';

  // Navbar 교체
  if (NAV_RE.test(html)) {
    html = html.replace(NAV_RE,
      `<nav class="navbar"><!-- shared-ui.js가 교체 --></nav>\n<script src="/shared-ui.js"${dataActive}></script>`
    );
    changed = true;
  }

  // Footer 교체
  if (FOOTER_RE.test(html)) {
    html = html.replace(FOOTER_RE,
      '<footer><!-- shared-ui.js가 교체 --></footer>'
    );
    changed = true;
  }

  if (!changed) {
    console.log(`  [OK] ${filename} — navbar/footer 없음`);
    return;
  }

  // 백업
  copyFileSync(filepath, filepath + '.bak');
  writeFileSync(filepath, html, 'utf-8');
  console.log(`  [OK] ${filename} — 교체 완료`);
}

// 메인
const args = process.argv.slice(2);
const files = args.length > 0 ? args : Object.keys(PAGE_ACTIVE_MAP);

console.log(`\nshared-ui.js 인젝션 (${files.length}개 파일)...\n`);
for (const f of files) {
  processFile(f);
}
console.log('\n완료. .bak 파일로 원본 백업됨.\n');
