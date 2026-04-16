// lib/shortform/parse-claude-json.js
//
// Claude 응답 JSON 파서 — 4단계 fallback.
// spec: docs/superpowers/specs/2026-04-16-video-phase-a-bis-design.md §4.7 / §7.6
//
// 원본: app/blog-writer/BlogWriter.js (75~137줄 normalizeJsonEscape + safeParseJson).
// 변경점: 파싱 실패 시 throw 대신 null 반환 (spec §7.6 "완전 깨진 JSON은 null").
// 호출자가 fallback 경로를 분기할 수 있도록 함.
//
// 파싱 전략:
//   1차: 원본 그대로 JSON.parse
//   2차: normalizeJsonEscape 후 재시도 (문자열 내 raw 개행·탭 이스케이프)
//   3차: balanced brace 매칭으로 첫 { ... } 블록 추출 후 JSON.parse
//   4차: 추출 블록에 normalizeJsonEscape 적용 후 JSON.parse
//   실패 → null

/**
 * 문자열 리터럴 내부의 raw 제어 문자를 escape sequence로 치환.
 * 문자열 밖의 개행은 건드리지 않음. escape `\\`는 그대로 보존.
 */
function normalizeJsonEscape(text) {
  let result = '';
  let inStr = false;
  let esc = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (esc) {
      result += c;
      esc = false;
      continue;
    }
    if (c === '\\') {
      result += c;
      esc = true;
      continue;
    }
    if (c === '"') {
      result += c;
      inStr = !inStr;
      continue;
    }
    if (inStr) {
      if (c === '\n') {
        result += '\\n';
        continue;
      }
      if (c === '\r') {
        result += '\\r';
        continue;
      }
      if (c === '\t') {
        result += '\\t';
        continue;
      }
    }
    result += c;
  }
  return result;
}

/**
 * Claude 응답에서 안전하게 JSON 파싱.
 * @param {string} rawText
 * @returns {object | null} 파싱 결과 또는 완전 실패 시 null
 */
export function safeParseJson(rawText) {
  if (typeof rawText !== 'string' || rawText.length === 0) return null;

  // 1차: 원본 그대로
  try {
    return JSON.parse(rawText);
  } catch (_) {}

  // 2차: escape 정규화 후 재시도
  try {
    return JSON.parse(normalizeJsonEscape(rawText));
  } catch (_) {}

  // 3차: balanced brace 매칭으로 첫 JSON 블록 추출
  const start = rawText.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < rawText.length; i++) {
    const c = rawText[i];
    if (esc) {
      esc = false;
      continue;
    }
    if (c === '\\') {
      esc = true;
      continue;
    }
    if (c === '"') {
      inStr = !inStr;
      continue;
    }
    if (inStr) continue;
    if (c === '{') {
      depth++;
    } else if (c === '}') {
      depth--;
      if (depth === 0) {
        const extracted = rawText.substring(start, i + 1);
        // 4차: 추출 블록에 정규화 적용
        try {
          return JSON.parse(extracted);
        } catch (_) {}
        try {
          return JSON.parse(normalizeJsonEscape(extracted));
        } catch (_) {}
        return null;
      }
    }
  }

  return null;
}
