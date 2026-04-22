// 벤치마킹 리졸버 — legacy 숏폼 경로 전용.
//
// Sprint 1 (2026-04-22): corpus-first 전환.
//   1순위: data/viral-corpus/v{version}/{category}.structured.json 에서 실제
//          바이럴 샘플(Identity Mirror 6-beat + sceneSequence + CTA) 주입.
//   2순위: 해당 카테고리 코퍼스 없으면 기존 YouTube+Haiku fallback.
//
// 이력:
//   - bbaa553(4/15) Genkit 리팩터 시 analyzePatterns /analyze 로 분리 → silent fail
//   - 8324aa1(4/21) 죽은 주입 코드 제거
//   - ee397d5(4/22) YouTube + Haiku 로 주입 복원
//   - 1a32e93(4/22) Pattern 분석기 Sonnet 승급
//   - Sprint 1 (4/22) 코퍼스 우선

import fs from 'node:fs';
import path from 'node:path';

const CORPUS_VERSION = process.env.SHORTFORM_CORPUS_VERSION || 'v2026-Q2';
const PATTERN_MODEL = 'claude-sonnet-4-6';
const BENCHMARK_TIMEOUT_MS = 25 * 1000;
const ANALYZE_TIMEOUT_MS = 20 * 1000;

function getInternalSecret() {
  return process.env.CRON_SECRET || process.env.INTERNAL_API_SECRET || '';
}

function extractText(data) {
  return (data?.content || [])
    .filter((block) => block?.type === 'text' && block?.text)
    .map((block) => block.text)
    .join('\n')
    .trim();
}

function parseJsonLoose(raw) {
  const trimmed = raw.trim();
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
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(trimmed.slice(start, end + 1));
    } catch (_) {}
  }
  return null;
}

async function fetchCandidates({ baseUrl, keyword, jobId, contentType, authHeader }) {
  const internalSecret = getInternalSecret();
  try {
    const res = await fetch(`${baseUrl}/api/shortform-benchmark`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(authHeader ? { Authorization: authHeader } : {}),
        ...(internalSecret ? { 'x-internal-secret': internalSecret } : {}),
      },
      body: JSON.stringify({ keywords: keyword, jobId, contentType }),
      signal: AbortSignal.timeout(BENCHMARK_TIMEOUT_MS),
    });
    if (!res.ok) {
      const snippet = await res.text().catch(() => '');
      console.warn(`[BENCHMARK-RESOLVER] candidates HTTP ${res.status}: ${snippet.slice(0, 200)}`);
      return null;
    }
    return await res.json();
  } catch (error) {
    console.warn('[BENCHMARK-RESOLVER] candidates fetch failed:', error?.message || error);
    return null;
  }
}

async function analyzePatterns({ keyword, videos }) {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!Array.isArray(videos) || videos.length === 0) return null;

  const top = videos.slice(0, 3);
  const descriptions = top
    .map((v, i) => {
      const title = v.title || '(제목 없음)';
      const channel = v.channelName || v.channelTitle || '(채널 미상)';
      const views = (v.viewCount || 0).toLocaleString();
      const subs = (v.subscriberCount || 0).toLocaleString();
      const ratio = Number(v.viewToSubRatio || 0).toFixed(1);
      return `[영상 ${i + 1}] 제목: "${title}" | 채널: ${channel} (구독자 ${subs}) | 조회수: ${views} | 비율: ${ratio}배`;
    })
    .join('\n');

  const prompt = `당신은 숏폼 바이럴 공식 분석가입니다. 아래는 "${keyword}" 주제로 구독자 대비 조회수가 터진 YouTube 숏폼들입니다.

${descriptions}

이 영상들에 공통된 패턴을 JSON으로만 답하세요. 설명 금지.

규칙:
- hookType 은 **정확히 1개** enum 값만. 파이프/슬래시/쉼표 금지.
- suggestedHook 은 단정형. 인사·서론·"~같아요"·"~일 수 있어요" 금지. 8~14자 한국어. 숫자/반전/경고/비밀 중 한 방.
- hookPattern, viralFormula 는 한 줄 요약.

{
  "hookType": "질문형|충격형|비밀형|증거형|공감형|경고형|리스트형|실수지적형|변신형|FOMO형 중 정확히 1개",
  "hookPattern": "후킹 패턴 1줄 (예: 숫자+결과 제시로 시작)",
  "structure": "대본 구조 1줄 (예: hook→problem→solution→cta)",
  "viralFormula": "이 주제에서 조회수를 터뜨리는 공식 요약 1~2문장",
  "suggestedHook": "추천 첫 문장 (한국어, 8~14자, 단정형)"
}`;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: PATTERN_MODEL,
        max_tokens: 500,
        temperature: 0.4,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: AbortSignal.timeout(ANALYZE_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.warn(`[BENCHMARK-RESOLVER] Sonnet HTTP ${res.status}`);
      return null;
    }
    const data = await res.json();
    const text = extractText(data);
    const parsed = parseJsonLoose(text);
    if (!parsed || typeof parsed !== 'object') return null;
    // 모델이 enum 여러 개를 반환하는 경우 방어적으로 첫 토큰만 사용.
    const firstHookType = typeof parsed.hookType === 'string'
      ? parsed.hookType.split(/[|,/]/)[0].trim()
      : null;
    return {
      hookType: firstHookType || null,
      hookPattern: parsed.hookPattern || null,
      structure: parsed.structure || null,
      viralFormula: parsed.viralFormula || null,
      suggestedHook: parsed.suggestedHook || null,
    };
  } catch (error) {
    console.warn('[BENCHMARK-RESOLVER] Sonnet analyze failed:', error?.message || error);
    return null;
  }
}

