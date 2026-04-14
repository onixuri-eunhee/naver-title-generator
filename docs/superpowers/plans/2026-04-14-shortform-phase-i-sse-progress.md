# Phase I — SSE Progress + Cancel: 실시간 진행 표시 + 취소

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. 12 Phase 중 Phase I. 마스터 플랜: `2026-04-14-shortform-master-plan.md`. 스펙: `2026-04-14-shortform-benchmark-pipeline-design.md` §16~17.

**Goal:** 벤치마킹·대본·영상 렌더에 30~90초 걸리는 상황에서 "무작정 기다리는 느낌"을 없앤다. Server-Sent Events(SSE)로 단계별 진행 상태를 실시간 푸시하고, 취소 버튼으로 진행 중 작업을 안전하게 중단 + 환불 정책을 적용한다. 브라우저를 닫아도 작업은 백엔드에서 계속 진행되고 결과는 마이페이지에 누적된다.

**Architecture:** Redis pub/sub를 중앙 버스로 사용. 백엔드 파이프라인(benchmark / script)은 각 체크포인트에서 `publishProgress(jobId, event)`를 호출하고, 동시에 `checkCancelled(jobId)`로 취소 플래그를 확인한다. SSE 엔드포인트는 Redis 구독자 역할로 client에 이벤트를 흘려보내고, client 측 `useJobProgress` 훅이 `EventSource`로 구독한 뒤 `<ProgressIndicator />`에 state를 바인딩한다. 크레딧 차감 시점을 **Step 7 영상 렌더 시작**으로 확정해 환불 로직을 단순화한다.

**Tech Stack:** Next.js 15 App Router, @upstash/redis pub/sub, EventSource API, React hooks

**의존성:** Phase B (shortform-benchmark), Phase D (shortform-script) — 두 라우트의 주요 체크포인트에 publish 지점을 삽입해야 하므로 B/D가 어느 정도 진행된 후 시작 가능

**예상 작업량:** 13 task, 약 1.5 주

---

## 파일 구조

### 신규 파일

```
lib/job-progress.js                           Redis pub/sub publishProgress / subscribeProgress / checkCancelled
lib/cancelled-error.js                        CancelledError 클래스
app/api/shortform-progress/route.js           SSE 엔드포인트 (GET ?jobId=xxx)
app/api/shortform-cancel/route.js             취소 엔드포인트 (POST ?jobId=xxx)
app/shortform/hooks/useJobProgress.js         React 훅 — EventSource 구독
components/ProgressIndicator.js               단계별 진행 UI
components/ProgressIndicator.module.css
```

### 수정 파일

```
app/api/shortform-benchmark/route.js          진행 이벤트 publish (keyword-extraction, youtube-search, video-analysis)
app/api/shortform-benchmark/analyze/route.js  진행 이벤트 publish (Gemini 분석 sub-step)
app/api/shortform-script/route.js             진행 이벤트 publish + 크레딧 차감 시점 조정 + 환불 정책
app/shortform/ShortformClient.js              jobId 발급 + useJobProgress 연결 + 취소 버튼
```

---

## SSE 이벤트 규격 (전 Phase 공통 계약)

```
event: step
data: { "step": "keyword-extraction", "status": "running", "progress": 0 }

event: step
data: { "step": "keyword-extraction", "status": "done", "progress": 100 }

event: step
data: { "step": "youtube-search", "status": "running", "progress": 30, "subStep": "query-2/5" }

event: step
data: { "step": "youtube-search", "status": "done", "result": { "candidates": 5 } }

event: step
data: { "step": "video-analysis", "status": "running", "subStep": "video-1/3", "progress": 50 }

event: step
data: { "step": "script-generation", "status": "running", "progress": 70 }

event: complete
data: { "result": { "scriptId": "...", "projectId": "..." } }

event: error
data: { "error": "Gemini 응답 schema 검증 실패", "step": "video-analysis", "recoverable": false }

event: cancelled
data: { "cancelledAt": "video-analysis", "refundCredits": 0 }
```

**Step ID 고정 목록 (변경 금지):**

| step | 발생 Phase | subStep |
|---|---|---|
| `keyword-extraction` | B | 없음 |
| `youtube-search` | B | `query-N/5` |
| `video-analysis` | B | `video-N/M` |
| `script-generation` | D | `draft` / `caption` |
| `tts-synthesis` | D | `voice-N` |
| `video-render` | F (Phase 7) | `scene-N` |
| `upload-youtube` | J | `chunk-N/M` |

---

## Task I0: 사전 준비 — 기존 체크포인트 매핑

Phase I를 시작하기 전에 Phase B·D가 진행한 라우트에서 어떤 비동기 단계가 존재하는지 먼저 파악해야 publish 지점을 빠뜨리지 않는다.

- [ ] **Step 1: 기존 라우트 그레프**

```bash
cd /Users/gong-eunhui/Desktop/naver-title-generator
grep -n "await " app/api/shortform-benchmark/route.js | head -30
grep -n "await " app/api/shortform-script/route.js | head -30
```

Expected: 키워드 추출, YouTube 검색, 비디오 분석, Claude 호출 등의 `await` 지점이 나온다. 각각에 publishProgress를 삽입할 계획을 세운다.

- [ ] **Step 2: 체크포인트 리스트 확정**

다음 형식으로 `.worktrees` 또는 작업 메모에 저장:

```
benchmark:
  L45 추출 시작 → keyword-extraction running
  L52 추출 끝 → keyword-extraction done
  L60~95 5쿼리 루프 → youtube-search running (query-N/5)
  L100 merge → youtube-search done
  L110~150 분석 루프 → video-analysis running (video-N/M)
  L160 분석 끝 → video-analysis done

script:
  L80 Claude 호출 직전 → script-generation running
  L150 대본 응답 파싱 → script-generation done
```

실제 라인 번호는 Phase B/D 머지 시점 기준으로 달라지므로 시작 직전에 재확인.

- [ ] **Step 3: 커밋 없음**

이 task는 조사만 수행. 다음 task부터 실제 코드 변경.

---

## Task I1: lib/job-progress.js — Redis pub/sub 헬퍼

**Files:**
- Create: `lib/job-progress.js`
- Create: `lib/cancelled-error.js`

- [ ] **Step 1: CancelledError 클래스 작성**

```javascript
// lib/cancelled-error.js
/**
 * 진행 중인 작업이 사용자에 의해 취소되었을 때 던지는 에러.
 * catch 블록에서 if (err instanceof CancelledError) 로 분기한다.
 */
export class CancelledError extends Error {
  constructor(jobId, checkpoint) {
    super(`Job ${jobId} cancelled at ${checkpoint}`);
    this.name = 'CancelledError';
    this.jobId = jobId;
    this.checkpoint = checkpoint;
  }
}
```

- [ ] **Step 2: job-progress.js 작성**

