/**
 * 한국어 조사 자동 처리 (종성 유무 기반)
 */
export function josa(word, type) {
  if (!word) return type.split('/')[1] || '';
  const code = word.charCodeAt(word.length - 1);
  if (code < 0xAC00 || code > 0xD7A3) {
    const def = { '이/가': '가', '은/는': '는', '을/를': '를', '으로/로': '로', '와/과': '와' };
    return def[type] || '';
  }
  const jong = (code - 0xAC00) % 28;
  const hasBatchim = jong !== 0;
  switch (type) {
    case '이/가': return hasBatchim ? '이' : '가';
    case '은/는': return hasBatchim ? '은' : '는';
    case '을/를': return hasBatchim ? '을' : '를';
    case '으로/로': return (jong === 0 || jong === 8) ? '로' : '으로';
    case '와/과': return hasBatchim ? '과' : '와';
    default: return '';
  }
}

export const ga = (w) => w + josa(w, '이/가');
export const neun = (w) => w + josa(w, '은/는');
export const reul = (w) => w + josa(w, '을/를');
export const ro = (w) => w + josa(w, '으로/로');
export const wa = (w) => w + josa(w, '와/과');
