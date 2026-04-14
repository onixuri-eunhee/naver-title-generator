/**
 * 숏폼 대본 작성 시 사용할 화자 페르소나 5종.
 * 각 페르소나는 1인칭 시점, 톤, 자주 쓰는 표현 패턴을 정의.
 * Claude/Gemini 프롬프트에 직접 주입됨 (Phase D).
 */

export const PERSONAS = [
  {
    id: 'store-owner',
    label: '매장 사장',
    description: '카페·식당·미용실·매장 등 운영',
    firstPerson: '저희 가게에서는, 직접 만나보시면',
    voiceCues: '친근하면서 매장에 대한 자부심 표현',
    sampleOpening: '오늘 단골손님이 이런 말씀을 하셨어요',
  },
  {
    id: 'blogger',
    label: '블로거',
    description: '블로그·SNS 콘텐츠 운영',
    firstPerson: '오늘 알려드릴 정보는, 제가 직접 써보니',
    voiceCues: '정보 전달 위주, 친절한 설명',
    sampleOpening: '많이들 헷갈려 하시는 부분 정리해드릴게요',
  },
  {
    id: 'instructor',
    label: '강사',
    description: '학원·온라인 강의·코치',
    firstPerson: '수업에서 자주 받는 질문이, 제가 가르치다 보면',
    voiceCues: '교육적 톤, 단계별 설명',
    sampleOpening: '오늘 수업 들으신 분이 이런 질문을 주셨는데요',
  },
  {
    id: 'consultant',
    label: '컨설턴트',
    description: '비즈니스·마케팅·재무 컨설턴트',
    firstPerson: '많은 사장님들이, 제 클라이언트 중에',
    voiceCues: '전문가 톤, 데이터/사례 인용',
    sampleOpening: '최근 3년간 100분의 사장님을 만나뵀는데',
  },
  {
    id: 'freelancer',
    label: '프리랜서',
    description: '디자이너·작가·개발자·1인 사업자',
    firstPerson: '제가 작업하면서, 클라이언트와 일하다 보니',
    voiceCues: '경험 기반, 솔직한 톤',
    sampleOpening: '5년차 프리랜서로 일하면서 깨달은 건',
  },
];

/**
 * id로 페르소나 조회. 존재하지 않으면 null.
 */
export function getPersona(id) {
  return PERSONAS.find((p) => p.id === id) || null;
}

/**
 * 직접 입력 페르소나 생성 (사용자가 5종 외 입력한 경우)
 */
export function buildCustomPersona(label, firstPersonHint) {
  return {
    id: 'custom',
    label: label || '직접 입력',
    description: '사용자 직접 입력',
    firstPerson: firstPersonHint || '제가, 저는',
    voiceCues: '사용자 톤 그대로',
    sampleOpening: '',
  };
}

export const TONES = [
  { id: 'professional', label: '전문가', description: '신뢰감 있는 톤, 정확한 정보 전달' },
  { id: 'casual', label: '친근한 친구', description: '편안하고 따뜻한 톤, 일상 대화' },
];