```javascript
// lib/job-progress.js
/**
 * 숏폼 파이프라인 전 단계에서 공용으로 사용하는 진행 이벤트 버스.
 *
 * 설계 원칙:
 * - Redis pub/sub 채널: `job:progress:{jobId}`
 * - 이력(replay)용 list 키: `job:history:{jobId}` (TTL 1시간)
 * - 취소 플래그: `job:cancel:{jobId}` (boolean)
 * - 모든 이벤트는 JSON 직렬화
 */
import { getRedis } from '@/lib/api-helpers';
import { CancelledError } from '@/lib/cancelled-error';

const HISTORY_TTL_SEC = 3600;
const CANCEL_TTL_SEC = 3600;
const MAX_HISTORY = 200;

function channelKey(jobId) {
  return `job:progress:${jobId}`;
}
function historyKey(jobId) {
  return `job:history:${jobId}`;
}
function cancelKey(jobId) {
  return `job:cancel:${jobId}`;
}

/**
 * 진행 이벤트를 발행한다.
 *
 * @param {string} jobId UUID
 * @param {object} event { type: 'step'|'complete'|'error'|'cancelled', ...payload }
 */
export async function publishProgress(jobId, event) {
  if (!jobId) return;
  const redis = getRedis();
  const payload = JSON.stringify({
    ...event,
    ts: Date.now(),
  });
  try {
    // Upstash Redis는 publish + rpush 동시 지원
    await Promise.all([
      redis.publish(channelKey(jobId), payload),
      redis.rpush(historyKey(jobId), payload),
    ]);
    await redis.expire(historyKey(jobId), HISTORY_TTL_SEC);
    // 히스토리 길이 제한 (안전장치)
    await redis.ltrim(historyKey(jobId), -MAX_HISTORY, -1);
  } catch (err) {
    console.error('[job-progress] publish 실패:', err?.message);
  }
}

/**
 * 히스토리 전체를 순서대로 읽어 반환한다. SSE 재연결 시 replay 용도.
 */
export async function readHistory(jobId) {
  if (!jobId) return [];
  const redis = getRedis();
  try {
    const items = await redis.lrange(historyKey(jobId), 0, -1);
    return items
      .map((s) => {
        try {
          return JSON.parse(s);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch (err) {
    console.error('[job-progress] readHistory 실패:', err?.message);
    return [];
  }
}

/**
 * 취소 플래그 설정. 라우트 핸들러(/api/shortform-cancel)에서 호출.
 */
export async function requestCancel(jobId) {
  if (!jobId) return false;
  const redis = getRedis();
  try {
    await redis.set(cancelKey(jobId), '1', { ex: CANCEL_TTL_SEC });
    return true;
  } catch (err) {
    console.error('[job-progress] requestCancel 실패:', err?.message);
    return false;
  }
}

/**
 * 파이프라인 내부에서 체크포인트마다 호출.
 * 취소 플래그가 켜져 있으면 CancelledError를 throw.
 */
export async function checkCancelled(jobId, checkpoint) {
  if (!jobId) return;
  const redis = getRedis();
  try {
    const flag = await redis.get(cancelKey(jobId));
    if (flag) {
      throw new CancelledError(jobId, checkpoint);
    }
  } catch (err) {
    if (err instanceof CancelledError) throw err;
    console.error('[job-progress] checkCancelled 실패:', err?.message);
  }
}

/**
 * 작업 종료 시 정리 (cancel 플래그 제거 + 히스토리는 TTL 자연 소멸).
 */
export async function cleanupJob(jobId) {
  if (!jobId) return;
  const redis = getRedis();
  try {
    await redis.del(cancelKey(jobId));
  } catch {}
}

/**
 * 새 jobId 발급 (클라이언트가 요청 헤더에 넣어 보낼 때 서버에서도 대응).
 * 라우트에서 body.jobId가 없으면 이 함수로 생성.
 */
export function createJobId() {
  // crypto.randomUUID는 edge/node 모두 지원
  return globalThis.crypto?.randomUUID?.() || `job_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}
```

- [ ] **Step 3: 빌드 체크**

```bash
npx next build 2>&1 | grep -iE "error|✓ Compiled" | head -10
```

Expected: 컴파일 성공. Redis 연결은 런타임에 발생하므로 빌드 영향 없음.

- [ ] **Step 4: 커밋**

```bash
git add lib/job-progress.js lib/cancelled-error.js
git commit -m "$(cat <<'EOF'
feat(lib): job-progress Redis pub/sub 버스 + CancelledError

숏폼 파이프라인 전 단계의 진행 이벤트/취소 플래그를 공통 관리.
- publishProgress: 채널 publish + 히스토리 rpush (TTL 1시간)
- readHistory: SSE 재연결 시 replay
- requestCancel: job:cancel:{jobId} 설정
- checkCancelled: 체크포인트에서 호출 → CancelledError throw
- cleanupJob / createJobId
EOF
)"
```

---

## Task I2: SSE 엔드포인트 — /api/shortform-progress

**Files:**
- Create: `app/api/shortform-progress/route.js`

- [ ] **Step 1: SSE 라우트 작성**

```javascript
// app/api/shortform-progress/route.js
import { getRedis } from '@/lib/api-helpers';
import { readHistory } from '@/lib/job-progress';

// SSE는 Edge가 아닌 Node runtime에서 안정적
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/shortform-progress?jobId=xxx
 *
 * Server-Sent Events로 진행 상태를 push한다.
 * 1. 연결 직후: 히스토리(replay) 플러시
 * 2. 이후: Redis subscribe로 실시간 수신 → SSE로 push
 * 3. 클라이언트가 연결을 끊으면 subscribe 정리
 */
