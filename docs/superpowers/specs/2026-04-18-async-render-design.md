# Async Shortform Render Pipeline — Design Spec

- **Date**: 2026-04-18
- **Status**: Approved (pending user file review)
- **Related**: Week 2 블로커 A (Cloudflare 524 Gateway Timeout)
- **Next step**: `writing-plans` skill로 구현 plan 작성

---

## 문제 정의

현재 `/api/shortform-render`는 Vercel → Railway `/render`를 **동기 proxy**로 호출한다. Railway Remotion 렌더는 30초~10분 소요되는데, ddukddaktool.co.kr 앞단 Cloudflare의 기본 100초 proxy timeout에 먼저 걸려 **렌더 성공 여부와 무관하게 HTTP 524가 클라에 반환**된다.

Vercel `maxDuration: 300` 설정도 Node 실행 제한일 뿐 Cloudflare edge timeout은 뚫지 못한다. 결과적으로 30초 넘는 모든 숏폼 렌더가 실패로 표시되며, 4/25 정식 출시 블로커다.

## 목표

1. `/api/shortform-render`의 HTTP 응답 시간을 **3초 이내**로 고정한다.
2. 실제 렌더 진행 상황과 완료 결과를 클라에 **지연 없이** 전달한다.
3. 실패 시 **원인 추적 가능한** 단일 로그 스트림을 남긴다.
4. 출시 블로커 해결에 **스코프를 집중** — 크레딧 차감/환불은 별도 PR.

## 비목표

- Render resumption (Railway crash 시 중단된 프레임부터 재개) — 복잡도 과다, 이번 스코프 밖.
- Queue-based job 분산 (여러 Railway 워커) — 단일 워커로 4/25 출시 충분.
- 크레딧 차감/환불 로직 구현 — 다음 PR. 단, `parentJobId` 필드는 이번에 심어둔다.

---

## 아키텍처

```
┌─────────┐  ① POST {parentJobId, inputProps}    ┌──────────────┐
│  Client │ ─────────────────────────────────────▶│ Vercel:      │
│         │                                        │ /shortform-  │
│         │◀──────── ② 202 {jobId} ───────────────│  render      │
│         │                                        └──────┬───────┘
│         │                                               │ ③ POST /render
│         │                                               ▼
│         │                                        ┌──────────────┐
│         │                                        │ Railway:     │
│         │                                        │ /render      │
│         │◀────── ⑤ SSE progress/complete ────────┤              │
│         │                                        │ ┌────────┐   │
│         │           (via Redis)                  │ │Remotion│   │
│         │                                        │ │+ R2    │   │
│         │                                        │ └────┬───┘   │
│         │                                        └──────┼───────┘
│         │                                               │ ⑥ webhook
│         │                                               ▼
│         │                                        ┌──────────────┐
│         │                                        │ Vercel:      │
│         │                                        │ /shortform-  │
│         │                                        │ render-      │
│         │                                        │  callback    │
│         │                                        └──────┬───────┘
│         │                                               │ ⑦ publishProgress
│         │                                               ▼
│         │           ┌──────────────┐             ┌──────────────┐
│         │◀──────────│ /shortform-  │◀────────────│ Redis        │
│         │           │  progress    │   tail poll │ job:history: │
│         │           │  (SSE)       │             │   {jobId}    │
└─────────┘           └──────────────┘             └──────────────┘
```

### 핵심 변화
- Cloudflare 524 원인인 "Vercel 100초 hold"를 제거 — `/api/shortform-render`는 **항상 1초 안에 202 반환**.
- 실 렌더는 Railway 프로세스의 백그라운드 Promise에서 실행.
- Redis가 이벤트 hub. Railway가 직접 쓰지 않고 Vercel webhook을 거쳐 **schema 단일 소유 원칙 유지**.

---

## 컴포넌트 변경

### 신규 파일 (1)

