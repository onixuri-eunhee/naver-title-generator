/**
 * 블로그 v2 품질 검수 패스 — AI감지 16항목(blog-publisher-v2 스킬)의 서버판.
 *
 * 2단 구조:
 *  1) 기계 검사(이 파일, 코드) — 확정 판정 가능한 항목: 금지어·제목 길이·완결형·
 *     어미 3연속·[IMG] 수·태그 수·분량. 비용 0, 즉시.
 *  2) 모델 검사(Haiku) — 주관 판단 항목: 훅·구체성·리듬·구어체·과잉친절·소제목 등 10항목.
 *
 * 원칙: 생성 프롬프트에 검증을 쌓지 않고 생성 후 별도 패스(rule-stacking 회피, 시즌2 동일).
 * 규제검수(시즌2)와 다름 — 품질검수는 발행 차단이 아니라 점수·이슈 안내 + 1회 자동 수정.
 */

import { safeParseJson } from '../shortform/parse-claude-json.js';
import { callClaude, CHECK_MODEL } from '../season2/anthropic.js';

// ───────────────────────── 1) 기계 검사 ─────────────────────────

const BANNED_WORDS = ['방법', '꿀팁', '비법', '하세요'];
// 제목이 서술형으로 닫히는지(명사 툭끊김 방지). 골드뱅크 전 제목이 이 꼴로 끝난다.
const TITLE_CLOSED = /(요|죠|다|까\?|까요\??|나요\??|세요\?|\?)\s*$/;

/** 문장 종결부(마지막 2자) 추출 — 어미 3연속 검출용. 마커·소제목은 문장이 아니므로 제외. */
function sentenceEndings(body) {
  return String(body)
    .replace(/\((사진|이미지):\s*[^)]+\)/g, '')
    .replace(/\[IMG\]/g, '')
    .split(/(?<=[.!?…])\s+|\n+/)
    .map((s) => s.trim().replace(/^#+\s*/, '').replace(/[.!?…]+$/, ''))
    .filter((s) => s.length >= 4)
    .map((s) => s.slice(-2))
    .filter((e) => /^[가-힣]{2}$/.test(e)); // 한글 종결부만(숫자·기호 끝은 어미 아님)
}

/**
 * 확정 판정 항목 검사. 위반 목록 반환(빈 배열 = 통과).
 * @param {{title:string, body:string, tags:string[]}} draft
 * @returns {{id:string, label:string, detail:string, fixable:boolean}[]}
 */
export function runMachineChecks(draft) {
  const issues = [];
  const title = String(draft.title || '');
  const body = String(draft.body || '');
  const text = `${title}\n${body}`;

  for (const w of BANNED_WORDS) {
    if (text.includes(w)) {
      issues.push({ id: `banned:${w}`, label: '금지어', detail: `"${w}" 사용됨 — 다른 표현으로`, fixable: true });
    }
  }
  if ([...title].length > 25) {
    issues.push({ id: 'title:length', label: '제목 길이', detail: `${[...title].length}자 — 25자 이내로`, fixable: true });
  }
  if (title && !TITLE_CLOSED.test(title)) {
    issues.push({ id: 'title:open', label: '제목 완결형', detail: '명사로 뚝 끊긴 느낌 — 문장이 닫히게', fixable: true });
  }
  const ends = sentenceEndings(body);
  for (let i = 0; i + 2 < ends.length; i++) {
    if (ends[i] === ends[i + 1] && ends[i] === ends[i + 2]) {
      issues.push({ id: 'ending:repeat', label: '종결어미 반복', detail: `"…${ends[i]}" 3문장 연속 — 어미를 섞어서`, fixable: true });
      break;
    }
  }
  // blog-image-pro가 파싱하는 마커 형식과 동일해야 이미지 파이프라인에 바로 꽂힌다.
  const imgs = (body.match(/\((사진|이미지):\s*[^)]+\)/g) || []).length;
  if (imgs !== 6) {
    issues.push({ id: 'img:count', label: '이미지 마커', detail: `(이미지: 설명) ${imgs}개 — 정확히 6개로`, fixable: true });
  }
  const tagCount = (draft.tags || []).length;
  if (tagCount < 5 || tagCount > 10) {
    issues.push({ id: 'tags:count', label: '태그 수', detail: `${tagCount}개 — 5~10개로`, fixable: true });
  }
  const len = body.length;
  if (len < 1600 || len > 3500) {
    issues.push({ id: 'body:length', label: '분량', detail: `${len}자 — 2,000~3,000자 안팎으로`, fixable: true });
  }
  return issues;
}

