// lib/shared-prompts/seda.js
//
// SEDA 작문 법칙 — 뚝딱툴 모든 AI 콘텐츠 생성기가 공유하는 원칙.
// S: Shortly(짧게) / E: Easily(쉽게) / D: Divide(문단 나누기) / A: Again(독자 재독)
//
// 사용: `${SEDA_PROMPT_BLOCK}\n\n[도구 고유 규칙]...` 형태로 프롬프트 상단에 삽입.
//
// NOTE: 이 파일이 canonical source. plan/spec과 문구가 다르면 이 파일이 우선.
// 문구 바꾸면 shared-prompts-seda.test.js의 회귀 테스트가 잡아준다.

export const SEDA_PROMPT_BLOCK = `[SEDA 작문 원칙 — 모든 텍스트에 적용]
- S(Shortly): 불필요한 단어 제거. 한 줄·한 문장 짧게.
- E(Easily): 쉽게 쓰기. 쉬운 어휘. 전문용어는 괄호로 풀어쓰기. 한 번에 한 메시지.
- D(Divide): 의미 단위로 줄·문단을 나눔. 덩어리 텍스트 금지. 줄바꿈은 \\n.
- A(Again): 작성 후 독자 시선으로 다시 읽기. 오해·지루함·어색한 조사 다듬기.`;
