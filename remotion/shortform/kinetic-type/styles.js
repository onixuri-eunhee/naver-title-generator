import { PRETENDARD } from './fonts';

export const KT_COLORS = {
  bg: "#0A0A0A",
  coral: "#ff6f61",
  coralLight: "#FFB8AF",
  white: "#FFFFFF",
  gray: "#888888",
  warning: "#F59E0B",
} ;

/**
 * preset.colors → KT_COLORS 매핑. preset 없으면 KT_COLORS fallback.
 */
export function resolveColors(preset) {
  const c = preset?.colors;
  if (!c) return KT_COLORS;
  return {
    bg: c.bgBase || KT_COLORS.bg,
    coral: c.accent || KT_COLORS.coral,
    coralLight: c.accentLight || KT_COLORS.coralLight,
    white: c.textPrimary || KT_COLORS.white,
    gray: c.textSecondary || KT_COLORS.gray,
    warning: KT_COLORS.warning,
  };
}

export const KT_FONT = PRETENDARD;

export const KT_SIZES = {
  giant: 220,
  impact: 180,
  title: 110,
  body: 48,
  small: 40,
  subtitle: 52,
} ;

export const KT_WEIGHTS = {
  regular: 400,
  medium: 500,
  bold: 700,
  extraBold: 800,
  black: 900,
} ;

export const KT_SPRING = { damping: 200, stiffness: 100 } ;

export const KT_TEXT_SHADOW = [
  "0 2px 0 rgba(0, 0, 0, 0.6)",
  "0 4px 8px rgba(0, 0, 0, 0.4)",
].join(", ");

export const KT_CORAL_GLOW = [
  "0 0 0 2px rgba(255, 111, 97, 0.5)",
  "0 8px 24px rgba(255, 111, 97, 0.18)",
].join(", ");
