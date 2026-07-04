/**
 * 시즌2 전용 Anthropic 호출 헬퍼.
 * app/api/generate 패턴과 동일한 방식(직접 fetch). 기존 라우트는 건드리지 않는다.
 */

// 원고 = Sonnet, 검수 = Haiku(저비용). 기존 인프라 화이트리스트와 일치하는 모델 id.
// 계정에서 상위 모델 접근이 열리면 이 상수만 교체.
export const DRAFT_MODEL = 'claude-sonnet-4-20250514';
export const CHECK_MODEL = 'claude-haiku-4-5-20251001';

/**
 * 단발 메시지 호출 → 응답 텍스트 반환.
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

  const body = { model, max_tokens: maxTokens, temperature, messages };
  if (system) body.system = system;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });

  // 에러 바디가 non-JSON(529/502의 HTML·빈 body)일 수 있으므로 파싱을 방어적으로.
  const rawBody = await res.text();
  let data;
  try {
    data = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    data = {};
  }
  if (!res.ok) {
    const type = data?.error?.type || res.status;
    throw new Error(`Anthropic ${type}`);
  }
  const text = (data?.content || [])
    .filter((b) => b?.type === 'text')
    .map((b) => b.text)
    .join('');
  return text;
}
