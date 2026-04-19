# 카드뉴스 Chromium 렌더 전환 — Design Spec

- **Date**: 2026-04-19 (Phase D)
- **Status**: Approved (pending user file review)
- **Related**: SEDA 슬림화(선행, `2026-04-19-cardnews-seda-slim-design.md`), Week 2 async render(`2026-04-18-async-render-design.md`)
- **Next step**: `writing-plans` skill로 구현 plan 작성

---

## 문제 정의

뚝딱툴 카드뉴스는 **Satori + Resvg**로 React JSX → SVG → PNG 렌더링한다. Satori는 CSS subset만 지원해 `@keyframes` 애니메이션, `background-clip: text`, `filter: drop-shadow` 등 **웹 스펙의 상당 부분이 미지원**이다. 그 결과 14종 고정 테마 × 3 레이아웃 = 42 조합 안에서만 결과가 나오고, 사용자(사업자)가 체감하는 디자인 품질이 Claude Design 수준에 못 미친다.

사용자가 `~/Desktop/cardnews/output/cardnews/20260419-self_employed_ai-coral.html` 에서 Claude Code로 생성한 카드뉴스 HTML 10장을 검토한 결과, 동일 모델(Sonnet)로도 **서버 Chromium 렌더 파이프라인을 쓰면 Claude Design급 품질**이 가능함을 확인했다. 이 문서는 Satori → Chromium 전환 설계를 정의한다.

## 목표

1. 카드뉴스 렌더를 **서버 Chromium(Puppeteer)** 파이프라인으로 전환. Claude가 HTML/CSS 직접 생성 → Chromium이 카드별 PNG 캡처 → R2 업로드.
2. **웹 풀스펙 자유도** 확보. `@keyframes`, container queries, gradient, shadow, filter 전부 사용 가능.
3. **Brand Kit 제약 + AI 자유도** 균형. 사용자 설정 색·로고·톤 내에서 Claude가 카드별 디자인 결정.
4. **마이페이지 "내 이미지" 자동 활용**. 업로드 이미지 + AI 생성 이미지를 Claude가 맥락에 맞게 배치.
5. **점진 롤아웃** (SEDA 슬림 패턴). 기존 Satori는 `CARDNEWS_CHROMIUM_ROLLOUT=0` fallback으로 유지.

## 비목표

- 기존 Satori 코드 즉시 제거 (1주 안정 관찰 후 별도 PR)
- 카드뉴스 비율 옵션 추가 (4:5 고정 유지)
- Opus 모델 도입 (Sonnet 고정. 비용 관리 + 샘플 품질로 Sonnet 충분성 확인)
- JS 애니메이션 카드 (PNG 스냅샷이라 의미 없음. CSS @keyframes `forwards`로 최종 상태)
- 프리미엄 이미지 생성기 `blog-image-pro` 의 Satori 제거 (본 PR 스코프 밖)

---

## 확정된 9개 의사결정

| # | 결정 |
|---|---|
| 1 | **디자인 철학**: Claude 자유도 + Brand Kit 제약 |
| 2 | **HTML 생성 단위**: 단일 HTML에 N장 카드 (`:root` 변수 공유 + `.cN` 독립 스타일) |
| 3 | **Claude 모델**: Sonnet 4.6/4.7 (원가 ~$0.24 = 크레딧 단가, Opus는 5배로 부적합) |
| 4 | **이미지 처리**: `{{img:N}}` placeholder + 서버 후처리 치환 (마이페이지 "내 이미지" 재활용) |
| 5 | **비율**: 4:5 (1080×1350) 고정 |
| 6 | **기존 Satori**: rollout fallback 유지 (`CARDNEWS_CHROMIUM_ROLLOUT` 0→10→50→100) |
| 7 | **크레딧**: 1개 유지 |
| 8 | **Chromium 서비스**: 기존 Railway `services/server.mjs`에 `/render-cardnews` 추가 (Remotion과 Chromium 공유) |
| 9 | **보안**: JS 비활성 + `<script>` strip + 이미지 URL 화이트리스트 |

---

## 아키텍처 + 데이터 흐름

