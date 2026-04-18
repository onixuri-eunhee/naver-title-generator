# Async Shortform Render Pipeline — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/api/shortform-render`의 HTTP 응답 시간을 3초 이내로 축소하여 Cloudflare 524 Gateway Timeout을 근본 해결한다.

**Architecture:** Vercel/Railway 간 동기 proxy를 fire-and-forget + webhook callback 패턴으로 전환한다. Railway가 202로 즉시 응답하고 백그라운드에서 Remotion 렌더를 실행하며, 진행률·완료·에러를 Vercel webhook(`/api/shortform-render-callback`)으로 보고한다. Vercel은 webhook을 기존 Redis 기반 `publishProgress`로 중계하고, 클라는 기존 `useJobProgress` SSE 훅으로 구독한다.

**Tech Stack:** Next.js App Router, Vercel Serverless, Express on Railway, Upstash Redis REST, Remotion 4.0.446, Node 20 `node:test`.

**Spec Reference:** `/Users/gong-eunhui/Desktop/naver-title-generator/docs/superpowers/specs/2026-04-18-async-render-design.md`

---

## File Structure

**신규 파일 (7)**
- `app/api/shortform-render-callback/route.js` — Vercel webhook 수신 라우트
- `services/webhook-client.mjs` — Railway → Vercel webhook POST + exp backoff retry (순수 로직, 테스트 대상)
- `lib/shortform/render-request.js` — 클라 render request body builder (순수 함수, 테스트 대상)
- `lib/shortform/inactivity-detector.js` — 마지막 이벤트 ts 기반 비활동 판정 (순수 함수, 테스트 대상)
- `tests/unit/webhook-client.test.js`
- `tests/unit/render-callback.test.js`
- `tests/unit/render-request.test.js` + `tests/unit/inactivity-detector.test.js`

**수정 파일 (4)**
- `app/api/shortform-render/route.js` — 동기 proxy → fire-and-forget dispatch
- `services/server.mjs` — `/render`를 fire-and-forget 패턴 + webhook 보고
- `app/shortform/ShortformClient.js` — `handleRender` 함수 + result bridge useEffect
- `app/shortform/hooks/useJobProgress.js` — inactivity detector 연결

**설계 원칙**
- 테스트 가치 있는 로직은 **순수 함수로 추출**해서 별도 파일에 두고 TDD로 구현 (webhook retry, request builder, inactivity detector, callback route 핸들러)
- HTTP route 껍데기·Remotion 호출·React 훅 외곽 등 integration 성격 코드는 수동 E2E로 커버 (Task 9 체크리스트)

---

## Task 1: Webhook retry helper (services/webhook-client.mjs)

**Files:**
- Create: `services/webhook-client.mjs`
- Create: `tests/unit/webhook-client.test.js`

- [ ] **Step 1.1: Write failing tests**

Create `tests/unit/webhook-client.test.js`:

```js
// tests/unit/webhook-client.test.js
//
// services/webhook-client.mjs — exp backoff retry 검증.
// 실패 시나리오: 4xx 즉시 포기 / 5xx·네트워크 3회 재시도 / 모든 재시도 실패 시 결과 반환.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { postWithRetry } from '../../services/webhook-client.mjs';

function makeFetchStub(responses) {
  let callCount = 0;
  const stub = async () => {
    const r = responses[callCount++];
    if (r instanceof Error) throw r;
    return r;
  };
  stub.callCount = () => callCount;
  return stub;
}

function okResponse(body = { ok: true }) {
  return { ok: true, status: 200, json: async () => body };
}

function errorResponse(status, body = 'err') {
  return { ok: false, status, text: async () => body };
}

test('200 첫 응답 → 즉시 성공, retry 안 함', async () => {
  const stub = makeFetchStub([okResponse()]);
  const result = await postWithRetry('https://x', { jobId: 'j1' }, {
    fetchImpl: stub,
    sleepImpl: async () => {},
    secret: 's',
  });
  assert.equal(result.ok, true);
  assert.equal(result.attempts, 1);
  assert.equal(stub.callCount(), 1);
});

test('500 후 200 → 1회 retry 후 성공', async () => {
  const stub = makeFetchStub([errorResponse(500), okResponse()]);
  const result = await postWithRetry('https://x', { jobId: 'j1' }, {
    fetchImpl: stub,
    sleepImpl: async () => {},
    secret: 's',
  });
  assert.equal(result.ok, true);
  assert.equal(result.attempts, 2);
});

test('500 3회 → 영구 실패 반환', async () => {
  const stub = makeFetchStub([
    errorResponse(500),
    errorResponse(500),
    errorResponse(500),
    errorResponse(500),
  ]);
  const result = await postWithRetry('https://x', { jobId: 'j1' }, {
    fetchImpl: stub,
    sleepImpl: async () => {},
    secret: 's',
  });
  assert.equal(result.ok, false);
  assert.equal(result.attempts, 4); // 1회 + 3회 재시도
  assert.equal(result.finalStatus, 500);
});

test('400 → 즉시 포기, retry 안 함', async () => {
  const stub = makeFetchStub([errorResponse(400)]);
  const result = await postWithRetry('https://x', { jobId: 'j1' }, {
    fetchImpl: stub,
    sleepImpl: async () => {},
    secret: 's',
  });
  assert.equal(result.ok, false);
  assert.equal(result.attempts, 1);
  assert.equal(result.finalStatus, 400);
  assert.equal(stub.callCount(), 1);
});

test('네트워크 에러 3회 → 영구 실패', async () => {
  const stub = makeFetchStub([
    new Error('ECONNREFUSED'),
    new Error('ETIMEDOUT'),
    new Error('ECONNRESET'),
    new Error('ECONNREFUSED'),
  ]);
  const result = await postWithRetry('https://x', { jobId: 'j1' }, {
    fetchImpl: stub,
    sleepImpl: async () => {},
    secret: 's',
  });
  assert.equal(result.ok, false);
  assert.equal(result.attempts, 4);
  assert.equal(result.networkError, true);
});

test('x-render-secret 헤더 주입', async () => {
  let seenHeaders = null;
  const stub = async (_url, init) => {
    seenHeaders = init.headers;
    return okResponse();
  };
  await postWithRetry('https://x', { jobId: 'j1' }, {
    fetchImpl: stub,
    sleepImpl: async () => {},
    secret: 'SECRET_XYZ',
  });
  assert.equal(seenHeaders['x-render-secret'], 'SECRET_XYZ');
  assert.equal(seenHeaders['Content-Type'], 'application/json');
});

test('exp backoff: 1s, 3s, 9s 순으로 sleep 호출', async () => {
  const sleeps = [];
  const stub = makeFetchStub([
    errorResponse(500),
    errorResponse(500),
    errorResponse(500),
    errorResponse(500),
  ]);
  await postWithRetry('https://x', { jobId: 'j1' }, {
    fetchImpl: stub,
    sleepImpl: async (ms) => { sleeps.push(ms); },
    secret: 's',
  });
  assert.deepEqual(sleeps, [1000, 3000, 9000]);
});
```

