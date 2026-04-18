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

test('연속 호출 시 매번 다른 jobId (uuidFn 호출 횟수 검증)', () => {
  let counter = 0;
  const uuidFn = () => `stub-uuid-${++counter}`;
  const r1 = buildRenderRequest({ scriptJobId: 's', inputProps: {}, uuidFn });
  const r2 = buildRenderRequest({ scriptJobId: 's', inputProps: {}, uuidFn });
  assert.equal(r1.jobId, 'stub-uuid-1');
  assert.equal(r2.jobId, 'stub-uuid-2');
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
