import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import {
  KT_FONT,
  KT_SPRING,
  KT_TEXT_SHADOW,
  KT_WEIGHTS,
  resolveColors,
} from "../styles.js";

export const ComparisonColumns = ({
  leftIcon,
  leftTitle,
  leftPoints,
  rightIcon,
  rightTitle,
  rightPoints,
  rightHighlight = true,
  startFrame = 0,
  preset,
}) => {
  const KT_COLORS = resolveColors(preset);
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const leftIn = spring({
    frame: frame - startFrame,
    fps,
    config: KT_SPRING,
  });
  const rightIn = spring({
    frame: frame - startFrame - 10,
    fps,
    config: KT_SPRING,
  });

  const leftX = interpolate(leftIn, [0, 1], [-40, 0]);
  const rightX = interpolate(rightIn, [0, 1], [40, 0]);

  const Column = ({
    icon,
    title,
    points: rawPoints,
    highlight,
    delay,
    op,
    x,
  }) => {
    // Phase 1 safe area: 5개+ 포인트 세로 넘침 → 최대 4개로 클램프.
    const points = Array.isArray(rawPoints) ? rawPoints.slice(0, 4) : [];
    const accentColor = highlight ? KT_COLORS.coral : KT_COLORS.gray;
    return (
      <div
        style={{
          flex: 1,
          opacity: op,
          transform: `translateX(${x}px)`,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 24,
          padding: "32px 24px",
          backgroundColor: highlight
            ? "rgba(255, 111, 97, 0.08)"
            : "rgba(255, 255, 255, 0.04)",
          border: `2px solid ${highlight ? KT_COLORS.coral : "rgba(255, 255, 255, 0.15)"}`,
          borderRadius: 20,
        }}
      >
        <div
          style={{
            width: 84,
            height: 84,
            borderRadius: "50%",
            border: `2px solid ${accentColor}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 44,
          }}
        >
          {icon}
        </div>
        <div
          style={{
            fontFamily: KT_FONT,
            fontWeight: KT_WEIGHTS.extraBold,
            fontSize: 44,
            color: highlight ? KT_COLORS.white : KT_COLORS.gray,
            letterSpacing: -0.5,
            textAlign: "center",
            textShadow: KT_TEXT_SHADOW,
          }}
        >
          {title}
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 12,
            alignItems: "center",
          }}
        >
          {points.map((p, i) => {
            const pStart = delay + 10 + i * 8;
            const pOp = interpolate(
              frame,
              [pStart, pStart + 15],
              [0, 1],
              { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
            );
            const pY = interpolate(
              frame,
              [pStart, pStart + 18],
              [10, 0],
              { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
            );
            return (
              <div
                key={i}
                style={{
                  opacity: pOp,
                  transform: `translateY(${pY}px)`,
                  fontFamily: KT_FONT,
                  fontWeight: KT_WEIGHTS.medium,
                  fontSize: 34,
                  color: highlight ? KT_COLORS.white : KT_COLORS.gray,
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                }}
              >
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    backgroundColor: accentColor,
                    display: "inline-block",
                  }}
                />
                {p}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div
      style={{
        display: "flex",
        gap: 20,
        width: "100%",
        alignItems: "stretch",
      }}
    >
      <Column
        icon={leftIcon}
        title={leftTitle}
        points={leftPoints}
        highlight={false}
        delay={startFrame}
        op={leftIn}
        x={leftX}
      />
      <Column
        icon={rightIcon}
        title={rightTitle}
        points={rightPoints}
        highlight={rightHighlight}
        delay={startFrame + 10}
        op={rightIn}
        x={rightX}
      />
    </div>
  );
};
