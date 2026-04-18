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

test('expectedSecret undefined (env 미설정) + 임의 secret 헤더 → 401', async () => {
  const redis = makeRedisStub();
  const res = await handleRenderCallback({
    headers: { 'x-render-secret': 'anything' },
    body: { type: 'complete', jobId: 'j1', url: 'u', durationSec: 1, elapsedMs: 1 },
    expectedSecret: undefined,
    redis,
  });
  assert.equal(res.status, 401);
  assert.equal(redis.map.size, 0);
});

test('expectedSecret undefined + 헤더도 누락 → 401 (조용한 실패 방지)', async () => {
  const redis = makeRedisStub();
  const res = await handleRenderCallback({
    headers: {},
    body: { type: 'complete', jobId: 'j1', url: 'u', durationSec: 1, elapsedMs: 1 },
    expectedSecret: undefined,
    redis,
  });
  assert.equal(res.status, 401);
});