export async function GET(request) {
  const url = new URL(request.url);
  const jobId = url.searchParams.get('jobId');

  if (!jobId) {
    return new Response('jobId required', { status: 400 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const send = (event, data) => {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
          );
        } catch (err) {
          // 클라이언트가 끊어진 상태
          closed = true;
        }
      };

      // 0. 주기적 heartbeat (프록시 timeout 방지)
      const heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`: heartbeat ${Date.now()}\n\n`));
        } catch {
          closed = true;
        }
      }, 15000);

      // 1. 히스토리 replay
      try {
        const history = await readHistory(jobId);
        for (const item of history) {
          const type = item.type || 'step';
          send(type, item);
          if (item.type === 'complete' || item.type === 'error' || item.type === 'cancelled') {
            // 이미 끝난 잡 → 바로 종료
            clearInterval(heartbeat);
            try { controller.close(); } catch {}
            return;
          }
        }
      } catch (err) {
        console.error('[sse] history replay 실패:', err?.message);
      }

      // 2. Redis subscribe
      // 주의: @upstash/redis는 REST 기반이므로 네이티브 subscribe가 없다.
      // 대안: short polling (1초 간격)으로 히스토리 tail 읽기
      let lastLen = 0;
      try {
        const redis = getRedis();
        const initial = await redis.lrange(`job:history:${jobId}`, 0, -1);
        lastLen = initial.length;
      } catch {}

      const poller = setInterval(async () => {
        if (closed) return;
        try {
          const redis = getRedis();
          const all = await redis.lrange(`job:history:${jobId}`, lastLen, -1);
          if (all && all.length > 0) {
            for (const raw of all) {
              let parsed;
              try {
                parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
              } catch {
                continue;
              }
              const type = parsed.type || 'step';
              send(type, parsed);
              if (type === 'complete' || type === 'error' || type === 'cancelled') {
                clearInterval(poller);
                clearInterval(heartbeat);
                closed = true;
                try { controller.close(); } catch {}
                return;
              }
            }
            lastLen += all.length;
          }
        } catch (err) {
          console.error('[sse] poll 실패:', err?.message);
        }
      }, 800);

      // 3. 연결 종료 처리
      request.signal?.addEventListener('abort', () => {
        closed = true;
        clearInterval(poller);
        clearInterval(heartbeat);
        try { controller.close(); } catch {}
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // nginx 버퍼 off
    },
  });
}
```

> **주의:** Upstash Redis REST API는 `SUBSCRIBE` 미지원. Short polling(800ms)로 tail을 읽는 방식으로 대체. 메인 publisher(파이프라인)는 여전히 `rpush`로 이력을 쌓기 때문에 subscribe 없이도 이벤트 손실이 없다.

- [ ] **Step 2: 수동 검증 (빌드 후)**

```bash
npx next build 2>&1 | grep -iE "error|✓ Compiled" | head -10
```

Expected: `✓ Compiled successfully`.

- [ ] **Step 3: 커밋**

```bash
git add app/api/shortform-progress/route.js
git commit -m "$(cat <<'EOF'
feat(api): /api/shortform-progress SSE 엔드포인트

Upstash REST 한계 때문에 subscribe 대신 800ms short-polling으로 히스토리
tail을 읽어 클라이언트로 푸시. heartbeat 15초로 프록시 timeout 회피.
연결 직후 replay + 이후 실시간 이벤트 + complete/error/cancelled 시 종료.
EOF
)"
```

---

## Task I3: 취소 엔드포인트 — /api/shortform-cancel

**Files:**
- Create: `app/api/shortform-cancel/route.js`

- [ ] **Step 1: 라우트 작성**

```javascript
// app/api/shortform-cancel/route.js
import {
  extractToken,
  resolveSessionEmail,
  jsonResponse,
  handleOptions,
} from '@/lib/api-helpers';
import { requestCancel, publishProgress } from '@/lib/job-progress';

export const runtime = 'nodejs';

export async function OPTIONS(request) {
  return handleOptions(request);
}

/**
 * POST /api/shortform-cancel?jobId=xxx
 *
 * 사용자가 "취소" 버튼을 눌렀을 때 호출.
 * 1. 로그인 검증
 * 2. job:cancel:{jobId} Redis 플래그 설정
 * 3. SSE 구독자에게 cancelled 이벤트 발행 (파이프라인은 다음 checkpoint에서 실제 throw)
 */
export async function POST(request) {
  const token = extractToken(request);
  const email = await resolveSessionEmail(token);
  if (!email) {
    return jsonResponse(request, { error: '로그인이 필요합니다.' }, { status: 401 });
  }

  const url = new URL(request.url);
  const jobId = url.searchParams.get('jobId');
  if (!jobId) {
    return jsonResponse(request, { error: 'jobId required' }, { status: 400 });
  }

  const ok = await requestCancel(jobId);
  // 즉시 cancelled 이벤트도 발행 (클라이언트가 바로 반응할 수 있게)
  await publishProgress(jobId, {
    type: 'cancelled',
    cancelledAt: 'user-request',
    note: '사용자 취소 요청 수신',
  });

  return jsonResponse(request, { success: ok });
}
```

- [ ] **Step 2: 빌드 체크**

```bash
npx next build 2>&1 | grep -iE "error|✓ Compiled" | head -10
```

Expected: 컴파일 성공.

- [ ] **Step 3: 커밋**

```bash
git add app/api/shortform-cancel/route.js
git commit -m "$(cat <<'EOF'
feat(api): /api/shortform-cancel 취소 엔드포인트

로그인 검증 후 job:cancel:{jobId} Redis 플래그를 설정하고 SSE로
cancelled 이벤트를 즉시 발행한다. 실제 파이프라인 중단은 다음
checkpoint에서 checkCancelled가 CancelledError를 throw하는 방식.
EOF
)"
```

---

## Task I4: useJobProgress 훅 — EventSource 구독

**Files:**
- Create: `app/shortform/hooks/useJobProgress.js`

- [ ] **Step 1: 훅 작성**

```javascript
// app/shortform/hooks/useJobProgress.js
'use client';

import { useEffect, useRef, useState, useCallback } from 'react';

/**
 * 숏폼 진행 상태 SSE 구독 훅.
 *
 * 사용:
 *   const { steps, current, status, error, cancel } = useJobProgress(jobId);
 *
 * Returns:
 *   - steps: Map<stepId, { status: 'idle'|'running'|'done'|'error', progress, subStep }>
 *   - current: 현재 running 중인 step id (없으면 null)
 *   - status: 'idle' | 'running' | 'complete' | 'error' | 'cancelled'
 *   - result: complete 시 payload
 *   - error: error 시 메시지
 *   - cancel(): 취소 호출
 */