- [ ] **Step 1.2: Run test to verify failure**

```bash
cd /Users/gong-eunhui/Desktop/naver-title-generator
node --test tests/unit/webhook-client.test.js
```

Expected: FAIL — `Cannot find module '.../services/webhook-client.mjs'`.

- [ ] **Step 1.3: Implement services/webhook-client.mjs**

```js
// services/webhook-client.mjs
//
// Railway 서버가 Vercel webhook을 호출할 때 사용하는 exp backoff retry 헬퍼.
// 5xx·네트워크 에러만 재시도. 4xx는 즉시 포기.

const RETRY_DELAYS_MS = [1000, 3000, 9000]; // 총 13초
const TOTAL_ATTEMPTS = RETRY_DELAYS_MS.length + 1; // 1 + 3 retry

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function postWithRetry(url, body, {
  fetchImpl = globalThis.fetch,
  sleepImpl = defaultSleep,
  secret,
} = {}) {
  let lastStatus = null;
  let lastErr = null;

  for (let attempt = 1; attempt <= TOTAL_ATTEMPTS; attempt++) {
    try {
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-render-secret': secret,
        },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        return { ok: true, attempts: attempt, finalStatus: res.status };
      }

      lastStatus = res.status;

      // 4xx → 즉시 포기 (retry 의미 없음)
      if (res.status >= 400 && res.status < 500) {
        return { ok: false, attempts: attempt, finalStatus: res.status };
      }

      // 5xx → retry
    } catch (err) {
      lastErr = err;
      // 네트워크 에러 → retry
    }

    if (attempt < TOTAL_ATTEMPTS) {
      await sleepImpl(RETRY_DELAYS_MS[attempt - 1]);
    }
  }

  return {
    ok: false,
    attempts: TOTAL_ATTEMPTS,
    finalStatus: lastStatus,
    networkError: lastErr !== null,
  };
}
```

- [ ] **Step 1.4: Run test to verify pass**

```bash
node --test tests/unit/webhook-client.test.js
```

Expected: all 7 tests PASS.

- [ ] **Step 1.5: Commit**

```bash
git add services/webhook-client.mjs tests/unit/webhook-client.test.js
git commit -m "feat(shortform): webhook retry helper — exp backoff 1s/3s/9s

Railway → Vercel webhook 호출 시 사용. 4xx 즉시 포기, 5xx/네트워크 에러만 재시도.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Render request builder (lib/shortform/render-request.js)

**Files:**
- Create: `lib/shortform/render-request.js`
- Create: `tests/unit/render-request.test.js`

- [ ] **Step 2.1: Write failing tests**

Create `tests/unit/render-request.test.js`:

```js
// tests/unit/render-request.test.js
//
// handleRender body shape 검증. 새 renderJobId 발급 + parentJobId 전파.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildRenderRequest } from '../../lib/shortform/render-request.js';

test('새 renderJobId 발급, script jobId와 다름', () => {
  const req = buildRenderRequest({
    scriptJobId: 'script_abc',
    inputProps: { audio: { url: 'a' } },
  });
  assert.notEqual(req.jobId, 'script_abc');
  assert.equal(typeof req.jobId, 'string');
  assert.ok(req.jobId.length > 0);
});

test('parentJobId = scriptJobId', () => {
  const req = buildRenderRequest({
    scriptJobId: 'script_abc',
    inputProps: {},
  });
  assert.equal(req.parentJobId, 'script_abc');
});

test('inputProps passthrough', () => {
  const props = { audio: { url: 'https://x' }, totalDurationSec: 30 };
  const req = buildRenderRequest({ scriptJobId: 's', inputProps: props });
  assert.deepEqual(req.inputProps, props);
});

test('연속 호출 시 매번 다른 jobId', () => {
  const r1 = buildRenderRequest({ scriptJobId: 's', inputProps: {} });
  const r2 = buildRenderRequest({ scriptJobId: 's', inputProps: {} });
  assert.notEqual(r1.jobId, r2.jobId);
});

test('scriptJobId 없어도 동작 (최초 세션)', () => {
  const req = buildRenderRequest({ scriptJobId: null, inputProps: {} });
  assert.equal(req.parentJobId, null);
  assert.ok(req.jobId);
});

test('외부 uuid 주입 가능 (테스트용)', () => {
  const req = buildRenderRequest({
    scriptJobId: 's',
    inputProps: {},
    uuidFn: () => 'fixed-uuid',
  });
  assert.equal(req.jobId, 'fixed-uuid');
});
```

- [ ] **Step 2.2: Run test to verify failure**

```bash
node --test tests/unit/render-request.test.js
```

Expected: FAIL — module not found.

- [ ] **Step 2.3: Implement lib/shortform/render-request.js**

```js
// lib/shortform/render-request.js
//
// /api/shortform-render POST body 를 구성한다.
// render 전용 jobId 신규 발급, script jobId는 parentJobId로 전파.

