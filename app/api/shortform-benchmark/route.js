import crypto from 'crypto';
import {
  getRedis,
  resolveAdmin,
  extractToken,
  resolveSessionEmail,
  jsonResponse,
  handleOptions,
} from '@/lib/api-helpers';
import { expandKeywords } from '@/lib/keyword-expansion';
import { benchmarkSearch } from '@/lib/youtube-search';

export const maxDuration = 30;

const CACHE_TTL_SEC = 7 * 86400; // 7일 (스펙 §9)

/**
 * 요청 캐시 키 — blogText + keywords 해시.
 */
function makeCacheKey({ blogText, keywords }) {
  const hash = crypto.createHash('sha256')
    .update(`${blogText || ''}|${keywords || ''}`)
    .digest('hex')
    .slice(0, 32);
  return `bench:cache:${hash}`;
}

export async function OPTIONS(request) {
  return handleOptions(request);
}

export async function POST(request) {
  // ─ 인증 ─
  const isAdmin = await resolveAdmin(request);
  const token = extractToken(request);
  const email = await resolveSessionEmail(token);
  if (!isAdmin && !email) {
    return jsonResponse(request, { error: '로그인이 필요합니다.' }, { status: 401 });
  }

  // ─ 입력 ─
  const body = await request.json().catch(() => ({}));
  const blogText = typeof body.blogText === 'string' ? body.blogText.trim().slice(0, 8000) : '';
  const keywords = typeof body.keywords === 'string'
    ? body.keywords.trim().slice(0, 200)
    : Array.isArray(body.keywords)
      ? body.keywords.join(', ').slice(0, 200)
      : '';

  if (!blogText && !keywords) {
    return jsonResponse(request, { error: 'blogText 또는 keywords 중 하나는 필수입니다.' }, { status: 400 });
  }

  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    return jsonResponse(request, { error: 'YouTube API가 설정되지 않았습니다.' }, { status: 500 });
  }

  // ─ 캐시 확인 ─
  const cacheKey = makeCacheKey({ blogText, keywords });
  try {
    const cached = await getRedis().get(cacheKey);
    if (cached) {
      console.log(`[BENCHMARK] Cache hit: ${cacheKey}`);
      return jsonResponse(request, { ...cached, cached: true });
    }
  } catch (e) {
    console.warn('[BENCHMARK] Cache read failed:', e.message);
  }

  // ─ 파이프라인 실행 ─
  try {
    // 1) 키워드 확장 (Gemini Flash)
    console.log('[BENCHMARK] Expanding keywords...');
    const expansion = await expandKeywords({ blogText, keywords });

    // 2) YouTube 5쿼리 병렬 검색
    console.log(`[BENCHMARK] Parallel search: ${expansion.searchQueries.join(' | ')}`);
    const { videos, relaxed } = await benchmarkSearch(expansion.searchQueries, apiKey);

    if (videos.length === 0) {
      // 폴백: 벤치마킹 없이 진행
      return jsonResponse(request, {
        candidates: [],
        searchKeywords: expansion.searchQueries,
        mainKeywords: expansion.mainKeywords,
        relatedKeywords: expansion.relatedKeywords,
        fallback: true,
        message: '검색 결과가 없어 벤치마킹 없이 진행합니다.',
      });
    }

    // 3) 응답 구조 (스펙 §8 요청/응답)
    const candidates = videos.map((v) => ({
      videoId: v.videoId,
      title: v.title,
      thumbnail: v.thumbnail,
      channelName: v.channelTitle,
      viewCount: v.viewCount,
      subscriberCount: v.subscriberCount,
      duration: v.durationSec,
      viewToSubRatio: Number(v.viewToSubRatio.toFixed(2)),
      url: v.url,
      publishedAt: v.publishedAt,
      sourceQuery: v.sourceQuery,
      // subtitlePreview는 Task B5 analyze 호출 후 채워짐 (여기서는 빈 문자열)
      subtitlePreview: '',
    }));

    const result = {
      candidates,
      searchKeywords: expansion.searchQueries,
      mainKeywords: expansion.mainKeywords,
      relatedKeywords: expansion.relatedKeywords,
      relaxedFilter: relaxed,
      fallback: false,
    };

    // 4) 캐시 저장
    try {
      await getRedis().set(cacheKey, result, { ex: CACHE_TTL_SEC });
      console.log(`[BENCHMARK] Cached: ${cacheKey} (${candidates.length} videos, relaxed=${relaxed})`);
    } catch (e) {
      console.warn('[BENCHMARK] Cache write failed:', e.message);
    }

    return jsonResponse(request, { ...result, cached: false });
  } catch (error) {
    console.error('[BENCHMARK] Pipeline error:', error.message);
    return jsonResponse(request, {
      candidates: [],
      searchKeywords: [],
      fallback: true,
      message: '벤치마킹에 실패했습니다. 벤치마킹 없이 진행합니다.',
      error: error.message,
    });
  }
}
