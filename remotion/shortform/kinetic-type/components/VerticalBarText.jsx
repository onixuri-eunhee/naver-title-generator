import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import {
  KT_FONT,
  KT_SPRING,
  KT_WEIGHTS,
  resolveColors,
} from "../styles.js";

export const VerticalBarText = ({ text, startFrame = 0, preset }) => {
  const KT_COLORS = resolveColors(preset);
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const progress = spring({
    frame: frame - startFrame,
    fps,
    config: KT_SPRING,
  });
  const barHeight = interpolate(progress, [0, 1], [0, 80]);
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
        maxWidth: 800,
      }}
    >
      <div
        style={{
          width: 8,
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
          // Phase 1 방어: 10자+면 56, 14자+면 44로 축소 (safe area 초과 방지).
          fontSize:
            (text || "").length <= 10
              ? 80
              : (text || "").length <= 14
                ? 56
                : 44,
          color: KT_COLORS.white,
          letterSpacing: -1,
          lineHeight: 1.1,
          wordBreak: "keep-all",
        }}
      >
        {text}
      </div>
    </div>
  );
};