```
┌─────────┐  ① POST /api/card-news {blogText, count, imagesRef}   ┌──────────────┐
│  Client │ ──────────────────────────────────────────────────────▶│ Vercel:      │
│         │                                                         │ /api/card-   │
│         │◀──────── ② 202 {jobId, accepted} ───────────────────────│  news        │
│         │                                                         └──────┬───────┘
│         │                                                                │
│         │  [rollout 분기 (resolveRolloutFlag(email, ROLLOUT))]           │
│         │                                                                │
│         │    chromium path ──────────────┐      fallback: Satori (기존)  │
│         │                                │                               │
│         │                                │ ③ dispatch Railway (HTTP 202) │
│         │                                ▼                               │
│         │                       ┌──────────────┐                         │
│         │                       │ Railway:     │                         │
│         │                       │/render-     │                          │
│         │                       │ cardnews    │                          │
│         │                       └──────┬──────┘                          │
│         │                              │                                 │
│         │                              │ ④ Claude Sonnet 호출            │
│         │                              │   (system prompt + Brand Kit +  │
│         │                              │    이미지 목록 + 블로그 글)     │
│         │                              │   응답: 단일 HTML ~15K tokens   │
│         │                              │                                 │
│         │                              │ ⑤ Sanitize (cheerio):           │
│         │                              │   - <script>, iframe 등 strip   │
│         │                              │   - on* 속성 제거               │
│         │                              │   - <img> 호스트 화이트리스트   │
│         │                              │   - issues 배열 로그            │
│         │                              │                                 │
│         │                              │ ⑥ validateCardCount             │
│         │                              │   → mismatch면 Claude 재시도 1회│
│         │                              │                                 │
│         │                              │ ⑦ resolveImagePlaceholders      │
│         │                              │   {{img:N}} → CDN URL           │
│         │                              │                                 │
│         │                              │ ⑧ Chromium 렌더 (js disabled):  │
│         │                              │   - setContent(html)             │
│         │                              │   - viewport 1080×1350*N         │
│         │                              │   - document.fonts.ready 대기    │
│         │                              │   - 600ms 애니메이션 settle      │
│         │                              │   - 각 .card element.screenshot  │
│         │                              │                                 │
│         │                              │ ⑨ R2 병렬 업로드 (N PNG)        │
│         │                              │                                 │
│         │                              │ ⑩ webhook POST                  │
│         │                              │   /api/card-news-callback       │
│         │                              │   {jobId, type: 'complete',     │
│         │                              │    urls: [...]}                 │
│         │                              ▼                                 │
│         │                       ┌──────────────┐                         │
│         │                       │ Vercel:      │                         │
│         │                       │ /api/card-   │                         │
│         │                       │ news-        │                         │
│         │                       │  callback    │                         │
│         │                       └──────┬───────┘                         │
│         │                              │                                 │
│         │                              │ ⑪ error이면 자동 환불 (1 크레딧) │
│         │                              │ ⑫ publishProgress(jobId, ...)   │
│         │                              ▼                                 │
│         │                       ┌──────────────┐                         │
│         │                       │ Redis        │                         │
│         │                       │ job:history  │                         │
│         │                       └──────┬───────┘                         │
│         │                              │                                 │
│         │  ⑬ SSE (/api/card-news-progress) ◀──────────────────────────────┘
│         │      → complete: [url1, url2, ...] 표시
│         │      → error: 환불 안내 + 재시도 버튼
└─────────┘
```

### 재활용 인프라 (Week 2 블로커 A)

- `services/webhook-client.mjs` — exp backoff retry
- `lib/shared-prompts/rollout.js` — `resolveRolloutFlag`
- `lib/job-progress.js` — `publishProgress`, `readHistoryTail`, `createJobId`
- `lib/shortform/render-callback-handler.js` 패턴 복제
- `lib/shortform/inactivity-detector.js` — 8분 timeout
- `app/shortform/hooks/useJobProgress.js` 훅 그대로 (카드뉴스 페이지에서 재활용)
- `services/server.mjs` Railway — Chromium 공유 (Remotion과 동일 경로)

### 신규 컴포넌트

- `lib/shared-prompts/cardnews-system-prompt.js` — Claude system prompt (SEDA + 구조 제약)
- `services/card-news-renderer.mjs` — Chromium HTML → PNG N장 (puppeteer-core)
- `lib/cardnews/sanitize.js` — cheerio 기반 HTML 정화 + `{{img:N}}` 치환
- `lib/cardnews/html-builder.js` — Claude 호출 + Brand Kit/이미지 주입 + 검증
- `lib/cardnews/callback-handler.js` — webhook handler 순수 로직 (자동 환불 포함)
- `app/api/card-news-callback/route.js` — Next.js route wrapper
- SSE: 기존 `/api/shortform-progress` **재사용 가능** (`job:history:{jobId}` 키 형식 공유). 단 이름이 shortform-specific해서 혼란 방지 위해 plan 단계에서 `/api/job-progress`로 rename 검토.

