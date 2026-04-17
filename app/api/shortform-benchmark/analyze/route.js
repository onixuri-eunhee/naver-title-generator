/**
 * POST /api/shortform-benchmark/analyze
 *
 * 사용자가 선택한 1~3개 YouTube 숏폼을 Gemini 2.5 Pro 사고 모드로 깊게 분석.
 * 결과는 스펙 §5 JSON Schema 구조 (videos[] + aggregated).
 *
 * 캐시 전략: 영상 단위로 bench:analyze:{videoId} 30일 저장.
 * 같은 영상이 여러 사용자 결과에 등장하므로 재사용율 80%+.
 */
import {
  resolveAdmin,
  extractToken,
  resolveSessionEmail,
  jsonResponse,
  handleOptions,
  getRedis,
} from '@/lib/api-helpers';
import { getGenkit, resolveProModel } from '@/lib/gemini-vertex';
import { AnalysisOutputSchema } from '@/lib/benchmark-schemas';
import { aggregateDesignTokens, saveDesignTokens } from '@/lib/shortform/design-tokens';
import {
  publishProgress,
  checkCancelled,
  createJobId,
  cleanupJob,
} from '@/lib/job-progress';
import { CancelledError } from '@/lib/cancelled-error';

export const maxDuration = 60; // 사고 모드 + 3영상 → 최대 45초 소요 가능

const CACHE_TTL_SEC = 30 * 86400; // 30일
const MAX_VIDEOS_PER_REQUEST = 3;

/**
 * YouTube URL에서 videoId 추출.
 */