/** 위반 항목만 고치라는 재작성 지시(전체 JSON 재출력). 고칠 게 없으면 null. */
export function buildQualityFixInstruction(issues) {
  const fixable = (issues || []).filter((i) => i && i.fixable);
  if (fixable.length === 0) return null;
  const lines = fixable.map((i) => `- [${i.label}] ${i.detail}`).join('\n');
  return `방금 원고에서 아래 항목이 기준에 어긋난다. 해당 부분만 고치고 나머지는 그대로 유지해, 전체를 같은 JSON 형식으로 다시 출력하라.
${lines}`;
}

// ───────────────────────── 2) 모델 검사 (Haiku) ─────────────────────────

const HUMAN_ITEMS = [
  '1. 도입이 훅인가(장면·대사·숫자로 시작, 총론 아님)',
  '2. 잘못된 선택이 2개 이상 구체적으로 나열됐는가',
  '3. 기준 제시가 실제 상황·사례로 뒷받침되는가',
  '4. 마무리가 댓글을 부르는 질문인가(강요 아님)',
  '5. 문장 리듬 변화가 있는가(짧고 긴 문장 교차)',
  '6. 구어체 표현이 있는가(근데, 솔직히, 그러니까요 등)',
  '7. 같은 문장 시작어·구조가 3회 이상 반복되지 않는가',
  '8. 과잉 친절 문구가 없는가("도움이 되셨으면 합니다" 류)',
  '9. 감정·온도가 느껴지는 표현이 1개 이상 있는가',
  '10. 소제목이 사람이 쓸 법한가(기계적 나열형 아님)',
];

export function buildHumanCheckPrompt() {
  return `너는 네이버 블로그 원고의 "사람글 느낌" 검수기다. AI가 쓴 티가 나는 지점을 찾는다.

# 검수 항목(각 10점, 총 100점)
${HUMAN_ITEMS.join('\n')}

# 지침
- 발견한 모든 문제를 보고하라 — 확신이 낮거나 사소해 보여도 포함. 이 단계에서 중요도로 거르지 마라(걸러내기는 다음 단계가 한다).
- 각 문제에 항목 번호와 원고 속 근거 문구(quote)를 단다.

# 출력(JSON만)
{
  "score": 0~100,
  "issues": [ { "item": 항목번호, "quote": "원고 속 문구", "reason": "왜 감점" } ]
}`;
}

/** 모델 검사 결과 파싱. 실패 시 checked:false(품질검수는 보조 — 원고 전달을 막지 않는다). */
export function parseHumanVerdict(rawText) {
  const obj = safeParseJson(String(rawText || ''));
  if (!obj || typeof obj !== 'object' || typeof obj.score !== 'number') {
    return { checked: false, score: null, issues: [] };
  }
  return {
    checked: true,
    score: Math.max(0, Math.min(100, Math.round(obj.score))),
    issues: Array.isArray(obj.issues)
      ? obj.issues.filter((i) => i && typeof i.reason === 'string').slice(0, 20)
      : [],
  };
}

export const HUMAN_PASS_SCORE = 70; // 스킬 기준(112/160 = 70%)과 동일 비율

/**
 * 사람글 느낌 검사 실행(Haiku). parseError면 1회 재시도(온도만 올림 — 시즌2 runCheck 동일 정책).
 */
export async function runHumanCheck(draft) {
  const system = buildHumanCheckPrompt();
  const target = `제목: ${draft.title}\n\n${draft.body}`;
  const messages = [{ role: 'user', content: `아래 원고를 검수해라.\n\n${target}` }];

  let verdict = parseHumanVerdict(await callClaude({ system, messages, model: CHECK_MODEL, maxTokens: 1500, temperature: 0 }));
  if (!verdict.checked) {
    verdict = parseHumanVerdict(await callClaude({ system, messages, model: CHECK_MODEL, maxTokens: 1500, temperature: 0.3 }));
  }
  return verdict;
}
