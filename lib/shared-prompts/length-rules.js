// lib/shared-prompts/length-rules.js
//
// 도구별 글자수 기준 중앙 관리.
// 프롬프트에서 상세 글자수 표를 제거했으므로 이 파일이 단일 진실.
// findOverflows는 감지만, throw 없음 — 호출자가 warn 로그 또는 재요청 결정.

export const CARD_NEWS_LIMITS = Object.freeze({
  'cover.title':     20,
  'cover.subtitle':  25,
  'summary.title':   18,
  'summary.body':    60,
  'content.title':   15,
  'content.body':    60,
  'cta.title':       18,
  'compare.title':   22,
  'compare.label':   10,
  'compare.item':    20,
  'flow.title':      22,
  'flow.step.title': 12,
  'flow.step.body':  30,
});

// 향후 확장:
// export const THREADS_LIMITS = { ... };
// export const SHORTFORM_LIMITS = { 'onScreenText': 15 };

/**
 * 필드 경로로 limit 조회.
 * @param {Object|null|undefined} limits
 * @param {string} path — 예: 'cover.title'
 * @returns {number|null}
 */
export function getLimit(limits, path) {
  if (!limits || typeof limits !== 'object') return null;
  const v = limits[path];
  return typeof v === 'number' ? v : null;
}

/**
 * 슬라이드 배열에서 길이 초과 필드를 찾아 반환. throw하지 않음.
 *
 * @param {Array} slides
 * @param {Object} limits — CARD_NEWS_LIMITS 등 frozen 맵
 * @param {Object} fieldMap — { [type]: [{ path, limitKey }] }
 *   path 는 dot-notation. 배열 원소는 'items[]' 또는 'steps[].title' 형태.
 * @returns {Array<{slideIndex, field, limit, actual}>}
 */
export function findOverflows(slides, limits, fieldMap) {
  if (!Array.isArray(slides)) return [];
  const overflows = [];

  slides.forEach((slide, slideIndex) => {
    if (!slide || typeof slide !== 'object') return;
    const fields = fieldMap?.[slide.type];
    if (!Array.isArray(fields)) return;

    for (const { path, limitKey } of fields) {
      const lim = getLimit(limits, limitKey);
      if (lim == null) continue;

      for (const { field, value } of readPath(slide, path)) {
        if (typeof value !== 'string' || !value) continue;
        const len = value.replace(/\n/g, '').length;
        if (len > lim) {
          overflows.push({ slideIndex, field, limit: lim, actual: len });
        }
      }
    }
  });

  return overflows;
}

/**
 * dot-notation + [] 배열 확장 읽기.
 * - 'title' → [{ field: 'title', value: slide.title }]
 * - 'leftItems[]' → [{ field: 'leftItems[0]', value: ... }, ...]
 * - 'steps[].title' → [{ field: 'steps[0].title', value: ... }, ...]
 */
function* readPath(slide, path) {
  const bracketIdx = path.indexOf('[]');
  if (bracketIdx < 0) {
    const parts = path.split('.');
    let cur = slide;
    for (const p of parts) {
      if (cur == null) return;
      cur = cur[p];
    }
    yield { field: path, value: cur };
    return;
  }

  const before = path.slice(0, bracketIdx);
  const after = path.slice(bracketIdx + 2);
  const arr = readSimple(slide, before);
  if (!Array.isArray(arr)) return;

  for (let i = 0; i < arr.length; i++) {
    const item = arr[i];
    if (after === '') {
      yield { field: `${before}[${i}]`, value: item };
    } else {
      const subPath = after.startsWith('.') ? after.slice(1) : after;
      const subVal = readSimple(item, subPath);
      yield { field: `${before}[${i}]${after}`, value: subVal };
    }
  }
}

function readSimple(obj, path) {
  if (!path) return obj;
  const parts = path.split('.');
  let cur = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}