function defaultUuid() {
  return (
    globalThis.crypto?.randomUUID?.() ||
    `render_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
  );
}

export function buildRenderRequest({ scriptJobId, inputProps, uuidFn = defaultUuid }) {
  return {
    jobId: uuidFn(),
    parentJobId: scriptJobId ?? null,
    inputProps,
  };
}
```

- [ ] **Step 2.4: Run test to verify pass**

```bash
node --test tests/unit/render-request.test.js
```

Expected: all 6 tests PASS.

- [ ] **Step 2.5: Commit**

```bash
git add lib/shortform/render-request.js tests/unit/render-request.test.js
git commit -m "feat(shortform): render request builder — 새 jobId + parentJobId 전파

handleRender 호출 시 render 전용 jobId 발급하고 script jobId를 parentJobId로 전달.
다음 PR 크레딧 차감 트리거에서 사용.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Inactivity detector (lib/shortform/inactivity-detector.js)

**Files:**
- Create: `lib/shortform/inactivity-detector.js`
- Create: `tests/unit/inactivity-detector.test.js`

- [ ] **Step 3.1: Write failing tests**

Create `tests/unit/inactivity-detector.test.js`:

```js
// tests/unit/inactivity-detector.test.js
//
// 클라 useJobProgress inactivity timeout 순수 로직 검증.
// 8분 threshold, status 'running'일 때만 적용.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  isInactive,
  INACTIVITY_THRESHOLD_MS,
} from '../../lib/shortform/inactivity-detector.js';

test('threshold 값이 8분(480_000ms)', () => {
  assert.equal(INACTIVITY_THRESHOLD_MS, 8 * 60 * 1000);
});

test('running + 경과 < threshold → inactive 아님', () => {
  const now = 1_000_000;
  const last = now - 7 * 60 * 1000; // 7분 전
  assert.equal(isInactive({ status: 'running', lastEventTs: last, now }), false);
});

test('running + 경과 = threshold 정확히 → inactive 아님 (초과만 true)', () => {
  const now = 1_000_000;
  const last = now - INACTIVITY_THRESHOLD_MS;
  assert.equal(isInactive({ status: 'running', lastEventTs: last, now }), false);
});

test('running + 경과 > threshold → inactive', () => {
  const now = 1_000_000;
  const last = now - (INACTIVITY_THRESHOLD_MS + 1);
  assert.equal(isInactive({ status: 'running', lastEventTs: last, now }), true);
});

test('idle 상태 + 경과 초과 → inactive 아님 (실행 중이 아님)', () => {
  const now = 1_000_000;
  const last = now - 2 * INACTIVITY_THRESHOLD_MS;
  assert.equal(isInactive({ status: 'idle', lastEventTs: last, now }), false);
});

test('complete 상태 → inactive 아님', () => {
  const now = 1_000_000;
  const last = now - 2 * INACTIVITY_THRESHOLD_MS;
  assert.equal(isInactive({ status: 'complete', lastEventTs: last, now }), false);
});

test('lastEventTs null → inactive 아님 (아직 시작 전)', () => {
  assert.equal(isInactive({ status: 'running', lastEventTs: null, now: 1000 }), false);
});
```

- [ ] **Step 3.2: Run test to verify failure**

```bash
node --test tests/unit/inactivity-detector.test.js
```

Expected: FAIL — module not found.

- [ ] **Step 3.3: Implement lib/shortform/inactivity-detector.js**

```js
// lib/shortform/inactivity-detector.js
//
// useJobProgress 훅이 호출하는 순수 inactivity 판정 함수.
// 8분간 step/complete/error 이벤트 없으면 렌더 서버 무응답으로 간주.

export const INACTIVITY_THRESHOLD_MS = 8 * 60 * 1000;

export function isInactive({ status, lastEventTs, now }) {
  if (status !== 'running') return false;
  if (lastEventTs == null) return false;
  return now - lastEventTs > INACTIVITY_THRESHOLD_MS;
}
```

- [ ] **Step 3.4: Run test to verify pass**

```bash
node --test tests/unit/inactivity-detector.test.js
```

Expected: all 7 tests PASS.

- [ ] **Step 3.5: Commit**

```bash
git add lib/shortform/inactivity-detector.js tests/unit/inactivity-detector.test.js
git commit -m "feat(shortform): inactivity detector — 8분 무이벤트 시 렌더 무응답 판정

useJobProgress 훅에서 사용할 순수 함수. 다음 task에서 훅에 연결.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Vercel webhook callback endpoint (app/api/shortform-render-callback)

**Files:**
- Create: `app/api/shortform-render-callback/route.js`
- Create: `tests/unit/render-callback.test.js`

핸들러 로직을 순수 함수로 추출해서 테스트한다. route.js는 Next.js Request wrapping만.

- [ ] **Step 4.1: Write failing tests**

Create `tests/unit/render-callback.test.js`:

```js
// tests/unit/render-callback.test.js
//
// Railway → Vercel webhook 수신 핸들러 로직 검증.
// auth / validation / idempotency / event type 분기.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { handleRenderCallback } from '../../lib/shortform/render-callback-handler.js';

function makeRedisStub() {
  const map = new Map();
  return {
    map,
    async readHistoryTail(jobId, from) {
      return (map.get(jobId) || []).slice(from);
    },
    async publishProgress(jobId, event) {
      const list = map.get(jobId) || [];
      list.push({ ...event, ts: Date.now() });
      map.set(jobId, list);
    },
  };
}

const SECRET = 'test-secret';

test('올바른 secret + complete → publishProgress 1회', async () => {
  const redis = makeRedisStub();
  const body = {
    type: 'complete',
    jobId: 'j1',
    url: 'https://cdn.x/a.mp4',
    durationSec: 28.3,
    elapsedMs: 127000,
  };
  const res = await handleRenderCallback({
    headers: { 'x-render-secret': SECRET },
    body,
    expectedSecret: SECRET,
    redis,
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  const events = redis.map.get('j1');
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'complete');
  assert.equal(events[0].result.url, 'https://cdn.x/a.mp4');
});

test('secret 누락 → 401', async () => {
  const redis = makeRedisStub();
  const res = await handleRenderCallback({
    headers: {},
    body: { type: 'complete', jobId: 'j1', url: 'u', durationSec: 1, elapsedMs: 1 },
    expectedSecret: SECRET,
    redis,
  });
  assert.equal(res.status, 401);
  assert.equal(redis.map.size, 0);
});

test('secret 불일치 → 401', async () => {
  const redis = makeRedisStub();
  const res = await handleRenderCallback({
    headers: { 'x-render-secret': 'wrong' },
    body: { type: 'complete', jobId: 'j1', url: 'u', durationSec: 1, elapsedMs: 1 },
    expectedSecret: SECRET,
    redis,
  });
  assert.equal(res.status, 401);
});

test('알 수 없는 type → 400', async () => {
  const redis = makeRedisStub();
  const res = await handleRenderCallback({
    headers: { 'x-render-secret': SECRET },
    body: { type: 'wtf', jobId: 'j1' },
    expectedSecret: SECRET,
    redis,
  });
  assert.equal(res.status, 400);
});

test('jobId 누락 → 400', async () => {
  const redis = makeRedisStub();
  const res = await handleRenderCallback({
    headers: { 'x-render-secret': SECRET },
    body: { type: 'complete', url: 'u', durationSec: 1, elapsedMs: 1 },
    expectedSecret: SECRET,
    redis,
  });
  assert.equal(res.status, 400);
});

test('complete 필수 필드(url) 누락 → 400', async () => {
  const redis = makeRedisStub();
  const res = await handleRenderCallback({
    headers: { 'x-render-secret': SECRET },
    body: { type: 'complete', jobId: 'j1', durationSec: 1, elapsedMs: 1 },
    expectedSecret: SECRET,
    redis,
  });
  assert.equal(res.status, 400);
});

test('같은 jobId에 complete 2회 → 2번째는 skip', async () => {
  const redis = makeRedisStub();
  const body = {
    type: 'complete',
    jobId: 'j1',
    url: 'u',
    durationSec: 1,
    elapsedMs: 1,
  };
  const ctx = {
    headers: { 'x-render-secret': SECRET },
    body,
    expectedSecret: SECRET,
    redis,
  };
  await handleRenderCallback(ctx);
  const res2 = await handleRenderCallback(ctx);
  assert.equal(res2.status, 200);
  assert.equal(res2.body.skipped, 'duplicate');
  assert.equal(redis.map.get('j1').length, 1); // 1건만 남아야 함
});

test('progress 이벤트는 중복 허용', async () => {
  const redis = makeRedisStub();
  const body = {
    type: 'progress',
    jobId: 'j1',
    progress: 0.5,
    framesRendered: 600,
    framesTotal: 1200,
  };
  await handleRenderCallback({ headers: { 'x-render-secret': SECRET }, body, expectedSecret: SECRET, redis });
  await handleRenderCallback({ headers: { 'x-render-secret': SECRET }, body, expectedSecret: SECRET, redis });
  assert.equal(redis.map.get('j1').length, 2);
});

test('error 이벤트 후 같은 jobId error 또 옴 → skip', async () => {
  const redis = makeRedisStub();
  const body = { type: 'error', jobId: 'j1', errorCode: 'X', errorMessage: 'Y' };
  await handleRenderCallback({ headers: { 'x-render-secret': SECRET }, body, expectedSecret: SECRET, redis });
  const res2 = await handleRenderCallback({ headers: { 'x-render-secret': SECRET }, body, expectedSecret: SECRET, redis });
  assert.equal(res2.body.skipped, 'duplicate');
});

test('progress → publishProgress에 step/running/progress 필드', async () => {
  const redis = makeRedisStub();
  const body = {
    type: 'progress',
    jobId: 'j1',
    progress: 0.33,
    framesRendered: 400,
    framesTotal: 1200,
  };
  await handleRenderCallback({ headers: { 'x-render-secret': SECRET }, body, expectedSecret: SECRET, redis });
  const [event] = redis.map.get('j1');
  assert.equal(event.type, 'step');
  assert.equal(event.step, 'video-render');
  assert.equal(event.status, 'running');
  assert.equal(event.progress, 0.33);
});

test('error → publishProgress에 사용자용 message', async () => {
  const redis = makeRedisStub();
  const body = {
    type: 'error',
    jobId: 'j1',
    errorCode: 'REMOTION_RENDER_FAILED',
    errorMessage: 'Chromium OOM',
  };
  await handleRenderCallback({ headers: { 'x-render-secret': SECRET }, body, expectedSecret: SECRET, redis });
  const [event] = redis.map.get('j1');
  assert.equal(event.type, 'error');
  assert.equal(event.message, '렌더링에 실패했습니다.'); // 사용자용
  assert.equal(event.errorCode, 'REMOTION_RENDER_FAILED');
});
```

- [ ] **Step 4.2: Run test to verify failure**

```bash
node --test tests/unit/render-callback.test.js
```

Expected: FAIL — module not found.

- [ ] **Step 4.3: Implement lib/shortform/render-callback-handler.js**

```js
// lib/shortform/render-callback-handler.js
//
// Railway → Vercel webhook의 순수 핸들러 로직.
// Next.js Request wrapping 없이 테스트 가능한 shape.

function validateBody(body) {
  if (!body || typeof body !== 'object') return 'invalid body';
  if (!body.jobId || typeof body.jobId !== 'string') return 'jobId required';
  if (!['progress', 'complete', 'error'].includes(body.type)) return 'unknown type';

  if (body.type === 'complete') {
    if (typeof body.url !== 'string' || !body.url) return 'url required';
    if (typeof body.durationSec !== 'number') return 'durationSec required';
    if (typeof body.elapsedMs !== 'number') return 'elapsedMs required';
  }
  if (body.type === 'progress') {
    if (typeof body.progress !== 'number') return 'progress required';
  }
  if (body.type === 'error') {
    if (typeof body.errorCode !== 'string') return 'errorCode required';
  }
  return null;
}

export async function handleRenderCallback({
  headers,
  body,
  expectedSecret,
  redis,
}) {
  const secret = headers?.['x-render-secret'];
  if (!secret || secret !== expectedSecret) {
    return { status: 401, body: { error: 'unauthorized' } };
  }

  const err = validateBody(body);
  if (err) {
    return { status: 400, body: { error: err } };
  }

  const { jobId, type } = body;

  if (type === 'complete' || type === 'error') {
    const recent = await redis.readHistoryTail(jobId, 0);
    const alreadyTerminal = recent.some(
      (e) => e.type === 'complete' || e.type === 'error',
    );
    if (alreadyTerminal) {
      return { status: 200, body: { ok: true, skipped: 'duplicate' } };
    }
  }

  if (type === 'progress') {
    await redis.publishProgress(jobId, {
      type: 'step',
      step: 'video-render',
      status: 'running',
      progress: body.progress,
      framesRendered: body.framesRendered,
      framesTotal: body.framesTotal,
    });
  } else if (type === 'complete') {
    await redis.publishProgress(jobId, {
      type: 'complete',
      step: 'video-render',
      status: 'done',
      result: {
        url: body.url,
        durationSec: body.durationSec,
        elapsedMs: body.elapsedMs,
      },
    });
  } else {
    // error
    await redis.publishProgress(jobId, {
      type: 'error',
      step: 'video-render',
      errorCode: body.errorCode,
      errorMessage: body.errorMessage, // 로그용
      message: '렌더링에 실패했습니다.', // 사용자용
    });
  }

  return { status: 200, body: { ok: true } };
}
```

- [ ] **Step 4.4: Run test to verify pass**

```bash
node --test tests/unit/render-callback.test.js
```

Expected: all 11 tests PASS.

- [ ] **Step 4.5: Create Next.js route wrapper**

Create `app/api/shortform-render-callback/route.js`:

```js
import { handleOptions, jsonResponse } from '@/lib/api-helpers';
import { publishProgress, readHistoryTail } from '@/lib/job-progress';
import { handleRenderCallback } from '@/lib/shortform/render-callback-handler';

export const maxDuration = 10;

/**
 * POST /api/shortform-render-callback
 *
 * Railway 렌더 서버가 완료/진행률/에러를 통지하는 webhook.
 * 인증: x-render-secret 헤더 == RENDER_SECRET 환경변수.
 */
export async function OPTIONS(request) {
  return handleOptions(request);
}

export async function POST(request) {
  const headers = Object.fromEntries(request.headers);

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse(request, { error: 'invalid json' }, { status: 400 });
  }

  const result = await handleRenderCallback({
    headers,
    body,
    expectedSecret: process.env.RENDER_SECRET,
    redis: {
      readHistoryTail,
      publishProgress,
    },
  });

  return jsonResponse(request, result.body, { status: result.status });
}
```

- [ ] **Step 4.6: Commit**

```bash
git add app/api/shortform-render-callback/ lib/shortform/render-callback-handler.js tests/unit/render-callback.test.js
git commit -m "feat(shortform): render callback webhook — Railway 진행률/완료/에러 수신

순수 핸들러는 lib/shortform/render-callback-handler.js에 추출하여 TDD.
auth / validation / idempotency (complete·error 중복 skip, progress는 허용).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Vercel /api/shortform-render fire-and-forget 전환

**Files:**
- Modify: `app/api/shortform-render/route.js` (전체 재작성)

이 라우트는 Railway로 dispatch만 하고 즉시 202 반환. 단위 테스트는 Task 4와 동일 패턴으로 추가할 수 있지만, 실제 Railway fetch 외엔 로직이 거의 없어 **수동 E2E로 커버**(Task 9 체크리스트).

- [ ] **Step 5.1: Replace route file**

Overwrite `app/api/shortform-render/route.js`:

```js
import {
  extractToken,
  resolveSessionEmail,
  jsonResponse,
  handleOptions,
} from '@/lib/api-helpers';
import { publishProgress, createJobId } from '@/lib/job-progress';

export const maxDuration = 30;

/**
 * POST /api/shortform-render
 *
 * Railway 렌더 서버에 fire-and-forget dispatch 후 즉시 202 반환.
 * 실제 렌더 결과는 Railway가 /api/shortform-render-callback 에 보고하고
 * 클라는 /api/shortform-progress SSE로 수신.
 *
 * Body: { jobId, parentJobId?, inputProps }
 * Headers: Authorization: Bearer <token>
 *
 * Response: 202 { jobId, accepted: true }
 *
 * 환경변수:
 *   RAILWAY_RENDER_URL — Railway 렌더 서버 베이스 URL
 *   RENDER_SECRET — Railway 서버 인증용 시크릿
 */
export async function OPTIONS(request) {
  return handleOptions(request);
}

export async function POST(request) {
  // 1. 인증
  const token = extractToken(request);
  const email = await resolveSessionEmail(token);
  if (!email) {
    return jsonResponse(request, { error: '로그인이 필요합니다.' }, { status: 401 });
  }

  // 2. Body 파싱
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse(request, { error: '잘못된 요청입니다.' }, { status: 400 });
  }

  const { jobId: clientJobId, parentJobId, inputProps } = body;
  if (!inputProps || typeof inputProps !== 'object') {
    return jsonResponse(request, { error: 'inputProps가 필요합니다.' }, { status: 400 });
  }

  const jobId = clientJobId || createJobId();

  // 3. 환경변수 확인
  const railwayUrl = process.env.RAILWAY_RENDER_URL;
  const renderSecret = process.env.RENDER_SECRET;

  if (!railwayUrl) {
    console.error('[shortform-render] RAILWAY_RENDER_URL 미설정');
    return jsonResponse(request, { error: '렌더 서버가 아직 준비되지 않았습니다.' }, { status: 503 });
  }

  // 4. 진행률: 렌더링 시작
  await publishProgress(jobId, {
    type: 'step',
    step: 'video-render',
    status: 'running',
    message: '영상 렌더링 시작...',
    progress: 0,
  });

  // 5. Railway dispatch (202 확인만, 완료는 기다리지 않음)
  try {
    const dispatchRes = await fetch(`${railwayUrl}/render`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(renderSecret ? { 'x-render-secret': renderSecret } : {}),
      },
      body: JSON.stringify({
        jobId,
        parentJobId: parentJobId ?? null,
        userId: email,
        inputProps,
        outputFilename: `shortform-${jobId}`,
      }),
    });

    if (dispatchRes.status !== 202) {
      const errText = await dispatchRes.text().catch(() => 'unknown');
      console.error(
        `[shortform-render] Railway dispatch 실패: ${dispatchRes.status} ${errText}`,
      );
      await publishProgress(jobId, {
        type: 'error',
        step: 'video-render',
        errorCode: 'DISPATCH_FAILED',
        message: '렌더 서버에 작업을 전달하지 못했습니다.',
      });
      return jsonResponse(
        request,
        { error: '렌더 서버가 작업을 받지 못했습니다. 잠시 후 다시 시도해주세요.' },
        { status: 502 },
      );
    }

    // 6. 202: Railway가 작업을 받음 → 클라에 즉시 응답
    return jsonResponse(request, { jobId, accepted: true }, { status: 202 });
  } catch (err) {
    console.error('[shortform-render] Railway 호출 실패:', err?.message);
    await publishProgress(jobId, {
      type: 'error',
      step: 'video-render',
      errorCode: 'DISPATCH_NETWORK_ERROR',
      message: '렌더 서버에 연결할 수 없습니다.',
    });
    return jsonResponse(
      request,
      { error: '렌더 서버에 연결할 수 없습니다.' },
      { status: 502 },
    );
  }
}
```

- [ ] **Step 5.2: Run existing test suite to verify no regression in related tests**

```bash
cd /Users/gong-eunhui/Desktop/naver-title-generator
npm test
```

Expected: 기존 테스트 모두 PASS + 새로 추가한 3개 테스트 PASS (callback, request, retry, inactivity). 관련 없는 테스트 실패는 손대지 않음.

- [ ] **Step 5.3: Commit**

```bash
git add app/api/shortform-render/route.js
git commit -m "refactor(shortform): /api/shortform-render를 fire-and-forget으로 전환

