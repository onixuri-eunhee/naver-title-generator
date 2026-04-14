/**
 * 숏폼 상위 프리셋 6종 — Step 6 사용자 선택용.
 *
 * 각 상위 프리셋은 다음을 정의한다:
 * - colorPreset: 기존 remotion/shortform/presets.js의 10종 컬러 프리셋 키
 * - kinetic: 정적 | light | heavy | word-by-word
 * - textPosition: top | center | center-large | bottom | free
 * - cameraMotion: static | ken-burns | zoom-in | pan
 * - sceneTransition: fade | fade-long | slide | slide-fast | cut
 * - subtitle: { color, font, size, position, bgColor, bgOpacity }
 * - bgmCategory: calm | energetic | impact | emotional | trend
 * - personas: 해당 프리셋을 추천할 페르소나 id
 *
 * 스펙 §24 참조. lib/shortform-personas.js의 id와 연결.
 */

export const SHORTFORM_PRESETS = {
  professional: {
    id: 'professional',
    label: '전문가',
    description: '신뢰감 있는 전문 콘텐츠 톤',
    colorPreset: 'midnight',
    kinetic: 'static',
    textPosition: 'bottom',
    cameraMotion: 'static',
    sceneTransition: 'fade',
    subtitle: {
      color: '#ffffff',
      font: 'Pretendard',
      size: 56,
      position: 'bottom',
      bgColor: '#000000',
      bgOpacity: 0.5,
    },
    bgmCategory: 'calm',
    personas: ['consultant', 'instructor'],
  },

  friendly: {
    id: 'friendly',
    label: '친근',
    description: '따뜻하고 다가가기 편한 톤',
    colorPreset: 'cream',
    kinetic: 'light',
    textPosition: 'center',
    cameraMotion: 'ken-burns',
    sceneTransition: 'slide',
    subtitle: {
      color: '#FFD233',
      font: 'Noto Sans KR',
      size: 64,
      position: 'center',
      bgColor: '#1A1A1A',
      bgOpacity: 0.4,
    },
    bgmCategory: 'energetic',
    personas: ['store-owner', 'blogger'],
  },

  impact: {
    id: 'impact',
    label: '임팩트',
    description: '강렬하고 시선을 사로잡는 톤',
    colorPreset: 'midnight',
    kinetic: 'heavy',
    textPosition: 'center-large',
    cameraMotion: 'zoom-in',
    sceneTransition: 'cut',
    subtitle: {
      color: '#FF3333',
      font: 'Pretendard',
      size: 80,
      position: 'center',
      bgColor: '#ffffff',
      bgOpacity: 0.9,
    },
    bgmCategory: 'impact',
    personas: ['store-owner', 'freelancer'],
  },

  calm: {
    id: 'calm',
    label: '차분',
    description: '감성적이고 여유로운 톤',
    colorPreset: 'champagne',
    kinetic: 'static',
    textPosition: 'bottom',
    cameraMotion: 'static',
    sceneTransition: 'fade-long',
    subtitle: {
      color: '#F5E8D0',
      font: 'Spoqa Han Sans Neo',
      size: 56,
      position: 'bottom',
      bgColor: '#000000',
      bgOpacity: 0.35,
    },
    bgmCategory: 'emotional',
    personas: ['instructor', 'consultant'],
  },

  trendy: {
    id: 'trendy',
    label: '트렌디',
    description: '젊고 역동적인 트렌드 감각',
    colorPreset: 'rose',
    kinetic: 'word-by-word',
    textPosition: 'free',
    cameraMotion: 'pan',
    sceneTransition: 'slide-fast',
    subtitle: {
      color: '#39FF14',
      font: 'Suit',
      size: 72,
      position: 'center',
      bgColor: '#000000',
      bgOpacity: 0.6,
    },
    bgmCategory: 'trend',
    personas: ['freelancer', 'blogger'],
  },

  business: {
    id: 'business',
    label: '비즈니스',
    description: '정제된 비즈니스 프레젠테이션 톤',
    colorPreset: 'midnight',
    kinetic: 'static',
    textPosition: 'top',
    cameraMotion: 'static',
    sceneTransition: 'cut',
    subtitle: {
      color: '#1D3A80',
      font: 'IBM Plex Sans KR',
      size: 56,
      position: 'top',
      bgColor: '#ffffff',
      bgOpacity: 0.9,
    },
    bgmCategory: 'calm',
    personas: ['consultant', 'store-owner'],
  },
};

