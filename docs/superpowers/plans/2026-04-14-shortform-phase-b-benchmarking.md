# Phase B — Benchmarking: Genkit 파이프라인 + Gemini 2.5 Pro

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. 12 Phase 중 Phase B. 마스터 플랜: `2026-04-14-shortform-master-plan.md`. 스펙: `2026-04-14-shortform-benchmark-pipeline-design.md`.

**Goal:** 기존 `/api/shortform-benchmark/route.js`을 Firebase Genkit 기반 파이프라인으로 리팩토링한다. 단일 키워드 → 5개 쿼리 확장 + 병렬 검색 + Gemini 2.5 Pro 사고(thinking) 모드 영상 분석을 추가한다. 현재의 Claude Sonnet 기반 간이 패턴 추출을 Vertex AI Gemini Pro thinking으로 교체해 스펙 §5 JSON Schema를 엄격히 생성한다.

**Architecture:**

```
[ POST /api/shortform-benchmark ]                    ← enhance (기존 파일)
        │
        ├── keyword-expansion.js (Genkit + gemini-2.5-flash)
        │       input: { blogText, keywords }
        │       output: { mainKeywords, relatedKeywords, searchQueries[5] }
        │
        ├── youtube-search.js (5쿼리 병렬 + dedupe + 필터)
        │       필터: ko, ≤90s, ≥10K views, viewToSub ≥5, ≤12개월, captions
        │       → videos[5] (viewToSub 내림차순)
        │
        └── cache: bench:cache:{sha256(blogText+keywords)} (7d)

[ POST /api/shortform-benchmark/analyze ]            ← 신규
        │
        ├── gemini-vertex.js (Genkit + gemini-2.5-pro thinking)
        │       input: videoUrls[1~3]
        │       output: 스펙 §5 JSON (Zod 검증)
        │
        └── cache: bench:analyze:{videoId} (30d)
```

**Tech Stack:**
- Firebase Genkit (`genkit`, `@genkit-ai/vertexai`) — Phase A0에서 선설치됨
- Vertex AI: `gemini-2.5-flash` (키워드 확장), `gemini-2.5-pro` (영상 분석 + 사고 모드)
- YouTube Data API v3
- Zod — Genkit input/output 스키마 검증
- Upstash Redis (`getRedis()`) — 캐시 저장소

**의존성:** Phase A (Genkit 패키지 선설치 완료)

**예상 작업량:** 10 task, 약 1.5 주

**테스트 전략:** 프로젝트에 테스트 프레임워크 없음 → **수동 검증**(curl 호출 + 응답 JSON 확인). 각 task의 "Steps" 마지막에 curl 명령을 포함.

---

## 파일 구조

### 신규 파일

```
lib/gemini-vertex.js                              Genkit + Vertex AI 싱글톤 + 공용 generate helper
lib/keyword-expansion.js                          Gemini Flash 키워드 확장 Flow
lib/youtube-search.js                             YouTube API 병렬 검색/필터 유틸
lib/benchmark-schemas.js                          Zod 스키마 (키워드/분석 I/O) 중앙화
app/api/shortform-benchmark/analyze/route.js      신규 엔드포인트 (Gemini 영상 분석)
```

### 수정 파일

```
app/api/shortform-benchmark/route.js              Claude 제거 → Genkit 파이프라인으로 교체
```

### 환경 변수 (이미 마스터 플랜에 정의됨)

```
GOOGLE_CLOUD_PROJECT=ddukddaktool-XXXXX
VERTEX_AI_LOCATION=us-central1
GEMINI_VERTEX_MODEL=gemini-2.5-pro
YOUTUBE_API_KEY=AIza...                  (기존)
```

Vercel Serverless 환경에서 `GOOGLE_APPLICATION_CREDENTIALS` 대신 **Workload Identity Federation** 또는 **서비스 계정 JSON의 base64 인코딩**을 사용. Task B1에서 상세 다룸.

---

## Task B1: Vertex AI 인증 + Genkit 싱글톤 (`lib/gemini-vertex.js`)

Genkit 인스턴스를 프로세스 단위 싱글톤으로 유지하고, Vertex AI 플러그인을 통해 `gemini-2.5-flash` / `gemini-2.5-pro` 모델에 접근할 수 있게 한다. Vercel 서버리스 환경의 cold start에서도 재사용 가능한 lazy 초기화 패턴.

**Files:**
- Create: `lib/gemini-vertex.js`

- [ ] **Step 1: 환경 변수 사전 확인**

```bash
cd /Users/gong-eunhui/Desktop/naver-title-generator
node -e "['GOOGLE_CLOUD_PROJECT','VERTEX_AI_LOCATION','GEMINI_VERTEX_MODEL','GOOGLE_SERVICE_ACCOUNT_KEY'].forEach(k => console.log(k, process.env[k] ? 'OK' : 'MISSING'))"
```

Expected: 4개 중 `GOOGLE_SERVICE_ACCOUNT_KEY`가 MISSING이면 운영자가 Vercel에 서비스 계정 JSON을 base64로 등록해야 함. 로컬 개발에서는 `gcloud auth application-default login`으로 대체 가능.

- [ ] **Step 2: `lib/gemini-vertex.js` 작성**