Railway에 dispatch 후 202만 확인하고 즉시 클라에 {jobId, accepted:true} 반환.
Cloudflare 524 timeout 근본 해결. 렌더 결과는 webhook callback + SSE로 전달.

BREAKING: 응답 shape { url, duration, jobId } → { jobId, accepted: true }.
클라는 SSE complete 이벤트로 url 수신 (다음 task에서 전환).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Railway /render fire-and-forget 전환

**Files:**
- Modify: `services/server.mjs` (전체 재작성)

Railway `@upstash/redis` 의존 제거, webhook client 통해 통신. Remotion `onProgress` 콜백으로 10% 단위 progress 보고.

- [ ] **Step 6.1: Replace services/server.mjs**

Overwrite `services/server.mjs`:

```js
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import {
  renderShortformRemotion,
  SHORTFORM_REMOTION_VERSION,
} from './shortform-remotion-render.mjs';
import { postWithRetry } from './webhook-client.mjs';

const app = express();
app.use(express.json({ limit: '10mb' }));

const PORT = process.env.PORT || 8080;
const RENDER_SECRET = process.env.RENDER_SECRET;
const WEBHOOK_BASE_URL = process.env.WEBHOOK_BASE_URL; // 예: https://ddukddaktool.co.kr
const WEBHOOK_PATH = '/api/shortform-render-callback';
const RENDER_HARD_TIMEOUT_MS = 10 * 60 * 1000;
const PROGRESS_REPORT_STEP = 0.1; // 10% 단위

// ---------------------------------------------------------------------------
// R2 upload
// ---------------------------------------------------------------------------
let _s3 = null;
function getS3() {
  if (_s3) return _s3;
  _s3 = new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
  });
  return _s3;
}

async function uploadToR2(key, filePath) {
  const body = fs.readFileSync(filePath);
  await getS3().send(
    new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: key,
      Body: body,
      ContentType: 'video/mp4',
    }),
  );
  const publicUrl = process.env.R2_PUBLIC_URL || 'https://cdn.ddukddaktool.co.kr';
  return `${publicUrl}/${key}`;
}

// ---------------------------------------------------------------------------
// Webhook helper
// ---------------------------------------------------------------------------
async function reportToVercel(body) {
  if (!WEBHOOK_BASE_URL) {
    console.error('[webhook] WEBHOOK_BASE_URL 미설정 — skip');
    return;
  }
  const url = `${WEBHOOK_BASE_URL}${WEBHOOK_PATH}`;
  const result = await postWithRetry(url, body, { secret: RENDER_SECRET });
  if (!result.ok) {
    console.error(
      '[webhook] permanent failure jobId=%s type=%s attempts=%d finalStatus=%s network=%s',
      body.jobId,
      body.type,
      result.attempts,
      result.finalStatus,
      !!result.networkError,
    );
  }
}

// ---------------------------------------------------------------------------
// Background render job
// ---------------------------------------------------------------------------
async function runRenderJob({ jobId, inputProps, outputFilename }) {
  const startMs = Date.now();
  const localPath = path.join('/tmp', `${outputFilename}.mp4`);
  const r2Key = `shortform/${outputFilename}.mp4`;

  let lastReportedProgress = 0;

  try {
    const renderPromise = renderShortformRemotion({
      inputProps,
      outputLocation: localPath,
      onProgress: ({ progress, renderedFrames, encodedFrames, totalFrames }) => {
        // Remotion 내부 두 단계(rendering + encoding). 간단히 progress만 보고.
        if (progress - lastReportedProgress >= PROGRESS_REPORT_STEP) {
          lastReportedProgress = progress;
          // fire-and-forget (webhook 실패해도 렌더는 계속)
          reportToVercel({
            type: 'progress',
            jobId,
            progress,
            framesRendered: renderedFrames ?? encodedFrames ?? 0,
            framesTotal: totalFrames ?? 0,
          }).catch(() => {});
        }
      },
    });

    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error('RENDER_TIMEOUT_10MIN')),
        RENDER_HARD_TIMEOUT_MS,
      ),
    );

    const result = await Promise.race([renderPromise, timeoutPromise]);
    console.info('[render] remotion done in %ds', ((Date.now() - startMs) / 1000).toFixed(1));

    const url = await uploadToR2(r2Key, localPath);
    console.info('[render] uploaded to R2: %s', url);

    try { fs.unlinkSync(localPath); } catch {}

    await reportToVercel({
      type: 'complete',
      jobId,
      url,
      durationSec: result.durationInFrames / result.fps,
      elapsedMs: Date.now() - startMs,
    });
  } catch (err) {
    console.error('[render] jobId=%s error:', jobId, err);
    try { fs.unlinkSync(localPath); } catch {}

    const isTimeout = err?.message === 'RENDER_TIMEOUT_10MIN';
    const errorCode = isTimeout
      ? 'TIMEOUT'
      : err?.message?.includes('upload')
        ? 'R2_UPLOAD_FAILED'
        : 'REMOTION_RENDER_FAILED';

    await reportToVercel({
      type: 'error',
      jobId,
      errorCode,
      errorMessage: String(err?.message || err).slice(0, 500),
    });
  }
}

// ---------------------------------------------------------------------------
// Auth middleware
// ---------------------------------------------------------------------------
function authMiddleware(req, res, next) {
  if (!RENDER_SECRET) {
    return res.status(500).json({ error: 'RENDER_SECRET not configured' });
  }
  if (req.headers['x-render-secret'] !== RENDER_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// ---------------------------------------------------------------------------
// POST /render — fire-and-forget
// ---------------------------------------------------------------------------
app.post('/render', authMiddleware, async (req, res) => {
  const { jobId, inputProps, outputFilename } = req.body;

  if (!jobId || typeof jobId !== 'string') {
    return res.status(400).json({ error: 'jobId required' });
  }
  if (!inputProps || typeof inputProps !== 'object') {
    return res.status(400).json({ error: 'inputProps required' });
  }
  if (!outputFilename || typeof outputFilename !== 'string') {
    return res.status(400).json({ error: 'outputFilename required' });
  }

  // 즉시 202 반환 (클라가 기다리지 않게)
  res.status(202).json({ jobId, accepted: true });

  // 백그라운드 실행 (await 안 함)
  runRenderJob({ jobId, inputProps, outputFilename }).catch((err) => {
    console.error('[render] unhandled runRenderJob error:', err);
  });
});

// ---------------------------------------------------------------------------
// GET /health
// ---------------------------------------------------------------------------
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', version: SHORTFORM_REMOTION_VERSION });
});

app.listen(PORT, () => {
  console.info('[server] listening on port %d  version=%s', PORT, SHORTFORM_REMOTION_VERSION);
});
```

