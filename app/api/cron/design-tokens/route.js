/**
 * GET /api/cron/design-tokens
 *
 * 매주 1회 자동으로 주요 카테고리 10종의 디자인 토큰을 선제 갱신.
 * Vercel Cron 또는 Railway Cron에서 호출.
 *
 * 플로우:
 *   카테고리별 대표 키워드 → YouTube 검색 (상위 5개)
 *   → Gemini 멀티모달 분석 (designMeta 추출)
 *   → aggregateDesignTokens → saveDesignTokens
 *
 * 인증: Authorization: Bearer <CRON_SECRET>
 * 순차 처리 (Gemini 할당량 초과 방지)
 * 카테고리당 15~30초 → 전체 3~5분
 */
import { benchmarkSearch } from '@/lib/youtube-search';
import { getGenkit, resolveProModel } from '@/lib/gemini-vertex';
import { AnalysisOutputSchema } from '@/lib/benchmark-schemas';
import {
  aggregateDesignTokens,
  saveDesignTokens,
} from '@/lib/shortform/design-tokens';
import { getRedis } from '@/lib/api-helpers';

export const maxDuration = 300;

const CATEGORY_KEYWORDS = {
  business: '1인 사업 마케팅 전략',
  marketing: 'SNS 마케팅 숏폼',
  beauty: '뷰티 메이크업 튜토리얼',
  health: '건강 운동 다이어트',
  education: '공부법 자격증 준비',
  food: '요리 레시피 맛집',
  travel: '여행 추천 코스',
  tech: 'IT 기술 개발자',
  finance: '재테크 투자 절약',
  lifestyle: '일상 브이로그 루틴',
};

/** analyze/route.js와 동일한 프롬프트 (designMeta 추출 전용) */
const ANALYSIS_PROMPT = `당신은 한국어 YouTube 숏폼 영상 분석 전문가입니다.
첨부된 숏폼 영상을 멀티모달로(영상 + 음성 + 자막) 깊게 분석하여
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

const ANALYZE_CACHE_TTL = 30 * 86400; // 30일

/**
 * 단일 카테고리 처리: YouTube 검색 → Gemini 분석 → 디자인 토큰 저장
 */
async function processCategory(category, keyword) {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) throw new Error('YOUTUBE_API_KEY 환경변수 없음');

  // 1. YouTube 검색 — 대표 키워드 1개를 쿼리 배열로 전달
  const queries = [keyword];
  const { videos } = await benchmarkSearch(queries, apiKey, {
    contentType: 'shortform',
  });

  if (!videos || videos.length === 0) {
    return { status: 'skip', message: '검색 결과 없음' };
  }

  // 상위 5개 (benchmarkSearch가 이미 5개로 제한)
  const topVideos = videos.slice(0, 5);
  const videoUrls = topVideos.map(
    (v) => `https://youtube.com/shorts/${v.videoId}`
  );

  // 2. 캐시 확인 — 이미 분석된 영상 건너뛰기
  const redis = getRedis();
  const cached = {};
  const uncachedUrls = [];

  for (const v of topVideos) {
    try {
      const stored = await redis.get(`bench:analyze:${v.videoId}`);
      if (stored) {
        cached[v.videoId] = stored;
        continue;
      }
    } catch {}
    uncachedUrls.push(`https://youtube.com/shorts/${v.videoId}`);
  }

  let allAnalyzed = Object.values(cached);

  // 3. 미분석 영상이 있으면 Gemini 호출
  if (uncachedUrls.length > 0) {
    const ai = getGenkit();
    const response = await ai.generate({
      model: resolveProModel(),
      prompt: [
        { text: ANALYSIS_PROMPT },
        ...uncachedUrls.map((url) => ({
          media: { url, contentType: 'video/*' },
        })),
      ],
      output: { schema: AnalysisOutputSchema },
      config: {
        temperature: 0.2,
        thinkingConfig: { thinkingBudget: 8000 },
      },
    });

    const output = response.output;
    if (!output || !output.videos?.length) {
      if (allAnalyzed.length === 0) {
        return { status: 'error', message: 'Gemini 응답 파싱 실패' };
      }
      // 캐시된 것만으로 진행
    } else {
      // 영상별 캐시 저장
      for (const v of output.videos) {
        try {
          await redis.set(`bench:analyze:${v.videoId}`, v, {
            ex: ANALYZE_CACHE_TTL,
          });
        } catch {}
      }
      allAnalyzed = [...allAnalyzed, ...output.videos];
    }
  }

  if (allAnalyzed.length === 0) {
    return { status: 'skip', message: '분석 결과 없음' };
  }

  // 4. 디자인 토큰 집계 + 저장
  const designTokens = aggregateDesignTokens(allAnalyzed);
  await saveDesignTokens(category, designTokens);

  return {
    status: 'ok',
    sampleCount: designTokens.sampleCount,
    fromCache: Object.keys(cached).length,
    fromGemini: allAnalyzed.length - Object.keys(cached).length,
  };
}

export async function GET(request) {
  // CRON_SECRET 검증
  const authHeader = request.headers.get('authorization');
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (!process.env.CRON_SECRET || authHeader !== expected) {
    return new Response('Unauthorized', { status: 401 });
  }

  const results = {};
  const categories = Object.entries(CATEGORY_KEYWORDS);

  // 순차 처리 (Gemini 할당량 초과 방지)
  for (const [category, keyword] of categories) {
    try {
      console.log(`[cron/design-tokens] Processing: ${category} (${keyword})`);
      results[category] = await processCategory(category, keyword);
      console.log(
        `[cron/design-tokens] Done: ${category} →`,
        results[category].status
      );
    } catch (err) {
      console.error(
        `[cron/design-tokens] Error for ${category}:`,
        err.message
      );
      results[category] = { status: 'error', message: err.message };
    }
  }

  const okCount = Object.values(results).filter(
    (r) => r.status === 'ok'
  ).length;

  return Response.json({
    results,
    summary: {
      total: categories.length,
      ok: okCount,
      errors: categories.length - okCount,
    },
    updatedAt: new Date().toISOString(),
  });
}
