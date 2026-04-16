import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import {
  KT_COLORS,
  KT_CORAL_GLOW,
  KT_FONT,
  KT_SPRING,
  KT_TEXT_SHADOW,
  KT_WEIGHTS,
} from "../styles";

const ICONS = {
  check: "✓",
  warning: "!",
  info: "i",
};

export const EmphasisBox = ({ text, variant = "check", startFrame = 0 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const progress = spring({
    frame: frame - startFrame,
    fps,
    config: KT_SPRING,
  });
  const scale = interpolate(
    progress,
    [0, 0.6, 1],
    [0.8, 1.02, 1],
  );
  const op = progress;

  return (
    <div
      style={{
        opacity: op,
        transform: `scale(${scale})`,
        display: "inline-flex",
        alignItems: "center",
        gap: 20,
        padding: "22px 36px",
        backgroundColor: "rgba(255, 111, 97, 0.08)",
        border: `2px solid ${KT_COLORS.coral}`,
        borderRadius: 16,
        boxShadow: KT_CORAL_GLOW,
      }}
    >
      <div
        style={{
          width: 48,
          height: 48,
          borderRadius: "50%",
          backgroundColor: KT_COLORS.coral,
          color: KT_COLORS.white,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: KT_FONT,
          fontWeight: KT_WEIGHTS.black,
          fontSize: 28,
          flexShrink: 0,
        }}
      >
        {ICONS[variant]}
      </div>
      <div
        style={{
          fontFamily: KT_FONT,
          fontWeight: KT_WEIGHTS.extraBold,
          fontSize: 44,
          color: KT_COLORS.white,
          letterSpacing: -0.5,
          textShadow: KT_TEXT_SHADOW,
        }}
      >
        {text}
      </div>
    </div>
  );
};
