/**
 * 시즌2 원고 생성 프롬프트 빌더.
 *
 * 설계 원칙(PRD 03·05, 글로벌 rule-stacking-check):
 *  - 규제·금지어는 이 생성 프롬프트에 절대명령으로 쌓지 않는다.
 *    → 원고 생성 후 별도 규제 검수 패스(regulation-check.js)가 처리.
 *  - AEO는 전략별 강도만 조절해 공통 삽입(PRD 05).
 *
 * 전략 3벌 중 검색100·반반은 P0, 홈피드100은 P1(추후).
 */

import { safeParseJson } from '../shortform/parse-claude-json.js';

const INDUSTRY_LABEL = { medical: '병원·의원', legal: '변호사·법무법인', biz: '기업' };

/** tags를 항상 배열로 정규화(문자열·객체·공백구분 → join 폭발·단일 거대태그 방지). */
export function normalizeTags(tags) {
  if (Array.isArray(tags)) return tags.map((t) => String(t).trim()).filter(Boolean);
  if (typeof tags === 'string') return tags.split(/[\s,#\n]+/).map((t) => t.trim()).filter(Boolean);
  return [];
}

/**
 * 원고 JSON 파싱. 프롬프트가 정의한 출력 계약(아래 buildSearch100Prompt 출력형식)을 파싱하므로
 * 이 파일에 둔다(regulation-check의 parseVerdict가 검수 프롬프트 옆에 있는 것과 대칭).
 * safeParseJson(4단계 fallback) 재활용. 실패 시 null → 호출부가 에러 처리.
 * @returns {{title:string, body:string, tags:string[], intent:string, note:string} | null}
 */
export function parseDraft(rawText) {
  const obj = safeParseJson(String(rawText || ''));
  if (!obj || typeof obj !== 'object' || typeof obj.body !== 'string' || !obj.body.trim()) return null;
  return {
    title: typeof obj.title === 'string' ? obj.title : '',
    body: obj.body,
    tags: normalizeTags(obj.tags),
    intent: typeof obj.intent === 'string' ? obj.intent : '',
    note: typeof obj.note === 'string' ? obj.note : '',
  };
}

/** 전략별 AEO 강도 지시(PRD 05 4장). */
function aeoBlock(strategy) {
  if (strategy === 'homefeed100') {
    return [
      '# AEO (약하게 — 스토리 우선)',
      '- 핵심 즉답 문장 1개만 자연스럽게 포함.',
      '- 글 끝 FAQ 3개(짧게). 표·목록은 생략 가능.',
    ].join('\n');
  }
  const strength = strategy === 'hybrid' ? '중간' : '풀';
  return [
    `# AEO — AI가 이 글을 답변 근거로 인용하게 (강도: ${strength})`,
    '- 각 소제목 첫 문장에서 결론·정의를 먼저(두괄식).',
    '- 문장은 앞뒤 맥락 없이도 뜻이 통하게(주어 명시, 대명사 최소).',
    '- 소제목은 실제 질문 형태로.',
    strategy === 'search100'
      ? '- 정의·기준·비교는 표나 번호 목록으로 최소 1개.'
      : '- 두괄식 즉답 1개 + FAQ 유지, 표는 선택.',
    '- 수치·기간·조건은 구체 값으로, 통계는 출처와 함께.',
    '- 글 끝에 FAQ 3~5개(질문 + 2~3문장 자기완결 답변).',
  ].join('\n');
}

/**
 * 검색 100% 시스템 프롬프트(PRD 03).
 * @param {object} s 슬롯
 * @param {string} s.industry medical|legal|biz
 * @param {string} s.keyword 대표키워드
 * @param {string} [s.region] 지역
 * @param {string} [s.subfield] 세부분야
 * @param {string} [s.persona] 페르소나(말투·이력·위치)
 * @param {string} [s.references] 업로드 자료 요약
 * @param {string} [s.benchmark] 상위글 구조 요약
 * @param {number} [s.targetChars] 목표 글자수(기본 2000)
 * @param {number} [s.imageCount] 이미지 장수(기본 6)
 */
export function buildSearch100Prompt(s) {
  const region = s.region || '';
  const target = s.targetChars || 2000;
  const images = s.imageCount || 6;
  return `너는 네이버 블로그 검색 상위노출 전문 작가다.
목표: ${s.keyword}로 검색한 사람이 원하는 답을 완결적으로 주고, 검색 상위에 오르는 글을 쓴다.
업종: ${INDUSTRY_LABEL[s.industry] || s.industry} · 세부분야: ${s.subfield || '-'}

# 글쓴이 페르소나 (이 사람의 입장·말투로)
${s.persona || '(미설정 — 중립적 전문가 톤)'}

# 참고 자료 (있으면 근거로만 활용, 원문 복붙 금지)
${s.references || '(없음)'}

# 벤치마킹 (상위글 구조 — 따라하되 베끼지 마라)
${s.benchmark || '(없음 — 일반 SEO 구조로)'}

# 검색100 규칙
## 1. 검색의도 먼저
${s.keyword}를 검색한 사람의 의도(정보형/사용법형/비교형)를 한 줄로 정하고, 글 전체가 그 의도를 해결한다. 의도와 무관한 총론·감상은 넣지 않는다.
- 의도를 글에서 완결적으로 못 푸는 키워드면 검색100이 안 맞으니, 그 사실을 결과에 note로 남긴다.

## 2. 제목 = 지역 + 키워드 + 후킹구
- 형식: ${region ? `[${region}] ` : ''}${s.keyword} + 후킹구 1개(이유·차이 / 3가지 리스티클 / 상황가정 / 결과·사례 / 체크·기준).
- 32자 내외, 키워드 앞쪽.

## 3. 도입부(첫 3문장)
검색한 사람의 상황·질문을 첫 문장에서 짚는다. "법치주의 나라에서…" 같은 의미 없는 총론 금지.

## 4. 본문
- 소제목 4~6개. 번호 리스티클 또는 질문형으로 구조화.
- 각 소제목 아래 정보 완결: 기준·조건·비교를 구체적으로. 표·목록 적극 사용.
- 키워드는 제목·첫 문단·소제목·본문에 자연스럽게(억지 반복 금지).

${aeoBlock('search100')}

## 5. 네이버 SEO
- 하단 태그 5~10개(키워드 + 연관어). 과다·무관 태그 금지.
- 이미지 마커 위치: 소제목마다 1장 원칙.

## 6. 분량·톤
- 공백 포함 약 ${target}자. 전문성·신뢰 우선, 과장·감탄사 금지.

# 출력 형식(JSON — 반드시 유효한 JSON)
{
  "title": "제목",
  "body": "본문(소제목·문단 포함, 이미지 위치엔 [IMG] 마커 ${images}개)",
  "tags": ["태그1", "태그2", ...],
  "intent": "검색의도 한 줄",
  "note": "전략 부적합 등 특이사항(없으면 빈 문자열)"
}
- tags는 반드시 개별 문자열 배열(하나의 문자열로 합치지 말 것).
- 본문 안에서 큰따옴표(")는 쓰지 말고 홑따옴표(')를 쓴다. 부득이하면 \\" 로 이스케이프해 JSON이 깨지지 않게 한다.
※ 규제·금지어 검수는 이 글 생성 후 별도 패스가 수행한다. 여기서는 자연스러운 원고에 집중.`;
}

/** 전략 코드 → 빌더. 반반·홈피드100은 추후 슬라이스에서 추가. */
export function buildPrompt(strategy, slots) {
  switch (strategy) {
    case 'search100':
      return buildSearch100Prompt(slots);
    default:
      throw new Error(`미구현 전략: ${strategy} (현재 슬라이스는 search100만)`);
  }
}

export const STRATEGIES = ['search100', 'hybrid', 'homefeed100'];