// ─ 코퍼스 lookup ───────────────────────────────────────────────────────

const CORPUS_CACHE = new Map(); // category → {loadedAt, videos}
const CORPUS_TTL_MS = 5 * 60 * 1000;

function getCorpusPath(category) {
  return path.join(process.cwd(), 'data', 'viral-corpus', CORPUS_VERSION, `${category}.structured.json`);
}

function loadCorpus(category) {
  const cached = CORPUS_CACHE.get(category);
  if (cached && Date.now() - cached.loadedAt < CORPUS_TTL_MS) return cached.videos;

  const filePath = getCorpusPath(category);
  if (!fs.existsSync(filePath)) {
    CORPUS_CACHE.set(category, { loadedAt: Date.now(), videos: null });
    return null;
  }
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    const videos = Array.isArray(data?.videos) ? data.videos.filter((v) => v.identityMirror) : [];
    CORPUS_CACHE.set(category, { loadedAt: Date.now(), videos });
    return videos;
  } catch (err) {
    console.warn(`[BENCHMARK-RESOLVER] corpus load failed (${category}):`, err?.message);
    return null;
  }
}

/**
 * 토픽 ↔ 샘플 유사도 — 간단 keyword overlap.
 * 추후 embedding 으로 업그레이드 가능하되 20건 이하에서는 과잉.
 */
function scoreRelevance(topic, video) {
  const topicTokens = new Set(
    (topic || '').toLowerCase().replace(/[^\w가-힣\s]/g, '').split(/\s+/).filter((t) => t.length > 1),
  );
  if (topicTokens.size === 0) return 0;

  const targetText = [
    video.title || '',
    video.identityMirror?.firstSentence || '',
    ...(video.identityMirror?.actions || []),
    ...(video.identityMirror?.consequences || []),
    video.sourceSeed || '',
  ].join(' ').toLowerCase();

  let hits = 0;
  for (const t of topicTokens) {
    if (targetText.includes(t)) hits += 1;
  }
  return hits / topicTokens.size;
}

function buildCorpusExamples(topic, videos, maxSamples = 3) {
  const scored = videos
    .map((v) => ({ video: v, score: scoreRelevance(topic, v) }))
    .sort((a, b) => b.score - a.score);

  // 스코어 0 만 있는 경우에도 상위 샘플로 fallback (카테고리 기반 주입)
  const topScore = scored[0]?.score || 0;
  const selected = topScore > 0
    ? scored.slice(0, maxSamples).filter((s) => s.score > 0)
    : scored.slice(0, maxSamples);

  return selected.map(({ video: v, score }) => ({
    title: v.title,
    firstSentence: v.identityMirror?.firstSentence || '',
    identityMirror: v.identityMirror,
    sceneSampleBrief: (v.sceneSequence || []).slice(0, 3).map((s) => ({
      role: s.role,
      script: (s.script || '').slice(0, 120),
      narrationTone: s.narrationTone,
      polaritySignal: s.polaritySignal,
    })),
    cta: v.cta,
    verdict: v.overallVerdict?.notes || '',
    stats: {
      views: v.views,
      subs: v.subs,
      ratio: v.ratio,
    },
    relevanceScore: Number(score.toFixed(2)),
  }));
}