- [ ] **Step 6.2: Verify Remotion `onProgress` 파라미터 통과**

`renderShortformRemotion` 함수가 `onProgress` 옵션을 받지 않으면 추가해야 함.

Read `services/shortform-remotion-render.mjs`. `renderShortformRemotion` 시그니처를 확인:

현재 `{inputProps, outputLocation, codec = 'h264'}` 만 받음. `onProgress` 추가 필요.

Modify `services/shortform-remotion-render.mjs:41-44`:

```js
export async function renderShortformRemotion({
  inputProps,
  outputLocation,
  codec = 'h264',
  onProgress,
}) {
```

그리고 `renderMedia` 호출에 `onProgress` 전달 (`services/shortform-remotion-render.mjs:70-83` 부근):

```js
  await renderMedia({
    serveUrl,
    composition,
    inputProps,
    outputLocation,
    codec,
    browserExecutable,
    chromeMode,
    overwrite: true,
    timeoutInMilliseconds: RENDER_TIMEOUT_MS,
    chromiumOptions: {
      gl: 'angle',
    },
    onProgress,
  });
```

- [ ] **Step 6.3: Run webhook-client tests (regression check)**

```bash
node --test tests/unit/webhook-client.test.js
```

Expected: PASS.

- [ ] **Step 6.4: Commit**

