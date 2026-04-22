// 벤치마킹 패턴 리졸버 — legacy 숏폼 경로 전용.
//
// Why: 2026-04-15 bbaa553 Genkit 리팩터에서 `/api/shortform-benchmark` 의
// Sonnet analyzePatterns 가 `/analyze` 로 분리됐는데 클라이언트 연결이 끝까지
// 이어지지 않아 legacy 주입이 silent fail 됐다. 2026-04-22 복원 작업으로
// server-side 에서 YouTube 검색 후보에 Haiku 4.5 텍스트 분석을 태워 patterns
// 를 다시 만들어 legacy 프롬프트에 주입한다.
//
// 유의: 무거운 작업(검색+분석)을 피해야 할 때는 resolveBenchmark 가 null 을
// 돌려 legacy 가 조용히 프롬프트 자산 fallback 으로 동작한다.

const HAIKU_MODEL = 'claude-haiku-4-5-20251001';
const BENCHMARK_TIMEOUT_MS = 25 * 1000;
const ANALYZE_TIMEOUT_MS = 15 * 1000;

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

async function analyzePatternsWithHaiku({ keyword, videos }) {
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

{
  "hookType": "질문형|충격형|비밀형|증거형|공감형|경고형|리스트형|실수지적형|변신형|FOMO형 중 1개",
  "hookPattern": "후킹 패턴 1줄 (예: 숫자+결과 제시로 시작)",
  "structure": "대본 구조 1줄 (예: hook→problem→solution→cta)",
  "viralFormula": "이 주제에서 조회수를 터뜨리는 공식 요약 1~2문장",
  "suggestedHook": "추천 첫 문장 (한국어, 8~14자)"
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
        model: HAIKU_MODEL,
        max_tokens: 400,
        temperature: 0.3,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: AbortSignal.timeout(ANALYZE_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.warn(`[BENCHMARK-RESOLVER] Haiku HTTP ${res.status}`);
      return null;
    }
    const data = await res.json();
    const text = extractText(data);
    const parsed = parseJsonLoose(text);
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      hookType: parsed.hookType || null,
      hookPattern: parsed.hookPattern || null,
      structure: parsed.structure || null,
      viralFormula: parsed.viralFormula || null,
      suggestedHook: parsed.suggestedHook || null,
    };
  } catch (error) {
    console.warn('[BENCHMARK-RESOLVER] Haiku analyze failed:', error?.message || error);
    return null;
  }
}

/**
 * legacy 숏폼 경로에서 벤치마킹 패턴을 해소한다.
 *
 * @param {Object} params
 * @param {string} params.topic
 * @param {string} [params.blogText]
 * @param {string} [params.jobId]
 * @param {'shortform'|'longform'} [params.contentType]
 * @param {string} [params.authHeader]
 * @param {string} [params.baseUrl] — self-call 기본 URL. 미지정 시 env 에서 추론.
 * @returns {Promise<{ patterns: object|null, videos: Array, fallback: boolean }|null>}
 *   patterns 추출 성공 시 legacy 프롬프트에 주입할 객체 반환.
 *   실패/검색없음/타임아웃 시 null → legacy 가 프롬프트 자산 fallback 을 탄다.
 */
export async function resolveBenchmark({
  topic,
  blogText,
  jobId,
  contentType = 'shortform',
  authHeader,
  baseUrl,
} = {}) {
  if (process.env.SHORTFORM_BENCHMARK_DISABLED === '1') return null;

  const keyword = (topic || '').trim()
    || (blogText ? blogText.slice(0, 50).replace(/[^가-힣a-zA-Z0-9\s]/g, '').trim() : '');
  if (!keyword) return null;

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
    console.log(`[BENCHMARK-RESOLVER] "${keyword}" → fallback (no candidates)`);
    return { patterns: null, videos: [], fallback: true };
  }

  const candidates = Array.isArray(raw.candidates) ? raw.candidates : [];
  if (candidates.length === 0) {
    return { patterns: null, videos: [], fallback: true };
  }

  const patterns = await analyzePatternsWithHaiku({ keyword, videos: candidates });
  if (!patterns) {
    console.log(`[BENCHMARK-RESOLVER] "${keyword}" → candidates ${candidates.length} but pattern analysis failed`);
    return { patterns: null, videos: candidates, fallback: true };
  }

  console.log(
    `[BENCHMARK-RESOLVER] "${keyword}" → ${candidates.length} videos, hookType=${patterns.hookType}`,
  );
  return {
    patterns,
    videos: candidates,
    fallback: false,
  };
}
