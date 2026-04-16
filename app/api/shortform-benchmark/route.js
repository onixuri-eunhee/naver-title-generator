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
import {
  publishProgress,
  checkCancelled,
  createJobId,
  cleanupJob,
} from '@/lib/job-progress';
import { CancelledError } from '@/lib/cancelled-error';

export const maxDuration = 30;

const CACHE_TTL_SEC = 7 * 86400; // 7일 (스펙 §9)

/**
 * 요청 캐시 키 — blogText + keywords 해시.
 */
function makeCacheKey({ blogText, keywords, contentType }) {
  const hash = crypto.createHash('sha256')
    .update(`${blogText || ''}|${keywords || ''}|${contentType || 'shortform'}`)
    .digest('hex')
    .slice(0, 32);
  return `bench:cache:${hash}`;
}

export async function OPTIONS(request) {
  return handleOptions(request);
}

export async function POST(request) {
  // ─ 인증 ─
  // 내부 self-call 바이패스: shortform-script → benchmark self-call 시
  // Vercel Deployment Protection 401 방지 (커밋 4e93066 참조)
  const internalSecret = request.headers.get('x-internal-secret');
  const expectedSecret = process.env.CRON_SECRET || process.env.INTERNAL_API_SECRET || '';
  const isInternalCall = !!(internalSecret && expectedSecret && internalSecret === expectedSecret);

  const isAdmin = isInternalCall || await resolveAdmin(request);
  const token = extractToken(request);
  const email = isInternalCall ? '_internal_' : await resolveSessionEmail(token);
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

  // v2.1: contentType 필터 (shortform=≤90s, longform=≥180s)
  const contentType = body.contentType === 'longform' ? 'longform' : 'shortform';

  if (!blogText && !keywords) {
    return jsonResponse(request, { error: 'blogText 또는 keywords 중 하나는 필수입니다.' }, { status: 400 });
  }

  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    return jsonResponse(request, { error: 'YouTube API가 설정되지 않았습니다.' }, { status: 500 });
  }

  // ─ Phase I: jobId + SSE 진행 이벤트 ─
  // jobId가 body로 들어오면 상위 호출자(예: shortform-script)가 SSE를 소유한 sub-call.
  // 이 경우 step 이벤트만 발행하고 'complete'는 발행하지 않아야 함
  // (그러지 않으면 클라이언트 EventSource가 도중에 닫혀 후속 단계가 안 보임).
  const isSubCall = !!body.jobId;
  const jobId = body.jobId || createJobId();

  // ─ 캐시 확인 (contentType 포함 — shortform과 longform 분리 캐시) ─
  const cacheKey = makeCacheKey({ blogText, keywords, contentType });
  try {
    const cached = await getRedis().get(cacheKey);
    if (cached) {
      console.log(`[BENCHMARK] Cache hit: ${cacheKey}`);
      // 캐시 적중도 진행 이벤트를 즉시 complete 로 발행
      await publishProgress(jobId, {
        type: 'step',
        step: 'keyword-extraction',
        status: 'done',
        progress: 100,
        result: { cached: true },
      });
      await publishProgress(jobId, {
        type: 'step',
        step: 'youtube-search',
        status: 'done',
        progress: 100,
        result: { cached: true },
      });
      if (!isSubCall) {
        await publishProgress(jobId, {
          type: 'complete',
          result: { jobId, ...cached, cached: true },
        });
      }
      return jsonResponse(request, { ...cached, jobId, cached: true });
    }
  } catch (e) {
    console.warn('[BENCHMARK] Cache read failed:', e.message);
  }

  // ─ 파이프라인 실행 ─
  try {
    // 1) 키워드 확장 (Gemini Flash)
    await publishProgress(jobId, {
      type: 'step',
      step: 'keyword-extraction',
      status: 'running',
      progress: 0,
    });
    await checkCancelled(jobId, 'keyword-extraction:start');
    console.log('[BENCHMARK] Expanding keywords...');
    const expansion = await expandKeywords({ blogText, keywords });
    await publishProgress(jobId, {
      type: 'step',
      step: 'keyword-extraction',
      status: 'done',
      progress: 100,
      result: {
        queries: expansion.searchQueries?.length || 0,
      },
    });

    // 2) YouTube 5쿼리 병렬 검색
    await publishProgress(jobId, {
      type: 'step',
      step: 'youtube-search',
      status: 'running',
      progress: 0,
      subStep: `query-0/${expansion.searchQueries?.length || 5}`,
    });
    await checkCancelled(jobId, 'youtube-search:start');
    console.log(`[BENCHMARK] Parallel search (${contentType}): ${expansion.searchQueries.join(' | ')}`);
    const { videos, relaxed } = await benchmarkSearch(expansion.searchQueries, apiKey, { contentType });
    await publishProgress(jobId, {
      type: 'step',
      step: 'youtube-search',
      status: 'done',
      progress: 100,
      result: { candidates: videos.length, relaxed },
    });

    if (videos.length === 0) {
      // 폴백: 벤치마킹 없이 진행
      const fallbackResult = {
        jobId,
        candidates: [],
        searchKeywords: expansion.searchQueries,
        mainKeywords: expansion.mainKeywords,
        relatedKeywords: expansion.relatedKeywords,
        fallback: true,
        message: '검색 결과가 없어 벤치마킹 없이 진행합니다.',
      };
      if (!isSubCall) {
        await publishProgress(jobId, {
          type: 'complete',
          result: fallbackResult,
        });
      }
      return jsonResponse(request, fallbackResult);
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

    if (!isSubCall) {
      await publishProgress(jobId, {
        type: 'complete',
        result: { jobId, ...result, cached: false },
      });
    }

    return jsonResponse(request, { ...result, jobId, cached: false });
  } catch (error) {
    if (error instanceof CancelledError) {
      await publishProgress(jobId, {
        type: 'cancelled',
        cancelledAt: error.checkpoint,
      });
      return jsonResponse(
        request,
        { cancelled: true, checkpoint: error.checkpoint, jobId },
        { status: 499 },
      );
    }
    console.error('[BENCHMARK] Pipeline error:', error.message);
    await publishProgress(jobId, {
      type: 'error',
      error: error.message || 'benchmark pipeline error',
      step: 'benchmark',
    });
    return jsonResponse(request, {
      candidates: [],
      searchKeywords: [],
      fallback: true,
      message: '벤치마킹에 실패했습니다. 벤치마킹 없이 진행합니다.',
      error: error.message,
      jobId,
    });
  } finally {
    await cleanupJob(jobId);
  }
}