```bash
git add services/server.mjs services/shortform-remotion-render.mjs
git commit -m "refactor(shortform): Railway /render을 fire-and-forget으로 전환

요청 수신 즉시 202 반환 + 백그라운드 async 렌더. Remotion onProgress로 10% 단위
progress webhook, 완료/실패 시 complete/error webhook. 10분 hard timeout.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: useJobProgress 훅에 inactivity detector 연결

**Files:**
- Modify: `app/shortform/hooks/useJobProgress.js`

- [ ] **Step 7.1: Read current hook to establish anchor for edit**

```bash
cat /Users/gong-eunhui/Desktop/naver-title-generator/app/shortform/hooks/useJobProgress.js | head -120
```

- [ ] **Step 7.2: Add inactivity timer in the SSE useEffect**

Modify `app/shortform/hooks/useJobProgress.js`:

(1) 상단 import 추가 (기존 React import 밑):

```js
'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import {
  isInactive,
  INACTIVITY_THRESHOLD_MS,
} from '@/lib/shortform/inactivity-detector';
```

(2) `useEffect` 내부에서 lastEventTs ref 추가 및 timer. 기존 `const es = new EventSource(...)` 다음에:

**위치 anchor:** `esRef.current = es;` 라인 **다음**에 아래 블록 삽입.

```js
    const lastEventTsRef = { current: Date.now() };
    const touchEvent = () => { lastEventTsRef.current = Date.now(); };

    const inactivityTimer = setInterval(() => {
      if (closedRef.current) return;
      if (
        isInactive({
          status: 'running',
          lastEventTs: lastEventTsRef.current,
          now: Date.now(),
        })
      ) {
        setStatus('error');
        setError('렌더 서버 응답이 없습니다. 새로고침 후 다시 시도해주세요.');
        try { es.close(); } catch {}
      }
    }, 30_000);
