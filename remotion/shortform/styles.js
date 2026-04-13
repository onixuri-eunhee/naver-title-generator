/**
 * 숏폼 디자인 토큰 — my-video 포팅판
 * 색상은 프리셋에서 주입받으므로 여기는 레이아웃/폰트 상수만 유지
 *
 * 주의: @remotion/google-fonts/NotoSansKR가 Google Fonts 최신 URL을 못
 * 따라가 런타임에 폰트 파일 404 + "weight: 400 is not available" 에러를
 * 던져 전체 숏폼 페이지 크래시를 일으켰음. 해당 import를 제거하고 CSS
 * font-family 문자열만 사용하도록 변경. 브라우저/시스템의 Noto Sans KR
 * 또는 Apple SD Gothic Neo로 폴백되어 동작. 추후 self-hosted TTF 또는
 * next/font 로 교체 예정.
 */

const notoSansKR = '"Noto Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';

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
