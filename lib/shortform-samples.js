/**
 * 숏폼 온보딩 샘플 4종.
 *
 * 각 샘플은 Step1Input 의 value 구조와 100% 호환되어
 * OnboardingModal 이 "사용하기" 클릭 시 바로 state로 주입된다.
 *
 * 원칙:
 * - 블로그 글 200자 이상 (입력 검증 통과 + 사용자가 수정 없이 진행 가능한 품질)
 * - 경험·느낌 50자 이상 (강한 1인칭)
 * - 이모지 금지
 * - 페르소나/톤/길이 모두 확정
 */

export const SAMPLES = [
  {
    id: 'store-owner-cafe',
    industry: '매장 사장',
    industrySub: '동네 카페',
    persona: 'store-owner',
    tone: 'casual',
    durationSec: 45,
    contentMode: 'blog',
    blogText: `오늘 단골손님이 "여기 왜 이렇게 커피 맛이 한결같냐"고 물어보셨어요. 제가 드린 답은 간단했어요. "원두 배합을 바꾸지 않고, 볶는 정도를 계절마다 0.5단계씩 조정하거든요." 여름엔 쓴맛이 더 도드라지게, 겨울엔 단맛이 길게 남도록. 작은 카페라 기계 바꿀 돈도, 바리스타 교체도 어렵지만 대신 원두와 물과 기계 온도 3가지만 매일 같은 시간에 점검해요. 손님이 "여기 커피 맛이 안 변해"라고 말해주는 게 제일 좋은 리뷰라고 생각해요.`,
    userExperience: '15년차 카페 사장. 손님이 "여기 커피 맛이 한결같다"고 칭찬해줬을 때 진짜 기뻤음.',
  },
  {
    id: 'instructor-math',
    industry: '강사',
    industrySub: '학원 수학 강사',
    persona: 'instructor',
    tone: 'professional',
    durationSec: 60,
    contentMode: 'blog',
    blogText: `수업에서 자주 받는 질문이 있어요. "수학은 왜 풀이 과정을 쓰라고 해요?" 답안만 맞으면 되는 거 아닌가 싶잖아요. 근데 학원에서 10년 넘게 가르쳐 보니까, 풀이 과정을 안 쓰는 학생들 공통점이 있어요. 중학교까지는 어떻게든 점수 나오는데, 고등학교 2학년쯤 돼서 갑자기 무너져요. 문제가 복잡해지면 머릿속 암산으로 안 되거든요. 그래서 저는 첫 수업에 이런 규칙을 정해요. "문제 푼 거는 틀려도 괜찮아요. 대신 풀이는 반드시 적으세요." 시간이 지나면 이게 습관이 되고, 결국 큰 시험에서 살아남는 학생이 됩니다.`,
    userExperience: '10년차 수학 강사. 풀이 과정 안 쓰던 학생이 고2 때 무너지는 걸 반복해서 본 게 가장 확신 있는 이유.',
  },
  {
    id: 'consultant-marketing',
    industry: '컨설턴트',
    industrySub: '소상공인 마케팅 컨설턴트',
    persona: 'consultant',
    tone: 'professional',
    durationSec: 60,
    contentMode: 'blog',
    blogText: `최근 3년간 100분이 넘는 사장님을 만나뵀는데, 매출이 오르는 가게와 안 오르는 가게를 가르는 건 마케팅 예산 크기가 아니었어요. 10만원 쓰는 분과 500만원 쓰는 분 모두 실패하는 공통점이 하나 있어요. "우리 가게는 뭐가 다른가?"라는 질문에 3초 안에 답을 못 해요. 광고는 그 다음 문제예요. 타겟팅이 아무리 좋아도 차별점이 없으면 클릭률부터 안 나와요. 그래서 저는 컨설팅 들어가면 항상 첫 질문부터 이걸 묻습니다. "손님이 왜 다른 가게가 아니라 사장님 가게를 골라야 해요?"`,
    userExperience: '마케팅 컨설턴트 7년차. 100분 넘는 사장님 만나면서 "차별점 3초 안에 못 대답"이 모든 실패의 공통점이라고 확신.',
  },
  {
    id: 'blogger-travel',
    industry: '블로거',
    industrySub: '국내 여행 블로거',
    persona: 'blogger',
    tone: 'casual',
    durationSec: 45,
    contentMode: 'blog',
    blogText: `많이들 헷갈려 하시는 부분 정리해드릴게요. 제주도 2박 3일 일정 짤 때 가장 많이 하는 실수가 "하루에 3~4곳씩 넣는 거"예요. 지도로 보면 가까워 보이지만 제주는 도로가 구불구불해서 30분이 1시간으로 늘어나요. 제가 직접 50번 넘게 다녀본 결과, 하루에 "무조건 갈 곳 1곳 + 선택 1곳"만 잡으시고 나머지는 그 근처에서 자연스럽게 풀어가시는 게 가장 편해요. 이 방식으로 가면 사진도 잘 나오고, 식사도 여유롭고, 무엇보다 여행이 일처럼 안 느껴져요.`,
    userExperience: '제주도만 50번 이상 다녀본 여행 블로거. "하루 3~4곳 욕심내다가 사진만 남고 추억은 없다"는 실패 후 단순화.',
  },
];

/**
 * id로 샘플 조회.
 */
export function getSample(id) {
  return SAMPLES.find((s) => s.id === id) || null;
}

/**
 * OnboardingModal에서 "사용하기" 클릭 시 Step1Input 의 value 구조로 변환.
 */
export function sampleToStep1Value(sample) {
  if (!sample) return null;
  return {
    contentMode: sample.contentMode,
    blogText: sample.blogText,
    keywords: '',
    userExperience: sample.userExperience,
    persona: sample.persona,
    customPersonaLabel: '',
    tone: sample.tone,
    durationSec: sample.durationSec,
    // 샘플 출처 메타 (Phase L 검증·로깅용)
    _sampleId: sample.id,
  };
}