```

(3) 기존 handleStep / handleComplete / handleCancelled / handleErrorEvent 맨 첫 줄에 `touchEvent();` 추가:

```js
    const handleStep = (ev) => {
      touchEvent();
      try { ... } // 기존 로직
    };
    const handleComplete = (ev) => {
      touchEvent();
      try { ... } // 기존 로직
    };
    const handleCancelled = (ev) => {
      touchEvent();
      try { ... } // 기존 로직
    };
    const handleErrorEvent = (ev) => {
      if (!ev?.data) return;
      touchEvent();
      try { ... } // 기존 로직
    };
```

(4) `closedRef` 추가 — useEffect 내부 상단. `es` 생성 전:

```js
    const closedRef = { current: false };
```

그리고 cleanup 함수 (`return () => { ... }`) 맨 앞에 추가:

```js
    return () => {
      closedRef.current = true;
      clearInterval(inactivityTimer);
      // 기존 listener 제거 + es.close()
      ...
    };
```

**완성된 useEffect cleanup (전체):**

```js
    return () => {
      closedRef.current = true;
      clearInterval(inactivityTimer);
      es.removeEventListener('step', handleStep);
      es.removeEventListener('complete', handleComplete);
      es.removeEventListener('error', handleErrorEvent);
      es.removeEventListener('cancelled', handleCancelled);
      es.close();
      esRef.current = null;
    };
```

- [ ] **Step 7.3: Run inactivity-detector tests to verify no regression**

```bash
node --test tests/unit/inactivity-detector.test.js
```

Expected: PASS.

- [ ] **Step 7.4: Manual smoke — dev server에서 훅 mount, unmount 1회**

클라 측 통합 테스트는 Task 9 E2E에서 커버. 여기서는 dev server가 에러 없이 시작하는지만 확인:

```bash
cd /Users/gong-eunhui/Desktop/naver-title-generator
npm run dev
```

Expected: `✓ Ready`. 브라우저 `/shortform` 열어서 콘솔에 import 에러 없으면 OK. Ctrl+C로 종료.

- [ ] **Step 7.5: Commit**

```bash
git add app/shortform/hooks/useJobProgress.js
git commit -m "feat(shortform): useJobProgress에 inactivity timeout 연결

마지막 step/complete/error 이벤트 후 8분 무이벤트 시 status=error 전환.
SSE comment heartbeat(15초)는 타임스탬프 갱신에 영향 없음 (의도된 동작).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: ShortformClient handleRender 변경

**Files:**
- Modify: `app/shortform/ShortformClient.js` — `handleRender` 함수 + 새 `useEffect` bridge

- [ ] **Step 8.1: Read current handleRender for anchor**

```bash
sed -n '1295,1340p' /Users/gong-eunhui/Desktop/naver-title-generator/app/shortform/ShortformClient.js
```

- [ ] **Step 8.2: Replace handleRender 함수**

Find the existing `async function handleRender()` block (~line 1296–1334) and replace with:

```js
  // Step 7: 서버 렌더링 요청 (fire-and-forget + SSE 구독)
  async function handleRender() {
    const token = getToken();
    if (!token) {
      alert('로그인이 필요합니다.');
      router.push('/login');
      return;
    }
    if (!audioInputProps) return;

    setRenderStatus('rendering');
    setRenderError(null);
    setRenderVideoUrl(null);

    // 새 render 전용 jobId 발급 + script jobId는 parentJobId로 전달
    const renderRequest = buildRenderRequest({
      scriptJobId: jobId,
      inputProps: audioInputProps,
    });

    // useJobProgress 훅이 새 jobId로 자동 재구독
    resetProgress();
    setJobId(renderRequest.jobId);

    try {
      const res = await fetch('/api/shortform-render', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(renderRequest),
      });

      if (res.status === 202) {
        // 정상: SSE로 진행률 받을 것
        return;
      }

      // 2xx가 아니면 즉시 에러
      const data = await res.json().catch(() => ({}));
      setRenderStatus('error');
      setRenderError(data.error || '렌더 서버가 작업을 받지 못했습니다.');
    } catch (err) {
      console.error('[handleRender]', err);
      setRenderStatus('error');
      setRenderError('네트워크 오류가 발생했습니다.');
    }
  }
```

- [ ] **Step 8.3: Import buildRenderRequest**

Find existing imports at top of `app/shortform/ShortformClient.js`. Add:

```js
import { buildRenderRequest } from '@/lib/shortform/render-request';
```

- [ ] **Step 8.4: Bridge useJobProgress → render UI state**

`handleRender` 함수 **정의 직후**에 `useEffect` 추가. `useJobProgress` 훅에서 `result`/`status`/`error`를 가져오는 코드는 이미 존재 (파일 상단에서 `useJobProgress(jobId, ...)` 호출). 없으면 확인:

```bash
grep -n "useJobProgress" /Users/gong-eunhui/Desktop/naver-title-generator/app/shortform/ShortformClient.js
```

Assume hook returns: `const { steps, current, status: jobStatus, result: jobResult, error: jobError } = useJobProgress(jobId, { authToken });`

Add bridge effect:

```js
  // useJobProgress 훅의 render 이벤트를 renderStatus/renderVideoUrl 상태로 중계
  useEffect(() => {
    if (renderStatus !== 'rendering') return;

    if (jobStatus === 'complete' && jobResult?.url) {
      setRenderVideoUrl(jobResult.url);
      setRenderStatus('complete');
      return;
    }
    if (jobStatus === 'error') {
      setRenderError(jobError || '렌더링에 실패했습니다.');
      setRenderStatus('error');
      return;
    }
    if (jobStatus === 'cancelled') {
      setRenderStatus('idle');
    }
  }, [jobStatus, jobResult, jobError, renderStatus]);
```

**주의:** `useJobProgress` 훅 반환값을 구조분해할 때 이름이 `status`·`result`·`error`라면 다른 `status` 변수와 충돌 방지를 위해 `renderStatus`·`renderVideoUrl`과 겹치지 않게 별칭(`jobStatus`, `jobResult`, `jobError`)으로 받도록 호출부도 수정:

```js
const {
  steps: progressSteps,
  current: currentStep,
  status: jobStatus,
  result: jobResult,
  error: jobError,
  cancel: cancelJob,
  reset: resetProgress,
} = useJobProgress(jobId, { authToken: getToken() });
```

기존 호출부(있다면) 위 shape로 유지·조정. 기존 코드에 이미 별칭이 있다면 그대로 사용.

- [ ] **Step 8.5: Run build to catch type errors**

