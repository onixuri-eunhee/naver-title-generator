/**
 * 카드뉴스 테마 프리셋 14종
 * 무드/스타일 기반 — 은은하면서 입체적인 프리미엄 팔레트
 *
 * 디자인 원칙:
 * - primary: 메인 브랜드 컬러 (채도 낮추고 깊이감)
 * - secondary: 카드 배경 (primary 극연한 톤, 평면적 화이트 대신 미색/크림)
 * - accent: 포인트 (primary와 보색 또는 동계열 밝은 톤)
 * - bgDark: 커버/CTA 배경 (primary 기반 딥톤)
 * - bg: 전체 배경 (secondary보다 더 연한 미색)
 */

const themes = {
  charcoal: {
    name: '차콜 & 골드',
    primary: '#3A3A3A',
    secondary: '#F5F4F0',
    accent: '#C8A96E',
    text: '#2A2A2A',
    textLight: '#8A8680',
    bg: '#FAF9F7',
    bgDark: '#1E1E1E',
    radius: 14,
  },
  midnight: {
    name: '미드나잇 블루',
    primary: '#1E3A5F',
    secondary: '#EFF3F8',
    accent: '#C4956A',
    text: '#162B45',
    textLight: '#6E849E',
    bg: '#F6F8FB',
    bgDark: '#0F2035',
    radius: 14,
  },
  sage: {
    name: '세이지 그린',
    primary: '#6B8F7B',
    secondary: '#F2F5F3',
    accent: '#D4B896',
    text: '#2E4238',
    textLight: '#7A9688',
    bg: '#F8FAF8',
    bgDark: '#243530',
    radius: 16,
  },
  rosewood: {
    name: '로즈우드',
    primary: '#8C5A6E',
    secondary: '#F8F2F4',
    accent: '#D4A08C',
    text: '#4A2C38',
    textLight: '#A07888',
    bg: '#FDF8FA',
    bgDark: '#3A1E2A',
    radius: 18,
  },
  slate: {
    name: '슬레이트',
    primary: '#506478',
    secondary: '#F0F2F5',
    accent: '#8AAEC0',
    text: '#2C3A48',
    textLight: '#7A8B9C',
    bg: '#F7F8FA',
    bgDark: '#1C2A38',
    radius: 12,
  },
  espresso: {
    name: '에스프레소',
    primary: '#5C4033',
    secondary: '#F5F0EB',
    accent: '#C49A6C',
    text: '#3A2518',
    textLight: '#937B6A',
    bg: '#FAF7F4',
    bgDark: '#2A1810',
    radius: 16,
  },
  ocean: {
    name: '딥 오션',
    primary: '#1A535C',
    secondary: '#EEF5F6',
    accent: '#E8866A',
    text: '#0E2F33',
    textLight: '#5A8E94',
    bg: '#F5FAFB',
    bgDark: '#0A2228',
    radius: 14,
  },
  plum: {
    name: '플럼 벨벳',
    primary: '#5E4B6E',
    secondary: '#F4F0F8',
    accent: '#C8A87C',
    text: '#352840',
    textLight: '#8A7898',
    bg: '#FAF8FC',
    bgDark: '#251A30',
    radius: 18,
  },
  forest: {
    name: '포레스트',
    primary: '#3D5A40',
    secondary: '#F0F4EE',
    accent: '#B8A88A',
    text: '#1E2E20',
    textLight: '#6A826C',
    bg: '#F7F9F6',
    bgDark: '#162018',
    radius: 14,
  },
  mono: {
    name: '모노크롬',
    primary: '#1A1A1A',
    secondary: '#F2F2F2',
    accent: '#E06030',
    text: '#1A1A1A',
    textLight: '#888888',
    bg: '#F8F8F8',
    bgDark: '#0A0A0A',
    radius: 12,
  },
  blush: {
    name: '블러시 테라',
    primary: '#B0785A',
    secondary: '#F8F2EE',
    accent: '#D4A088',
    text: '#4A3028',
    textLight: '#A08878',
    bg: '#FBF8F5',
    bgDark: '#382218',
    radius: 16,
  },
  arctic: {
    name: '아틱 아이스',
    primary: '#4A6FA5',
    secondary: '#EFF3F9',
    accent: '#7EB5D6',
    text: '#1E3352',
    textLight: '#6E88A8',
    bg: '#F6F9FC',
    bgDark: '#142440',
    radius: 14,
  },
  terracotta: {
    name: '테라코타',
    primary: '#A0634B',
    secondary: '#F5EDE8',
    accent: '#8A9A6C',
    text: '#4A2E22',
    textLight: '#9E7E6E',
    bg: '#FAF6F3',
    bgDark: '#321E14',
    radius: 16,
  },
  noir: {
    name: '느와르',
    primary: '#B8A272',
    secondary: '#2A2A28',
    accent: '#D4C090',
    text: '#F0EBE0',
    textLight: '#9A9488',
    bg: '#1A1A18',
    bgDark: '#0E0E0C',
    radius: 12,
  },
};

function buildThemePreviewMap() {
  return Object.fromEntries(
    Object.entries(themes).map(([key, theme]) => [
      key,
      { name: theme.name, colors: [theme.primary, theme.secondary, theme.accent] },
    ])
  );
}

export { themes, buildThemePreviewMap };
