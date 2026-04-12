/**
 * 숏폼 5 프리셋 — 색상/배경 스타일만 교체
 *
 * my-video 디자인 시스템 구조 유지, 프리셋별로 BRAND_COLORS + mesh circles만 다름
 */

export const PRESETS = {
  // 1. 뚝딱 기본 — 코랄 + 다크 (원래 shortform 톤)
  'ddukddak-basic': {
    name: '뚝딱 기본',
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
      { color: '#ff5f1f', opacity: 0.18, size: 700, blur: 180, left: -150, top: -100, seed: 'basic-a' },
      { color: '#ff8a5f', opacity: 0.15, size: 800, blur: 200, left: 450, top: 1250, seed: 'basic-b' },
      { color: '#6B7280', opacity: 0.08, size: 500, blur: 140, left: 290, top: 710, seed: 'basic-c' },
    ],
  },

  // 2. 뚝딱 프리미엄 — 코랄 + 밝은 mesh (my-video v2)
  'ddukddak-premium': {
    name: '뚝딱 프리미엄',
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
      { color: '#ff6f61', opacity: 0.12, size: 600, blur: 150, left: -150, top: -100, seed: 'premium-a' },
      { color: '#FFB8AF', opacity: 0.15, size: 700, blur: 180, left: 450, top: 1250, seed: 'premium-b' },
      { color: '#FDF0E8', opacity: 0.1, size: 500, blur: 120, left: 290, top: 710, seed: 'premium-c' },
    ],
  },

  // 3. 우아한 웨딩 — 베이지 + 골드
  'elegant-wedding': {
    name: '우아한 웨딩',
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
      { color: '#C8A96E', opacity: 0.14, size: 650, blur: 170, left: -120, top: -80, seed: 'wedding-a' },
      { color: '#E8D5A8', opacity: 0.16, size: 720, blur: 190, left: 460, top: 1260, seed: 'wedding-b' },
      { color: '#F8F4EC', opacity: 0.12, size: 520, blur: 130, left: 310, top: 720, seed: 'wedding-c' },
    ],
  },

  // 4. 발랄한 카페 — 파스텔 + 라운드
  'cheerful-cafe': {
    name: '발랄한 카페',
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
      { color: '#FFCFB8', opacity: 0.2, size: 680, blur: 160, left: -130, top: -90, seed: 'cafe-a' },
      { color: '#FFE8CC', opacity: 0.22, size: 740, blur: 180, left: 440, top: 1240, seed: 'cafe-b' },
      { color: '#FFF4E6', opacity: 0.16, size: 540, blur: 130, left: 300, top: 700, seed: 'cafe-c' },
    ],
  },

  // 5. 신뢰 전문가 — 네이비 + 화이트
  'trust-expert': {
    name: '신뢰 전문가',
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
      { color: '#1E3A5F', opacity: 0.1, size: 640, blur: 170, left: -140, top: -100, seed: 'expert-a' },
      { color: '#3B5A85', opacity: 0.12, size: 720, blur: 190, left: 450, top: 1250, seed: 'expert-b' },
      { color: '#D4DEEC', opacity: 0.18, size: 520, blur: 130, left: 300, top: 710, seed: 'expert-c' },
    ],
  },
};

export const PRESET_KEYS = Object.keys(PRESETS);
export const DEFAULT_PRESET_KEY = 'ddukddak-basic';

export function getPreset(key) {
  return PRESETS[key] || PRESETS[DEFAULT_PRESET_KEY];
}