```javascript
/**
 * Firebase Genkit + Vertex AI 싱글톤
 *
 * Vercel Serverless 환경에서 cold start 시 1회 초기화 후 재사용.
 * 서비스 계정 인증은 GOOGLE_SERVICE_ACCOUNT_KEY (base64 인코딩된 JSON) 사용.
 * 로컬 개발에서는 ADC(Application Default Credentials) 자동 fallback.
 */
import { genkit } from 'genkit';
import { vertexAI, gemini25Pro, gemini25Flash } from '@genkit-ai/vertexai';

let _ai = null;

/**
 * 서비스 계정 키를 런타임 임시 파일로 디코드.
 * GOOGLE_APPLICATION_CREDENTIALS 대신 환경변수로 키를 주입할 때 사용.
 */
function setupCredentials() {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) return; // 이미 설정됨
  const b64 = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!b64) return; // ADC fallback (로컬 gcloud)

  // Vercel 서버리스는 /tmp 쓰기 가능
  try {
    const fs = require('fs');
    const path = require('path');
    const tmpPath = path.join('/tmp', 'gcp-sa-key.json');
    if (!fs.existsSync(tmpPath)) {
      const json = Buffer.from(b64, 'base64').toString('utf-8');
      fs.writeFileSync(tmpPath, json, 'utf-8');
    }
    process.env.GOOGLE_APPLICATION_CREDENTIALS = tmpPath;
  } catch (err) {
    console.error('[gemini-vertex] Failed to set credentials:', err.message);
  }
}

/**
 * Genkit 싱글톤 획득. 최초 호출 시 Vertex AI 플러그인 초기화.
 */
export function getGenkit() {
  if (_ai) return _ai;

  setupCredentials();

  const projectId = process.env.GOOGLE_CLOUD_PROJECT;
  const location = process.env.VERTEX_AI_LOCATION || 'us-central1';

  if (!projectId) {
    throw new Error('GOOGLE_CLOUD_PROJECT 환경 변수가 설정되지 않았습니다.');
  }

  _ai = genkit({
    plugins: [
      vertexAI({ projectId, location }),
    ],
  });

  return _ai;
}

/**
 * 공용 참조 — Task B2/B5에서 import 해서 사용.
 */
export { gemini25Pro, gemini25Flash };

/**
 * 모델 ID 환경변수 override — 스펙 §11 "모델 ID는 구현 단계에서 확정"에 대응.
 * 실제로는 gemini25Pro / gemini25Flash 참조를 사용하지만, 향후 gemini-3.0-pro 출시 시
 * 코드 변경 없이 환경변수로 전환 가능하도록 헬퍼 제공.
 */
export function resolveProModel() {
  const override = process.env.GEMINI_VERTEX_MODEL;
  if (override && override !== 'gemini-2.5-pro') {
    // 문자열 모델 ID로 override — Genkit는 string model ID도 허용
    return `vertexai/${override}`;
  }
  return gemini25Pro;
}

export function resolveFlashModel() {
  const override = process.env.GEMINI_VERTEX_FLASH_MODEL;
  if (override && override !== 'gemini-2.5-flash') {
    return `vertexai/${override}`;
  }
  return gemini25Flash;
}
```

- [ ] **Step 3: 빌드 체크**

```bash
cd /Users/gong-eunhui/Desktop/naver-title-generator && npx next build 2>&1 | grep -iE "error|✓ Compiled" | head -10
```

Expected: `✓ Compiled successfully`. Genkit import 실패 시 Phase A0에서 `npm install`이 정상 수행됐는지 확인.

- [ ] **Step 4: 수동 검증 — 초기화 smoke test**

```bash
cd /Users/gong-eunhui/Desktop/naver-title-generator && node --experimental-vm-modules -e "
import('./lib/gemini-vertex.js').then(async (m) => {
  try {
    const ai = m.getGenkit();
    console.log('Genkit init OK');
    console.log('Pro model:', m.resolveProModel());
    console.log('Flash model:', m.resolveFlashModel());
  } catch (err) {
    console.error('Init failed:', err.message);
  }
});
"
```

Expected: `Genkit init OK` + 두 모델 참조 출력. `GOOGLE_CLOUD_PROJECT missing` 에러가 뜨면 `.env.local`에 추가.

- [ ] **Step 5: 커밋**

```bash
git add lib/gemini-vertex.js
git commit -m "$(cat <<'EOF'
feat(lib): Genkit + Vertex AI 싱글톤 헬퍼

gemini-2.5-pro/flash 모델 참조를 lib/gemini-vertex.js로 중앙화.
Vercel 서버리스 환경 cold start에서 lazy 초기화 + GOOGLE_SERVICE_ACCOUNT_KEY
base64 디코딩 지원. resolveProModel/resolveFlashModel 헬퍼로 향후 모델 ID
변경 시 코드 수정 없이 환경변수 override 가능.

Phase B의 키워드 확장(B2) / 영상 분석(B5) 모두 이 파일을 import.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task B2: 키워드 확장 Flow (`lib/keyword-expansion.js`)

블로그 글 또는 사용자 키워드 입력을 받아 **5개 YouTube 검색 쿼리**를 생성한다. Gemini 2.5 Flash는 단순 텍스트 작업이므로 빠르고 저렴. Genkit `defineFlow` + Zod 스키마로 타입 안전한 호출을 보장.

**Files:**
- Create: `lib/keyword-expansion.js`

- [ ] **Step 1: Flow 작성**

```javascript
/**
 * 키워드 확장 Flow (Genkit + Gemini Flash)
 *
 * 입력: blogText (선택) + keywords (선택, 쉼표 구분) — 최소 하나는 필수
 * 출력: mainKeywords[], relatedKeywords[], searchQueries[5]
 *
 * 5개 검색 쿼리는 메인 + 관련 키워드를 조합해 YouTube 숏폼 검색 커버리지 극대화.
 * 스펙 §4 Step 2 "키워드 확장" 섹션 참고.
 */
import { z } from 'zod';
import { getGenkit, resolveFlashModel } from './gemini-vertex.js';

export const KeywordExpansionInputSchema = z.object({
  blogText: z.string().nullable().optional(),
  keywords: z.string().nullable().optional(),
});

export const KeywordExpansionOutputSchema = z.object({
  mainKeywords: z.array(z.string()).min(1).max(5),
  relatedKeywords: z.array(z.string()).min(3).max(7),
  searchQueries: z.array(z.string()).length(5),
});

/**
 * Flow를 lazy 생성 — genkit 초기화는 런타임 첫 호출 시에만 실행.
 * 모듈 top-level에서 defineFlow를 호출하면 빌드 타임에 Vertex 초기화 시도 → 실패 가능.
 */
let _flow = null;

function buildFlow() {
  if (_flow) return _flow;
  const ai = getGenkit();

  _flow = ai.defineFlow(
    {
      name: 'shortformKeywordExpansion',
      inputSchema: KeywordExpansionInputSchema,
      outputSchema: KeywordExpansionOutputSchema,
    },
    async ({ blogText, keywords }) => {
      const baseText = (blogText || '').slice(0, 4000);
      const userKeywords = (keywords || '').trim();

      if (!baseText && !userKeywords) {
        throw new Error('blogText 또는 keywords 중 하나는 필수입니다.');
      }

      const prompt = `당신은 한국어 YouTube 숏폼 검색 키워드 생성 전문가입니다.
아래 입력을 읽고 검색 쿼리 5개를 생성하세요. 쿼리는 YouTube 검색창에 바로 입력 가능한 형태여야 합니다.

## 블로그 글
${baseText || '(없음)'}

## 사용자 키워드
${userKeywords || '(없음)'}

## 출력 규칙
1. mainKeywords: 글의 핵심 명사 3~5개 (예: "신랑 정장", "웨딩플래너")
2. relatedKeywords: 의미적 인접어/동의어/상위 카테고리 5~7개 (예: "예비 신랑", "결혼식 슈트")
3. searchQueries: 메인 + 관련을 조합해 YouTube 검색 커버리지를 극대화하는 5개 쿼리
   - 중복 최소화, 각 쿼리 2~6단어 이내
   - 검색량 많은 표현 우선 (예: "신랑 정장 추천" > "신랑이 고를만한 정장")
4. 모두 순수 한국어, 이모지·특수문자·해시태그 금지

반드시 JSON 형식으로만 응답하세요.`;

      const response = await ai.generate({
        model: resolveFlashModel(),
        prompt,
        output: { schema: KeywordExpansionOutputSchema },
        config: { temperature: 0.3 },
      });

      const output = response.output;
      if (!output) {
        throw new Error('Gemini Flash 응답에서 output 파싱 실패');
      }
      return output;
    }
  );

  return _flow;
}

