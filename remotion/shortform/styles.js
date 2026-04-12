/**
 * 숏폼 디자인 토큰 — my-video 포팅판
 * 색상은 프리셋에서 주입받으므로 여기는 레이아웃/폰트 상수만 유지
 */
import { loadFont } from '@remotion/google-fonts/NotoSansKR';

const { fontFamily: notoSansKR } = loadFont('normal', {
  weights: ['400', '500', '700', '900'],
  subsets: ['korean'],
});

export const FONTS = {
  primary: notoSansKR,
  weight: {
    regular: 400,
    medium: 500,
    bold: 700,
    black: 900,
  },
};

export const SPACING = {
  xs: 6,
  sm: 16,
  md: 24,
  lg: 40,
  xl: 60,
  xxl: 80,
};

export const RADIUS = {
  card: 24,
  large: 48,
  full: 100,
};

export const SIZES = {
  hookBadge: 38,
  hookTitle: 88,
  hookUnderline: 64,
  bodyHeader: 64,
  bodyCaption: 40,
  cardNumber: 120,
  cardTitle: 48,
  cardDescription: 28,
  ctaBrand: 56,
  ctaHeadline: 56,
  ctaButton: 44,
};

export const SPRING_CONFIG = { damping: 200 };

export const SHORTFORM_FPS = 30;
export const SHORTFORM_WIDTH = 1080;
export const SHORTFORM_HEIGHT = 1920;
