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
          ...(secret !== undefined && { 'x-render-secret': secret }),
        },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        return { ok: true, attempts: attempt, finalStatus: res.status };
      }

      // 이 attempt는 HTTP 응답을 받았으므로 이전 네트워크 에러 기록을 초기화
      lastStatus = res.status;
      lastErr = null;

      // 4xx → 즉시 포기 (retry 의미 없음)
      if (res.status >= 400 && res.status < 500) {
        return { ok: false, attempts: attempt, finalStatus: res.status };
      }

      // 5xx → retry
    } catch (err) {
      // 이 attempt는 네트워크 에러이므로 이전 HTTP status 기록을 초기화
      lastErr = err;
      lastStatus = null;
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
