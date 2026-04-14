/**
 * YouTube Data API v3 병렬 검색 + 필터 헬퍼
 *
 * 5쿼리 병렬 → dedupe → videos.list + channels.list 배치 호출 → 필터 → 정렬
 * 스펙 §4 Step 2 + §10 쿼터 관리 참고.
 */

const YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3';

// 필터 임계값 (스펙 §4 Step 2)
export const MIN_VIEW_TO_SUB_RATIO = 5; // 기존 10 → 5로 완화
export const MIN_VIEW_COUNT = 10000;
export const MAX_DURATION_SEC = 90;
export const MAX_MONTHS_AGO = 12;
export const TARGET_VIDEOS = 5;
export const SEARCH_RESULTS_PER_QUERY = 50;

// v2.1: 롱폼 벤치마크 임계값
export const LONGFORM_MIN_DURATION_SEC = 180;  // 3분
export const LONGFORM_MAX_DURATION_SEC = 1200; // 20분 (medium 상한)

/**
 * 단일 쿼리로 YouTube 검색 (search.list).
 * @param {object} opts { contentType: 'shortform'|'longform' }
 */
async function searchQuery(q, apiKey, opts = {}) {
  const publishedAfter = new Date();
  publishedAfter.setMonth(publishedAfter.getMonth() - MAX_MONTHS_AGO);

  const contentType = opts.contentType || 'shortform';
  // shortform: short (≤4분), longform: medium (4~20분) — YouTube API 정의
  const videoDuration = contentType === 'longform' ? 'medium' : 'short';

  const params = new URLSearchParams({
    part: 'snippet',
    q,
    type: 'video',
    videoDuration,
    videoCaption: 'closedCaption',
    order: 'viewCount',
    maxResults: String(SEARCH_RESULTS_PER_QUERY),
    relevanceLanguage: 'ko',
    regionCode: 'KR',
    publishedAfter: publishedAfter.toISOString(),
    key: apiKey,
  });

  const res = await fetch(`${YOUTUBE_API_BASE}/search?${params}`);
  if (!res.ok) {
    const text = await res.text();
    console.warn(`[youtube-search] search.list failed for "${q}":`, res.status, text.slice(0, 200));
    return [];
  }
  const data = await res.json();
  return (data.items || []).map((item) => ({
    videoId: item.id?.videoId,
    title: item.snippet?.title || '',
    channelId: item.snippet?.channelId,
    channelTitle: item.snippet?.channelTitle || '',
    publishedAt: item.snippet?.publishedAt,
    thumbnail: item.snippet?.thumbnails?.high?.url || '',
    sourceQuery: q,
  })).filter((v) => v.videoId);
}

/**
 * 5개 쿼리를 병렬 검색 + dedupe.
 * @param {object} opts { contentType }
 */
export async function parallelSearch(queries, apiKey, opts = {}) {
  if (!queries.length) return [];
  const results = await Promise.all(queries.map((q) => searchQuery(q, apiKey, opts)));
  const seen = new Set();
  const unique = [];
  for (const list of results) {
    for (const item of list) {
      if (seen.has(item.videoId)) continue;
      seen.add(item.videoId);
      unique.push(item);
    }
  }
  return unique;
}

/**
 * videos.list — 최대 50개씩 배치.
 */
export async function getVideoStats(videoIds, apiKey) {
  if (!videoIds.length) return {};
  const stats = {};
  for (let i = 0; i < videoIds.length; i += 50) {
    const batch = videoIds.slice(i, i + 50);
    const params = new URLSearchParams({
      part: 'statistics,contentDetails',
      id: batch.join(','),
      key: apiKey,
    });
    const res = await fetch(`${YOUTUBE_API_BASE}/videos?${params}`);
    if (!res.ok) continue;
    const data = await res.json();
    for (const item of (data.items || [])) {
      stats[item.id] = {
        viewCount: parseInt(item.statistics?.viewCount || '0', 10),
        likeCount: parseInt(item.statistics?.likeCount || '0', 10),
        commentCount: parseInt(item.statistics?.commentCount || '0', 10),
        duration: item.contentDetails?.duration || '',
      };
    }
  }
  return stats;
}

/**
 * channels.list — dedupe 후 최대 50개씩 배치.
 */
export async function getChannelStats(channelIds, apiKey) {
  if (!channelIds.length) return {};
  const unique = [...new Set(channelIds)];
  const stats = {};
  for (let i = 0; i < unique.length; i += 50) {
    const batch = unique.slice(i, i + 50);
    const params = new URLSearchParams({
      part: 'statistics',
      id: batch.join(','),
      key: apiKey,
    });
    const res = await fetch(`${YOUTUBE_API_BASE}/channels?${params}`);
    if (!res.ok) continue;
    const data = await res.json();
    for (const item of (data.items || [])) {
      stats[item.id] = {
        subscriberCount: parseInt(item.statistics?.subscriberCount || '0', 10),
      };
    }
  }
  return stats;
}

