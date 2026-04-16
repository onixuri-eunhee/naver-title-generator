// lib/shortform/reasoning-copy.js
//
// 9 카테고리별 reasoning 툴팁 큐레이션 + Claude few-shot 주입용 예시.
// 서버 전용 — 클라이언트 번들 유출 차단.
//
// spec: docs/superpowers/specs/2026-04-16-video-phase-a-bis-design.md §4.5 / Q9
//
// L3 빌드 시점 강제: server-only 패키지가 Next.js webpack layer에서
// 클라이언트 컴포넌트 import 시 빌드 에러 발생시킴.

// @server-only
import 'server-only';

// Q9 reasoning 카피 규칙:
// - 30~50자, 모바일 툴팁 최적
// - 타겟 구체 행동/심리 1개 + 결과 1개
// - 추상어 금지 ("효과적", "최적화")
// - 숫자 가산점 ("리플레이 확률 ~30% ↑")
// - ❌ "이 카테고리에 가장 적합한 톤입니다"
// - ✅ "예비부부는 '진짜 그럴까?' 의심형에 댓글 다는 비율이 2배 높음"

const DATA = {
  wedding: {
    copies: [
      "예비부부는 '진짜 그럴까?' 의심형에 댓글 다는 비율이 2배 높음",
      '계약 직전 3~6개월 구간에서 저장 후 재시청 리플레이 ~30% ↑',
      '전문형 CTA는 "19년차" 같은 경력 숫자와 붙을 때 신뢰도 체감 큼',
      '숫자형 훅("3대 실수")은 스크롤 멈춤률이 스토리형보다 1.4배',
    ],
    fewShots: [
      {
        chip: 'ctaTone',
        value: 'casual',
        reasoning:
          "예비부부는 '진짜 그럴까?' 의심형에 댓글 다는 비율이 2배 높음",
      },
      {
        chip: 'firstThreeSeconds',
        value: 'number',
        reasoning: '숫자형 훅 "3대 실수"는 웨딩 카테고리 스크롤 멈춤률 1.4배',
      },
    ],
  },
  food: {
    copies: [
      '레시피 저장 의도 시청자는 끝까지 보고 저장 버튼을 누름',
      '첫 1초 클로즈업이 있으면 평균 시청 시간 ~25% ↑',
      '친근형 CTA가 "집밥" "엄마표" 주제와 결합 시 전환 높음',
    ],
    fewShots: [
      {
        chip: 'ctaTone',
        value: 'casual',
        reasoning: '레시피 저장형 시청자는 친근한 "저장해두세요" 문구에 반응 큼',
      },
    ],
  },
  realestate: {
    copies: [
      '전세·매매 구간 시청자는 "숫자+지역" 조합에 체류 시간 2배',
      '전문형 CTA + 실거래가 데이터 조합이 저장률 상승',
      '첫 3초 충격형("전세 5천 차이 실화")이 댓글 밀도 1.8배',
    ],
    fewShots: [
      {
        chip: 'firstThreeSeconds',
        value: 'shock',
        reasoning: '전세·매매 갈등 포인트는 첫 3초 충격형이 체류 2배',
      },
    ],
  },
  ai_education: {
    copies: [
      '초보자는 "30초 만에" 류 시간 약속 훅에 저장 확률 높음',
      '질문형 스크립트는 리플레이 구간을 유도해 완주율 ~20% ↑',
      '친근형 CTA가 진입 장벽 낮춰 댓글 질문 유입 증가',
    ],
    fewShots: [
      {
        chip: 'scriptType',
        value: 'question',
        reasoning: '초보 대상 질문형은 리플레이 구간 유도로 완주율 ~20% ↑',
      },
    ],
  },
  beauty: {
    copies: [
      '"타입별" 분류 훅(건성/지성/복합성)이 저장 버튼 클릭 견인',
      '전·후 비교 씬 첫 3초가 스크롤 멈춤률 최상위',
      '친근형 CTA가 "같이 해봐요" 어투와 결합 시 팔로우 전환 높음',
    ],
    fewShots: [
      {
        chip: 'firstThreeSeconds',
        value: 'shock',
        reasoning: '전·후 비교 첫 3초가 뷰티 카테고리 스크롤 멈춤률 최상위',
      },
    ],
  },
  fitness: {
    copies: [
      '운동 루틴 영상은 숫자형 훅("하루 5분")이 저장 의도 최대',
      '리스트형 스크립트는 화면 분할 자막과 결합 시 완주율 ~15% ↑',
      '친근형 CTA가 "같이" "함께" 문구와 결합 시 팔로우 견인',
    ],
    fewShots: [
      {
        chip: 'scriptType',
        value: 'list',
        reasoning: '운동 루틴 리스트형은 화면 분할 자막과 결합 시 완주율 ~15% ↑',
      },
    ],
  },
  lifestyle: {
    copies: [
      '일상 공감 훅("이거 나만 그런가요?")이 댓글 밀도 2배',
      '스토리형 스크립트 + 친근형 CTA 결합이 저장 확률 상위',
      '첫 3초 생활 디테일 클로즈업이 체류 시간 ~25% ↑',
    ],
    fewShots: [
      {
        chip: 'scriptType',
        value: 'story',
        reasoning: '일상 공감 스토리형은 "이거 나만?" 훅과 결합 시 댓글 밀도 2배',
      },
    ],
  },
  business: {
    copies: [
      '1인 사장 시청자는 "실제 사례+숫자" 조합에 저장 의도 2배',
      '전문형 CTA + 경력 연차 노출이 신뢰도 체감 크게 상승',
      '질문형 스크립트("이거 모르면 손해")가 리플레이 구간 유도',
    ],
    fewShots: [
      {
        chip: 'ctaTone',
        value: 'professional',
        reasoning: '1인 사장 대상은 전문형 + 경력 연차 노출 시 신뢰도 체감 큼',
      },
    ],
  },
  other: {
    copies: [
      '카테고리 불명이면 질문형 + 친근형 CTA가 기본 안전권',
      '첫 3초 숫자형 훅은 어떤 주제에서도 스크롤 멈춤률 기본값 이상',
    ],
    fewShots: [
      {
        chip: 'firstThreeSeconds',
        value: 'number',
        reasoning: '카테고리 불명일 때 숫자형은 안전권 스크롤 멈춤 유도',
      },
    ],
  },
};

/**
 * Claude 프롬프트에 주입할 카테고리별 예시 집합 반환.
 * 알 수 없는 카테고리는 `other` 폴백.
 *
 * @param {string} category - 9종 중 하나 또는 임의 문자열
 * @returns {{ copies: string[], fewShots: Array<{chip, value, reasoning}> }}
 */
export function getReasoningExamples(category) {
  const hit = DATA[category] ?? DATA.other;
  return {
    copies: [...hit.copies],
    fewShots: hit.fewShots.map((f) => ({ ...f })),
  };
}

/**
 * 특정 칩/옵션/카테고리 조합의 툴팁 카피 1개 반환.
 * 매칭 실패 시 해당 카테고리 `copies[0]` 또는 빈 문자열.
 *
 * @param {string} chipId
 * @param {string} optionId
 * @param {string} category
 * @returns {string}
 */
export function getTooltipCopy(chipId, optionId, category) {
  const bucket = DATA[category] ?? DATA.other;
  const match = bucket.fewShots.find(
    (f) => f.chip === chipId && f.value === optionId
  );
  if (match) return match.reasoning;
  return bucket.copies[0] ?? '';
}