### 수정 파일

- `app/api/card-news/route.js` — rollout 분기 (chromium vs satori path)
- `services/server.mjs` — `/render-cardnews` 엔드포인트 + `uploadBufferToR2` 헬퍼
- `services/package.json` — `puppeteer-core`, `cheerio` 의존성 추가
- `app/card-news/CardNewsClient.js` (or equivalent) — SSE 구독 + 다중 이미지 다운로드 UI

---

## Claude 프롬프트 구조

### System prompt (`lib/shared-prompts/cardnews-system-prompt.js`, 고정)

```
당신은 인스타그램 카드뉴스 HTML/CSS 디자이너입니다.

[SEDA 작문 원칙 — 텍스트에 적용]
- Shortly: 짧게. 한 줄·한 문장.
- Easily: 쉬운 어휘.
- Divide: \n 의미 단위 줄바꿈.
- Again: 독자 시선으로 재검토.

[산출물]
단일 완전한 HTML 문서 1개. 마크다운 코드블록이나 설명 없이 순수 HTML만 반환.

[필수 구조 — 지키지 않으면 렌더 실패]
1. <!DOCTYPE html> + <html lang="ko"> 로 시작
2. viewport: 1080 × 1350 (4:5). CSS container query(container-type: inline-size, cqw 단위) 사용
3. 각 카드는 반드시 <div class="card cN"> 구조 (N은 1부터 순번)
   - card 클래스 → 기본 레이아웃 (width:1080px, height:1350px, position:relative, overflow:hidden)
   - cN 클래스 → 각 카드 고유 스타일
4. :root에 CSS 변수로 Brand Kit 주입 (아래 [Brand Kit] 섹션 참고)
5. 이미지 사용 시 {{img:N}} placeholder (N = 제공된 이미지 인덱스)
6. <script> 태그 금지
7. external font는 Pretendard Variable CDN 1개만 허용
8. 요청된 슬라이드 수를 정확히 맞출 것

[자유도 — 이 외엔 자유]
- 카드별 background, layout, typography, animation 완전 독립
- CSS @keyframes (animation-fill-mode: forwards 권장 — 최종 상태 캡처 보장)
- gradient, shadow, filter, transform 자유
- 카드마다 다른 색/구성 — 다채롭게

[디자인 방향]
- 초대형 타이포 (heading 최소 8cqw, cover는 16cqw 수준)
- 여백 60~70%
- 강조 단어 하나만 액센트 컬러
- 이모지 금지 (렌더 제약)
- 스토리텔링 장치 활용 (번호/시간 배지/통계 강조 등)
```

### User message (동적, `lib/cardnews/html-builder.js`에서 조립)

```
[Brand Kit — :root 변수로 주입]
--brand-accent: #{primary_color};
--brand-secondary: #{secondary_color};
--brand-text: #0a0a0a;
--brand-bg: #ffffff;
--brand-logo-url: "{logo_url}";     (있을 때만)
폰트: Pretendard Variable
업종: {industry}
가게명: {store_name}
SNS: @{instagram}

[사용 가능한 이미지]
- img:0 (ratio: 4x5, source: user_upload, tag: "{사용자 tag 또는 파일명}")
- img:1 (ratio: 1x1, source: user_upload, tag: "...")
- img:2 (ratio: 4x5, source: ai_generated, tag: "...")
이미지 비율이 카드(4x5)와 다르면 object-fit: cover로 처리.
이미지 불필요하면 사용 안 해도 됩니다.

[블로그 글]
{blog_text (최대 8000자 절삭)}

[요청]
총 {slide_count}장 카드뉴스 HTML 생성:
- 1번: cover (강한 훅)
- 2 ~ {slide_count-1}번: content
- {slide_count}번: CTA (팔로우/저장)

SEDA 원칙으로 카드별 핵심 추출. 카드 N개 모두 시각적으로 다르게 디자인 (동일 배경·레이아웃 반복 금지).
```

