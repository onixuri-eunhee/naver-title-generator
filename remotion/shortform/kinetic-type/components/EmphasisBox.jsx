import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import {
  KT_FONT,
  KT_SPRING,
  KT_WEIGHTS,
  resolveColors,
} from "../styles.js";

const ICONS = {
  check: "✓",
  warning: "!",
  info: "i",
};

const VARIANT_STYLES = {
  check: (c) => ({ border: `2px solid ${c.coral}40`, bg: `${c.coral}08`, iconBg: c.coral }),
  warning: (c) => ({ border: `2px solid ${c.warning}40`, bg: `${c.warning}08`, iconBg: c.warning }),
  info: (c) => ({ border: `2px solid ${c.gray}40`, bg: `${c.gray}08`, iconBg: c.gray }),
};

export const EmphasisBox = ({ text, variant = "check", startFrame = 0, preset }) => {
  const colors = resolveColors(preset);
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const progress = spring({
    frame: frame - startFrame,
    fps,
    config: KT_SPRING,
  });
  const scale = interpolate(progress, [0, 0.6, 1], [0.9, 1.01, 1]);
  const op = progress;

  const vs = (VARIANT_STYLES[variant] || VARIANT_STYLES.check)(colors);

  return (
    <div
      style={{
        opacity: op,
        transform: `scale(${scale})`,
        display: "flex",
        alignItems: "flex-start",
        gap: 24,
        padding: "40px 48px",
        backgroundColor: vs.bg,
        border: vs.border,
        borderRadius: 20,
        maxWidth: 800,
      }}
    >
      <div
        style={{
          width: 64,
          height: 64,
          borderRadius: 18,
          backgroundColor: vs.iconBg,
          color: "#fff",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: KT_FONT,
          fontWeight: KT_WEIGHTS.black,
          fontSize: 26,
          flexShrink: 0,
        }}
      >
        {ICONS[variant]}
      </div>
      <div
        style={{
          fontFamily: KT_FONT,
          fontWeight: KT_WEIGHTS.bold,
          fontSize: 48,
          color: colors.white,
          letterSpacing: -0.5,
          lineHeight: 1.4,
          wordBreak: "keep-all",
        }}
      >
        {text}
      </div>
    </div>
  );
};
