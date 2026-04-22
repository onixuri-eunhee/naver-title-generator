#!/usr/bin/env node
// raw.json → 사람 승인용 Markdown 요약 생성.
//
// 사용:
//   node scripts/review-corpus.mjs business
//
// 출력:
//   data/viral-corpus/v2026-Q2/{category}.review.md   (사람이 눈으로 훑어 승인 판정)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const CORPUS_VERSION = 'v2026-Q2';

function formatRatio(r) {
  if (r >= 100) return `${r.toFixed(0)}x`;
  if (r >= 10) return `${r.toFixed(1)}x`;
  return `${r.toFixed(2)}x`;
}

function formatNumber(n) {
  if (n >= 10000) return `${(n / 10000).toFixed(1)}만`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return n.toString();
}

const category = process.argv[2];
if (!category) {
  console.error('사용: node scripts/review-corpus.mjs <category>');
  process.exit(1);
}

const rawPath = path.join(PROJECT_ROOT, 'data', 'viral-corpus', CORPUS_VERSION, `${category}.raw.json`);
if (!fs.existsSync(rawPath)) {
  console.error(`raw 파일 없음: ${rawPath}`);
  process.exit(1);
}

const raw = JSON.parse(fs.readFileSync(rawPath, 'utf-8'));
const candidates = raw.candidates || [];

const lines = [];
lines.push(`# ${category} 바이럴 후보 리뷰 — ${CORPUS_VERSION}`);
lines.push('');
lines.push(`- 수집 시각: ${raw.meta?.collectedAt || '?'}`);
lines.push(`- 시드: ${raw.meta?.seedCount || '?'}개`);
lines.push(`- 원본 후보: ${raw.meta?.rawCandidateCount || '?'}건 → 상위 ${candidates.length}건 저장`);
lines.push(`- 목표 승인: 20건`);
lines.push('');
lines.push('## 승인 방법');
lines.push('');
lines.push(`1. 각 URL 클릭 → YouTube 에서 실제 영상 확인`);
lines.push(`2. \`data/viral-corpus/${CORPUS_VERSION}/${category}.raw.json\` 열어서`);
lines.push(`   - 승인: \`"approved": true\``);
lines.push(`   - 거절: \`"approved": false\` (+ 필요시 \`reviewNotes\`)`);
lines.push(`3. 20건 승인 후 Gemini 분석 스크립트 실행`);
lines.push('');
lines.push('## 승인 기준 (3원칙 기반)');
lines.push('');
lines.push('- [ ] **business 카테고리 실제 관련** — 게임·엔터테인먼트·일반 라이프 제외');
lines.push('- [ ] **Identity Mirror 작동** — 시청자(자영업자/사장) 상황에 즉시 꽂히는 첫 문장');
lines.push('- [ ] **단정·도발 톤** — "~때문입니다" 교과서 어미 아닌, 현장 증언체');
lines.push('- [ ] **Polarity 선 긋기** — 중립/애매한 "~일 수 있어요" 류 피함');
lines.push('');
lines.push('## 후보 목록');
lines.push('');

for (let i = 0; i < candidates.length; i += 1) {
  const c = candidates[i];
  const num = String(i + 1).padStart(2, '0');
  lines.push(`### ${num}. ${c.title || '(제목 없음)'}`);
  lines.push('');
  lines.push(`- **URL**: ${c.url}`);
  lines.push(`- **채널**: ${c.channelName} (구독자 ${formatNumber(c.subs)})`);
  lines.push(`- **조회수**: ${formatNumber(c.views)} · **비율**: ${formatRatio(c.ratio)} · **길이**: ${c.durationSec}s`);
  lines.push(`- **seed**: \`${c.sourceSeed}\` · **발행**: ${c.publishedAt?.slice(0, 10) || '?'}`);
  lines.push(`- **승인 상태**: ${c.approved === null ? '⬜ 미결' : (c.approved ? '✅ 승인' : '❌ 거절')}`);
  if (c.reviewNotes) lines.push(`- **메모**: ${c.reviewNotes}`);
  lines.push('');
}

const outPath = path.join(PROJECT_ROOT, 'data', 'viral-corpus', CORPUS_VERSION, `${category}.review.md`);
fs.writeFileSync(outPath, lines.join('\n'), 'utf-8');

console.log(`✅ 리뷰용 MD 생성: ${outPath}`);
console.log(`   ${candidates.length}건 훑어서 raw.json 에 approved 마킹`);