function extractVideoId(url) {
  if (!url || typeof url !== 'string') return null;
  const patterns = [
    /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/watch\?v=([a-zA-Z0-9_-]{11})/,
    /youtu\.be\/([a-zA-Z0-9_-]{11})/,
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}

/**
 * 분석 프롬프트 — 스펙 §5 JSON Schema 엄격 출력 유도.
 */
const ANALYSIS_PROMPT = `당신은 한국어 YouTube 숏폼 영상 분석 전문가입니다.
첨부된 1~3개의 숏폼 영상을 멀티모달로(영상 + 음성 + 자막) 깊게 분석하여
각 영상의 구조와 공통 패턴을 JSON으로 정확히 추출하세요.

## 분석 항목 (영상별)
1. **hook (첫 3초)**: 후킹 유형, 첫 문장, 비주얼 연출, 톤
   - type 후보: number-list, question, shock, secret, evidence, empathy, warning, mistake, transformation, fomo
2. **body**: 대본 구조, 세그먼트 수, 평균 길이, 톤, 본인 등장 비율, 세팅
   - structure 후보: list, narrative, how-to, comparison, problem-solution
   - personPresence 후보: high, medium, low, none
3. **cta**: 유형, 문구, 위치
   - type 후보: comment, dm, follow, link, save, share, none
4. **visualStyle**: 자막 위치/스타일, 컷 빈도
   - subtitlePosition: top, middle, bottom
   - subtitleStyle: static, kinetic, mixed
   - cutFrequency: slow, medium, fast
5. **caption**: 유튜브 설명 텍스트 패턴 (해시태그, 이모지 사용 여부, 줄바꿈 빈도 등)

## 집계 항목 (aggregated)
- dominantHookType, dominantBodyStructure, dominantTone
- averageDuration (초)
- personPresenceMode, recommendedSubtitlePosition, commonCTAType
- captionPattern (averageLength, dominantStructure, averageHashtagCount, commonHashtags)
- **recommendedPreset**: 전문가 | 친근 | 임팩트 | 차분 | 트렌디 | 비즈니스 중 1개
- advice: 사용자가 자기 영상 만들 때 참고할 한국어 조언 (2~3 문장)

## 디자인 메타 분석 (영상별 designMeta 필드로 응답)
- titleSizeRatio: 제목 텍스트가 화면 폭에서 차지하는 비율 (0.0~1.0)
- titlePositionPercent: 제목이 화면 상단에서 몇 % 위치에 있는지 (0~100)
- backgroundTone: 배경이 어두운지 밝은지 ("dark" | "light" | "mixed")
- avgSceneDurationSec: 평균 씬/컷 길이 (초, 소수점 1자리)
- textContrast: 텍스트와 배경의 대비 ("high" | "medium")
- transitionStyle: 주로 사용하는 전환 효과 ("cut" | "fade" | "slide" | "mixed")

## 절대 규칙
1. 반드시 JSON만 출력. 설명 텍스트 금지.
2. 모든 문자열 필드는 한국어 또는 소문자 영어 enum.
3. 숫자 필드는 실제 영상 분석 결과에 근거 (추측 금지).
4. recommendedPreset은 반드시 6개 enum 중 하나.
5. advice는 "~하세요" 체 (반말 금지).
6. designMeta의 모든 필드는 실제 영상 화면 분석 결과에 근거.`;

export async function OPTIONS(request) {
  return handleOptions(request);
}

export async function POST(request) {
  // 내부 self-call 바이패스 (shortform-script → benchmark 체인 호출 시)
  const internalSecret = request.headers.get('x-internal-secret');
  const expectedSecret = process.env.CRON_SECRET || process.env.INTERNAL_API_SECRET || '';
  const isInternalCall = !!(internalSecret && expectedSecret && internalSecret === expectedSecret);

  const isAdmin = isInternalCall || await resolveAdmin(request);
  const token = extractToken(request);
  const email = isInternalCall ? '_internal_' : await resolveSessionEmail(token);
  if (!isAdmin && !email) {
    return jsonResponse(request, { error: '로그인이 필요합니다.' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const category = typeof body.category === 'string' ? body.category.trim() : '';
  const rawUrls = Array.isArray(body.videoUrls) ? body.videoUrls : [];
  const urls = rawUrls.slice(0, MAX_VIDEOS_PER_REQUEST).filter(Boolean);

  if (urls.length === 0) {
    return jsonResponse(request, { error: 'videoUrls 배열이 비어있습니다.' }, { status: 400 });
  }

  // videoId 추출 + 캐시 lookup
  const videoIds = urls.map(extractVideoId).filter(Boolean);
  if (videoIds.length === 0) {
    return jsonResponse(request, { error: '유효한 YouTube URL이 없습니다.' }, { status: 400 });
  }

  // ─ Phase I: jobId + 진행 이벤트 ─
  const jobId = body.jobId || createJobId();

  const redis = getRedis();
  const cached = {};
  const missingUrls = [];
  const missingIds = [];

  await publishProgress(jobId, {
    type: 'step',
    step: 'video-analysis',
    status: 'running',
    progress: 0,
    subStep: `video-0/${videoIds.length}`,
  });

  for (let i = 0; i < videoIds.length; i++) {
    const id = videoIds[i];
    try {
      const v = await redis.get(`bench:analyze:${id}`);
      if (v) {
        cached[id] = v;
        continue;
      }
    } catch {}
    missingUrls.push(urls[i]);
    missingIds.push(id);
  }

  // 모두 캐시 적중 → 집계만 재계산
  if (missingUrls.length === 0) {
    const allVideos = Object.values(cached);
    const aggregated = await computeAggregated(allVideos);

    // 디자인 토큰 집계 + 저장
    if (category) {
      try {
        const designTokens = aggregateDesignTokens(allVideos);
        await saveDesignTokens(category, designTokens);
      } catch (e) {
        console.warn('[ANALYZE] Design token save failed (cached):', e.message);
      }
    }

    await publishProgress(jobId, {
      type: 'step',
      step: 'video-analysis',
      status: 'done',
      progress: 100,
      result: { fromCache: videoIds.length, fromGemini: 0 },
    });
    await publishProgress(jobId, {
      type: 'complete',
      result: {
        jobId,
        videos: allVideos,
        aggregated,
        cached: true,
      },
    });
    await cleanupJob(jobId);
    return jsonResponse(request, {
      jobId,
      videos: allVideos,
      aggregated,
      cached: true,
    });
  }

  // Gemini 호출
  try {
    await checkCancelled(jobId, 'video-analysis:gemini');
    await publishProgress(jobId, {
      type: 'step',
      step: 'video-analysis',
      status: 'running',
      progress: Math.round((Object.keys(cached).length / videoIds.length) * 100),
      subStep: `video-${Object.keys(cached).length}/${videoIds.length}`,
    });

    const ai = getGenkit();
    const response = await ai.generate({
      model: resolveProModel(),
      prompt: [
        { text: ANALYSIS_PROMPT },
        ...missingUrls.map((url) => ({
          media: { url, contentType: 'video/*' },
        })),
      ],
      output: { schema: AnalysisOutputSchema },
      config: {
        temperature: 0.2,
        // 사고 모드 — Gemini 2.5 Pro는 기본 탑재, thinkingBudget으로 제어
        thinkingConfig: { thinkingBudget: 8000 },
      },
    });

    const output = response.output;
    if (!output) {
      throw new Error('Gemini 응답 파싱 실패 (output null)');
    }

    // 영상별 캐시 저장
    for (const v of (output.videos || [])) {
      try {
        await redis.set(`bench:analyze:${v.videoId}`, v, { ex: CACHE_TTL_SEC });
      } catch {}
    }

    // 캐시 + 새 분석 병합
    const allVideos = [...Object.values(cached), ...(output.videos || [])];
    const aggregated = output.aggregated && allVideos.length === (output.videos || []).length
      ? output.aggregated
      : await computeAggregated(allVideos);

    // 디자인 토큰 집계 + 저장
    if (category) {
      try {
        const designTokens = aggregateDesignTokens(allVideos);
        await saveDesignTokens(category, designTokens);
      } catch (e) {
        console.warn('[ANALYZE] Design token save failed:', e.message);
      }
    }

    await publishProgress(jobId, {
      type: 'step',
      step: 'video-analysis',
      status: 'done',
      progress: 100,
      result: {
        fromCache: Object.keys(cached).length,
        fromGemini: (output.videos || []).length,
      },
    });
    await publishProgress(jobId, {
      type: 'complete',
      result: {
        jobId,
        videos: allVideos,
        aggregated,
      },
    });

    return jsonResponse(request, {
      jobId,
      videos: allVideos,
      aggregated,
      cached: Object.keys(cached).length > 0,
      fromCache: Object.keys(cached).length,
      fromGemini: (output.videos || []).length,
    });
  } catch (err) {
    if (err instanceof CancelledError) {
      await publishProgress(jobId, {
        type: 'cancelled',
        cancelledAt: err.checkpoint,
      });
      return jsonResponse(
        request,
        { cancelled: true, checkpoint: err.checkpoint, jobId },
        { status: 499 },
      );
    }
    console.error('[ANALYZE] Gemini error:', err.message);
    await publishProgress(jobId, {
      type: 'error',
      error: err.message,
      step: 'video-analysis',
    });
    return jsonResponse(request, {
      jobId,
      videos: Object.values(cached),
      aggregated: null,
      fallback: true,
      error: err.message,
      message: 'Gemini 분석에 실패했습니다. 벤치마킹 없이 진행합니다.',
    }, { status: 200 });
  } finally {
    await cleanupJob(jobId);
  }
}

/**
 * 캐시 적중만으로 응답해야 할 때 aggregated 재계산 헬퍼.
 * Gemini 재호출 없이 단순 통계만 산출 (정확도는 낮지만 폴백 용도).
 */
async function computeAggregated(videos) {
  if (!videos.length) return null;

  const pickDominant = (arr) => {
    const counts = {};
    for (const v of arr) counts[v] = (counts[v] || 0) + 1;
    return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  };

  const avg = (nums) => nums.reduce((a, b) => a + b, 0) / (nums.length || 1);

  return {
    dominantHookType: pickDominant(videos.map((v) => v.hook?.type).filter(Boolean)),
    dominantBodyStructure: pickDominant(videos.map((v) => v.body?.structure).filter(Boolean)),
    dominantTone: pickDominant(videos.map((v) => v.body?.tone).filter(Boolean)),
    averageDuration: Math.round(avg(videos.map((v) => v.duration || 0))),
    personPresenceMode: pickDominant(videos.map((v) => v.body?.personPresence).filter(Boolean)),
    recommendedSubtitlePosition: pickDominant(videos.map((v) => v.visualStyle?.subtitlePosition).filter(Boolean)),
    commonCTAType: pickDominant(videos.map((v) => v.cta?.type).filter(Boolean)),
    captionPattern: {
      averageLength: Math.round(avg(videos.map((v) => v.caption?.totalLength || 0))),
      dominantStructure: pickDominant(videos.map((v) => v.caption?.structure).filter(Boolean)),
      averageHashtagCount: Math.round(avg(videos.map((v) => v.caption?.hashtagCount || 0))),
      commonHashtags: [],
    },
    recommendedPreset: '친근', // 캐시 폴백 시 기본값
    advice: '캐시된 분석 결과로 집계한 패턴입니다.',
  };
}