- `app/api/shortform-render-callback/route.js`
  - Railway → Vercel webhook 수신 엔드포인트
  - `x-render-secret` 헤더 검증
  - `publishProgress`로 Redis에 이벤트 push
  - Idempotency: 같은 `jobId`에 이미 `complete`/`error` 이벤트가 있으면 skip

### 수정 파일 (4)

1. **`app/api/shortform-render/route.js`**
   - 동기 `await fetch(...)` 제거 → Railway에 POST 후 **202 status만 확인**하고 즉시 반환
   - 응답 shape 변경: `{ url, duration, jobId }` → `{ jobId, accepted: true }` (202)
   - Railway 호출 실패(타임아웃/401/500) → `publishProgress` error 이벤트 + 클라 502 응답
   - Body에 `parentJobId` 필드 수신 후 Railway로 전달 (이번 PR에서는 Railway는 사용 안 함, 다음 PR에서 refund 트리거에 사용)

2. **`services/server.mjs`**
   - `/render` 핸들러를 fire-and-forget 패턴으로 리팩토링
   - 요청 파싱 후 즉시 `res.status(202).json({ jobId, accepted: true })`
   - 렌더·업로드는 별도 async function(`runRenderJob`)에서 실행
   - Remotion `onProgress` 콜백 → 10% 단위로 webhook `progress` 이벤트 호출
   - 완료/실패 시 webhook `complete`/`error` 이벤트 호출
   - Webhook 호출 헬퍼: exponential backoff 3회 (1s → 3s → 9s), 5xx·네트워크 에러만 재시도, 4xx는 즉시 포기
   - Render timeout: `Promise.race`로 10분 hard cap → 초과 시 `errorCode: 'TIMEOUT'`

3. **`app/shortform/ShortformClient.js` — `handleRender` 함수**
   - 새 render jobId 발급(`crypto.randomUUID()`) — 기존 script jobId 재활용 중단
   - `setJobId(newRenderJobId)` → `useJobProgress` 훅이 자동으로 SSE 재연결
   - Body에 `parentJobId: scriptJobId` 추가
   - `await res.json().url` 제거 — render 결과는 SSE `complete` 이벤트의 `result.url`에서 수신
   - `useJobProgress.result` / `.status` / `.error` 변화를 render UI(`renderStatus`, `renderVideoUrl`)에 bridge하는 `useEffect` 추가

4. **`app/shortform/hooks/useJobProgress.js`**
   - Inactivity timeout 추가: 마지막 `step`/`progress`/`complete`/`error` 이벤트 이후 8분 무소식 시 `status='error'`, `error='렌더 서버 응답이 없습니다.'`
   - SSE comment heartbeat(15초)는 타임스탬프 갱신에 포함하지 **않음** — 명시적 진행률 이벤트만 "살아있음" 신호로 취급

### 경계 변경 없음

- `lib/job-progress.js` — 그대로. Schema/TTL/키 모두 유지.
- `app/api/shortform-progress/route.js` — 그대로. SSE polling 그대로 작동.
- `services/package.json` — `@upstash/redis`는 런타임 사용 중단(아키텍처 원칙: Railway가 Redis 직접 접근 금지). 의존성 제거는 후속 PR에서 처리(diff 최소화).

---

## 데이터 플로우 + 계약

### Webhook: `POST /api/shortform-render-callback`

**요청 헤더**
```
Content-Type: application/json
x-render-secret: <RENDER_SECRET>
```

**요청 바디 — 세 가지 이벤트 타입**

```json
// ① progress
{
  "type": "progress",
  "jobId": "render_xxx",
  "progress": 0.45,
  "framesRendered": 540,
  "framesTotal": 1200
}

// ② complete
{
  "type": "complete",
  "jobId": "render_xxx",
  "url": "https://cdn.ddukddaktool.co.kr/shortform/render_xxx.mp4",
  "durationSec": 28.3,
  "elapsedMs": 127000
}

// ③ error
{
  "type": "error",
  "jobId": "render_xxx",
  "errorCode": "REMOTION_RENDER_FAILED",
  "errorMessage": "Chromium OOM"
}
```