// ─ 메인 API ────────────────────────────────────────────────────────────

/**
 * 숏폼 벤치마킹 리졸버. 코퍼스 우선, 실패 시 YouTube+Haiku fallback.
 *
 * @param {Object} params
 * @param {string} params.topic
 * @param {string} [params.blogText]
 * @param {string} [params.category] — inferCategory 결과. 있으면 해당 카테고리 코퍼스 1순위.
 * @param {string} [params.jobId]
 * @param {'shortform'|'longform'} [params.contentType]
 * @param {string} [params.authHeader]
 * @param {string} [params.baseUrl]
 * @returns {Promise<Object|null>}
 *   corpusExamples: Array<{title, firstSentence, identityMirror, sceneSampleBrief, cta, ...}>
 *   patterns: object (backward compat — 첫 샘플 기반)
 *   videos: Array
 *   fallback: boolean
 *   source: 'corpus' | 'haiku' | 'none'
 */
export async function resolveBenchmark({
  topic,
  blogText,
  category,
  jobId,
  contentType = 'shortform',
  authHeader,
  baseUrl,
} = {}) {
  if (process.env.SHORTFORM_BENCHMARK_DISABLED === '1') return null;

  const keyword = (topic || '').trim()
    || (blogText ? blogText.slice(0, 50).replace(/[^가-힣a-zA-Z0-9\s]/g, '').trim() : '');
  if (!keyword) return null;

  // 1순위 — 코퍼스 lookup
  if (category && category !== 'other' && category !== 'auto') {
    const videos = loadCorpus(category);
    if (videos && videos.length > 0) {
      const corpusExamples = buildCorpusExamples(keyword, videos, 3);
      if (corpusExamples.length > 0) {
        // backward-compat patterns — 첫 샘플 기준
        const topIM = corpusExamples[0].identityMirror || {};
        const patterns = {
          hookType: topIM.hookType || null,
          hookPattern: topIM.firstSentence || null,
          structure: null,
          viralFormula: corpusExamples[0].verdict || null,
          suggestedHook: topIM.firstSentence || null,
        };
        console.log(
          `[BENCHMARK-RESOLVER] corpus[${category}] → ${corpusExamples.length} samples · top hookType=${topIM.hookType} · topic-match=${corpusExamples[0].relevanceScore}`,
        );
        return {
          source: 'corpus',
          corpusExamples,
          patterns,
          videos: corpusExamples.map((s) => ({
            title: s.title,
            viewCount: s.stats.views,
            subscriberCount: s.stats.subs,
            viewToSubRatio: s.stats.ratio,
          })),
          fallback: false,
        };
      }
    }
  }

  // 2순위 — 기존 YouTube + Haiku fallback
  const resolvedBaseUrl = baseUrl
    || process.env.NEXT_PUBLIC_SITE_URL
    || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null)
    || 'http://localhost:3000';

  const raw = await fetchCandidates({
    baseUrl: resolvedBaseUrl,
    keyword,
    jobId,
    contentType,
    authHeader,
  });

  if (!raw || raw.fallback) {
    console.log(`[BENCHMARK-RESOLVER] "${keyword}" [cat=${category || '?'}] → no corpus, no candidates`);
    return { source: 'none', patterns: null, videos: [], fallback: true };
  }

  const candidates = Array.isArray(raw.candidates) ? raw.candidates : [];
  if (candidates.length === 0) {
    return { source: 'none', patterns: null, videos: [], fallback: true };
  }

  const patterns = await analyzePatterns({ keyword, videos: candidates });
  if (!patterns) {
    return { source: 'none', patterns: null, videos: candidates, fallback: true };
  }

  console.log(
    `[BENCHMARK-RESOLVER] haiku-fallback "${keyword}" → ${candidates.length} videos, hookType=${patterns.hookType}`,
  );
  return {
    source: 'haiku',
    patterns,
    videos: candidates,
    fallback: false,
  };
}