export function useJobProgress(jobId, { authToken } = {}) {
  const [steps, setSteps] = useState({});
  const [current, setCurrent] = useState(null);
  const [status, setStatus] = useState('idle');
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const esRef = useRef(null);

  useEffect(() => {
    if (!jobId) return undefined;

    setStatus('running');
    setSteps({});
    setCurrent(null);
    setResult(null);
    setError(null);

    const es = new EventSource(`/api/shortform-progress?jobId=${encodeURIComponent(jobId)}`);
    esRef.current = es;

    const handleStep = (ev) => {
      try {
        const data = JSON.parse(ev.data);
        setSteps((prev) => ({
          ...prev,
          [data.step]: {
            status: data.status,
            progress: data.progress ?? 0,
            subStep: data.subStep || null,
            result: data.result || null,
          },
        }));
        if (data.status === 'running') {
          setCurrent(data.step);
        }
      } catch (err) {
        console.error('[useJobProgress] step parse:', err);
      }
    };

    const handleComplete = (ev) => {
      try {
        const data = JSON.parse(ev.data);
        setResult(data.result || data);
        setStatus('complete');
        setCurrent(null);
      } catch (err) {
        console.error('[useJobProgress] complete parse:', err);
      } finally {
        es.close();
      }
    };

    const handleError = (ev) => {
      try {
        const data = typeof ev.data === 'string' ? JSON.parse(ev.data) : null;
        if (data?.error) {
          setError(data.error);
          setStatus('error');
        }
      } catch {
        // EventSource 내부 onerror도 여기로 오므로 data가 없는 경우 무시
      }
    };

    const handleCancelled = (ev) => {
      try {
        const data = JSON.parse(ev.data);
        setStatus('cancelled');
        setCurrent(null);
        setError(data?.note || '취소되었습니다.');
      } catch {}
      finally {
        es.close();
      }
    };

    es.addEventListener('step', handleStep);
    es.addEventListener('complete', handleComplete);
    es.addEventListener('error', handleError);
    es.addEventListener('cancelled', handleCancelled);

    es.onerror = () => {
      // 네트워크 단절: EventSource가 자동 재연결하므로 UI상 status는 유지
      console.warn('[useJobProgress] EventSource error, 자동 재연결 대기');
    };

    return () => {
      es.removeEventListener('step', handleStep);
      es.removeEventListener('complete', handleComplete);
      es.removeEventListener('error', handleError);
      es.removeEventListener('cancelled', handleCancelled);
      es.close();
      esRef.current = null;
    };
  }, [jobId]);

  const cancel = useCallback(async () => {
    if (!jobId) return;
    try {
      const res = await fetch(
        `/api/shortform-cancel?jobId=${encodeURIComponent(jobId)}`,
        {
          method: 'POST',
          headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
        }
      );
      if (!res.ok) {
        console.warn('[useJobProgress] cancel 실패:', res.status);
      }
    } catch (err) {
      console.error('[useJobProgress] cancel 에러:', err);
    }
  }, [jobId, authToken]);

  return { steps, current, status, result, error, cancel };
}
```

- [ ] **Step 2: 커밋**

```bash
git add app/shortform/hooks/useJobProgress.js
git commit -m "$(cat <<'EOF'
feat(hooks): useJobProgress — SSE 구독 + 취소 액션

EventSource로 /api/shortform-progress 를 구독해서 step/complete/error/
cancelled 이벤트를 React state로 흘려준다. cancel() 호출 시 authToken을
헤더에 넣어 /api/shortform-cancel로 POST.
EOF
)"
```

---

## Task I5: ProgressIndicator 컴포넌트 — 단계별 UI

**Files:**
- Create: `components/ProgressIndicator.js`
- Create: `components/ProgressIndicator.module.css`

- [ ] **Step 1: 컴포넌트 작성**

```javascript
// components/ProgressIndicator.js
'use client';

import styles from './ProgressIndicator.module.css';

const STEP_LABELS = {
  'keyword-extraction': '키워드 추출',
  'youtube-search': '후보 영상 검색',
  'video-analysis': '영상 분석',
  'script-generation': '대본 생성',
  'tts-synthesis': '음성 합성',
  'video-render': '영상 렌더',
  'upload-youtube': 'YouTube 업로드',
};

function statusIcon(status) {
  if (status === 'done') return '✓';
  if (status === 'running') return '⏳';
  if (status === 'error') return '✕';
  return '○';
}

/**
 * 단계별 진행 표시 + 취소 버튼.
 *
 * Props:
 * - activeSteps: string[]  // 표시할 step 순서 (파이프라인마다 다름)
 * - progress: { [stepId]: { status, progress, subStep } }
 * - current: 현재 running step
 * - status: 'idle'|'running'|'complete'|'error'|'cancelled'
 * - error: string | null
 * - onCancel: () => void
 */
