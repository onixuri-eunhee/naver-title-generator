import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import {
  KT_COLORS,
  KT_FONT,
  KT_SPRING,
  KT_TEXT_SHADOW,
  KT_WEIGHTS,
} from "../styles";

export const VerticalBarText = ({ text, startFrame = 0 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const progress = spring({
    frame: frame - startFrame,
    fps,
    config: KT_SPRING,
  });
  const barHeight = interpolate(progress, [0, 1], [0, 72]);
  const textOp = interpolate(
    frame,
    [startFrame + 6, startFrame + 20],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  const textX = interpolate(
    frame,
    [startFrame + 6, startFrame + 22],
    [-20, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 24,
      }}
    >
      <div
        style={{
          width: 6,
          height: barHeight,
          backgroundColor: KT_COLORS.coral,
          borderRadius: 3,
        }}
      />
      <div
        style={{
          opacity: textOp,
          transform: `translateX(${textX}px)`,
          fontFamily: KT_FONT,
          fontWeight: KT_WEIGHTS.extraBold,
          fontSize: 72,
          color: KT_COLORS.white,
          letterSpacing: -1,
          lineHeight: 1.1,
          textShadow: KT_TEXT_SHADOW,
        }}
      >
        {text}
      </div>
    </div>
  );
};