```bash
cd /Users/gong-eunhui/Desktop/naver-title-generator
npm run build
```

Expected: `✓ Compiled successfully`. 실패 시 출력에서 `ShortformClient.js` 관련 에러만 해결. 기타는 건드리지 않음.

- [ ] **Step 8.6: Commit**

```bash
git add app/shortform/ShortformClient.js
git commit -m "feat(shortform): handleRender fire-and-forget + SSE bridge

Render 전용 jobId 발급, parentJobId로 script jobId 전달. 응답은 202만 확인하고
실제 결과·에러는 useJobProgress SSE로 수신 후 renderStatus/renderVideoUrl에 bridge.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Pre-deploy smoke + deployment checklist (manual E2E)

이 단계는 코드 변경 없음. 배포 전 수동 검증 + 배포 순서 확인.

**Files:** (code changes 없음, 로그 수집·관찰 전용)

- [ ] **Step 9.1: 전체 unit test suite PASS 확인**

```bash
cd /Users/gong-eunhui/Desktop/naver-title-generator
npm test
```

Expected: 모든 `tests/unit/*.test.js` PASS. 특히:
- `webhook-client.test.js` — 7 passes
- `render-callback.test.js` — 11 passes
- `render-request.test.js` — 6 passes
- `inactivity-detector.test.js` — 7 passes
- 기존 테스트(settings, prompt 등) 회귀 없음

- [ ] **Step 9.2: Railway 환경변수 추가 확인**

Railway 대시보드에서 naver-title-generator 서비스에:
- `WEBHOOK_BASE_URL=https://ddukddaktool.co.kr` 추가
- `RENDER_SECRET` 값이 Vercel과 동일한지 확인

- [ ] **Step 9.3: 배포 순서 (spec §배포 순서)**

1. Railway 먼저 배포 (fire-and-forget + webhook 호출 포함)
   - 아직 Vercel callback 없음 → webhook 404 받지만 Railway는 retry 후 포기. 치명적 아님.
2. Vercel 배포 (callback + /shortform-render refactor + 클라)
3. 이 시점부터 e2e 동작 개시

실 배포는 사용자가 직접 실행 (git push + Railway/Vercel 자동 배포 흐름).

- [ ] **Step 9.4: Smoke test on preview (사용자가 수행)**

Vercel preview 배포 URL에서:
- [ ] 30초 영상 렌더 → 클라 Network 탭 `/api/shortform-render` 응답 시간 < 3초 + 2분 내 SSE complete + 영상 재생 OK
- [ ] 60초 영상 렌더 → 3분 내 동일
- [ ] 90초 영상 렌더 → 4분 내 동일
- [ ] Remotion progress 이벤트가 클라 프로그레스바에 10%→20%→...→100% 단조 증가로 반영

- [ ] **Step 9.5: Error path smoke (사용자가 수행, 선택)**

- [ ] Railway 환경변수 `WEBHOOK_BASE_URL`을 일부러 잘못 설정 → 렌더 후 8분 뒤 클라 inactivity timeout 에러 표시 확인 후 원복
- [ ] `curl`로 webhook 2번 호출 → Redis history에 complete 1건만 존재

- [ ] **Step 9.6: 프로덕션 배포 + 메모리 업데이트**

1. main 머지
2. `/Users/gong-eunhui/.claude/projects/-Users-gong-eunhui-Desktop-naver-title-generator/memory/project_week2_status.md`:
   - 블로커 A ✅ 완료 기록
   - 남은 블로커 B (TTS 1.12x 싱크 드리프트)만 플래그

---

## Rollback Plan

만약 프로덕션에서 문제 발생:

**Railway**
```bash
# 이전 이미지로 롤백 — Railway 대시보드에서 이전 deploy "Redeploy"
```

**Vercel**
```bash
# 이전 deployment promote
vercel promote <previous-deployment-url>
```

Vercel `/api/shortform-render`가 이전 동기 버전으로 돌아가도 Railway가 새 fire-and-forget 버전이면 202만 반환 → 기존 클라는 `data.url` 파싱 실패 → 에러 표시. **즉, Railway와 Vercel 양쪽을 동시에 롤백해야 일관성 유지.**

롤백 커밋 필요 시:

```bash
git revert <task-5-commit> <task-6-commit> <task-7-commit> <task-8-commit>
```

---

## Self-Review

Plan 작성 후 spec과 대조한 자가 검증:

**1. Spec coverage**
- ✅ `app/api/shortform-render-callback/route.js` 신규 → Task 4
- ✅ `app/api/shortform-render/route.js` 수정 → Task 5
- ✅ `services/server.mjs` 수정 → Task 6
- ✅ `app/shortform/ShortformClient.js` — `handleRender` 수정 → Task 8
- ✅ `app/shortform/hooks/useJobProgress.js` — inactivity timeout → Task 7
- ✅ Webhook 계약 (progress/complete/error) → Task 4 테스트 + Task 6 구현
- ✅ 에러 매트릭스 7개 케이스 → Task 5/6/7 분산 처리
- ✅ 타임아웃 3값 (Railway 10분 / 클라 8분 / webhook maxDuration 10초) → Task 3, 4, 6
- ✅ Webhook retry (1s/3s/9s, 4xx 즉시 포기) → Task 1
- ✅ Idempotency (complete/error 중복 skip, progress 허용) → Task 4
- ✅ parentJobId 전파 (클라 → Vercel → Railway) → Task 2, 5, 6
- ✅ 환경변수 `WEBHOOK_BASE_URL` 신규 (Railway 측) → Task 9.2
- ✅ 배포 순서 (Railway 먼저 → Vercel) → Task 9.3
- ✅ 롤백 전략 → Rollback Plan 섹션

**2. Placeholder scan**
- "TBD/TODO" 없음 ✅
- "implement later" 없음 ✅
- "similar to Task N" 없음 (Task 7에서 참조 anchor는 제공) ✅

**3. Type consistency**
- `buildRenderRequest({ scriptJobId, inputProps, uuidFn })` — Task 2 정의, Task 8 사용 ✅
- `isInactive({ status, lastEventTs, now })` — Task 3 정의, Task 7 사용 ✅
- `postWithRetry(url, body, { fetchImpl, sleepImpl, secret })` — Task 1 정의, Task 6 사용 ✅
- `handleRenderCallback({ headers, body, expectedSecret, redis })` — Task 4 정의, route wrapper에서 호출 ✅
- Webhook body shape (`type: 'progress'|'complete'|'error'`, fields) — Task 4 테스트 + Task 6 구현 일치 ✅

**4. Order dependency**
- Task 1 (webhook-client) → Task 6 (server.mjs에서 사용) ✅
- Task 2 (render-request) → Task 8 (ShortformClient에서 사용) ✅
- Task 3 (inactivity-detector) → Task 7 (useJobProgress에서 사용) ✅
- Task 4 (callback route) → Task 5/6 이전에 배포 (Task 9.3 배포 순서 명시) ✅

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-18-async-render-plan.md`.
