/**
 * 시즌2 업종별 광고 규제 룰 세트 (데이터).
 *
 * 법령 근거(2026-07-03 확인):
 *  - 병원: 의료법 제56조②(금지 12유형)·시행령 제23조·제27조③
 *  - 변호사: 변호사법 제23조② + 변협 「변호사 광고에 관한 규정」 제4조
 *  - 기업: 표시·광고의 공정화에 관한 법률
 *
 * ⚠️ 조문 기반이지만 초안. 최종본은 변호사 감수 필요(PRD 04번·미결 #3).
 * 룰은 코드 상수가 아니라 편집 가능한 데이터로 관리 → 법 개정 시 이 파일만 갱신.
 * 이 도구는 위반 소지 사전 경고이지 심의 통과 보장 아님(PRD 07번).
 */

/** @typedef {{ id: string, basis: string, catch: string, replace: string }} RegRule */

/** 병원·의원 — 의료법 제56조② 12유형 기반 */
export const MEDICAL_RULES = [
  { id: 'medical.cure_guarantee', basis: '의료법 제56조②2 치료효과 보장·현혹', catch: '완치 가능, 반드시 효과, 무조건 낫습니다, 100% 치료', replace: '증상 완화를 기대할 수 있습니다' },
  { id: 'medical.comparison', basis: '제56조②3 비교광고', catch: '타 병원보다 우수, 다른 병원보다', replace: '비교 표현 삭제' },
  { id: 'medical.disparage', basis: '제56조②4 비방', catch: '다른 병원은 못하는, 실력 없는 곳', replace: '삭제' },
  { id: 'medical.surgery_scene', basis: '제56조②5 시술장면 노출(이미지)', catch: '수술·시술·환부·혈흔 직접 묘사', replace: '비노출' },
  { id: 'medical.side_effect_omit', basis: '제56조②6 중요정보(부작용) 누락', catch: '부작용 없는, 100% 안전, 무통증 보장', replace: '부작용·개인차 명시' },
  { id: 'medical.unverified_claim', basis: '제56조②7 객관적 근거 없음', catch: '근거 없는 우위·수치, 통증 없는', replace: '근거 없으면 삭제' },
  { id: 'medical.article_style', basis: '제56조②8 기사·전문가 의견형', catch: '기사/인터뷰 위장 형식', replace: '광고임을 명확히' },
  { id: 'medical.price_bait', basis: '제56조②11 비급여 할인·면제 오인', catch: '임플란트 39만원 특가, 오늘까지 반값, 이벤트가', replace: '가격은 구성 항목(재료·보철·범위) 안내' },
  { id: 'medical.superlative', basis: '시행령 제23조 최상급', catch: '최고의, 국내 유일, 1위, 최상', replace: '삭제 또는 객관 근거' },
  { id: 'medical.testimonial', basis: '시행령 제23조 치료경험담', catch: '○○ 받고 다 나았어요 식 환자 후기', replace: '개별 경험담 지양' },
  { id: 'medical.patient_inducement', basis: '의료법 제27조③ 환자 유인', catch: '지인 소개 시 할인, 선착순 무료', replace: '삭제' },
];

/** 변호사·법무법인 — 변호사법 제23조② + 변협 광고규정 제4조 */
export const LEGAL_RULES = [
  { id: 'legal.false', basis: '변호사법 제23조②1 거짓 표시', catch: '사실과 다른 경력·실적', replace: '실제 사실만' },
  { id: 'legal.fake_credential', basis: '제23조②2 근거 없는 자격·명칭', catch: '국제변호사, 법적근거 없는 명칭', replace: '삭제' },
  { id: 'legal.exaggerate_mislead', basis: '제23조②3 과장·일부 누락 오도', catch: '업계 최다 승소, 유리한 사실만', replace: '균형·근거' },
  { id: 'legal.win_guarantee', basis: '제23조②4 / 규정 제4조 부당한 기대', catch: '반드시 승소, 무죄 보장, 승소율 98%, 석방율, 100% 가능', replace: '~을 받아낸 사례(과거·개별)' },
  { id: 'legal.superlative', basis: '규정 제4조 최고·유일', catch: '최고의 변호사, 국내 1위 로펌, 유일한', replace: '삭제' },
  { id: 'legal.disparage', basis: '제23조②(비교·비방)', catch: '다른 변호사는 못하는', replace: '삭제' },
  { id: 'legal.client_disclosure', basis: '규정(의뢰인 동의 없는 공개)', catch: '동의 없는 의뢰인·사건 특정', replace: '익명·동의 확보' },
];

/** 기업 — 표시·광고의 공정화에 관한 법률 */
export const BIZ_RULES = [
  { id: 'biz.false_superlative', basis: '표시광고법 근거 없는 최상급', catch: '업계 1위, 국내 최초(근거 없이)', replace: '근거 표기 또는 삭제' },
  { id: 'biz.exaggeration', basis: '과장·기만', catch: '100% 만족 보장, 무조건 성공', replace: '단정 표현 제거' },
  { id: 'biz.fake_review', basis: '거짓 후기·체험', catch: '실제 없는 사용 후기', replace: '실제 후기만' },
];

export const RULE_SETS = {
  medical: MEDICAL_RULES,
  legal: LEGAL_RULES,
  biz: BIZ_RULES,
};

/** 업종 코드 → 룰 세트. 알 수 없으면 빈 배열(검수는 통과되나 로그 경고). */
export function getRuleSet(industry) {
  return RULE_SETS[industry] || [];
}

/**
 * 이미지 생성 사전 차단 지시(업종별). 텍스트 검수로 못 잡는 이미지 규제 대응(PRD 04 1-2장).
 * ⚠️ 아직 미연결 — 이미지 생성 슬라이스에서 gpt-image 프롬프트에 주입 예정.
 * 현재 슬라이스(원고 텍스트 생성)에서는 호출되지 않는다.
 */
export function imageGuard(industry) {
  if (industry === 'medical') {
    return '수술·시술 장면, 환부, 혈흔, 의료행위 직접 묘사 금지. 시술 전후 비교 이미지 금지.';
  }
  return '';
}

export const INDUSTRIES = ['medical', 'legal', 'biz'];