export default function ProgressIndicator({
  activeSteps = [],
  progress = {},
  current,
  status,
  error,
  onCancel,
}) {
  const isRunning = status === 'running';

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <div className={styles.title}>
          {status === 'complete' && '생성 완료'}
          {status === 'running' && '생성 중...'}
          {status === 'cancelled' && '취소되었습니다'}
          {status === 'error' && '오류가 발생했습니다'}
          {status === 'idle' && '대기 중'}
        </div>
      </div>

      <ol className={styles.list}>
        {activeSteps.map((stepId) => {
          const info = progress[stepId] || { status: 'idle' };
          const isCurrent = stepId === current;
          const label = STEP_LABELS[stepId] || stepId;
          return (
            <li
              key={stepId}
              className={`${styles.item} ${styles[`item_${info.status || 'idle'}`]} ${isCurrent ? styles.itemCurrent : ''}`}
            >
              <span className={styles.icon}>{statusIcon(info.status)}</span>
              <span className={styles.label}>{label}</span>
              {info.subStep && (
                <span className={styles.subStep}>{info.subStep}</span>
              )}
              {info.status === 'running' && typeof info.progress === 'number' && (
                <div className={styles.progressBar}>
                  <div
                    className={styles.progressFill}
                    style={{ width: `${Math.max(0, Math.min(100, info.progress))}%` }}
                  />
                </div>
              )}
            </li>
          );
        })}
      </ol>

      {error && <div className={styles.error}>{error}</div>}

      {isRunning && onCancel && (
        <button type="button" className={styles.cancelBtn} onClick={onCancel}>
          취소
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 2: CSS 작성**

```css
/* components/ProgressIndicator.module.css */
.root {
  padding: 24px;
  background: var(--ds-surface-1, #fff);
  border: 1px solid var(--ds-border, #E5E7EB);
  border-radius: 16px;
  max-width: 520px;
  margin: 0 auto;
}
.header { margin-bottom: 16px; }
.title {
  font-size: 16px;
  font-weight: 700;
  color: var(--ds-text, #1F2937);
}
.list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.item {
  display: grid;
  grid-template-columns: 24px 1fr auto;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border-radius: 10px;
  background: var(--ds-surface-2, #F9FAFB);
  transition: background 0.2s;
}
.item_done { background: rgba(16, 185, 129, 0.08); }
.item_running { background: rgba(255, 95, 31, 0.08); }
.item_error { background: rgba(239, 68, 68, 0.08); }
.itemCurrent { box-shadow: 0 0 0 2px var(--ds-accent, #ff5f1f); }
.icon {
  font-size: 16px;
  font-weight: 700;
  text-align: center;
}
.item_done .icon { color: #10B981; }
.item_running .icon { color: var(--ds-accent, #ff5f1f); }
.item_error .icon { color: #EF4444; }
.label {
  font-size: 14px;
  color: var(--ds-text, #1F2937);
  font-weight: 600;
}
.subStep {
  font-size: 12px;
  color: var(--ds-muted, #77736B);
}
.progressBar {
  grid-column: 1 / -1;
  width: 100%;
  height: 4px;
  background: var(--ds-border, #E5E7EB);
  border-radius: 2px;
  overflow: hidden;
  margin-top: 6px;
}
.progressFill {
  height: 100%;
  background: var(--ds-accent, #ff5f1f);
  transition: width 0.3s ease;
}
.error {
  margin-top: 12px;
  padding: 10px 12px;
  background: rgba(239, 68, 68, 0.08);
  color: #DC2626;
  border-radius: 8px;
  font-size: 13px;
}
.cancelBtn {
  margin-top: 16px;
  width: 100%;
  padding: 12px 16px;
  background: var(--ds-surface-2, #F3F4F6);
  border: 1px solid var(--ds-border, #E5E7EB);
  border-radius: 10px;
  color: var(--ds-text, #1F2937);
  font-weight: 600;
  cursor: pointer;
}
.cancelBtn:hover { background: #FEE2E2; color: #DC2626; }
```

- [ ] **Step 3: 커밋**

```bash
git add components/ProgressIndicator.js components/ProgressIndicator.module.css
git commit -m "$(cat <<'EOF'
feat(components): ProgressIndicator — 단계별 진행 UI + 취소

activeSteps 배열 순서대로 step을 표시하고, 상태(idle/running/done/error)에
따라 스타일과 아이콘을 전환. running 상태에서만 취소 버튼 표시.
Phase I의 SSE 데이터를 시각화하는 최종 컴포넌트.
EOF
)"
```

---

## Task I6: shortform-benchmark 라우트 — 진행 이벤트 삽입

**Files:**
- Modify: `app/api/shortform-benchmark/route.js`
- Modify: `app/api/shortform-benchmark/analyze/route.js` (존재한다면 Phase B에서)

- [ ] **Step 1: jobId 입력 확장**

요청 body에 `jobId` 필드가 없으면 `createJobId()`로 발급하고 응답에 포함해 반환. 이후 publishProgress 호출부에서 사용.

```javascript
// app/api/shortform-benchmark/route.js (발췌)
import {
  publishProgress,
  checkCancelled,
  createJobId,
  cleanupJob,
} from '@/lib/job-progress';
import { CancelledError } from '@/lib/cancelled-error';

export async function POST(request) {
  const body = await request.json();
  const jobId = body.jobId || createJobId();

  try {
    // 1. 키워드 추출
    await publishProgress(jobId, {
      type: 'step',
      step: 'keyword-extraction',
      status: 'running',
      progress: 0,
    });
    await checkCancelled(jobId, 'keyword-extraction:start');
    const keywords = await extractKeywords(body.input);
    await publishProgress(jobId, {
      type: 'step',
      step: 'keyword-extraction',
      status: 'done',
      progress: 100,
      result: { count: keywords.length },
    });

    // 2. YouTube 검색 (5쿼리 병렬이라도 이벤트는 순차로)
    await publishProgress(jobId, {
      type: 'step',
      step: 'youtube-search',
      status: 'running',
      progress: 0,
    });
    await checkCancelled(jobId, 'youtube-search:start');
    const searchResults = await Promise.all(
      keywords.map(async (kw, idx) => {
        await publishProgress(jobId, {
          type: 'step',
          step: 'youtube-search',
          status: 'running',
          progress: Math.round(((idx) / keywords.length) * 100),
          subStep: `query-${idx + 1}/${keywords.length}`,
        });
        return searchYoutube(kw);
      })
    );
    await publishProgress(jobId, {
      type: 'step',
      step: 'youtube-search',
      status: 'done',
      progress: 100,
      result: { candidates: searchResults.flat().length },
    });

    // 3. 영상 분석
    const videos = dedupeAndFilter(searchResults);
    await publishProgress(jobId, {
      type: 'step',
      step: 'video-analysis',
      status: 'running',
      progress: 0,
    });
    const analyses = [];
    for (let i = 0; i < videos.length; i++) {
      await checkCancelled(jobId, `video-analysis:${i}`);
      await publishProgress(jobId, {
        type: 'step',
        step: 'video-analysis',
        status: 'running',
        progress: Math.round((i / videos.length) * 100),
        subStep: `video-${i + 1}/${videos.length}`,
      });
      const result = await analyzeWithGemini(videos[i]);
      analyses.push(result);
    }
    await publishProgress(jobId, {
      type: 'step',
      step: 'video-analysis',
      status: 'done',
      progress: 100,
    });

    await publishProgress(jobId, {
      type: 'complete',
      result: { jobId, analyses, aggregated: aggregate(analyses) },
    });

    return Response.json({ jobId, analyses, aggregated: aggregate(analyses) });
  } catch (err) {
    if (err instanceof CancelledError) {
      await publishProgress(jobId, {
        type: 'cancelled',
        cancelledAt: err.checkpoint,
      });
      return Response.json({ cancelled: true, checkpoint: err.checkpoint }, { status: 499 });
    }
    await publishProgress(jobId, {
      type: 'error',
      error: err.message,
      step: err.step || 'unknown',
    });
    throw err;
  } finally {
    await cleanupJob(jobId);
  }
}
```

> **참고:** 실제 헬퍼 이름(extractKeywords / searchYoutube / analyzeWithGemini / dedupeAndFilter / aggregate)은 Phase B 구현과 맞춰서 리네임. 위 코드는 skeleton.

- [ ] **Step 2: analyze 서브루트에도 동일 패턴 적용**

Phase B 에서 `/api/shortform-benchmark/analyze/route.js`를 만들었다면 거기서도 `video-analysis` sub-step을 publish하도록 편집.

- [ ] **Step 3: 빌드 체크**

```bash
npx next build 2>&1 | grep -iE "error|✓ Compiled" | head -10
```

Expected: 컴파일 성공.

- [ ] **Step 4: 커밋**

```bash
git add app/api/shortform-benchmark/route.js app/api/shortform-benchmark/analyze/route.js
git commit -m "$(cat <<'EOF'
feat(api): benchmark 라우트에 진행 이벤트 publish + checkCancelled

키워드 추출 / YouTube 검색 / 영상 분석 3단계에 publishProgress를 삽입하고
각 체크포인트에서 checkCancelled로 취소 여부 확인. CancelledError는
499 응답으로 처리하고 finally에서 cleanupJob 호출.
EOF
)"
```

---

## Task I7: shortform-script 라우트 — 진행 이벤트 + 크레딧 차감 시점

**Files:**
- Modify: `app/api/shortform-script/route.js`

- [ ] **Step 1: script-generation 진행 이벤트**

```javascript
// app/api/shortform-script/route.js (발췌)
import {
  publishProgress,
  checkCancelled,
  createJobId,
  cleanupJob,
} from '@/lib/job-progress';
import { CancelledError } from '@/lib/cancelled-error';

export async function POST(request) {
  const body = await request.json();
  const jobId = body.jobId || createJobId();

  try {
    await publishProgress(jobId, {
      type: 'step',
      step: 'script-generation',
      status: 'running',
      progress: 0,
      subStep: 'draft',
    });
    await checkCancelled(jobId, 'script:draft-start');

    const draft = await callClaude(body.prompt);

    await publishProgress(jobId, {
      type: 'step',
      step: 'script-generation',
      status: 'running',
      progress: 60,
      subStep: 'caption',
    });
    await checkCancelled(jobId, 'script:caption-start');

    const caption = await callClaudeCaption(body.prompt, draft);

    await publishProgress(jobId, {
      type: 'step',
      step: 'script-generation',
      status: 'done',
      progress: 100,
    });

    await publishProgress(jobId, {
      type: 'complete',
      result: { jobId, script: draft, caption },
    });

    return Response.json({ jobId, script: draft, caption });
  } catch (err) {
    if (err instanceof CancelledError) {
      await publishProgress(jobId, {
        type: 'cancelled',
        cancelledAt: err.checkpoint,
      });
      return Response.json({ cancelled: true }, { status: 499 });
    }
    await publishProgress(jobId, {
      type: 'error',
      error: err.message,
      step: 'script-generation',
    });
    throw err;
  } finally {
    await cleanupJob(jobId);
  }
}
```

- [ ] **Step 2: 크레딧 차감 시점 재배치**

스펙 §17에 따라 **Step 7 영상 렌더 시작 시점**에만 크레딧 차감. Phase I에서는 `shortform-script` 라우트의 기존 차감 로직을 **Step 7 진입 시점**(Phase F의 렌더 라우트 또는 현 ShortformClient의 렌더 트리거)으로 이동해야 한다.

이 task에서는 다음만 처리:
1. `shortform-script` 내 크레딧 차감 코드 블록을 별도 함수로 추출 (Phase F가 호출할 수 있게)
2. 차감 시점 주석에 "Step 7 진입 시 호출 예정" 명시
3. **중요:** 실제 이동은 Phase F(Preview) 작업 중 완료. Phase I는 skeleton만.

- [ ] **Step 3: 커밋**

```bash
git add app/api/shortform-script/route.js
git commit -m "$(cat <<'EOF'
feat(api): script 라우트에 진행 이벤트 + 크레딧 차감 시점 재배치 준비

script-generation step에 draft/caption sub-step publish. Cancel 지원.
크레딧 차감 로직은 별도 함수로 분리하고 Step 7(Phase F)이 호출하도록
인터페이스만 정리. 실제 호출 지점 이동은 Phase F에서 완료.
EOF
)"
```

---

## Task I8: 크레딧 환불 정책 모듈

**Files:**
- Create: `lib/shortform-refund.js`

- [ ] **Step 1: 환불 정책 작성**

```javascript
// lib/shortform-refund.js
/**
 * 숏폼 취소 시 크레딧 환불 정책.
 *
 * Step 1~6 (대본 생성 전): 100% — 아직 차감되지 않음
 * Step 7 진입 (영상 렌더 시작): 진행률 기반 부분 환불
 *   - scene 0~30%: 100% 환불
 *   - scene 30~70%: 50% 환불
 *   - scene 70~100%: 환불 없음
 * Step 7 완료 후: 환불 없음 (결과물 이미 생성됨)
 */

export function calculateRefund({ checkpoint, chargedCredits, renderProgress }) {
  // checkpoint 가 null/undefined 이면 아직 차감 전 → 0 환불(애초에 차감 없음)
  if (!chargedCredits) return 0;

  if (!checkpoint || checkpoint.startsWith('pre-render')) {
    return chargedCredits; // 100%
  }

  if (checkpoint.startsWith('video-render')) {
    const progress = renderProgress ?? 0;
    if (progress < 30) return chargedCredits;
    if (progress < 70) return Math.floor(chargedCredits / 2);
    return 0;
  }

  return 0;
}

export function refundReasonLabel(checkpoint, renderProgress) {
  if (!checkpoint || checkpoint.startsWith('pre-render')) {
    return '영상 생성 전 취소 → 전액 환불';
  }
  if (checkpoint.startsWith('video-render')) {
    const progress = renderProgress ?? 0;
    if (progress < 30) return '영상 렌더 초기 취소 → 전액 환불';
    if (progress < 70) return '영상 렌더 중간 취소 → 50% 환불';
    return '영상 렌더 후반 → 환불 없음';
  }
  return '환불 대상 아님';
}
```

- [ ] **Step 2: 취소 엔드포인트에 환불 계산 연결 (옵션)**

`app/api/shortform-cancel/route.js` 에 환불 금액 반환 추가:

```javascript
import { calculateRefund, refundReasonLabel } from '@/lib/shortform-refund';
// ... 취소 처리 후
const refund = calculateRefund({
  checkpoint: body?.checkpoint,
  chargedCredits: body?.chargedCredits,
  renderProgress: body?.renderProgress,
});
return jsonResponse(request, {
  success: ok,
  refundCredits: refund,
  reason: refundReasonLabel(body?.checkpoint, body?.renderProgress),
});
```

> **주의:** 실제 크레딧 환불 DB 연결은 기존 credits 시스템과 맞춰야 한다. 이 task는 계산 로직만 제공. Phase L(검증)에서 통합 테스트.

- [ ] **Step 3: 커밋**

```bash
git add lib/shortform-refund.js app/api/shortform-cancel/route.js
git commit -m "$(cat <<'EOF'
feat(lib): shortform 취소 환불 정책 계산 모듈

Step 1~6 취소: 100% 환불 (차감 전)
Step 7 렌더 0~30%: 100% / 30~70%: 50% / 70~100%: 0%
shortform-cancel 라우트가 refundCredits + reason을 응답에 포함.
실제 DB 환불 연결은 Phase L에서.
EOF
)"
```

---

## Task I9: 백그라운드 모드 — 브라우저 닫혀도 진행 유지

백엔드 작업은 Redis pub/sub 기반이라 클라이언트 연결 유무와 무관하게 이미 백그라운드에서 동작한다. 사용자가 브라우저 탭을 닫아도 `/api/shortform-benchmark`, `/api/shortform-script`는 완료까지 실행된다. 이 task에서는 다음 UX를 보장한다:

1. 브라우저 탭 재개 시 → 기존 jobId로 다시 `useJobProgress(jobId)` 호출 → 히스토리 replay로 현재 상태 복원
2. 완료 시 마이페이지 "내 영상" 섹션에 자동 추가 (Phase H가 담당)
3. Web Notification API로 브라우저 알림 표시 (권한 있을 때만)

**Files:**
- Modify: `app/shortform/ShortformClient.js`

- [ ] **Step 1: jobId localStorage 보존**

```javascript
// ShortformClient 발췌
useEffect(() => {
  const stored = localStorage.getItem('shortform:activeJobId');
  if (stored) {
    setJobId(stored);
  }
}, []);

useEffect(() => {
  if (jobId) {
    localStorage.setItem('shortform:activeJobId', jobId);
  }
}, [jobId]);
```

- [ ] **Step 2: 완료 시 localStorage 정리 + 브라우저 알림**

```javascript
// useJobProgress가 complete 상태로 전환되는 useEffect
useEffect(() => {
  if (progress.status === 'complete') {
    localStorage.removeItem('shortform:activeJobId');
    if (typeof window !== 'undefined' && 'Notification' in window) {
      if (Notification.permission === 'granted') {
        new Notification('숏폼 생성 완료', {
          body: '마이페이지에서 확인하실 수 있어요.',
        });
      }
    }
  }
}, [progress.status]);
```

- [ ] **Step 3: 알림 권한 요청 버튼 (옵션)**

첫 생성 직전에 한 번만 "알림을 받으실래요?" 버튼 표시. 사용자가 클릭 시 `Notification.requestPermission()`.

- [ ] **Step 4: 커밋**

```bash
git add app/shortform/ShortformClient.js
git commit -m "$(cat <<'EOF'
feat(shortform): 백그라운드 모드 — localStorage jobId 복원 + 완료 알림

브라우저 탭을 닫았다가 돌아와도 localStorage에 저장된 activeJobId로
진행 상태를 재구독한다. 완료 시 Web Notification으로 브라우저 알림.
실제 결과물은 Phase H의 "내 영상" 섹션에서 누적 관리.
EOF
)"
```

---

## Task I10: Genkit stream() 통합 여부 판단

Genkit은 flow에 대한 `run` 외에 `streamFlow()` 를 제공해 부분 응답을 stream으로 받을 수 있다. Phase B/D에서 Genkit 기반으로 파이프라인이 작성됐다면 `streamFlow()`를 직접 사용해 `publishProgress`를 호출하는 편이 더 매끄럽다.

**Files:**
- Modify: `app/api/shortform-benchmark/route.js` (옵션)
- Modify: `app/api/shortform-script/route.js` (옵션)

- [ ] **Step 1: Genkit flow에 streaming callback 추가**

```javascript
// lib/flows/benchmarkFlow.js (Phase B에서 정의되어 있다면)
import { defineFlow } from 'genkit';

export const benchmarkFlow = defineFlow(
  {
    name: 'shortformBenchmark',
    inputSchema: /* zod schema */,
    outputSchema: /* zod schema */,
    streamSchema: z.object({
      step: z.string(),
      status: z.string(),
      progress: z.number().optional(),
    }),
  },
  async (input, { sendChunk }) => {
    sendChunk({ step: 'keyword-extraction', status: 'running', progress: 0 });
    const keywords = await extractKeywords(input);
    sendChunk({ step: 'keyword-extraction', status: 'done', progress: 100 });
    // ...
  }
);
```

- [ ] **Step 2: 라우트에서 sendChunk → publishProgress 브리지**

```javascript
import { streamFlow } from 'genkit';

export async function POST(request) {
  const body = await request.json();
  const jobId = body.jobId || createJobId();

  const { stream, output } = streamFlow(benchmarkFlow, body.input);

  (async () => {
    for await (const chunk of stream) {
      await publishProgress(jobId, { type: 'step', ...chunk });
    }
    const result = await output;
    await publishProgress(jobId, { type: 'complete', result });
  })();

  return Response.json({ jobId });
}
```

> **주의:** 이 task는 **옵션**. Phase B/D가 Genkit 미사용이거나 publishProgress를 직접 호출하는 구조로 이미 안정화됐다면 skip. 결정 기준:
> - Genkit flow가 있으면 → streamFlow로 변경 (더 깔끔)
> - 없으면 → publishProgress 직접 호출 유지 (현 상태)

- [ ] **Step 3: 커밋 (옵션 적용 시)**

```bash
git add app/api/shortform-benchmark/route.js app/api/shortform-script/route.js lib/flows/benchmarkFlow.js
git commit -m "$(cat <<'EOF'
refactor(shortform): Genkit streamFlow로 진행 이벤트 브리지

Phase B/D의 Genkit flow가 sendChunk로 부분 응답을 흘리면
라우트가 그걸 받아 publishProgress로 Redis에 재발행.
publishProgress 인라인 호출 대비 코드 단순화.
EOF
)"
```

---

## Task I11: ShortformClient 통합 — ProgressIndicator 배치

**Files:**
- Modify: `app/shortform/ShortformClient.js`

- [ ] **Step 1: jobId state 추가 + runAll 연결**

```javascript
// ShortformClient 발췌
const [jobId, setJobId] = useState(null);
const { steps, current, status, result, error, cancel } = useJobProgress(jobId, {
  authToken: token,
});

async function handleRunBenchmark() {
  // POST 요청에 jobId를 미리 생성해서 body에 포함
  const newJobId = crypto.randomUUID();
  setJobId(newJobId);
  try {
    await fetch('/api/shortform-benchmark', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ jobId: newJobId, input: step1Value }),
    });
  } catch (err) {
    console.error(err);
  }
}
```

- [ ] **Step 2: ProgressIndicator 렌더**

```jsx
{jobId && status !== 'idle' && (
  <ProgressIndicator
    activeSteps={[
      'keyword-extraction',
      'youtube-search',
      'video-analysis',
      'script-generation',
      'tts-synthesis',
      'video-render',
    ]}
    progress={steps}
    current={current}
    status={status}
    error={error}
    onCancel={cancel}
  />
)}
```

- [ ] **Step 3: complete 시점 처리**

```javascript
useEffect(() => {
  if (status === 'complete' && result) {
    // 다음 단계로 자동 진입
    setCurrentStep((prev) => Math.min(prev + 1, 7));
  }
}, [status, result]);
```

- [ ] **Step 4: 커밋**

```bash
git add app/shortform/ShortformClient.js
git commit -m "$(cat <<'EOF'
feat(shortform): ProgressIndicator 통합 + useJobProgress 연결

runBenchmark/runScript 호출 직전에 jobId를 미리 생성해 body에 포함하고
useJobProgress로 SSE를 구독한다. 진행 중에는 ProgressIndicator가
단계별 상태를 실시간 표시하고 취소 버튼을 노출. complete 이벤트가
오면 자동으로 다음 Step으로 진입.
EOF
)"
```

---

## Task I12: 수동 검증 — curl + 브라우저

**Files:**
- 없음 (검증 전용)

- [ ] **Step 1: curl로 SSE 연결 테스트**

로컬 서버 기동 후 별도 터미널:

```bash
# 임의의 jobId 생성
JOB_ID="test_$(date +%s)"

# 1. SSE 연결 (백그라운드)
curl -N "http://localhost:3000/api/shortform-progress?jobId=${JOB_ID}" &
SSE_PID=$!

# 2. publishProgress 수동 발행 (Node REPL 또는 임시 API)
# 브라우저 devtools에서:
# fetch('/api/__debug/publish', { method: 'POST', body: JSON.stringify({ jobId: JOB_ID, step: 'keyword-extraction', status: 'done' }) })

# 3. 취소 테스트
curl -X POST "http://localhost:3000/api/shortform-cancel?jobId=${JOB_ID}" \
  -H "Authorization: Bearer ${TOKEN}"

kill $SSE_PID
```

Expected:
- SSE 연결 즉시 history replay (빈 히스토리면 empty)
- 발행한 이벤트가 SSE 스트림에 표시
- 취소 요청 후 `event: cancelled` 수신

- [ ] **Step 2: 브라우저 E2E 테스트**

1. /shortform 접속, Step 1 입력, "벤치마킹 찾기" 클릭
2. ProgressIndicator 표시 → 단계별 상태 업데이트 확인
3. 중간에 "취소" 버튼 클릭 → 2초 이내 cancelled 상태 전환
4. Step 1 입력 다시 → "벤치마킹 찾기" → 완료까지 진행 → 자동으로 Step 2 이동
5. 브라우저 탭 닫고 다시 열기 → 이전 jobId 복원 → 진행 상태 또는 완료 상태 표시

- [ ] **Step 3: Redis 키 확인**

```bash
# Upstash 콘솔 또는 redis-cli 직접 연결
# job:progress:{jobId} 채널은 subscribe 전용이므로 확인 불가
# 대신 job:history:{jobId} LRANGE 확인
```

Expected: 진행 중에는 이벤트 list가 쌓이고, TTL 1시간 후 자연 소멸.

- [ ] **Step 4: 회귀 시나리오 체크**

- [ ] 기존 (Phase I 이전) 숏폼 사용자: jobId 없이 `/api/shortform-benchmark` 호출해도 정상 동작 (publishProgress는 jobId 없으면 no-op)
- [ ] 빠른 모드 보조 버튼 (Phase A에서 구현): ProgressIndicator 표시 가능
- [ ] SSE 미지원 브라우저(구형 iOS Safari): EventSource가 지원되지 않아도 fetch 자체는 성공

- [ ] **Step 5: 검증 결과 커밋**

```bash
git commit --allow-empty -m "$(cat <<'EOF'
chore: Phase I SSE + Cancel 수동 검증 완료

- curl SSE 수신 OK
- 브라우저 E2E OK (진행 표시 / 취소 / 재개 / 백그라운드 모드)
- 기존 사용자 회귀 영향 0
EOF
)"
```

---

## Task I13: 메모리 + 마스터 플랜 상태 업데이트

**Files:**
- Create: `~/.claude/projects/-Users-gong-eunhui-Desktop-naver-title-generator/memory/project_shortform_phase_i_complete.md`
- Modify: `~/.claude/projects/-Users-gong-eunhui-Desktop-naver-title-generator/memory/MEMORY.md`
- Modify: `docs/superpowers/plans/2026-04-14-shortform-master-plan.md`

- [ ] **Step 1: 메모리 파일 작성**

```markdown
---
name: 숏폼 Phase I 완료
description: SSE 진행 표시 + 취소/환불 + 백그라운드 모드
type: project
---

# 숏폼 Phase I 완료

**완료일:** 2026-04-XX
**스펙:** docs/superpowers/specs/2026-04-14-shortform-benchmark-pipeline-design.md §16~17
**플랜:** docs/superpowers/plans/2026-04-14-shortform-phase-i-sse-progress.md

## 핵심 변경

- lib/job-progress.js: Redis pub/sub + 히스토리 + 취소 플래그
- /api/shortform-progress SSE 엔드포인트 (Upstash 제약으로 short-polling)
- /api/shortform-cancel 취소 엔드포인트
- useJobProgress 훅 + ProgressIndicator 컴포넌트
- benchmark/script 라우트에 publishProgress + checkCancelled 삽입
- shortform-refund 정책 모듈 (Step 1~6: 100% / Step 7 진행률 기반)
- 백그라운드 모드 (localStorage jobId + Web Notification)

## 기술 결정

- WebSocket 대신 SSE (단방향 푸시면 충분, 인프라 단순)
- Upstash Redis REST는 subscribe 미지원 → 800ms short-polling으로 대체
- 크레딧 차감 시점은 Step 7 영상 렌더 시작으로 이동 (Phase F에서 완료)
- CancelledError 클래스로 취소를 일반 에러와 분리

## 다음 Phase

Phase J (YouTube Upload) — SSE 재활용해 업로드 진행 표시
```

- [ ] **Step 2: MEMORY.md 업데이트**

`~/.claude/projects/.../memory/MEMORY.md` 최근 세션 섹션 위쪽에 추가:

```markdown
- [4/XX 숏폼 Phase I 완료](project_shortform_phase_i_complete.md) — SSE 진행 표시 + 취소/환불
```

- [ ] **Step 3: 마스터 플랜 상태 마킹**

`docs/superpowers/plans/2026-04-14-shortform-master-plan.md` 의 Phase I 섹션 끝에:

```markdown
**상태:** ✅ 완료 (커밋 SHA: XXXXXXX)
```

- [ ] **Step 4: 최종 커밋**

```bash
git add docs/superpowers/plans/2026-04-14-shortform-master-plan.md
git commit -m "$(cat <<'EOF'
docs: Phase I 완료 마킹 + 메모리 기록

SSE 진행 표시 + 취소/환불 + 백그라운드 모드 완료.
Phase J (YouTube 업로드)가 SSE 버스를 그대로 재활용.
EOF
)"
```

---

## Phase I 자기 검토

### Spec coverage

| 스펙 섹션 | 커버 task |
|---|---|
| §16 SSE 이벤트 규격 | I2 |
| §16 백엔드 구조 (Redis pub/sub) | I1 |
| §16 클라이언트 UI | I5 |
| §17 취소 액션 + CancelledError | I3, I1 |
| §17 크레딧 환불 정책 | I8 |
| §17 백그라운드 모드 | I9 |

### 알려진 미완 (다음 Phase/후속)

- 실제 크레딧 DB 환불 연결은 Phase L(검증)에서 실 결제 시스템과 통합
- Genkit streamFlow 변환 (I10)은 Phase B/D가 Genkit 사용 여부에 따라 적용 또는 skip
- Upstash subscribe가 지원되면 short-polling → 실 subscribe로 업그레이드

### 통합 지점

- **Phase J (YouTube 업로드)**: `upload-youtube` step 을 같은 SSE 버스에서 푸시. ProgressIndicator activeSteps 배열에 추가.
- **Phase F (Preview)**: `video-render` step 의 scene 진행률을 publishProgress로 발행. shortform-refund.js의 renderProgress 계산에 사용.
- **Phase H (프로젝트 히스토리)**: complete 이벤트 수신 시 draft → published 상태 변경.

### 회귀 안전성

- jobId 없이 호출 → publishProgress/checkCancelled는 no-op 처리 (Task I1에서 가드)
- SSE 미지원 브라우저는 EventSource 생성 실패 → UI는 스피너로 degrade (useJobProgress가 status='idle' 유지)
- Redis 장애 → publishProgress 에러 로그만 출력, 파이프라인 자체는 계속 진행

---

## Phase I 완료 후 다음 단계

Phase J (YouTube 업로드) 시작. Phase I의 SSE 버스 + ProgressIndicator를 그대로 재활용해서 업로드 chunk 진행 표시 구현.
