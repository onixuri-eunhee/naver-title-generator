// tests/unit/cardnews-callback-handler.test.js
//
// handleCardnewsCallback — 순수 webhook 핸들러 로직.
// auth / validation / progress / complete / error→자동환불 / 중복환불방지.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { handleCardnewsCallback } from '../../lib/cardnews/callback-handler.js';

function makeRedisStub() {
  const history = new Map();
  const meta = new Map();
  return {
    history,
    meta,
    async readHistoryTail(jobId, from) {
      return (history.get(jobId) || []).slice(from);
    },
    async publishProgress(jobId, event) {
      const list = history.get(jobId) || [];
      list.push({ ...event, ts: Date.now() });
      history.set(jobId, list);
    },
    async getJobMeta(jobId) {
      return meta.get(jobId) || null;
    },
    async deleteJobMeta(jobId) {
      meta.set(jobId, null); // 삭제 표시
      meta.delete(jobId);
    },
  };
}

function makeRefundStub() {
  const refunds = [];
  return {
    refunds,
    async refundCredits(email, amount, reason) {
      refunds.push({ email, amount, reason });
    },
  };
}

const SECRET = 'test-secret';

test('올바른 secret + complete → publishProgress 1회, 환불 없음', async () => {
  const redis = makeRedisStub();
  const refund = makeRefundStub();
  const body = {
    type: 'complete',
    jobId: 'j1',
    urls: ['https://cdn.x/c1.png', 'https://cdn.x/c2.png', 'https://cdn.x/c3.png'],
    cardCount: 3,
    elapsedMs: 25000,
  };
  const res = await handleCardnewsCallback({
    headers: { 'x-render-secret': SECRET },
    body,
    expectedSecret: SECRET,
    redis,
    refundFn: refund.refundCredits,
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  const events = redis.history.get('j1');
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'complete');
  assert.deepEqual(events[0].result.urls, body.urls);
  assert.equal(refund.refunds.length, 0, '성공 시 환불 없어야 함');
});

test('secret 누락 → 401', async () => {
  const redis = makeRedisStub();
  const refund = makeRefundStub();
  const res = await handleCardnewsCallback({
    headers: {},
    body: { type: 'complete', jobId: 'j1', urls: ['u'], cardCount: 1, elapsedMs: 1 },
    expectedSecret: SECRET,
    redis,
    refundFn: refund.refundCredits,
  });
  assert.equal(res.status, 401);
  assert.equal(redis.history.size, 0);
});

test('secret 불일치 → 401', async () => {
  const redis = makeRedisStub();
  const refund = makeRefundStub();
  const res = await handleCardnewsCallback({
    headers: { 'x-render-secret': 'wrong' },
    body: { type: 'complete', jobId: 'j1', urls: ['u'], cardCount: 1, elapsedMs: 1 },
    expectedSecret: SECRET,
    redis,
    refundFn: refund.refundCredits,
  });
  assert.equal(res.status, 401);
});

test('알 수 없는 type → 400', async () => {
  const redis = makeRedisStub();
  const refund = makeRefundStub();
  const res = await handleCardnewsCallback({
    headers: { 'x-render-secret': SECRET },
    body: { type: 'unknown', jobId: 'j1' },
    expectedSecret: SECRET,
    redis,
    refundFn: refund.refundCredits,
  });
  assert.equal(res.status, 400);
});

test('jobId 누락 → 400', async () => {
  const redis = makeRedisStub();
  const refund = makeRefundStub();
  const res = await handleCardnewsCallback({
    headers: { 'x-render-secret': SECRET },
    body: { type: 'complete', urls: ['u'], cardCount: 1, elapsedMs: 1 },
    expectedSecret: SECRET,
    redis,
    refundFn: refund.refundCredits,
  });
  assert.equal(res.status, 400);
});

test('complete 필수 필드(urls 배열) 누락 → 400', async () => {
  const redis = makeRedisStub();
  const refund = makeRefundStub();
  const res = await handleCardnewsCallback({
    headers: { 'x-render-secret': SECRET },
    body: { type: 'complete', jobId: 'j1', cardCount: 3, elapsedMs: 1 },
    expectedSecret: SECRET,
    redis,
    refundFn: refund.refundCredits,
  });
  assert.equal(res.status, 400);
});

test('error + job:meta 존재 → 자동 환불 + meta 삭제', async () => {
  const redis = makeRedisStub();
  const refund = makeRefundStub();
  redis.meta.set('j1', { userEmail: 'user@example.com', tool: 'cardnews', cost: 1 });

  const res = await handleCardnewsCallback({
    headers: { 'x-render-secret': SECRET },
    body: { type: 'error', jobId: 'j1', errorCode: 'TIMEOUT', errorMessage: 'render_3min' },
    expectedSecret: SECRET,
    redis,
    refundFn: refund.refundCredits,
  });

  assert.equal(res.status, 200);
  assert.equal(refund.refunds.length, 1);
  assert.equal(refund.refunds[0].email, 'user@example.com');
  assert.equal(refund.refunds[0].amount, 1);
  assert.match(refund.refunds[0].reason, /cardnews.*TIMEOUT/);
  // 환불 후 meta 삭제됨
  assert.equal(redis.meta.has('j1'), false);
});

test('error + job:meta 없음 → 환불 skip (중복 방지)', async () => {
  const redis = makeRedisStub();
  const refund = makeRefundStub();
  // meta 없음 (이미 환불된 상태)

  const res = await handleCardnewsCallback({
    headers: { 'x-render-secret': SECRET },
    body: { type: 'error', jobId: 'j1', errorCode: 'TIMEOUT', errorMessage: 'x' },
    expectedSecret: SECRET,
    redis,
    refundFn: refund.refundCredits,
  });

  assert.equal(res.status, 200);
  assert.equal(refund.refunds.length, 0, 'meta 없으면 환불 skip');
});

test('같은 jobId에 complete 2회 → 2번째는 skip (idempotent)', async () => {
  const redis = makeRedisStub();
  const refund = makeRefundStub();
  const body = {
    type: 'complete',
    jobId: 'j1',
    urls: ['u'],
    cardCount: 1,
    elapsedMs: 1,
  };
  const ctx = {
    headers: { 'x-render-secret': SECRET },
    body,
    expectedSecret: SECRET,
    redis,
    refundFn: refund.refundCredits,
  };
  await handleCardnewsCallback(ctx);
  const res2 = await handleCardnewsCallback(ctx);
  assert.equal(res2.status, 200);
  assert.equal(res2.body.skipped, 'duplicate');
  assert.equal(redis.history.get('j1').length, 1);
});

test('progress 이벤트는 중복 허용 + 환불 없음', async () => {
  const redis = makeRedisStub();
  const refund = makeRefundStub();
  redis.meta.set('j1', { userEmail: 'a@b.com', tool: 'cardnews', cost: 1 });

  const body = {
    type: 'progress',
    jobId: 'j1',
    progress: 0.3,
  };
  await handleCardnewsCallback({ headers: { 'x-render-secret': SECRET }, body, expectedSecret: SECRET, redis, refundFn: refund.refundCredits });
  await handleCardnewsCallback({ headers: { 'x-render-secret': SECRET }, body, expectedSecret: SECRET, redis, refundFn: refund.refundCredits });
  assert.equal(redis.history.get('j1').length, 2);
  assert.equal(refund.refunds.length, 0);
});