### API 파라미터

- `model: 'claude-sonnet-4-6'` (현 최신 Sonnet)
- `max_tokens: 16000`
- `temperature: 0.75`
- stream 아님 (단일 응답)

---

## Chromium 렌더 파이프라인

### `/render-cardnews` 엔드포인트 (`services/server.mjs`)

```js
app.post('/render-cardnews', authMiddleware, async (req, res) => {
  const { jobId, html, cardCount, parentJobId } = req.body;

  if (!jobId || !html || !cardCount) {
    return res.status(400).json({ error: 'jobId, html, cardCount required' });
  }
  if (cardCount < 3 || cardCount > 15) {
    return res.status(400).json({ error: 'cardCount must be 3~15' });
  }
  if (html.length > 200_000) {
    return res.status(400).json({ error: 'html too large (>200KB)' });
  }

  res.status(202).json({ jobId, accepted: true });

  runCardnewsRenderJob({ jobId, html, cardCount, parentJobId }).catch((err) => {
    console.error('[card-news] unhandled:', err);
  });
});
```

### `renderCardsFromHtml` (`services/card-news-renderer.mjs`)

```js
import puppeteer from 'puppeteer-core';

const CARD_WIDTH = 1080;
const CARD_HEIGHT = 1350;
const ANIMATION_SETTLE_MS = 600;

export async function renderCardsFromHtml(html, expectedCardCount) {
  const executablePath = resolveBrowserExecutable();
  const browser = await puppeteer.launch({
    executablePath,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    headless: 'new',
  });

  try {
    const page = await browser.newPage();
    await page.setJavaScriptEnabled(false);
    await page.setViewport({
      width: CARD_WIDTH,
      height: CARD_HEIGHT * expectedCardCount,
      deviceScaleFactor: 1,
    });
    await page.setContent(html, { waitUntil: ['load'], timeout: 10000 });
    await page.evaluate(() => document.fonts.ready).catch(() => null);
    await new Promise((r) => setTimeout(r, ANIMATION_SETTLE_MS));

    const cardHandles = await page.$$('.card');
    if (cardHandles.length !== expectedCardCount) {
      throw new Error(`CARD_COUNT_MISMATCH: expected ${expectedCardCount}, got ${cardHandles.length}`);
    }

    const pngBuffers = [];
    for (const handle of cardHandles) {
      const buf = await handle.screenshot({ type: 'png', omitBackground: false });
      pngBuffers.push(buf);
    }
    return pngBuffers;
  } finally {
    await browser.close();
  }
}
```

### 백그라운드 job 전체 (`runCardnewsRenderJob`)

1. `renderCardsFromHtml(html, cardCount)` — 3분 hard timeout (`Promise.race`)
2. 병렬 R2 업로드 → `uploadBufferToR2(key, buffer)` × N
3. webhook complete/error 통지

### 타임아웃 / 상수

| 지점 | 값 | 이유 |
|---|---|---|
| `setContent` | 10초 | HTML 로드 실패 조기 감지 |
| 전체 render timeout (`Promise.race`) | 3분 | 15장 × 3초 + 업로드 여유 |
| 클라 SSE inactivity | 8분 | 기존 `inactivity-detector` 재사용 |
| `ANIMATION_SETTLE_MS` | 600ms | CSS @keyframes forwards 수렴 |

### 성능 예상

| 단계 | 시간 |
|---|---|
| Claude HTML 생성 (Sonnet) | 15~25초 |
| Chromium launch + setContent | 1~2초 |
| 폰트·애니메이션 settle | 0.6초 |
| 카드 N=10 screenshot | ~3초 |
| R2 업로드 병렬 (N=10) | ~2초 |
| **총** | **~25~35초** |

기존 Satori (~10초) 대비 2~3배 느림. 사용자가 8분 SSE 타임아웃 안에서는 충분히 빠름.

---

## 보안 + 에러 처리

### HTML Sanitize (`lib/cardnews/sanitize.js`)

cheerio 파서 기반. 제거 규칙:

- `<script>` 태그 전체
- `<iframe>`, `<object>`, `<embed>`, `<meta http-equiv>` 태그
- 모든 `on*` 이벤트 속성
- `javascript:` URL (`href`, `src`)
- `<link rel="stylesheet">` 중 호스트가 화이트리스트 밖(`cdn.jsdelivr.net`, `fonts.googleapis.com`, `fonts.gstatic.com` 만 허용)
- `<img src>` 가 `{{img:N}}` 패턴도 아니고 `cdn.ddukddaktool.co.kr`/`data:image/*` 도 아니면 제거

