#!/usr/bin/env node
// 바이럴 숏폼 URL 채집 — 카테고리별 시드 키워드로 기존
// /api/shortform-benchmark 엔드포인트를 self-call 하여 후보 영상을 모은다.
//
// 실행 전제:
//   - dev server 가 떠 있어야 함 (localhost:3001 또는 env BENCHMARK_BASE_URL)
//   - INTERNAL_API_SECRET (또는 CRON_SECRET) 설정돼 있어야 함
//
// 사용:
//   node scripts/collect-viral-urls.mjs business
//
// 출력:
//   data/viral-corpus/v2026-Q2/{category}.raw.json

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

// ─ 설정 ────────────────────────────────────────────────────────────────
const CORPUS_VERSION = 'v2026-Q2';
const BASE_URL = process.env.BENCHMARK_BASE_URL || 'http://localhost:3001';

// 서버(`/api/shortform-benchmark`)가 이미 top-5 로 clipped 반환하고 기본
// MIN_VIEW_TO_SUB_RATIO=5 를 적용한다. 여기서 추가 필터는 최소한만 — 숏폼 길이와
// 시청수 floor 만. 관련성·품질은 사용자 승인 단계에서 걸러진다.
const FILTERS = {
  maxDurationSec: 90,      // 숏폼 기준만 강제
  minDurationSec: 5,       // 1~4초 metadata 오류 배제
  minViewCount: 5000,      // 절대 최저. 5천 미만은 바이럴 경쟁에서 의미 없음
};

const TOP_N = 60; // raw 에 남길 상위 N건 (사용자가 이 중 20건 승인)

// ─ 카테고리별 시드 키워드 ────────────────────────────────────────────
const SEEDS = {
  business: [
    // 1차 (4/22 1차 채집)
    '자영업 AI 활용',
    '창업 실수',
    '소상공인 세무',
    '폐업 위기',
    '매출 급증',
    '직원 관리 안 되는',
    '사장 마인드',
    '카페 창업 비용',
    '온라인 스토어 시작',
    '자영업 하루 루틴',
    // 2차 확장 (이야기성·감정성 강한 키워드)
    '혼자 사장',
    '부업 월 100만원',
    '첫 장사 실수',
    '매장 폐업 후기',
    '식당 망하는 이유',
    '사업 아이템 추천',
    '사장 월급',
    '자영업 현실',
    '소상공인 지원금',
    '창업 실패담',
  ],
};

// ─ 유틸 ────────────────────────────────────────────────────────────────
function loadEnv() {
  const envPath = path.join(PROJECT_ROOT, '.env.local');
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, 'utf-8');
  for (const line of content.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m && !process.env[m[1]]) {
      let val = m[2].trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      process.env[m[1]] = val;
    }
  }
}

// ─ 메인 ────────────────────────────────────────────────────────────────
async function main() {
  loadEnv();
  // loadEnv 이후에 SECRET 을 다시 평가 (module load 시 비어 있었을 수 있음)
  const secret = process.env.INTERNAL_API_SECRET || process.env.CRON_SECRET || '';
  if (!secret) {
    console.error('❌ INTERNAL_API_SECRET (or CRON_SECRET) not set');
    process.exit(1);
  }
  // 호출 함수에 쓰이는 전역 참조를 업데이트
  Object.defineProperty(globalThis, '__CORPUS_SECRET__', { value: secret });

  const category = process.argv[2];
  if (!category || !SEEDS[category]) {
    console.error(`사용: node scripts/collect-viral-urls.mjs <category>`);
    console.error(`가능한 카테고리: ${Object.keys(SEEDS).join(', ')}`);
    process.exit(1);
  }

  const seeds = SEEDS[category];
  console.log(`🎯 ${category} / ${seeds.length} seeds / target top-${TOP_N}`);
  console.log(`   필터: ratio≥${FILTERS.minViewToSubRatio}, views≥${FILTERS.minViewCount.toLocaleString()}, dur≤${FILTERS.maxDurationSec}s`);
  console.log('');

  // secret 을 fetch 호출에 실제로 반영하려면 fetchCandidatesForSeed 가 process.env 를 읽어야 하는데
  // 위에서 loadEnv 후 process.env 에 들어갔으므로 재실행 시점에 OK.
  // (module-top-level SECRET 상수는 이미 stale 이지만 fetchCandidatesForSeed 는 매번 process.env 참조하지 않음)
  // → SECRET 상수는 모듈 로드 시점 값. env load 순서 보장을 위해 fetch 함수를 클로저로 재작성.

  const secretForCall = secret;
  async function fetchForSeed(seed) {
    const headers = {
      'Content-Type': 'application/json',
      'x-internal-secret': secretForCall,
    };
    const res = await fetch(`${BASE_URL}/api/shortform-benchmark`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ keywords: seed, contentType: 'shortform' }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status}: ${text.slice(0, 150)}`);
    }
    return res.json();
  }

  const dedupe = new Map(); // videoId → candidate

  for (const seed of seeds) {
    process.stdout.write(`  "${seed}" ...`);
    try {
      const data = await fetchForSeed(seed);
      const candidates = Array.isArray(data?.candidates) ? data.candidates : [];
      let kept = 0;
      for (const c of candidates) {
        const ratio = Number(c.viewToSubRatio || 0);
        const views = Number(c.viewCount || 0);
        const dur = Number(c.duration || 0);
        if (views < FILTERS.minViewCount) continue;
        if (dur > FILTERS.maxDurationSec || dur < FILTERS.minDurationSec) continue;
        if (!c.videoId || dedupe.has(c.videoId)) continue;
        dedupe.set(c.videoId, {
          videoId: c.videoId,
          url: c.url,
          title: c.title,
          channelName: c.channelName,
          subs: c.subscriberCount,
          views: c.viewCount,
          ratio: Number(ratio.toFixed(2)),
          durationSec: dur,
          publishedAt: c.publishedAt,
          thumbnail: c.thumbnail,
          sourceSeed: seed,
          approved: null,
          reviewNotes: '',
        });
        kept += 1;
      }
      console.log(` ${candidates.length} → ${kept} kept (cumul=${dedupe.size})`);
    } catch (error) {
      console.log(` ❌ ${error?.message || error}`);
    }
  }

  const ranked = Array.from(dedupe.values())
    .sort((a, b) => b.ratio - a.ratio)
    .slice(0, TOP_N);

  const outDir = path.join(PROJECT_ROOT, 'data', 'viral-corpus', CORPUS_VERSION);
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `${category}.raw.json`);
  fs.writeFileSync(
    outPath,
    JSON.stringify(
      {
        meta: {
          category,
          corpusVersion: CORPUS_VERSION,
          collectedAt: new Date().toISOString(),
          seedCount: seeds.length,
          rawCandidateCount: dedupe.size,
          topNSaved: ranked.length,
          filters: FILTERS,
        },
        candidates: ranked,
      },
      null,
      2,
    ),
    'utf-8',
  );

  console.log('');
  console.log(`✅ ${dedupe.size} 후보 수집 → 상위 ${ranked.length}건 저장`);
  console.log(`   ${outPath}`);
  console.log('');
  console.log(`다음: 각 항목의 "approved" 를 true(20건) 또는 false 로 수기 마킹 → 다음 스크립트 실행`);
}

main().catch((err) => {
  console.error('❌ collect-viral-urls failed:', err);
  process.exit(1);
});