/**
 * 편의 함수 — 외부에서 Flow 직접 호출 없이 사용 가능.
 */
export async function expandKeywords({ blogText, keywords }) {
  const flow = buildFlow();
  return await flow({ blogText, keywords });
}
```

- [ ] **Step 2: 빌드 체크**

```bash
cd /Users/gong-eunhui/Desktop/naver-title-generator && npx next build 2>&1 | grep -iE "error|✓ Compiled" | head -10
```

Expected: 컴파일 성공. Zod 스키마 타입 충돌 에러가 나면 스키마 중 optional/nullable 순서 확인.

- [ ] **Step 3: 수동 검증 — 실제 Gemini 호출 smoke test**

Next.js 서버 실행 상태에서 별도 터미널:

```bash
cd /Users/gong-eunhui/Desktop/naver-title-generator && node --experimental-vm-modules -e "
import('./lib/keyword-expansion.js').then(async (m) => {
  try {
    const result = await m.expandKeywords({
      blogText: null,
      keywords: '웨딩플래너, 신랑정장'
    });
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    console.error('FAIL:', err.message);
  }
});
"
```

Expected:
```json
{
  "mainKeywords": ["웨딩플래너", "신랑 정장"],
  "relatedKeywords": ["예비 신랑", "결혼식 슈트", "남자 정장", ...],
  "searchQueries": [
    "웨딩플래너 신랑 정장",
    "예비 신랑 패션",
    "결혼식 슈트 코디",
    "남자 정장 결혼",
    "봄 결혼식 신랑 룩"
  ]
}
```

- [ ] **Step 4: 커밋**

```bash
git add lib/keyword-expansion.js
git commit -m "$(cat <<'EOF'
feat(lib): 키워드 확장 Flow (Genkit + Gemini Flash)

블로그 글 또는 사용자 키워드 → 메인/관련/YouTube 검색 쿼리 5개 확장.
Zod 스키마로 입출력 검증, 온도 0.3으로 재현성 확보.
스펙 §4 Step 2 "키워드 확장" 커버.

Phase B의 /api/shortform-benchmark 엔드포인트에서 사용.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task B3: YouTube 병렬 검색 헬퍼 (`lib/youtube-search.js`)

5개 쿼리를 동시에 검색하고, dedupe + 필터(5x 비율/10K 뷰/90s/한국어/자막/12개월) 처리 후 viewToSub 내림차순으로 상위 5개를 반환. 기존 `route.js` 안에 있던 helper를 중앙화한다.

**Files:**
- Create: `lib/youtube-search.js`

- [ ] **Step 1: 파일 작성**