**응답**
- `200 { ok: true }` — publishProgress 성공
- `200 { ok: true, skipped: "duplicate" }` — 이미 terminal 이벤트 publish됨 (idempotent)
- `400 { error: "invalid body" }` — 필수 필드 누락 or 알 수 없는 type
- `401 { error: "unauthorized" }` — secret 불일치
- `500 { error: "redis error" }` — Redis 장애 → Railway가 재시도

### Render JobId 체계

```
Script 생성 시: scriptJobId = crypto.randomUUID()
  → useJobProgress(scriptJobId) SSE 구독
  → script complete 이벤트 → EventSource close

Render 시작 시: renderJobId = crypto.randomUUID()  (신규)
  → POST /shortform-render body = { jobId: renderJobId, parentJobId: scriptJobId, inputProps }
  → ShortformClient가 setJobId(renderJobId)
  → useJobProgress가 새 SSE 연결
  → render progress/complete/error 수신
```

### Redis 이벤트 변환 (webhook → publishProgress)

| Webhook body | publishProgress 호출 | useJobProgress state 영향 |
|---|---|---|
| `{type:'progress', progress:0.45}` | `{type:'step', step:'video-render', status:'running', progress:0.45}` | `steps['video-render'].progress = 0.45` |
| `{type:'complete', url, durationSec, elapsedMs}` | `{type:'complete', step:'video-render', status:'done', result:{url,durationSec,elapsedMs}}` | `result = {url,...}`, `status='complete'` |
| `{type:'error', errorCode, errorMessage}` | `{type:'error', step:'video-render', errorCode, message:'렌더링에 실패했습니다.'}` | `error='렌더링에 실패했습니다.'`, `status='error'` |

`errorMessage`는 Redis에 로그용으로만 저장하고 클라에는 내려가지 않는다. 사용자에게는 항상 `message` 필드의 일반화된 메시지가 보인다.

---

## 에러 핸들링

### 실패 시나리오 매트릭스

| # | 시나리오 | 감지 지점 | 처리 |
|---|---------|----------|------|
| 1 | Vercel → Railway 네트워크 실패 | `/api/shortform-render`의 `fetch` catch | `publishProgress` error + 클라 502 |
| 2 | Railway 202 대신 4xx/5xx 반환 | `/api/shortform-render` 응답 status 체크 | 위와 동일 |
| 3 | Railway Remotion 렌더 실패 | Railway 내부 `try/catch` → error webhook | webhook이 `publishProgress` error |
| 4 | Railway R2 업로드 실패 | Railway 내부 catch → error webhook (`errorCode:'R2_UPLOAD_FAILED'`) | 동일 |
| 5 | Railway 10분 hard timeout 초과 | `Promise.race` → error webhook (`errorCode:'TIMEOUT'`) | 동일 |
| 6 | Railway → Vercel webhook 호출 실패 | Railway retry 헬퍼 | Exp backoff 3회 (1s/3s/9s). 3회 실패 시 Railway 로그 `webhook_permanent_failure` + 포기 → ⑦로 넘어감 |
| 7 | Webhook 영구 실패 / Railway crash / 네트워크 단절 | 클라 `useJobProgress` inactivity timer | 마지막 이벤트 후 8분 무소식 → `status='error'`, `error='렌더 서버 응답이 없습니다.'` |

### Webhook 중복 방지

Railway retry로 동일 `complete`/`error` 이벤트가 Vercel에 2번 도착할 수 있다. `/shortform-render-callback`에서:

```js
const recent = await readHistoryTail(jobId, 0);
const alreadyTerminal = recent.some(e => e.type === 'complete' || e.type === 'error');
if ((body.type === 'complete' || body.type === 'error') && alreadyTerminal) {
  return jsonResponse({ ok: true, skipped: 'duplicate' });
}
```

`progress` 이벤트는 중복 허용 — UI는 monotonic 체크로 뒤로 가는 progress를 무시한다.

### 클라 inactivity timeout 구현 요지

`useJobProgress` 훅 내부:

