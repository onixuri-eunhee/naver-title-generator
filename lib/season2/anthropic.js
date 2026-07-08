/**
 * 시즌2 전용 Anthropic 호출 헬퍼.
 * app/api/generate 패턴과 동일한 방식(직접 fetch). 기존 라우트는 건드리지 않는다.
 */

// 원고 = Sonnet, 검수 = Haiku(저비용). 기존 인프라 화이트리스트와 일치하는 모델 id.
// 계정에서 상위 모델 접근이 열리면 이 상수만 교체.
export const DRAFT_MODEL = 'claude-sonnet-4-20250514';
export const CHECK_MODEL = 'claude-haiku-4-5-20251001';

const MAX_RETRIES = 2;          // 최초 1회 + 재시도 2회 = 총 3회
// 한 호출 상한. Sonnet 5는 확장추론(thinking)이 기본이라 8192토큰 원고 생성이 ~80s 소요 →
// 60s는 정상 응답을 중단시켜 blog-v2가 항상 실패했음(2026-07-08 실호출 검증에서 확인).
// blog-v2 최악 경로 = 생성 + 재작성 1회 + Haiku검수. 120s×2 + 저비용 Haiku < maxDuration(300s).
const CALL_TIMEOUT_MS = 120_000;
const RETRYABLE = new Set([408, 409, 429, 500, 502, 503, 529]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 단발 메시지 호출 → 응답 텍스트 반환. 재시도(과부하·일시 오류)·타임아웃 포함.
 * @param {object} opts
 * @param {string} [opts.system]
 * @param {Array<{role:string, content:string}>} opts.messages
 * @param {string} [opts.model]
 * @param {number} [opts.maxTokens]
 * @param {number} [opts.temperature]
 * @returns {Promise<string>} 첫 text 블록 문자열
 */
export async function callClaude({ system, messages, model = DRAFT_MODEL, maxTokens = 4096, temperature = 0.5 }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY 미설정');

  const body = { model, max_tokens: maxTokens, messages };
  // Sonnet 5 계열은 temperature를 보내면 400 — null/undefined면 생략(모델 기본값 사용).
  if (typeof temperature === 'number') body.temperature = temperature;
  if (system) body.system = system;

  let lastErr;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) await sleep(500 * 2 ** (attempt - 1)); // 0.5s, 1s 백오프

    // 재시도 대상은 fetch(네트워크)와 HTTP status만. 파싱·후처리 오류는 재시도하지 않는다.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CALL_TIMEOUT_MS);
    let res;
    try {
      res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      // 타임아웃(AbortError)은 재시도해도 또 걸릴 확률이 높고 누적 시간이 커지므로 즉시 실패.
      // 연결 실패(TypeError)만 재시도.
      if (err?.name === 'TypeError' && attempt < MAX_RETRIES) {
        lastErr = err;
        continue;
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }

    // 에러 바디가 non-JSON(529/502의 HTML·빈 body)일 수 있으므로 방어적 파싱.
    const rawBody = await res.text();
    let data;
    try {
      data = rawBody ? JSON.parse(rawBody) : {};
    } catch {
      data = {};
    }

    if (!res.ok) {
      const type = data?.error?.type || res.status;
      if (RETRYABLE.has(res.status) && attempt < MAX_RETRIES) {
        lastErr = new Error(`Anthropic ${type}`);
        continue; // 재시도
      }
      throw new Error(`Anthropic ${type}`);
    }

    return (data?.content || [])
      .filter((b) => b?.type === 'text')
      .map((b) => b.text)
      .join('');
  }
  throw lastErr || new Error('Anthropic 호출 실패');
}
