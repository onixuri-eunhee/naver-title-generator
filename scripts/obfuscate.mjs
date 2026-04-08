/**
 * HTML 내 인라인 <script> 블록을 terser로 압축+난독화하는 빌드 스크립트.
 *
 * 사용법:
 *   node scripts/obfuscate.mjs                    # 모든 대상 HTML 처리
 *   node scripts/obfuscate.mjs blog-writer.html   # 특정 파일만
 *
 * - 원본을 .bak 파일로 백업 후 덮어씀
 * - <script src="..."> 외부 스크립트는 건드리지 않음
 * - <script> ... </script> 인라인 블록만 난독화
 * - GA/AdSense 등 짧은 스크립트(10줄 미만)는 건너뜀
 */

import { readFileSync, writeFileSync, copyFileSync } from 'fs';
import { minify } from 'terser';
import { resolve } from 'path';

const ROOT = resolve(import.meta.dirname, '..');

// 난독화 대상 HTML 파일 목록
const TARGET_FILES = [
  'index.html',
  'blog-writer.html',
  'blog-image-pro.html',
  'shortform.html',
  'hook-generator.html',
  'threads.html',
  'threads-writer.html',
  'card-news.html',
  'keyword-finder.html',
  'mypage.html',
  'pricing.html',
  'login.html',
  'signup.html',
  'guide.html',
];

const terserOptions = {
  compress: {
    dead_code: true,
    drop_console: false,  // console.error 유지 (디버깅용)
    passes: 2,
  },
  mangle: {
    toplevel: false,  // 전역 함수명은 HTML onclick 등에서 참조하므로 유지
  },
  output: {
    beautify: false,
    comments: false,
  },
};

// 인라인 <script>...</script> 블록 추출 (src 없고, type="application/ld+json" 아닌 것만)
const SCRIPT_RE = /<script(?![^>]*\bsrc\b)(?![^>]*application\/ld\+json)[^>]*>([\s\S]*?)<\/script>/gi;

async function processFile(filename) {
  const filepath = resolve(ROOT, filename);
  let html;
  try {
    html = readFileSync(filepath, 'utf-8');
  } catch {
    console.error(`  [SKIP] ${filename} — 파일 없음`);
    return;
  }

  let changed = false;
  const replacements = [];

  // 모든 인라인 스크립트 블록을 찾음
  let match;
  SCRIPT_RE.lastIndex = 0;
  while ((match = SCRIPT_RE.exec(html)) !== null) {
    const fullMatch = match[0];
    const code = match[1].trim();

    // 짧은 스크립트(GA, AdSense 초기화 등)는 건너뜀
    const lineCount = code.split('\n').length;
    if (lineCount < 10) continue;

    // 이미 난독화된 것 같으면 건너뜀 (줄바꿈 거의 없는 긴 코드)
    if (lineCount < 3 && code.length > 500) continue;

    try {
      const result = await minify(code, terserOptions);
      if (result.code && result.code !== code) {
        const tagOpen = fullMatch.substring(0, fullMatch.indexOf('>') + 1);
        replacements.push({
          original: fullMatch,
          minified: `${tagOpen}\n${result.code}\n</script>`,
        });
        changed = true;
      }
    } catch (err) {
      console.error(`  [ERR] ${filename}: terser 실패 — ${err.message.slice(0, 80)}`);
    }
  }

  if (!changed) {
    console.log(`  [OK] ${filename} — 변경 없음`);
    return;
  }

  // 백업
  const backupPath = resolve(ROOT, `${filename}.bak`);
  copyFileSync(filepath, backupPath);

  // 치환 적용
  let output = html;
  for (const { original, minified } of replacements) {
    output = output.replace(original, minified);
  }

  writeFileSync(filepath, output, 'utf-8');

  const origSize = Buffer.byteLength(html, 'utf-8');
  const newSize = Buffer.byteLength(output, 'utf-8');
  const saved = Math.round((1 - newSize / origSize) * 100);
  console.log(`  [OK] ${filename} — ${(origSize / 1024).toFixed(0)}KB → ${(newSize / 1024).toFixed(0)}KB (${saved}% 감소)`);
}

async function main() {
  const args = process.argv.slice(2);
  const files = args.length > 0 ? args : TARGET_FILES;

  console.log(`\n난독화 시작 (${files.length}개 파일)...\n`);

  for (const f of files) {
    await processFile(f);
  }

  console.log('\n완료. .bak 파일로 원본 백업됨.\n');
}

main();