```js
const lastEventTsRef = useRef(Date.now());

const handleStep = (ev) => { /* ... */ lastEventTsRef.current = Date.now(); };
const handleComplete = (ev) => { /* ... */ lastEventTsRef.current = Date.now(); };

const inactivityTimer = setInterval(() => {
  if (statusRef.current !== 'running') return;
  if (Date.now() - lastEventTsRef.current > 8 * 60 * 1000) {
    setStatus('error');
    setError('렌더 서버 응답이 없습니다. 새로고침 후 다시 시도해주세요.');
    es.close();
  }
}, 30_000);
```

SSE comment heartbeat(`: heartbeat ...`)는 EventSource가 받아도 named-event가 아니라 `onmessage` 대상. 훅은 명시적 named 이벤트(`step`/`complete`/`error`/`cancelled`)만 listen하므로 heartbeat는 타임스탬프 갱신에 영향 주지 않는다. 이는 의도된 동작.

### 크레딧 환불 (다음 PR)

이번 PR 스코프 밖. 단, `parentJobId`가 `/shortform-render` body → Railway `/render` body → webhook body까지 흐르도록 심어둔다. 다음 PR에서 callback 라우트가 error 이벤트 수신 시 `parentJobId` 기준으로 refund 트리거.

---

## 테스트 전략

### 현실: 이 코드베이스 테스트 인프라 부재

`package.json`에 Jest/Vitest 없음. `*.test.js` 파일은 node_modules 내부뿐. 기존 운영 방식은 **수동 E2E + 프로덕션 로그 관찰**. 이 spec도 그 현실에 맞춰 3-layer로 제시.

### Layer 1 — 수동 E2E (PR 머지 전 필수)

로컬 dev + preview 배포에서 순차 실행:

**Happy path**
- [ ] 30초 영상 → 1~2분 내 SSE complete 수신 + videoUrl 재생 OK
- [ ] 60초 영상 → 2~3분 내 동일
- [ ] 90초 영상 → 4분 내 동일
- [ ] Remotion onProgress → 클라 프로그레스바 10%→20%→...→100% 단조 증가

**Cloudflare 524 회귀 방지**
- [ ] 클라 Network 탭 확인: `/api/shortform-render` 응답 시간 < 3초 (구: 100초+)
- [ ] 렌더 6분+ 걸려도 클라에 524 에러 없음

**에러 경로**
- [ ] Railway 강제 crash (`process.exit` 수동 호출) → 8분 후 클라 inactivity timeout 에러
- [ ] Railway `/render`에 `inputProps` 누락 → Vercel 즉시 502 반환
- [ ] Webhook secret 일부러 mismatch → Railway 로그 401 retry 기록 + 3회 후 영구 실패

**중복 이벤트**
- [ ] Railway webhook을 `curl`로 2회 호출 → Redis history에 `complete` 1건만 존재

### Layer 2 — 유닛 테스트 (신규 3파일)

Node 18+ 내장 `node --test` 사용. 외부 의존성 0. `tests/` 디렉토리 신설.

```
tests/
├── shortform-render-callback.test.mjs
├── railway-webhook-retry.test.mjs
└── jobid-flow.test.mjs
```

**shortform-render-callback.test.mjs**
- 올바른 secret + complete body → publishProgress 1회 호출
- secret 누락 → 401
- 필수 필드 누락 → 400
- 같은 jobId에 complete 2회 → 2번째는 `skipped:'duplicate'`
- Redis mock이 throw → 500

**railway-webhook-retry.test.mjs**
- 200 → 즉시 성공, retry 안 함
- 500 한 번 후 200 → 1회 retry 후 성공
- 500 3번 → 3회 후 영구 실패
- 400 → 즉시 포기
- Fake timer로 backoff 1s/3s/9s 검증

**jobid-flow.test.mjs**
- `handleRender` 진입 시 새 UUID 발급
- body에 `parentJobId = scriptJobId`
- `setJobId` 호출로 `useJobProgress` 재구독

Mock: Redis는 in-memory Map, `fetch`는 globalThis.fetch 스텁.

