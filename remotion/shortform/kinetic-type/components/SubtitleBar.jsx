import { interpolate, useCurrentFrame } from "remotion";
import { KT_FONT, KT_SIZES, KT_TEXT_SHADOW, KT_WEIGHTS, resolveColors } from "../styles";

export const SubtitleBar = ({ text, startFrame = 0, preset }) => {
  const KT_COLORS = resolveColors(preset);
  const frame = useCurrentFrame();
  const op = interpolate(
    frame,
    [startFrame, startFrame + 15],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  const y = interpolate(
    frame,
    [startFrame, startFrame + 18],
    [20, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  return (
    <div
      style={{
        position: "absolute",
        bottom: "15%",
        left: 0,
        right: 0,
        textAlign: "center",
        padding: "0 60px",
        opacity: op,
        transform: `translateY(${y}px)`,
        fontFamily: KT_FONT,
        fontWeight: KT_WEIGHTS.bold,
        fontSize: KT_SIZES.subtitle,
        color: KT_COLORS.white,
        letterSpacing: -0.5,
        lineHeight: 1.3,
        textShadow: KT_TEXT_SHADOW,
      }}
    >
      {text}
    </div>
  );
};
