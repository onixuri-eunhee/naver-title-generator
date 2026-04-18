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

test('secret 미지정 → x-render-secret 헤더 아예 포함 안 함', async () => {
  let seenHeaders = null;
  const stub = async (_url, init) => {
    seenHeaders = init.headers;
    return okResponse();
  };
  await postWithRetry('https://x', { jobId: 'j1' }, {
    fetchImpl: stub,
    sleepImpl: async () => {},
  });
  assert.equal(seenHeaders['x-render-secret'], undefined);
  assert.equal('x-render-secret' in seenHeaders, false);
});

test('혼합 실패(네트워크 에러 후 5xx 연속) → finalStatus=500, networkError=false', async () => {
  const stub = makeFetchStub([
    new Error('ECONNRESET'),       // attempt 1: network
    errorResponse(500),             // attempt 2: 5xx
    errorResponse(500),             // attempt 3: 5xx
    errorResponse(500),             // attempt 4: 5xx
  ]);
  const result = await postWithRetry('https://x', { jobId: 'j1' }, {
    fetchImpl: stub,
    sleepImpl: async () => {},
    secret: 's',
  });
  assert.equal(result.ok, false);
  assert.equal(result.finalStatus, 500);
  assert.equal(result.networkError, false);
});

test('혼합 실패(5xx 후 네트워크 에러 연속) → finalStatus=null, networkError=true', async () => {
  const stub = makeFetchStub([
    errorResponse(500),
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
  assert.equal(result.finalStatus, null);
  assert.equal(result.networkError, true);
});