### Layer 3 — 프로덕션 관찰 (출시 후 1주)

Vercel/Railway 로그 매일 확인:
- `[SHORTFORM-RENDER]` ok 비율 > 95%
- `[WEBHOOK-CALLBACK] duplicate` skip 발생 빈도 (retry 과다 시 원인 조사)
- `[WEBHOOK-CALLBACK]` 401/400 빈도 → secret 설정 오류 조기 감지
- 평균 렌더 소요 p50/p95/p99 → 다음 PR에서 타임아웃 조정 데이터

### 스코프 제외

- Remotion 렌더 내부 로직
- 크레딧 차감/환불
- SSE heartbeat 세부 타이밍 (기존 동작 유지)

---

## 타임아웃 / 설정값 요약

| 층 | 값 | 근거 |
|---|---|---|
| Vercel `/api/shortform-render` maxDuration | 30초 | 기존 300초에서 축소. fire-and-forget이라 불필요. |
| Vercel `/api/shortform-render-callback` maxDuration | 10초 | Redis 1 write 작업만. |
| Railway 렌더 hard timeout | 10분 | 90초 영상 최악 4분 × 2배 마진. 첫 출시는 보수적. |
| Webhook retry backoff | 1s / 3s / 9s (총 13초) | Vercel cold start 수 초 + 여유. |
| 클라 SSE inactivity timeout | 8분 | Railway 10분 안에 complete/error가 오지 않으면 이상 상황. |

모두 관찰 후 조정 가능하며, 이번 PR 후 1주간 로그 수집 → 다음 PR에서 p95 기반으로 좁힌다.

---

## 환경변수 영향

| 이름 | 기존/신규 | 설명 |
|---|---|---|
| `RAILWAY_RENDER_URL` | 기존 | 변경 없음 |
| `RENDER_SECRET` | 기존 | **양방향 재사용** — Vercel→Railway 호출 / Railway→Vercel webhook 양쪽에서 동일 값 검증 |
| `WEBHOOK_BASE_URL` | **신규 (Railway 측)** | Railway가 Vercel webhook URL 구성에 사용. 예: `https://ddukddaktool.co.kr`. Vercel에는 추가 불필요. |
| `WEBHOOK_PATH` | 하드코드 | `/api/shortform-render-callback`로 Railway 코드에 상수. |

Vercel/Railway 양쪽 환경변수 콘솔에 `WEBHOOK_BASE_URL` 추가 필요 — 배포 체크리스트에 포함.

---

## 배포 순서 (release plan 초안)

1. **Railway 먼저 배포** — fire-and-forget `/render` + webhook 호출 로직 포함. 아직 Vercel에는 callback 엔드포인트 없음 → webhook 404 받을 것. Railway는 retry 후 포기.
2. **Vercel 배포** — `/shortform-render-callback` + `/shortform-render` 수정 + 클라 변경. 이 시점부터 e2e 정상 동작.
3. **양쪽 환경변수 확인** — `RENDER_SECRET`, `WEBHOOK_BASE_URL` 일치 여부.
4. **스모크 테스트** — 30초 영상 1개 렌더 → 클라에서 완료 확인.
5. **관찰** — 1주간 로그 데일리 리뷰.

롤백 전략: Railway 이전 image로 재배포하면 `/render`는 다시 동기 응답. Vercel `/api/shortform-render`도 동기로 되돌리는 revert 커밋 준비. `feature flag`는 이번 PR 스코프 밖 — 추가 복잡도 불필요.

---

## Open Questions

**없음.** 7개 핵심 의사결정 모두 확정:

1. Webhook 방식 ✅
2. Railway fire-and-forget ✅
3. Webhook 재시도 exp backoff 3회 ✅
4. 새 render jobId + parentJobId ✅
5. 크레딧 차감은 다음 PR ✅
6. 타임아웃 (Railway 10분 / 클라 8분) ✅
7. Webhook auth: 기존 `RENDER_SECRET` 재사용 ✅
