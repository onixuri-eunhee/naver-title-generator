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