export const SHORTFORM_PRESET_KEYS = Object.keys(SHORTFORM_PRESETS);
export const DEFAULT_SHORTFORM_PRESET = 'friendly';

/**
 * id로 프리셋 조회. 없으면 기본값 반환.
 */
export function getShortformPreset(id) {
  return SHORTFORM_PRESETS[id] || SHORTFORM_PRESETS[DEFAULT_SHORTFORM_PRESET];
}

/**
 * 벤치마킹 결과 recommendedPreset 문자열 → 프리셋 id로 정규화.
 * Gemini 응답이 한글 label을 돌려주는 경우가 많아 label 매칭도 지원.
 */
export function resolveRecommendedPreset(raw) {
  if (!raw) return DEFAULT_SHORTFORM_PRESET;
  const trimmed = String(raw).trim().toLowerCase();
  // id 직접 매칭
  if (SHORTFORM_PRESETS[trimmed]) return trimmed;
  // 한글 label 매칭
  const byLabel = Object.values(SHORTFORM_PRESETS).find(
    (p) => p.label === raw || p.label === String(raw).trim(),
  );
  return byLabel?.id || DEFAULT_SHORTFORM_PRESET;
}

/**
 * Step 6 초기값 — 프리셋 id 하나에서 전체 step6Value 구성
 */
export function buildStep6ValueFromPreset(presetId) {
  const p = getShortformPreset(presetId);
  return {
    presetKey: p.id,
    subtitle: { ...p.subtitle },
    textPosition: p.textPosition,
    cameraMotion: p.cameraMotion,
    sceneTransition: p.sceneTransition,
    sceneImageOrder: [], // [{sceneId, imageUrl}] — 빈 상태는 자동 배치
    mode: 'recommended', // 'recommended' | 'custom'
  };
}

/**
 * 자막 폰트 옵션 — 세부 조정 UI에서 사용
 */
export const SUBTITLE_FONTS = [
  { id: 'Pretendard', label: 'Pretendard' },
  { id: 'Noto Sans KR', label: 'Noto Sans KR' },
  { id: 'Spoqa Han Sans Neo', label: 'Spoqa Han Sans Neo' },
  { id: 'IBM Plex Sans KR', label: 'IBM Plex Sans KR' },
  { id: 'Suit', label: 'SUIT' },
];

/**
 * 자막 색 8종 + 커스텀 HEX 지원
 */
export const SUBTITLE_COLORS = [
  { id: 'white', hex: '#FFFFFF', label: '흰색' },
  { id: 'yellow', hex: '#FFD233', label: '옐로우' },
  { id: 'red', hex: '#FF3333', label: '빨강' },
  { id: 'beige', hex: '#F5E8D0', label: '베이지' },
  { id: 'neon', hex: '#39FF14', label: '형광' },
  { id: 'navy', hex: '#1D3A80', label: '네이비' },
  { id: 'black', hex: '#000000', label: '검정' },
  { id: 'coral', hex: '#FF5F1F', label: '코랄' },
];

/**
 * 자막 배경색 8종
 */
export const SUBTITLE_BG_COLORS = [
  { id: 'black', hex: '#000000', label: '검정' },
  { id: 'white', hex: '#FFFFFF', label: '흰색' },
  { id: 'dark', hex: '#1A1A1A', label: '다크' },
  { id: 'cream', hex: '#FDF8F6', label: '크림' },
  { id: 'navy', hex: '#0F3460', label: '네이비' },
  { id: 'coral', hex: '#FF5F1F', label: '코랄' },
  { id: 'yellow', hex: '#FFD233', label: '옐로우' },
  { id: 'gray', hex: '#6B7280', label: '그레이' },
];

export const TEXT_POSITIONS = [
  { id: 'top', label: '상단' },
  { id: 'center', label: '중앙' },
  { id: 'center-large', label: '중앙 (큰 글씨)' },
  { id: 'bottom', label: '하단' },
  { id: 'free', label: '자유 배치' },
];

export const CAMERA_MOTIONS = [
  { id: 'static', label: '정적' },
  { id: 'ken-burns', label: 'Ken Burns' },
  { id: 'zoom-in', label: '줌 인' },
  { id: 'pan', label: '패닝' },
];

export const SCENE_TRANSITIONS = [
  { id: 'cut', label: '컷' },
  { id: 'fade', label: '페이드' },
  { id: 'fade-long', label: '페이드 (긴)' },
  { id: 'slide', label: '슬라이드' },
  { id: 'slide-fast', label: '슬라이드 (빠름)' },
];
