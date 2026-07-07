/**
 * 뚝딱툴 블로그 생성기 v2 — 서버 프롬프트 + 출력 계약.
 * 원본: PRD/작업지시서-블로그생성기-sonnet-v1.md (실전검증 1건 통과본)의 서버판.
 *
 * 서버판 차이(작업지시서 14번):
 *  - 출력 = JSON 계약(파싱용). 자체검증 표는 뺀다 — 검수는 별도 패스(rule-stacking 회피).
 *  - 훅(제목·첫문장) 블록은 hook-engine이 회전·회피 반영해 주입.
 *  - 병의원·변호사 규제 업종은 이 프롬프트 대상 아님 — 시즌2(Opus+규제검수)가 담당.
 */

import { safeParseJson } from '../shortform/parse-claude-json.js';
import { normalizeTags } from '../season2/prompts.js';

export const BLOG_V2_MODEL = 'claude-sonnet-5';

/**
 * 원고 JSON 파싱. 실패 시 null(호출부가 에러 처리).
 * usedPattern·motifs는 훅엔진 최근기록(다음 글 회피)에 들어간다.
 */
export function parseBlogV2Draft(rawText) {
  const obj = safeParseJson(String(rawText || ''));
  if (!obj || typeof obj !== 'object' || typeof obj.body !== 'string' || !obj.body.trim()) return null;
  return {
    title: typeof obj.title === 'string' ? obj.title : '',
    body: obj.body,
    tags: normalizeTags(obj.tags),
    summary3: Array.isArray(obj.summary3) ? obj.summary3.map(String).slice(0, 3) : [],
    faq: Array.isArray(obj.faq)
      ? obj.faq.filter((f) => f && typeof f.q === 'string' && typeof f.a === 'string').slice(0, 5)
      : [],
    usedPattern: typeof obj.usedPattern === 'string' ? obj.usedPattern : '',
    motifs: Array.isArray(obj.motifs) ? obj.motifs.map(String).slice(0, 5) : [],
    note: typeof obj.note === 'string' ? obj.note : '',
  };
}

/**
 * 시스템 프롬프트 조립.
 * @param {object} s 슬롯 {industry, keyword, targetReader, userStory?, tone?, region?}
 * @param {string} hookBlock hook-engine buildHookBlock() 산출물
 */
export function buildBlogV2Prompt(s, hookBlock) {
  const tone = s.tone || '다정한 -요체';
  const target = s.targetChars || 2300;
  return `너는 네이버 블로그 홈판·검색 노출 전문 작가다. 목표는 예쁜 글이 아니라, ${s.targetReader}가 스크롤을 멈추고 끝까지 읽게 만드는 원고다.
글쓴이 시점: 이 글은 ${s.industry}를 운영하는 사람이 자기 블로그에 쓰는 글이다 — 운영자 1인칭 시점을 유지한다(손님 시점으로 쓰면 글쓴이가 뒤바뀐다).

# 입력
업종: ${s.industry}
키워드: ${s.keyword}
타겟 독자: ${s.targetReader}
${s.region ? `지역: ${s.region}\n` : ''}사용자 이야기: ${s.userStory || '(비어 있음)'}

${hookBlock}

# 본문 (처리 순서대로, 건너뛰지 않는다)
1. ${s.keyword} 검색자의 의도를 한 줄로 정의하고 글 전체가 그 의도를 해결한다.
2. 본문 4단: 도입(첫문장 확장 2~3문장) → 잘못된 선택 2~3개(구체적으로) → 기준 제시(사용자 이야기가 있으면 여기 녹여 실제 사례로) → 댓글을 부르는 질문 1개로 마무리.
3. AEO: 소제목(4~6개)마다 첫 문장에 결론부터. 글 끝에 3줄 요약과 FAQ 3개(질문+2문장 답).
4. 이미지 자리 [IMG] 6개(소제목마다 1개꼴), 태그 5~10개(키워드+연관어).

# 문장 규칙
- 어투 ${tone}. 문장 길이를 섞어 리듬을 만든다. 같은 종결어미 3연속 금지.
- 공백 포함 약 ${target}자.
- 금지어 4개: "방법" "꿀팁" "비법" "하세요" — 구체 행동 문장으로 대신한다 (이유: 광고·AI 냄새가 나서 홈판에서 눌리지 않는다).
- 확정적 위협("망합니다")은 후회·경고 톤("아차 싶었어요")으로 (이유: 부정 어그로는 이탈과 신고를 부른다).
- 출처·URL·매체명 없이 경험·해석으로 재서술 (이유: 인용 시비 방지).
- 요청한 원고 외의 것을 덧붙이지 않는다 (이유: 출력이 예측 가능해야 자동화가 안 깨진다).

# 출력 형식(JSON — 반드시 유효한 JSON, 다른 텍스트 없이)
{
  "title": "최종 제목",
  "body": "본문(소제목·[IMG] 6개 포함)",
  "tags": ["태그1", ...],
  "summary3": ["요약1", "요약2", "요약3"],
  "faq": [{"q": "질문", "a": "2문장 답"}, ...3개],
  "usedPattern": "쓴 패턴 조합 번호(예: 5+11)",
  "motifs": ["제목·첫문장의 핵심 숫자나 장면 2~3개(예: 40건, 텅 빈 예약표)"],
  "note": "특이사항(없으면 빈 문자열)"
}
- tags는 개별 문자열 배열. 본문 안 큰따옴표는 홑따옴표로 바꿔 JSON이 깨지지 않게 한다.`;
}