`issues` 배열을 반환. 5개 이상이면 warn 로그 (Claude 출력 이상 감지용).

### 이미지 placeholder 치환 (`resolveImagePlaceholders`)

```js
export function resolveImagePlaceholders(html, imageUrls) {
  return html.replace(/\{\{img:(\d+)\}\}/g, (match, idx) => {
    const n = Number(idx);
    return imageUrls[n] || TRANSPARENT_PLACEHOLDER_DATA_URL;
  });
}
```

N이 범위 벗어나면 transparent 1×1 data URL로 대체 (렌더 실패 방지).

### 카드 수 검증 (`validateCardCount`)

sanitize 후 cheerio로 `.card` 개수 카운트. 기대값과 다르면 `CARD_COUNT_MISMATCH` 에러 → **Claude 재시도 1회** (서버 내부, 사용자 모름).

### 에러 매트릭스

| 에러 코드 | 원인 | 서버 재시도 | 환불 |
|---|---|---|---|
| `CLAUDE_EMPTY_HTML` | Claude 응답 없음 | 1회 | 실패 시 자동 |
| `CLAUDE_HTML_MALFORMED` | cheerio 파싱 실패 | 1회 | 자동 |
| `CARD_COUNT_MISMATCH` | `.card` 개수 불일치 | 1회 | 자동 |
| `CHROMIUM_LAUNCH_FAILED` | Chromium 실행 에러 | 1회 | 자동 |
| `CHROMIUM_RENDER_FAILED` | 렌더 중 크래시 | 1회 | 자동 |
| `R2_UPLOAD_FAILED` | S3 에러 | 1회 | 자동 |
| `TIMEOUT` | 3분 초과 | 없음 | 자동 |
| `DISPATCH_FAILED` | Vercel→Railway 실패 | 없음 | 자동 |

### 자동 환불 — `job:meta:{jobId}`

카드뉴스 시작 시 Vercel이 Redis에 메타 저장:

```
job:meta:{jobId} = { userEmail, tool: 'cardnews', cost: 1, createdAt }
TTL: 3600초
```

Error callback 수신 시:

```js
const meta = await redis.get(`job:meta:${jobId}`);
if (meta?.userEmail && meta?.tool === 'cardnews') {
  await refundCredits(meta.userEmail, meta.cost, `cardnews-${body.errorCode}`);
  await redis.del(`job:meta:${jobId}`);  // 중복 환불 방지
}
```

Error webhook이 retry로 2번 오면 두 번째는 `job:meta` 없어 skip.

### 클라이언트 에러 UX

`useJobProgress` 훅이 error 이벤트 수신 시:
- 에러 메시지: "카드뉴스 생성에 실패했습니다. 크레딧은 환불되었습니다."
- 재시도 버튼
- error 코드별 부가 메시지:
  - `TIMEOUT`: "생성이 오래 걸려 중단했습니다"
  - `CARD_COUNT_MISMATCH`: "슬라이드 개수 생성 오류. 다시 시도해주세요"
  - 그 외: 일반 메시지

---

## 롤아웃 + 배포 순서

### 환경변수

| 이름 | 위치 | 설명 |
|---|---|---|
| `CARDNEWS_CHROMIUM_ROLLOUT` | **신규** (Vercel) | 0~100 정수. 코드 default 0. |

### 배포 순서

1. **Railway 먼저 배포**: `services/server.mjs` + puppeteer 의존성
   - `/render-cardnews` live
   - Vercel이 아직 호출 안 함
2. **Vercel 배포** + `ROLLOUT=0` 유지
   - 기존 Satori 그대로 동작
3. **Vercel env `ROLLOUT=10` → Redeploy**: 10% chromium 경로 진입

### 롤아웃 단계

| 단계 | 기간 | 트래픽 | 판정 기준 |
|---|---|---|---|
| `ROLLOUT=10` | 1~2일 | ~10% | 20 샘플+ 축적. error_rate < 5% && p95_latency < 45s |
| `ROLLOUT=50` | 1~2일 | ~50% | Railway CPU/memory 안정. 동시 렌더 경합 없음 |
| `ROLLOUT=100` | 1주 | 100% | 사용자 만족도 체감 |
| Satori 제거 PR | 1주 후 | - | `SLIDE_SYSTEM_PROMPT*` + Satori 카드뉴스 코드 제거 |

