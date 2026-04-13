/**
 * 숏폼 디자인 프리셋 — 컬러 + 키네틱 타이포 변형
 *
 * 10종 (이전 5종 → 10종). 각 프리셋은:
 * - colors: 배경/텍스트/액센트 컬러 토큰
 * - mesh: 배경 mesh gradient 원 3종
 * - kineticHook: HookScene 타이틀 텍스트 애니메이션 변형
 * - kineticBody: BodyScene 헤더 텍스트 애니메이션 변형
 *
 * 키네틱 변형 6종: wordReveal | scaleBounce | slideUpMask | typewriter | wave | rotate3d
 *
 * 네이밍 원칙: 단일 영문 컬러/무드 단어 + 한글 표시명. 캐주얼 슬로건 금지.
 */

export const PRESETS = {
  // ─────────────────────────────────────────────────────
  // 1. MIDNIGHT — 다크 네이비 + 코랄 액센트 (이전 ddukddak-basic)
  // ─────────────────────────────────────────────────────
  midnight: {
    name: '미드나잇',
    kineticHook: 'wordReveal',
    kineticBody: 'slideUpMask',
    colors: {
      bgBase: '#0b1220',
      bgSecondary: '#132238',
      bgTertiary: '#1f314a',
      textPrimary: '#ffffff',
      textSecondary: '#B4C1D6',
      accent: '#ff5f1f',
      accentLight: '#FFB89D',
      accentCream: '#2a1f18',
      white: '#ffffff',
      particle: 'rgba(255, 95, 31, 0.12)',
      glassBg: 'rgba(255, 255, 255, 0.06)',
      glassBorder: 'rgba(255, 95, 31, 0.25)',
      numberBadgeBg: 'rgba(255, 95, 31, 0.15)',
    },
    mesh: [
      { color: '#ff5f1f', opacity: 0.18, size: 700, blur: 180, left: -150, top: -100, seed: 'midnight-a' },
      { color: '#ff8a5f', opacity: 0.15, size: 800, blur: 200, left: 450, top: 1250, seed: 'midnight-b' },
      { color: '#6B7280', opacity: 0.08, size: 500, blur: 140, left: 290, top: 710, seed: 'midnight-c' },
    ],
  },

  // ─────────────────────────────────────────────────────
  // 2. CREAM — 크림 베이스 + 코랄 (이전 ddukddak-premium)
  // ─────────────────────────────────────────────────────
  cream: {
    name: '크림',
    kineticHook: 'scaleBounce',
    kineticBody: 'wordReveal',
    colors: {
      bgBase: '#FDF8F6',
      bgSecondary: '#F8F1EE',
      bgTertiary: '#F0E8E3',
      textPrimary: '#1A1A1A',
      textSecondary: '#6B6B6B',
      accent: '#ff6f61',
      accentLight: '#FFB8AF',
      accentCream: '#FDF0E8',
      white: '#ffffff',
      particle: 'rgba(255, 111, 97, 0.08)',
      glassBg: 'rgba(255, 255, 255, 0.5)',
      glassBorder: 'rgba(255, 111, 97, 0.15)',
      numberBadgeBg: 'rgba(255, 111, 97, 0.1)',
    },
    mesh: [
      { color: '#ff6f61', opacity: 0.12, size: 600, blur: 150, left: -150, top: -100, seed: 'cream-a' },
      { color: '#FFB8AF', opacity: 0.15, size: 700, blur: 180, left: 450, top: 1250, seed: 'cream-b' },
      { color: '#FDF0E8', opacity: 0.1, size: 500, blur: 120, left: 290, top: 710, seed: 'cream-c' },
    ],
  },

  // ─────────────────────────────────────────────────────
  // 3. CHAMPAGNE — 베이지 + 골드 (이전 elegant-wedding)
  // ─────────────────────────────────────────────────────
  champagne: {
    name: '샴페인',
    kineticHook: 'slideUpMask',
    kineticBody: 'scaleBounce',
    colors: {
      bgBase: '#F5F4F0',
      bgSecondary: '#EDEAE2',
      bgTertiary: '#E1DBCD',
      textPrimary: '#2A2A2A',
      textSecondary: '#6E6652',
      accent: '#C8A96E',
      accentLight: '#E8D5A8',
      accentCream: '#F8F4EC',
      white: '#ffffff',
      particle: 'rgba(200, 169, 110, 0.1)',
      glassBg: 'rgba(255, 255, 255, 0.55)',
      glassBorder: 'rgba(200, 169, 110, 0.2)',
      numberBadgeBg: 'rgba(200, 169, 110, 0.12)',
    },
    mesh: [
      { color: '#C8A96E', opacity: 0.14, size: 650, blur: 170, left: -120, top: -80, seed: 'champagne-a' },
      { color: '#E8D5A8', opacity: 0.16, size: 720, blur: 190, left: 460, top: 1260, seed: 'champagne-b' },
      { color: '#F8F4EC', opacity: 0.12, size: 520, blur: 130, left: 310, top: 720, seed: 'champagne-c' },
    ],
  },

  // ─────────────────────────────────────────────────────
  // 4. APRICOT — 따뜻한 살구 파스텔 (이전 cheerful-cafe)
  // ─────────────────────────────────────────────────────
  apricot: {
    name: '애프리콧',
    kineticHook: 'wave',
    kineticBody: 'wordReveal',
    colors: {
      bgBase: '#FFFBF5',
      bgSecondary: '#FFF4E6',
      bgTertiary: '#FFE8CC',
      textPrimary: '#5A3A1F',
      textSecondary: '#9A7A5E',
      accent: '#FF9F7A',
      accentLight: '#FFCFB8',
      accentCream: '#FFF0E4',
      white: '#ffffff',
      particle: 'rgba(255, 159, 122, 0.1)',
      glassBg: 'rgba(255, 255, 255, 0.6)',
      glassBorder: 'rgba(255, 159, 122, 0.2)',
      numberBadgeBg: 'rgba(255, 159, 122, 0.14)',
    },
    mesh: [
      { color: '#FFCFB8', opacity: 0.2, size: 680, blur: 160, left: -130, top: -90, seed: 'apricot-a' },
      { color: '#FFE8CC', opacity: 0.22, size: 740, blur: 180, left: 440, top: 1240, seed: 'apricot-b' },
      { color: '#FFF4E6', opacity: 0.16, size: 540, blur: 130, left: 300, top: 700, seed: 'apricot-c' },
    ],
  },

  // ─────────────────────────────────────────────────────
  // 5. OCEAN — 딥 네이비 + 스틸 블루 (이전 trust-expert)
  // ─────────────────────────────────────────────────────
  ocean: {
    name: '오션',
    kineticHook: 'slideUpMask',
    kineticBody: 'rotate3d',
    colors: {
      bgBase: '#EFF3F8',
      bgSecondary: '#E3EAF3',
      bgTertiary: '#D4DEEC',
      textPrimary: '#162B45',
      textSecondary: '#4B6784',
      accent: '#1E3A5F',
      accentLight: '#3B5A85',
      accentCream: '#F0F4FA',
      white: '#ffffff',
      particle: 'rgba(30, 58, 95, 0.08)',
      glassBg: 'rgba(255, 255, 255, 0.6)',
      glassBorder: 'rgba(30, 58, 95, 0.18)',
      numberBadgeBg: 'rgba(30, 58, 95, 0.1)',
    },
    mesh: [
      { color: '#1E3A5F', opacity: 0.1, size: 640, blur: 170, left: -140, top: -100, seed: 'ocean-a' },
      { color: '#3B5A85', opacity: 0.12, size: 720, blur: 190, left: 450, top: 1250, seed: 'ocean-b' },
      { color: '#D4DEEC', opacity: 0.18, size: 520, blur: 130, left: 300, top: 710, seed: 'ocean-c' },
    ],
  },

  // ═════════════════════════════════════════════════════
  // 신규 5종
  // ═════════════════════════════════════════════════════

  // ─────────────────────────────────────────────────────
  // 6. NOIR — 검정 + 골드 (럭셔리, 명품 무드)
  // ─────────────────────────────────────────────────────
  noir: {
    name: '누아르',
    kineticHook: 'typewriter',
    kineticBody: 'slideUpMask',
    colors: {
      bgBase: '#0A0A0A',
      bgSecondary: '#141414',
      bgTertiary: '#1F1F1F',
      textPrimary: '#F5F2E8',
      textSecondary: '#9A9485',
      accent: '#D4B87A',
      accentLight: '#E8D5A8',
      accentCream: '#1F1A14',
      white: '#F5F2E8',
      particle: 'rgba(212, 184, 122, 0.1)',
      glassBg: 'rgba(245, 242, 232, 0.04)',
      glassBorder: 'rgba(212, 184, 122, 0.25)',
      numberBadgeBg: 'rgba(212, 184, 122, 0.12)',
    },
    mesh: [
      { color: '#D4B87A', opacity: 0.1, size: 680, blur: 200, left: -160, top: -100, seed: 'noir-a' },
      { color: '#8B6F2C', opacity: 0.08, size: 750, blur: 220, left: 460, top: 1250, seed: 'noir-b' },
      { color: '#3A3022', opacity: 0.12, size: 540, blur: 160, left: 300, top: 720, seed: 'noir-c' },
    ],
  },

  // ─────────────────────────────────────────────────────
  // 7. SAGE — 세이지 그린 + 워머 톤 (자연/웰니스)
  // ─────────────────────────────────────────────────────
  sage: {
    name: '세이지',
    kineticHook: 'scaleBounce',
    kineticBody: 'wave',
    colors: {
      bgBase: '#F2F5F0',
      bgSecondary: '#E8EFE3',
      bgTertiary: '#D9E4D2',
      textPrimary: '#2E4238',
      textSecondary: '#6F8474',
      accent: '#6B8F7B',
      accentLight: '#A8C2B2',
      accentCream: '#EEF4EA',
      white: '#ffffff',
      particle: 'rgba(107, 143, 123, 0.1)',
      glassBg: 'rgba(255, 255, 255, 0.55)',
      glassBorder: 'rgba(107, 143, 123, 0.2)',
      numberBadgeBg: 'rgba(107, 143, 123, 0.12)',
    },
    mesh: [
      { color: '#6B8F7B', opacity: 0.14, size: 660, blur: 170, left: -130, top: -90, seed: 'sage-a' },
      { color: '#A8C2B2', opacity: 0.18, size: 730, blur: 190, left: 450, top: 1250, seed: 'sage-b' },
      { color: '#EEF4EA', opacity: 0.14, size: 530, blur: 130, left: 300, top: 710, seed: 'sage-c' },
    ],
  },

  // ─────────────────────────────────────────────────────
  // 8. PLUM — 딥 플럼 + 라벤더 (시크/창의)
  // ─────────────────────────────────────────────────────
  plum: {
    name: '플럼',
    kineticHook: 'rotate3d',
    kineticBody: 'wordReveal',
    colors: {
      bgBase: '#1A0F1F',
      bgSecondary: '#251A30',
      bgTertiary: '#352440',
      textPrimary: '#F4F0F8',
      textSecondary: '#B8A8C5',
      accent: '#C8A87C',
      accentLight: '#E0CFAA',
      accentCream: '#2A1F32',
      white: '#F4F0F8',
      particle: 'rgba(200, 168, 124, 0.1)',
      glassBg: 'rgba(244, 240, 248, 0.05)',
      glassBorder: 'rgba(200, 168, 124, 0.2)',
      numberBadgeBg: 'rgba(200, 168, 124, 0.13)',
    },
    mesh: [
      { color: '#5E4B6E', opacity: 0.22, size: 700, blur: 200, left: -150, top: -100, seed: 'plum-a' },
      { color: '#C8A87C', opacity: 0.1, size: 760, blur: 220, left: 460, top: 1250, seed: 'plum-b' },
      { color: '#251A30', opacity: 0.3, size: 540, blur: 150, left: 300, top: 720, seed: 'plum-c' },
    ],
  },

  // ─────────────────────────────────────────────────────
  // 9. FOREST — 딥 포레스트 그린 + 베이지 (자연 럭셔리)
  // ─────────────────────────────────────────────────────
  forest: {
    name: '포레스트',
    kineticHook: 'wordReveal',
    kineticBody: 'slideUpMask',
    colors: {
      bgBase: '#0E1812',
      bgSecondary: '#162018',
      bgTertiary: '#1F2D22',
      textPrimary: '#F0EEE0',
      textSecondary: '#A8B0A0',
      accent: '#B8A88A',
      accentLight: '#D8C8A8',
      accentCream: '#1A2418',
      white: '#F0EEE0',
      particle: 'rgba(184, 168, 138, 0.1)',
      glassBg: 'rgba(240, 238, 224, 0.05)',
      glassBorder: 'rgba(184, 168, 138, 0.22)',
      numberBadgeBg: 'rgba(184, 168, 138, 0.14)',
    },
    mesh: [
      { color: '#3D5A40', opacity: 0.2, size: 680, blur: 190, left: -140, top: -100, seed: 'forest-a' },
      { color: '#B8A88A', opacity: 0.08, size: 750, blur: 200, left: 450, top: 1250, seed: 'forest-b' },
      { color: '#1F2D22', opacity: 0.25, size: 530, blur: 140, left: 300, top: 720, seed: 'forest-c' },
    ],
  },

  // ─────────────────────────────────────────────────────
  // 10. ROSE — 더스티 로즈 + 와인 (감성/뷰티)
  // ─────────────────────────────────────────────────────
  rose: {
    name: '로즈',
    kineticHook: 'wave',
    kineticBody: 'scaleBounce',
    colors: {
      bgBase: '#FAF2F4',
      bgSecondary: '#F4E8EC',
      bgTertiary: '#EBD8DD',
      textPrimary: '#3A1E2A',
      textSecondary: '#8C5A6E',
      accent: '#A04A66',
      accentLight: '#D4889E',
      accentCream: '#F8EEF1',
      white: '#ffffff',
      particle: 'rgba(160, 74, 102, 0.1)',
      glassBg: 'rgba(255, 255, 255, 0.55)',
      glassBorder: 'rgba(160, 74, 102, 0.2)',
      numberBadgeBg: 'rgba(160, 74, 102, 0.12)',
    },
    mesh: [
      { color: '#A04A66', opacity: 0.12, size: 660, blur: 180, left: -130, top: -90, seed: 'rose-a' },
      { color: '#D4889E', opacity: 0.18, size: 730, blur: 190, left: 450, top: 1250, seed: 'rose-b' },
      { color: '#F4E8EC', opacity: 0.16, size: 530, blur: 130, left: 300, top: 710, seed: 'rose-c' },
    ],
  },
};

export const PRESET_KEYS = Object.keys(PRESETS);
export const DEFAULT_PRESET_KEY = 'midnight';

export function getPreset(key) {
  return PRESETS[key] || PRESETS[DEFAULT_PRESET_KEY];
}

/**
 * 랜덤 프리셋 선택 (다양성 모드)
 * 같은 시드 → 같은 결과 (재현 가능)
 */
export function getRandomPresetKey(seed) {
  if (!seed) {
    return PRESET_KEYS[Math.floor(Math.random() * PRESET_KEYS.length)];
  }
  // 결정적 해시
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (h * 31 + seed.charCodeAt(i)) | 0;
  }
  const idx = Math.abs(h) % PRESET_KEYS.length;
  return PRESET_KEYS[idx];
}
