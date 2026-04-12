import {
  getRedis,
  resolveAdmin,
  extractToken,
  resolveSessionEmail,
  jsonResponse,
  handleOptions,
} from '@/lib/api-helpers';

export const maxDuration = 30;

const YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3';
const CACHE_TTL_SEC = 86400; // 24시간
const MAX_SEARCH_RESULTS = 50;
const TARGET_VIDEOS = 5;
const MIN_VIEW_TO_SUB_RATIO = 10;

async function youtubeSearch(keyword, apiKey) {
  const params = new URLSearchParams({
    part: 'snippet',
    q: keyword,
    type: 'video',
    videoDuration: 'short',
    order: 'viewCount',
    maxResults: String(MAX_SEARCH_RESULTS),
    relevanceLanguage: 'ko',
    key: apiKey,
  });

  const res = await fetch(`${YOUTUBE_API_BASE}/search?${params}`);
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`YouTube search failed: ${res.status} ${err.slice(0, 200)}`);
  }
  const data = await res.json();
  return (data.items || []).map((item) => ({
    videoId: item.id?.videoId,
    title: item.snippet?.title || '',
    channelId: item.snippet?.channelId,
    channelTitle: item.snippet?.channelTitle || '',
    publishedAt: item.snippet?.publishedAt,
    thumbnail: item.snippet?.thumbnails?.high?.url || '',
  })).filter((v) => v.videoId);
}

async function getVideoStats(videoIds, apiKey) {
  if (!videoIds.length) return {};
  const params = new URLSearchParams({
    part: 'statistics,contentDetails',
    id: videoIds.join(','),
    key: apiKey,
  });

  const res = await fetch(`${YOUTUBE_API_BASE}/videos?${params}`);
  if (!res.ok) return {};
  const data = await res.json();

  const stats = {};
  for (const item of (data.items || [])) {
    stats[item.id] = {
      viewCount: parseInt(item.statistics?.viewCount || '0', 10),
      likeCount: parseInt(item.statistics?.likeCount || '0', 10),
      commentCount: parseInt(item.statistics?.commentCount || '0', 10),
      duration: item.contentDetails?.duration || '',
    };
  }
  return stats;
}

async function getChannelStats(channelIds, apiKey) {
  if (!channelIds.length) return {};
  const unique = [...new Set(channelIds)];
  const params = new URLSearchParams({
    part: 'statistics',
    id: unique.join(','),
    key: apiKey,
  });

  const res = await fetch(`${YOUTUBE_API_BASE}/channels?${params}`);
  if (!res.ok) return {};
  const data = await res.json();

  const stats = {};
  for (const item of (data.items || [])) {
    stats[item.id] = {
      subscriberCount: parseInt(item.statistics?.subscriberCount || '0', 10),
    };
  }
  return stats;
}

function parseDuration(iso) {
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 0;
  return (parseInt(match[1] || '0', 10) * 3600) +
         (parseInt(match[2] || '0', 10) * 60) +
         (parseInt(match[3] || '0', 10));
}

async function analyzePatterns(videos, keyword) {
  const videoDescriptions = videos.map((v, i) =>
    `[영상 ${i + 1}] 제목: "${v.title}" | 채널: ${v.channelTitle} (구독자 ${v.subscriberCount.toLocaleString()}) | 조회수: ${v.viewCount.toLocaleString()} | 조회수/구독자 비율: ${v.viewToSubRatio.toFixed(1)}배`
  ).join('\n');

  const prompt = `당신은 숏폼 영상 분석 전문가입니다. 아래는 "${keyword}" 키워드로 검색한 YouTube 숏폼 중 구독자 대비 조회수가 높은 바이럴 영상들입니다.

${videoDescriptions}

이 영상들의 공통 패턴을 분석하여 아래 JSON 형식으로만 응답하세요. 설명 없이 JSON만.

{
  "hookType": "질문형|충격형|비밀형|증거형|공감형|경고형|리스트형|실수지적형|변신형|FOMO형 중 가장 많이 사용된 유형",
  "hookPattern": "후킹 패턴 설명 (예: 숫자+결과 제시로 시작)",
  "structure": "대본 구조 (예: hook→problem→solution→cta)",
  "visualStyle": "비주얼 스타일 (예: B-roll 중심, 텍스트 오버레이, 빠른 컷 전환)",
  "avgDurationSec": 예상 평균 영상 길이(초),
  "viralFormula": "이 키워드에서 조회수를 터뜨리는 공식 요약 (1~2문장)",
  "suggestedHook": "이 키워드로 만들 숏폼의 추천 첫 문장 (한국어)"
}`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!res.ok) {
    console.error('[BENCHMARK] Claude API failed:', res.status);
    return null;
  }

  const data = await res.json();
  const text = data?.content?.[0]?.text || '';
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    return jsonMatch ? JSON.parse(jsonMatch[0]) : null;
  } catch {
    console.error('[BENCHMARK] JSON parse failed:', text.slice(0, 200));
    return null;
  }
}