/**
 * ISO 8601 기간 → 초.
 */
export function parseDuration(iso) {
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 0;
  return (parseInt(match[1] || '0', 10) * 3600) +
         (parseInt(match[2] || '0', 10) * 60) +
         (parseInt(match[3] || '0', 10));
}

/**
 * 필터 + 정렬 + 상위 5개 추출.
 * @param {object} opts { relaxed, contentType }
 */
export function filterAndRank(searchResults, videoStats, channelStats, { relaxed = false, contentType = 'shortform' } = {}) {
  const isLongform = contentType === 'longform';
  const minDuration = isLongform ? LONGFORM_MIN_DURATION_SEC : 1;
  const maxDuration = isLongform ? LONGFORM_MAX_DURATION_SEC : MAX_DURATION_SEC;

  const enriched = searchResults.map((v) => {
    const vs = videoStats[v.videoId] || {};
    const cs = channelStats[v.channelId] || {};
    const durationSec = parseDuration(vs.duration || '');
    const viewCount = vs.viewCount || 0;
    const subscriberCount = cs.subscriberCount || 1;
    const viewToSubRatio = subscriberCount > 0 ? viewCount / subscriberCount : 0;
    return {
      ...v,
      url: isLongform
        ? `https://youtube.com/watch?v=${v.videoId}`
        : `https://youtube.com/shorts/${v.videoId}`,
      viewCount,
      likeCount: vs.likeCount || 0,
      commentCount: vs.commentCount || 0,
      subscriberCount,
      durationSec,
      viewToSubRatio,
    };
  });

  const passed = enriched.filter((v) => {
    if (v.durationSec < minDuration || v.durationSec > maxDuration) return false;
    if (relaxed) return true; // 완화 모드에서는 뷰/비율 필터 생략
    if (v.viewCount < MIN_VIEW_COUNT) return false;
    if (v.viewToSubRatio < MIN_VIEW_TO_SUB_RATIO) return false;
    return true;
  });

  return passed
    .sort((a, b) => b.viewToSubRatio - a.viewToSubRatio)
    .slice(0, TARGET_VIDEOS);
}

/**
 * 통합 검색 플로우 — route.js에서 직접 사용.
 * @param {object} opts { contentType: 'shortform'|'longform' }
 */
export async function benchmarkSearch(queries, apiKey, opts = {}) {
  const contentType = opts.contentType || 'shortform';
  const isLongform = contentType === 'longform';
  const minDuration = isLongform ? LONGFORM_MIN_DURATION_SEC : 1;
  const maxDuration = isLongform ? LONGFORM_MAX_DURATION_SEC : MAX_DURATION_SEC;

  const unique = await parallelSearch(queries, apiKey, { contentType });
  if (!unique.length) return { videos: [], relaxed: false };

  const videoIds = unique.map((v) => v.videoId);
  const channelIds = unique.map((v) => v.channelId).filter(Boolean);

  const [videoStats, channelStats] = await Promise.all([
    getVideoStats(videoIds, apiKey),
    getChannelStats(channelIds, apiKey),
  ]);

  const strict = filterAndRank(unique, videoStats, channelStats, { relaxed: false, contentType });
  if (strict.length >= 1) return { videos: strict, relaxed: false };

  // 결과 부족 시 필터 완화 (viewCount 정렬)
  const relaxed = unique.map((v) => {
    const vs = videoStats[v.videoId] || {};
    const cs = channelStats[v.channelId] || {};
    const durationSec = parseDuration(vs.duration || '');
    return {
      ...v,
      url: isLongform
        ? `https://youtube.com/watch?v=${v.videoId}`
        : `https://youtube.com/shorts/${v.videoId}`,
      viewCount: vs.viewCount || 0,
      likeCount: vs.likeCount || 0,
      commentCount: vs.commentCount || 0,
      subscriberCount: cs.subscriberCount || 1,
      durationSec,
      viewToSubRatio: (cs.subscriberCount || 1) > 0
        ? (vs.viewCount || 0) / (cs.subscriberCount || 1)
        : 0,
    };
  })
  .filter((v) => v.durationSec >= minDuration && v.durationSec <= maxDuration)
  .sort((a, b) => b.viewCount - a.viewCount)
  .slice(0, TARGET_VIDEOS);

  return { videos: relaxed, relaxed: true };
}