### 롤백 전략

프로덕션 이슈 시 `ROLLOUT=0` 으로 되돌리고 Vercel redeploy (30초). 클라이언트 즉시 Satori 경로로 복귀. 코드 revert 없이 해결.

---

## 테스트 전략

### Unit 테스트 (신규 `tests/unit/`)

| 파일 | 대상 | 예상 테스트 수 |
|---|---|---|
| `cardnews-sanitize.test.js` | `sanitizeCardNewsHtml` (script/iframe/on*/js URL/외부 stylesheet/img 화이트리스트/issues 반환) | ~12 |
| `cardnews-placeholder.test.js` | `resolveImagePlaceholders` (정상 치환/범위 초과/빈 배열/중복 placeholder/순서) | ~5 |
| `cardnews-validate.test.js` | `validateCardCount` (exact match/less/more/empty html) | ~4 |
| `cardnews-prompt-builder.test.js` | `buildCardnewsUserMessage` (Brand Kit 주입/이미지 목록/블로그 절삭/빈 Brand Kit fallback) | ~6 |
| `cardnews-callback-handler.test.js` | webhook handler (인증/progress/complete/error→환불/중복환불방지/meta 없을 때) | ~10 |

총 신규 ~37 테스트.

### 수동 E2E 체크리스트 (배포 후)

- [ ] `ROLLOUT=100` 임시, 본인 계정 강제 chromium 경로 → 카드뉴스 생성 성공
- [ ] 생성 완료 시간 < 45초
- [ ] 카드 N장 모두 PNG로 다운로드 가능
- [ ] 마이페이지 이미지 있으면 자동 배치 확인
- [ ] Brand Kit 색상이 반영됨
- [ ] 이모지 없음, 잘림 없음, 글자 overflow 없음
- [ ] `<script>` Claude 출력에 있어도 렌더 영향 없음 (sanitize 확인)
- [ ] 잘못된 요청 (빈 블로그 글, count=1) → 적절한 에러 + 환불
- [ ] 3분 타임아웃 시 환불 확인
- [ ] `ROLLOUT=50` 에서 Railway CPU/memory 지표 안정

### 관찰 로그 태그

- `[cardnews] Start` — variant, hashed email, slides
- `[cardnews-chromium] timing` — claude_ms, render_ms, upload_ms, total_ms
- `[cardnews-chromium] error` — errorCode, issues
- `[cardnews-chromium] retry` — 내부 재시도
- `[cardnews-sanitize]` — issues 5+ 이벤트

---

## 의존성

### 신규 npm packages (`services/package.json`)

- `puppeteer-core`: Chromium 실행. executable은 시스템 Chromium 공유
- `cheerio`: HTML 파싱 + sanitize

### 영향받는 기존 파일

- `services/Dockerfile` — 변경 없음 (Chromium 이미 있음)
- `services/shortform-remotion-render.mjs` — `resolveBrowserExecutable` export 필요 (내부 함수 → named export)
- `lib/user-images.js` — 변경 없음 (이미 public API 충분)
- `lib/brand-kit.js` — 변경 없음 (buildPromptContextForEmail 재활용)

---

## Deprecation 계획

`ROLLOUT=100` 안정 1주 후 별도 PR:

**제거 대상:**
- `app/api/card-news/route.js` 의 Satori 경로 (`SLIDE_SYSTEM_PROMPT`, `SLIDE_SYSTEM_PROMPT_SLIM`, `callSonnet`, `validateSlides` 중 카드뉴스용)
- `api/_satori-templates.js` 의 `renderCardNewsSlide` 등 카드뉴스 전용
- `lib/card-news-themes.js` (14테마)
- `lib/card-news-layouts.js`
- `lib/card-news-variants.js`
- `CARDNEWS_SLIM_PROMPT_ROLLOUT` env

**유지:**
- `api/_satori-renderer.js` — 블로그 프리미엄 이미지(`blog-image-pro`) 등에서 계속 사용
- Satori 의존성 — 다른 도구에서 쓰이는 한 유지

---

## Open Questions

없음. 9개 핵심 의사결정 + 5개 design section 모두 확정.