```javascript
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

/**
 * 단일 쿼리로 YouTube 검색 (search.list).
 */
async function searchQuery(q, apiKey) {
  const publishedAfter = new Date();
  publishedAfter.setMonth(publishedAfter.getMonth() - MAX_MONTHS_AGO);

  const params = new URLSearchParams({
    part: 'snippet',
    q,
    type: 'video',
    videoDuration: 'short',
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
 */
export async function parallelSearch(queries, apiKey) {
  if (!queries.length) return [];
  const results = await Promise.all(queries.map((q) => searchQuery(q, apiKey)));
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
 */
export function filterAndRank(searchResults, videoStats, channelStats, { relaxed = false } = {}) {
  const enriched = searchResults.map((v) => {
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
  });

  const passed = enriched.filter((v) => {
    if (v.durationSec <= 0 || v.durationSec > MAX_DURATION_SEC) return false;
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
 */
export async function benchmarkSearch(queries, apiKey) {
  const unique = await parallelSearch(queries, apiKey);
  if (!unique.length) return { videos: [], relaxed: false };

  const videoIds = unique.map((v) => v.videoId);
  const channelIds = unique.map((v) => v.channelId).filter(Boolean);

  const [videoStats, channelStats] = await Promise.all([
    getVideoStats(videoIds, apiKey),
    getChannelStats(channelIds, apiKey),
  ]);

  const strict = filterAndRank(unique, videoStats, channelStats, { relaxed: false });
  if (strict.length >= 1) return { videos: strict, relaxed: false };

  // 결과 부족 시 필터 완화 (viewCount 정렬)
  const relaxed = unique.map((v) => {
    const vs = videoStats[v.videoId] || {};
    const cs = channelStats[v.channelId] || {};
    const durationSec = parseDuration(vs.duration || '');
    return {
      ...v,
      url: `https://youtube.com/shorts/${v.videoId}`,
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
  .filter((v) => v.durationSec > 0 && v.durationSec <= MAX_DURATION_SEC)
  .sort((a, b) => b.viewCount - a.viewCount)
  .slice(0, TARGET_VIDEOS);

  return { videos: relaxed, relaxed: true };
}
```

- [ ] **Step 2: 빌드 체크**

```bash
cd /Users/gong-eunhui/Desktop/naver-title-generator && npx next build 2>&1 | grep -iE "error|✓ Compiled" | head -10
```

Expected: 컴파일 성공.

- [ ] **Step 3: 수동 검증 — 실제 YouTube 검색**

```bash
cd /Users/gong-eunhui/Desktop/naver-title-generator && node --experimental-vm-modules -e "
import('./lib/youtube-search.js').then(async (m) => {
  const queries = ['웨딩플래너 후기', '신랑 정장 추천', '결혼식 준비 팁', '예비부부 체크리스트', '봄 결혼식 룩'];
  const result = await m.benchmarkSearch(queries, process.env.YOUTUBE_API_KEY);
  console.log('Total videos:', result.videos.length);
  console.log('Relaxed:', result.relaxed);
  result.videos.forEach((v, i) => {
    console.log(\`[\${i+1}] \${v.title} | view:\${v.viewCount} | sub:\${v.subscriberCount} | ratio:\${v.viewToSubRatio.toFixed(1)}\`);
  });
});
"
```

Expected: 5개 영상 또는 relaxed 모드 표시. 각 영상의 viewToSubRatio가 ≥5(strict) 또는 정렬된 viewCount 순서(relaxed).

- [ ] **Step 4: 커밋**

```bash
git add lib/youtube-search.js
git commit -m "$(cat <<'EOF'
feat(lib): YouTube 병렬 검색 + 필터 유틸

5쿼리 병렬 검색 → dedupe → videos/channels 배치 조회 →
MIN_VIEW_TO_SUB_RATIO=5 (기존 10 → 완화) + 10K view + 90s + 12개월 + 한국어
필터 적용. filterAndRank + benchmarkSearch 헬퍼 export.

결과 0~4건 시 자동으로 relaxed 모드 폴백 (viewCount 정렬).
기존 app/api/shortform-benchmark/route.js의 inline helper를 중앙화.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task B4: 기존 `/api/shortform-benchmark/route.js` enhance

기존 Claude 기반 `analyzePatterns` 호출을 제거하고, Task B2 + B3 모듈로 교체. 이제 이 엔드포인트는 **후보 영상 리스트만** 반환하며, 영상 분석은 Task B5의 별도 `/analyze` 엔드포인트가 담당.

**Files:**
- Modify: `app/api/shortform-benchmark/route.js`

- [ ] **Step 1: 기존 파일 백업 확인**

```bash
cd /Users/gong-eunhui/Desktop/naver-title-generator && git status app/api/shortform-benchmark/route.js
```

Expected: working tree clean. 아니면 `git stash` 후 진행.

- [ ] **Step 2: route.js 전면 재작성**

```javascript
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
```

- [ ] **Step 3: 빌드 체크**

```bash
cd /Users/gong-eunhui/Desktop/naver-title-generator && npx next build 2>&1 | grep -iE "error|✓ Compiled" | head -10
```

Expected: 컴파일 성공. `analyzePatterns` 관련 경고 0건 (제거됐기 때문).

- [ ] **Step 4: 수동 검증 — curl 호출**

```bash
# dev 서버 실행 중이라 가정 (npm run dev)
cd /Users/gong-eunhui/Desktop/naver-title-generator && curl -s -X POST http://localhost:3000/api/shortform-benchmark \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${TEST_SESSION_TOKEN}" \
  -d '{"keywords":"웨딩플래너, 신랑정장"}' | python3 -m json.tool
```

Expected: `candidates` 배열 5개 + `searchKeywords` 5개. `fallback: false`. 재호출 시 `cached: true`.

- [ ] **Step 5: 회귀 검증 — 기존 클라이언트 호환성**

```bash
cd /Users/gong-eunhui/Desktop/naver-title-generator && grep -rn "shortform-benchmark" app/shortform/ components/ --include="*.js"
```

Expected: 기존 호출부 확인. **응답 필드가 `videos` → `candidates`로 바뀌었으므로** 기존 클라이언트가 `result.videos`를 참조하면 깨진다. Phase B에서는 서버 API만 교체하고, 클라이언트 교체는 Phase C/D 작업 시 함께 진행. 이 task의 커밋 메시지에 주의 사항으로 명시.

- [ ] **Step 6: 커밋**

```bash
git add app/api/shortform-benchmark/route.js
git commit -m "$(cat <<'EOF'
refactor(api): shortform-benchmark를 Genkit 파이프라인으로 교체

주요 변경:
- Claude Sonnet analyzePatterns 제거 (→ Task B5 /analyze 엔드포인트로 분리)
- keyword-expansion.js + youtube-search.js 신규 모듈 사용
- 입력 스키마 변경: keyword (단일) → blogText/keywords (스펙 §8)
- 응답 필드명 변경: videos → candidates
- MIN_VIEW_TO_SUB_RATIO 10 → 5 (스펙 §4 Step 2)
- 캐시 키: benchmark:\${keyword} → bench:cache:\${sha256(blogText+keywords)}
- TTL: 24h → 7일 (스펙 §9)

주의: 응답 스키마가 바뀌었으므로 클라이언트 호출부는 Phase C/D에서 같이
교체 필요. 현재 app/shortform/ShortformClient.js가 result.videos를 참조하면
일시적으로 깨질 수 있음.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task B5: 영상 분석 엔드포인트 (`/api/shortform-benchmark/analyze`)

사용자가 선택한 1~3개 YouTube 영상 URL을 받아 **Gemini 2.5 Pro 사고(thinking) 모드**로 멀티모달 분석한다. 스펙 §5 JSON Schema를 엄격히 생성 (Zod validation). 결과는 `bench:analyze:{videoId}` 키로 30일 캐싱.

**Files:**
- Create: `app/api/shortform-benchmark/analyze/route.js`
- Create: `lib/benchmark-schemas.js` (먼저 Task B7에서 작성) — 여기서는 import만

> **순서 주의:** Task B7 (Zod 스키마)을 먼저 작성한 후 B5 구현하는 것이 합리적이지만, 플랜 번호와 구현 순서를 분리. 실제 구현 시 B7 → B5 순으로 진행.

- [ ] **Step 1: route.js 작성 (B7의 스키마를 import)**

```javascript
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
import { AnalysisOutputSchema, VideoAnalysisSchema } from '@/lib/benchmark-schemas';

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

## 절대 규칙
1. 반드시 JSON만 출력. 설명 텍스트 금지.
2. 모든 문자열 필드는 한국어 또는 소문자 영어 enum.
3. 숫자 필드는 실제 영상 분석 결과에 근거 (추측 금지).
4. recommendedPreset은 반드시 6개 enum 중 하나.
5. advice는 "~하세요" 체 (반말 금지).`;

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

  const redis = getRedis();
  const cached = {};
  const missingUrls = [];
  const missingIds = [];

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
    const aggregated = await computeAggregated(Object.values(cached));
    return jsonResponse(request, {
      videos: Object.values(cached),
      aggregated,
      cached: true,
    });
  }

  // Gemini 호출
  try {
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
    const aggregated = output.aggregated && allVideos.length === output.videos.length
      ? output.aggregated
      : await computeAggregated(allVideos);

    return jsonResponse(request, {
      videos: allVideos,
      aggregated,
      cached: Object.keys(cached).length > 0,
      fromCache: Object.keys(cached).length,
      fromGemini: (output.videos || []).length,
    });
  } catch (err) {
    console.error('[ANALYZE] Gemini error:', err.message);
    return jsonResponse(request, {
      videos: Object.values(cached),
      aggregated: null,
      fallback: true,
      error: err.message,
      message: 'Gemini 분석에 실패했습니다. 벤치마킹 없이 진행합니다.',
    }, { status: 200 });
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
```

- [ ] **Step 2: 빌드 체크**

```bash
cd /Users/gong-eunhui/Desktop/naver-title-generator && npx next build 2>&1 | grep -iE "error|✓ Compiled" | head -10
```

Expected: 컴파일 성공. `benchmark-schemas.js` import가 Task B7에서 해결되므로 B7을 먼저 구현한 상태여야 함.

- [ ] **Step 3: 수동 검증 — curl 호출**

```bash
cd /Users/gong-eunhui/Desktop/naver-title-generator && curl -s -X POST http://localhost:3000/api/shortform-benchmark/analyze \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${TEST_SESSION_TOKEN}" \
  -d '{"videoUrls":["https://youtube.com/shorts/REAL_VIDEO_ID_HERE"]}' \
  | python3 -m json.tool | head -80
```

Expected:
- `videos[0].hook.type` (string)
- `videos[0].body.structure` (string)
- `aggregated.recommendedPreset` (6개 enum 중 1개)
- `aggregated.advice` (한국어 2~3 문장)

재호출 시 `cached: true`, `fromCache: 1`.

- [ ] **Step 4: 커밋**

```bash
git add app/api/shortform-benchmark/analyze/route.js
git commit -m "$(cat <<'EOF'
feat(api): /api/shortform-benchmark/analyze — Gemini 2.5 Pro 영상 분석

사용자가 선택한 1~3개 YouTube 숏폼을 Genkit + Gemini 2.5 Pro
사고(thinking) 모드로 멀티모달 분석 (fileData URL 직접 전달).

- 스펙 §5 JSON Schema 엄격 출력 (Zod 검증)
- thinkingBudget 8000으로 깊은 분석
- 영상별 캐시 bench:analyze:\${videoId} 30일 TTL
- 캐시 완전 적중 시 computeAggregated 로컬 집계로 Gemini 호출 스킵
- 실패 시 폴백 모드 (캐시된 분석만 반환 + 기본 aggregated)

maxDuration 60초 (사고 모드 + 3 영상 최대 45초).

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task B6: Genkit 설정 검토 + Vertex AI 플러그인 확인

Genkit은 보통 `genkit.config.js` 또는 `src/ai/genkit.ts` 같은 중앙 설정 파일을 두지만, 본 프로젝트는 **Task B1의 `lib/gemini-vertex.js`에 런타임 lazy init 패턴**으로 대체한다. 이 task는 단지 구성 검증과 (선택) Genkit dev UI 실행.

**Files:**
- (필요 시) `genkit.config.js` — 본 플랜에서는 **생성하지 않음**

- [ ] **Step 1: Vertex AI 플러그인 export 목록 확인**

```bash
cd /Users/gong-eunhui/Desktop/naver-title-generator && node -e "import('@genkit-ai/vertexai').then(m => console.log(Object.keys(m)))"
```

Expected: `vertexAI`, `gemini25Pro`, `gemini25Flash` 등 핵심 export 확인. 누락되면 패키지 버전 확인.

- [ ] **Step 2: Genkit Flow 레지스트리 검증**

Next.js 서버리스는 process 생명주기가 짧으므로 Genkit의 글로벌 Flow registry가 파편화될 수 있다. B2의 `buildFlow()` lazy 패턴으로 매 요청마다 Flow 인스턴스 재사용 여부를 검증:

```bash
cd /Users/gong-eunhui/Desktop/naver-title-generator && node --experimental-vm-modules -e "
import('./lib/keyword-expansion.js').then(async (m) => {
  console.time('call1');
  await m.expandKeywords({ keywords: 'test1' });
  console.timeEnd('call1');

  console.time('call2');
  await m.expandKeywords({ keywords: 'test2' });
  console.timeEnd('call2');
});
"
```

Expected: call1은 1~3초(cold start 포함), call2는 ~500ms 이내. call2가 call1과 같이 느리면 Flow 재생성 이슈.

- [ ] **Step 3: (선택) Genkit dev UI 실행 확인**

Genkit은 `genkit start` 명령으로 로컬 dev UI 제공. 본 프로젝트는 Next.js 내장으로 Flow를 호출하므로 dev UI는 **선택 사항**. 운영자가 향후 Flow 디버깅 원할 시 참고.

```bash
# 설치 여부만 확인 (실행 X)
cd /Users/gong-eunhui/Desktop/naver-title-generator && npx genkit --help 2>&1 | head -20 || echo "Genkit CLI 미설치 (정상 — 본 플랜에서는 불필요)"
```

Expected: 어느 쪽이든 OK. 본 플랜에서는 Flow 호출이 런타임 Next.js 내부에서만 일어나므로 CLI 없어도 됨.

- [ ] **Step 4: 기록 (커밋 없음)**

이 task는 코드 변경 없음. 검증 결과를 Task B10 메모리 파일에 "Genkit 구성: lazy init 패턴 적용, dev UI 미사용" 한 줄로 기록.

---

## Task B7: Zod 스키마 중앙화 (`lib/benchmark-schemas.js`)

스펙 §5 JSON Schema를 Zod로 정의해 Task B5의 `output.schema`로 주입. Gemini 2.5 Pro의 Structured Output 기능을 통해 응답이 스키마를 엄격히 따름. 이 파일은 Task B5보다 **먼저** 구현해야 한다 (B5가 import).

**Files:**
- Create: `lib/benchmark-schemas.js`

- [ ] **Step 1: 스키마 작성**

```javascript
/**
 * 벤치마킹 Zod 스키마 중앙화
 *
 * 스펙 §5 "Gemini Vertex AI JSON Schema"을 1:1 매핑.
 * Task B5의 /api/shortform-benchmark/analyze가 이 스키마로 Gemini
 * 응답을 검증 (Genkit Structured Output).
 */
import { z } from 'zod';

// ─ enum 정의 ─
export const HookType = z.enum([
  'number-list',
  'question',
  'shock',
  'secret',
  'evidence',
  'empathy',
  'warning',
  'mistake',
  'transformation',
  'fomo',
]);

export const BodyStructure = z.enum([
  'list',
  'narrative',
  'how-to',
  'comparison',
  'problem-solution',
]);

export const PersonPresence = z.enum(['high', 'medium', 'low', 'none']);

export const SubtitlePosition = z.enum(['top', 'middle', 'bottom']);
export const SubtitleStyle = z.enum(['static', 'kinetic', 'mixed']);
export const CutFrequency = z.enum(['slow', 'medium', 'fast']);

export const CTAType = z.enum(['comment', 'dm', 'follow', 'link', 'save', 'share', 'none']);
export const CTAPosition = z.enum(['beginning', 'middle', 'end']);

export const RecommendedPreset = z.enum([
  '전문가',
  '친근',
  '임팩트',
  '차분',
  '트렌디',
  '비즈니스',
]);

// ─ 서브 스키마 ─

export const HookSchema = z.object({
  type: HookType,
  openingText: z.string(),
  openingVisual: z.string(),
  first3Seconds: z.string(),
  hookDurationSec: z.number().min(1).max(10),
});

export const BodySchema = z.object({
  structure: BodyStructure,
  segmentCount: z.number().int().min(1).max(20),
  averageSegmentDuration: z.number(),
  tone: z.string(),
  personPresence: PersonPresence,
  setting: z.string(),
});

export const CTASchema = z.object({
  type: CTAType,
  text: z.string(),
  ctaPosition: CTAPosition,
});

export const VisualStyleSchema = z.object({
  subtitlePosition: SubtitlePosition,
  subtitleStyle: SubtitleStyle,
  cutFrequency: CutFrequency,
});

export const CaptionSchema = z.object({
  totalLength: z.number().int().min(0),
  structure: z.string(),
  hookLine: z.string(),
  bodyLength: z.number().int().min(0),
  hashtags: z.array(z.string()),
  hashtagCount: z.number().int().min(0),
  ctaText: z.string(),
  ctaPosition: z.string(),
  linkPlacement: z.string(),
  emojiUsage: z.boolean(),
  lineBreakStyle: z.string(),
});

// ─ 개별 영상 분석 ─

export const VideoAnalysisSchema = z.object({
  videoId: z.string(),
  title: z.string(),
  channelName: z.string(),
  viewCount: z.number().int().min(0),
  subscriberCount: z.number().int().min(0),
  duration: z.number().int().min(1).max(120),
  viewToSubRatio: z.number().min(0),

  hook: HookSchema,
  body: BodySchema,
  cta: CTASchema,
  visualStyle: VisualStyleSchema,
  caption: CaptionSchema,
});

// ─ 집계 ─

export const CaptionPatternSchema = z.object({
  averageLength: z.number(),
  dominantStructure: z.string(),
  averageHashtagCount: z.number(),
  commonHashtags: z.array(z.string()),
});

export const AggregatedSchema = z.object({
  dominantHookType: HookType,
  dominantBodyStructure: BodyStructure,
  dominantTone: z.string(),
  averageDuration: z.number(),
  personPresenceMode: PersonPresence,
  recommendedSubtitlePosition: SubtitlePosition,
  commonCTAType: CTAType,
  captionPattern: CaptionPatternSchema,
  recommendedPreset: RecommendedPreset,
  advice: z.string().min(10).max(500),
});

// ─ 최종 Analyze Output ─

export const AnalysisOutputSchema = z.object({
  videos: z.array(VideoAnalysisSchema).min(1).max(3),
  aggregated: AggregatedSchema,
});

/**
 * TypeScript 타입 정의 (JSDoc 지원).
 * @typedef {z.infer<typeof AnalysisOutputSchema>} AnalysisOutput
 * @typedef {z.infer<typeof VideoAnalysisSchema>} VideoAnalysis
 * @typedef {z.infer<typeof AggregatedSchema>} Aggregated
 */
```

- [ ] **Step 2: 빌드 체크 + 자가 검증**

```bash
cd /Users/gong-eunhui/Desktop/naver-title-generator && node --experimental-vm-modules -e "
import('./lib/benchmark-schemas.js').then((m) => {
  // Valid 샘플
  const sample = {
    videos: [{
      videoId: 'abc123',
      title: '테스트',
      channelName: '채널',
      viewCount: 120000,
      subscriberCount: 8000,
      duration: 35,
      viewToSubRatio: 15,
      hook: { type: 'number-list', openingText: '5가지', openingVisual: '클로즈업', first3Seconds: '빠른 컷', hookDurationSec: 3 },
      body: { structure: 'list', segmentCount: 5, averageSegmentDuration: 6, tone: '친근', personPresence: 'high', setting: 'indoor' },
      cta: { type: 'comment', text: '댓글로', ctaPosition: 'end' },
      visualStyle: { subtitlePosition: 'bottom', subtitleStyle: 'kinetic', cutFrequency: 'fast' },
      caption: { totalLength: 280, structure: 'hook+body+tags', hookLine: '테스트', bodyLength: 180, hashtags: ['#웨딩'], hashtagCount: 1, ctaText: '댓글로', ctaPosition: 'end', linkPlacement: 'with-cta', emojiUsage: false, lineBreakStyle: 'frequent' },
    }],
    aggregated: {
      dominantHookType: 'number-list',
      dominantBodyStructure: 'list',
      dominantTone: '친근',
      averageDuration: 35,
      personPresenceMode: 'high',
      recommendedSubtitlePosition: 'bottom',
      commonCTAType: 'comment',
      captionPattern: { averageLength: 220, dominantStructure: 'hook+body', averageHashtagCount: 5, commonHashtags: ['#웨딩'] },
      recommendedPreset: '친근',
      advice: '숫자형 후킹과 본인 등장을 권장합니다. 자막은 하단 키네틱.',
    },
  };
  const parsed = m.AnalysisOutputSchema.safeParse(sample);
  console.log('Valid sample:', parsed.success);
  if (!parsed.success) console.error(parsed.error.issues);

  // Invalid sample (enum 위반)
  const bad = { ...sample, aggregated: { ...sample.aggregated, recommendedPreset: '없는프리셋' } };
  const parsedBad = m.AnalysisOutputSchema.safeParse(bad);
  console.log('Invalid sample rejected:', !parsedBad.success);
});
"
```

Expected: `Valid sample: true` + `Invalid sample rejected: true`.

- [ ] **Step 3: 커밋**

```bash
git add lib/benchmark-schemas.js
git commit -m "$(cat <<'EOF'
feat(lib): 벤치마킹 Zod 스키마 중앙화

스펙 §5 "Gemini Vertex AI JSON Schema"를 Zod로 1:1 매핑:
- HookType/BodyStructure/PersonPresence/SubtitlePosition 등 enum 정의
- HookSchema/BodySchema/CTASchema/VisualStyleSchema/CaptionSchema 서브 스키마
- VideoAnalysisSchema + AggregatedSchema 결합 → AnalysisOutputSchema
- recommendedPreset은 6개 프리셋 enum 강제 (전문가/친근/임팩트/차분/트렌디/비즈니스)

Task B5의 /api/shortform-benchmark/analyze가 Genkit output.schema로 사용해
Gemini 2.5 Pro Structured Output을 엄격히 강제.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task B8: 캐싱 전략 통합 검증

Task B4(후보 검색 캐시) + Task B5(영상 분석 캐시)에 이미 적용됐지만, 이 task는 두 캐시의 동작을 통합 검증하고 운영 대시보드에서 조회 가능한 키 패턴을 확인한다.

**Files:**
- (읽기 전용 검증 — 파일 변경 없음)

- [ ] **Step 1: Redis 키 패턴 일관성 확인**

```bash
cd /Users/gong-eunhui/Desktop/naver-title-generator && grep -rn "bench:" app/api/ lib/ --include="*.js"
```

Expected:
- `bench:cache:${hash}` — 7일 TTL (route.js)
- `bench:analyze:${videoId}` — 30일 TTL (analyze/route.js)

다른 접두사(`benchmark:`)가 남아있으면 제거.

- [ ] **Step 2: 캐시 적중 시나리오 수동 테스트**

```bash
# 1차 호출 (cache miss)
cd /Users/gong-eunhui/Desktop/naver-title-generator && curl -s -X POST http://localhost:3000/api/shortform-benchmark \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${TEST_SESSION_TOKEN}" \
  -d '{"keywords":"카페 마케팅"}' | python3 -c "import json,sys; d=json.load(sys.stdin); print('cached:', d.get('cached'), 'count:', len(d.get('candidates',[])))"

# 2차 호출 (cache hit — 즉시 반환)
curl -s -X POST http://localhost:3000/api/shortform-benchmark \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${TEST_SESSION_TOKEN}" \
  -d '{"keywords":"카페 마케팅"}' | python3 -c "import json,sys; d=json.load(sys.stdin); print('cached:', d.get('cached'), 'count:', len(d.get('candidates',[])))"
```

Expected: 1차 `cached: False`, 2차 `cached: True`. 2차 응답 시간 < 100ms.

- [ ] **Step 3: 분석 캐시 교차 검증**

같은 videoId로 /analyze를 두 번 호출 → 두 번째는 `fromCache: 1`, `fromGemini: 0`.

```bash
cd /Users/gong-eunhui/Desktop/naver-title-generator && VID_URL="https://youtube.com/shorts/REAL_VIDEO_ID"
# 1차
curl -s -X POST http://localhost:3000/api/shortform-benchmark/analyze \
  -H "Content-Type: application/json" -H "Authorization: Bearer ${TEST_SESSION_TOKEN}" \
  -d "{\"videoUrls\":[\"$VID_URL\"]}" | python3 -c "import json,sys; d=json.load(sys.stdin); print('fromCache:', d.get('fromCache', 0), 'fromGemini:', d.get('fromGemini', 0))"
# 2차
curl -s -X POST http://localhost:3000/api/shortform-benchmark/analyze \
  -H "Content-Type: application/json" -H "Authorization: Bearer ${TEST_SESSION_TOKEN}" \
  -d "{\"videoUrls\":[\"$VID_URL\"]}" | python3 -c "import json,sys; d=json.load(sys.stdin); print('fromCache:', d.get('fromCache', 0), 'fromGemini:', d.get('fromGemini', 0))"
```

Expected: 2차에서 fromCache 1.

- [ ] **Step 4: Upstash 대시보드에서 키 확인 (운영자)**

운영자가 Upstash 콘솔에서 `bench:*` 프리픽스 검색 → 생성된 키 2종류 확인. 이 task는 커밋 없음.

---

## Task B9: 통합 수동 검증 (전체 파이프라인 e2e)

Phase B 전체가 동작하는지 블로그 글 입력 → 후보 검색 → 영상 선택 → 분석까지 한 번에 검증.

**Files:**
- (검증 전용)

- [ ] **Step 1: dev 서버 기동 + 테스트 세션 토큰 준비**

```bash
cd /Users/gong-eunhui/Desktop/naver-title-generator && npm run dev
```

별도 터미널에서 로그인 후 localStorage의 `ddukddak_session_token`을 `TEST_SESSION_TOKEN`으로 export.

- [ ] **Step 2: 블로그 글 기반 전체 플로우**

```bash
# 1단계: 후보 검색
RESP=$(curl -s -X POST http://localhost:3000/api/shortform-benchmark \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${TEST_SESSION_TOKEN}" \
  -d '{
    "blogText": "결혼식 2개월 전 신랑 정장은 이렇게 준비하세요. 가봉 일정, 색상 선택, 슈즈 매칭까지 단계별로 설명합니다.",
    "keywords": "신랑 정장, 웨딩 슈트"
  }')

echo "$RESP" | python3 -m json.tool

# 상위 2개 URL 추출
URLS=$(echo "$RESP" | python3 -c "
import json, sys
d = json.load(sys.stdin)
urls = [c['url'] for c in d.get('candidates', [])[:2]]
print(json.dumps(urls))
")

echo "Selected URLs: $URLS"
```

Expected:
- candidates 5개 (또는 relaxed 폴백)
- searchKeywords 5개 (Gemini Flash가 생성한 쿼리)
- mainKeywords / relatedKeywords 존재

- [ ] **Step 3: 분석 호출**

```bash
curl -s -X POST http://localhost:3000/api/shortform-benchmark/analyze \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${TEST_SESSION_TOKEN}" \
  -d "{\"videoUrls\": $URLS}" \
  | python3 -m json.tool
```

Expected:
- `videos[].hook.type` 각 영상마다 존재
- `aggregated.recommendedPreset` 6 enum 중 1개
- `aggregated.advice` 한국어 2~3 문장
- 전체 응답 30초 이내

- [ ] **Step 4: 에러 경로 검증**

```bash
# 빈 입력
curl -s -X POST http://localhost:3000/api/shortform-benchmark \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${TEST_SESSION_TOKEN}" \
  -d '{}' | python3 -m json.tool
# Expected: 400 + error 메시지

# 잘못된 URL
curl -s -X POST http://localhost:3000/api/shortform-benchmark/analyze \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${TEST_SESSION_TOKEN}" \
  -d '{"videoUrls":["https://example.com/notvideo"]}' | python3 -m json.tool
# Expected: 400 "유효한 YouTube URL이 없습니다"

# 미인증
curl -s -X POST http://localhost:3000/api/shortform-benchmark \
  -H "Content-Type: application/json" \
  -d '{"keywords":"test"}' | python3 -m json.tool
# Expected: 401 "로그인이 필요합니다"
```

- [ ] **Step 5: Production 빌드 체크**

```bash
cd /Users/gong-eunhui/Desktop/naver-title-generator && npx next build 2>&1 | tail -40
```

Expected: 모든 route 정상 빌드, 경고는 Phase B 외 코드에 한정.

- [ ] **Step 6: 문제 발견 시 수정 + 추가 커밋**

회귀 시나리오에서 발견된 이슈가 있으면 fix 커밋으로 보강. 없으면 Task B10 진행.

---

## Task B10: 메모리 + 마스터 플랜 상태 업데이트

**Files:**
- Modify: `~/.claude/projects/-Users-gong-eunhui-Desktop-naver-title-generator/memory/MEMORY.md`
- Create: `~/.claude/projects/-Users-gong-eunhui-Desktop-naver-title-generator/memory/project_shortform_phase_b_complete.md`
- Modify: `docs/superpowers/plans/2026-04-14-shortform-master-plan.md`

- [ ] **Step 1: 메모리 파일 작성**

```markdown
---
name: 숏폼 Phase B 완료
description: Genkit 벤치마킹 파이프라인 + Gemini 2.5 Pro 영상 분석
type: project
---

# 숏폼 Phase B 완료

**완료일:** 2026-04-XX
**스펙:** docs/superpowers/specs/2026-04-14-shortform-benchmark-pipeline-design.md
**플랜:** docs/superpowers/plans/2026-04-14-shortform-phase-b-benchmarking.md

## 핵심 변경

- Firebase Genkit + Vertex AI 도입 (lib/gemini-vertex.js)
- 키워드 확장 Flow (Gemini 2.5 Flash, lib/keyword-expansion.js)
- YouTube 5쿼리 병렬 검색 + 필터 (lib/youtube-search.js)
- MIN_VIEW_TO_SUB_RATIO 10 → 5 (작지만 터진 영상 포착)
- /api/shortform-benchmark 전면 리팩토링 (Claude → Genkit 파이프라인)
- /api/shortform-benchmark/analyze 신규 (Gemini 2.5 Pro thinking)
- Zod 스키마 중앙화 (lib/benchmark-schemas.js) — 스펙 §5 1:1 매핑

## 캐시 키

- bench:cache:{sha256(blogText+keywords)} — 7일
- bench:analyze:{videoId} — 30일

## 주의 사항

- /api/shortform-benchmark 응답 필드명이 videos → candidates로 변경됨
- 기존 app/shortform/ShortformClient.js 호출부는 Phase C/D에서 교체 필요
- GOOGLE_CLOUD_PROJECT, VERTEX_AI_LOCATION, GOOGLE_SERVICE_ACCOUNT_KEY
  3개 환경변수 Vercel 등록 필수

## 알려진 미완

- YouTube API 쿼터 상향 (운영자 작업 — 4~8주 소요, 승인 지연 시 폴백 대응 필요)
- ShortformClient.js 클라이언트 호출부 업데이트 (Phase C)
- 후보 카드 UI — Step 2.5 선택 인터랙션 (Phase D 또는 E)

## 다음 Phase

Phase C (shortform_projects DB + auto-save) 또는 Phase D (대본 생성) 진행.
Phase D는 Phase B의 AggregatedSchema 결과를 Claude Opus 프롬프트에 주입.
```

- [ ] **Step 2: MEMORY.md 최상단 "최근 세션" 섹션에 한 줄 추가**

```markdown
- [4/XX 숏폼 Phase B 완료](project_shortform_phase_b_complete.md) — Genkit + Gemini 2.5 Pro 벤치마킹
```

- [ ] **Step 3: 마스터 플랜 Phase B 섹션 끝에 상태 표기**

`docs/superpowers/plans/2026-04-14-shortform-master-plan.md` Phase B 섹션 마지막에 추가:

```markdown
**상태:** ✅ 완료 (커밋 SHA: XXXXXXX)
```

- [ ] **Step 4: 최종 커밋**

```bash
cd /Users/gong-eunhui/Desktop/naver-title-generator && git add docs/superpowers/plans/2026-04-14-shortform-master-plan.md
git commit -m "$(cat <<'EOF'
docs: Phase B 완료 마킹 + 메모리 기록

Phase B (Benchmarking: Genkit + Gemini 2.5 Pro) 완료.
10 task 모두 통과. 다음 Phase(C/D) 진입 가능.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase B 자기 검토

### Spec coverage

| 스펙 섹션 | 커버 task |
|---|---|
| §1 "5x 비율 + 키워드 확장" | B2, B3 (MIN_VIEW_TO_SUB_RATIO=5) |
| §4 Step 2 "키워드 확장" | B2 (Gemini Flash) |
| §4 Step 2 "YouTube 병렬 검색 + 필터" | B3 (parallelSearch + filterAndRank) |
| §4 Step 2 "선택된 영상 깊은 분석" | B5 (/analyze + Gemini Pro thinking) |
| §5 "JSON Schema" | B7 (Zod 스키마 중앙화) |
| §8.1 "POST /api/shortform-benchmark" | B4 (route.js 리팩토링) |
| §8.1 "POST /api/shortform-benchmark/analyze" | B5 (신규 route) |
| §9 "캐싱 전략" | B4 + B5 + B8 (bench:cache / bench:analyze) |
| §10 "YouTube Data API 쿼터" | B3 (코멘트로 문서화, 쿼터 상향은 운영자) |
| §11 "Gemini Vertex AI 모델" | B1 (resolveProModel/FlashModel 헬퍼) |
| §12 "실패 처리" | B4 + B5 (폴백 모드 + try/catch) |

### 알려진 미완 (다음 Phase로 이월)

- ShortformClient.js 클라이언트 호출부 업데이트 (videos → candidates) — Phase C/D
- 후보 카드 UI + 선택 인터랙션 (Step 2.5) — Phase E 예상
- YouTube API 쿼터 상향 — 운영자 작업 (4~8주)
- 폴백 모드: 쿼터 초과 시 SSE로 사용자에 알림 — Phase I
- Vercel Pro의 maxDuration 60초 한계 내 Gemini 3영상 분석 — B5 실측 후 필요 시 background job 전환

### 통합 지점

다음 Phase가 사용할 인터페이스:
- **Phase C**: `/api/shortform-benchmark` 응답 중 `candidates`를 `shortform_projects.benchmark_candidates`에 저장
- **Phase D**: `/api/shortform-benchmark/analyze` 응답의 `aggregated`를 Claude Opus 프롬프트의 `benchmarkAggregated` 필드로 주입
- **Phase I (SSE)**: Phase B의 두 엔드포인트에 진행 이벤트 발행 지점 추가 (keyword expansion / search / analyze 3단계)

### 회귀 안전성

- 기존 `/api/shortform-benchmark`의 **응답 스키마 변경**이 최대 리스크
  - 클라이언트 측 `result.videos` 참조가 있는 경우 깨짐
  - Phase C/D 진입 전까지는 관리자 테스트만 권장
- `analyzePatterns` 삭제로 ANTHROPIC_API_KEY 의존성 이 엔드포인트에서는 제거 (다른 API는 여전히 사용)
- 신규 `/analyze` 엔드포인트는 기존 동작과 무관 (신규 추가)

### Rollback 전략

문제 발생 시 Task B4 커밋 1개만 revert → 이전 Claude 기반 파이프라인으로 복귀 가능.
`lib/` 신규 파일 3개는 미사용 상태로 남아있어도 빌드·런타임 영향 없음.

```bash
# Rollback 시
git revert <B4-commit-sha>
```

---

## Phase B 완료 후 다음 단계

이 Phase 완료 시 마스터 플랜의 **Phase C (Project Model + auto-save)** 또는 **Phase D (Script Generation)** 상세 플랜 작성으로 진행. 특히 Phase D는 Phase B의 `AggregatedSchema` JSON을 Claude Opus 프롬프트에 주입하므로, Phase B의 스키마 확정 후 곧바로 시작 가능.

Phase C와 D는 독립적으로 병렬 진행 가능 (`subagent-driven-development`).