export async function OPTIONS(request) {
  return handleOptions(request);
}

export async function POST(request) {
  const isAdmin = await resolveAdmin(request);
  const token = extractToken(request);
  const email = await resolveSessionEmail(token);
  if (!isAdmin && !email) {
    return jsonResponse(request, { error: '로그인이 필요합니다.' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const { keyword } = body;
  if (!keyword || typeof keyword !== 'string' || keyword.trim().length < 2) {
    return jsonResponse(request, { error: '키워드를 2자 이상 입력해주세요.' }, { status: 400 });
  }

  const cleanKeyword = keyword.trim().slice(0, 100);
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    return jsonResponse(request, { error: 'YouTube API가 설정되지 않았습니다.' }, { status: 500 });
  }

  const cacheKey = `benchmark:${cleanKeyword}`;
  try {
    const cached = await getRedis().get(cacheKey);
    if (cached) {
      console.log(`[BENCHMARK] Cache hit: "${cleanKeyword}"`);
      return jsonResponse(request, { ...cached, cached: true });
    }
  } catch (e) {
    console.warn('[BENCHMARK] Cache read failed:', e.message);
  }

  try {
    console.log(`[BENCHMARK] Searching: "${cleanKeyword}"`);
    const searchResults = await youtubeSearch(cleanKeyword, apiKey);
    if (searchResults.length === 0) {
      return jsonResponse(request, { videos: [], patterns: null, fallback: true, message: '검색 결과가 없어 내장 후킹 공식으로 진행합니다.' });
    }

    const videoIds = searchResults.map((v) => v.videoId);
    const videoStats = await getVideoStats(videoIds, apiKey);

    const channelIds = searchResults.map((v) => v.channelId).filter(Boolean);
    const channelStats = await getChannelStats(channelIds, apiKey);

    const enriched = searchResults
      .map((v) => {
        const vs = videoStats[v.videoId] || {};
        const cs = channelStats[v.channelId] || {};
        const durationSec = parseDuration(vs.duration || '');
        const viewCount = vs.viewCount || 0;
        const subscriberCount = cs.subscriberCount || 1;
        const viewToSubRatio = subscriberCount > 0 ? viewCount / subscriberCount : 0;

        return {
          ...v,
          url: `https://youtube.com/shorts/${v.videoId}`,
          viewCount,
          likeCount: vs.likeCount || 0,
          commentCount: vs.commentCount || 0,
          subscriberCount,
          durationSec,
          viewToSubRatio,
        };
      })
      .filter((v) => v.durationSec > 0 && v.durationSec <= 90)
      .filter((v) => v.viewToSubRatio >= MIN_VIEW_TO_SUB_RATIO)
      .sort((a, b) => b.viewToSubRatio - a.viewToSubRatio)
      .slice(0, TARGET_VIDEOS);

    if (enriched.length === 0) {
      const relaxed = searchResults
        .map((v) => {
          const vs = videoStats[v.videoId] || {};
          const cs = channelStats[v.channelId] || {};
          const durationSec = parseDuration(vs.duration || '');
          return {
            ...v,
            url: `https://youtube.com/shorts/${v.videoId}`,
            viewCount: vs.viewCount || 0,
            subscriberCount: cs.subscriberCount || 1,
            durationSec,
            viewToSubRatio: (cs.subscriberCount || 1) > 0 ? (vs.viewCount || 0) / (cs.subscriberCount || 1) : 0,
          };
        })
        .filter((v) => v.durationSec > 0 && v.durationSec <= 90)
        .sort((a, b) => b.viewCount - a.viewCount)
        .slice(0, TARGET_VIDEOS);

      if (relaxed.length === 0) {
        return jsonResponse(request, { videos: [], patterns: null, fallback: true, message: '숏폼 영상을 찾지 못해 내장 후킹 공식으로 진행합니다.' });
      }

      const patterns = await analyzePatterns(relaxed, cleanKeyword);
      const result = { keyword: cleanKeyword, videos: relaxed, patterns, fallback: false };

      try { await getRedis().set(cacheKey, result, { ex: CACHE_TTL_SEC }); } catch {}

      return jsonResponse(request, result);
    }

    const patterns = await analyzePatterns(enriched, cleanKeyword);

    const result = {
      keyword: cleanKeyword,
      videos: enriched,
      patterns,
      fallback: false,
    };

    try {
      await getRedis().set(cacheKey, result, { ex: CACHE_TTL_SEC });
      console.log(`[BENCHMARK] Cached: "${cleanKeyword}" (${enriched.length} videos)`);
    } catch (e) {
      console.warn('[BENCHMARK] Cache write failed:', e.message);
    }

    return jsonResponse(request, result);
  } catch (error) {
    console.error('[BENCHMARK] Error:', error.message);
    return jsonResponse(request, {
      keyword: cleanKeyword,
      videos: [],
      patterns: null,
      fallback: true,
      message: '벤치마킹에 실패했습니다. 내장 후킹 공식으로 진행합니다.',
    });
  }
}
