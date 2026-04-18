import { interpolate, useCurrentFrame } from "remotion";
import { resolveColors, KT_FONT, KT_WEIGHTS } from "../styles.js";



export const VennDiagram = ({
  circles: rawCircles,
  intersectionLabel,
  size = 500,
  startFrame = 0,
  circleDuration = 20,
  preset,
}) => {
  const frame = useCurrentFrame();
  const colors = resolveColors(preset);
  const r = size * 0.3;
  const cx = size / 2;
  const cy = size / 2;
  // Phase 1 safe area: 2 또는 3만 허용. 4+ 시 첫 3개만. 1 이하는 렌더 스킵.
  const circles = Array.isArray(rawCircles) ? rawCircles.slice(0, 3) : [];
  if (circles.length < 2) return null;

  const CIRCLE_COLORS = [colors.coralLight, colors.coral, colors.coral];

  const positions =
    circles.length === 2
      ? [
          { x: cx - r * 0.6, y: cy },
          { x: cx + r * 0.6, y: cy },
        ]
      : [
          { x: cx, y: cy - r * 0.55 },
          { x: cx - r * 0.55, y: cy + r * 0.35 },
          { x: cx + r * 0.55, y: cy + r * 0.35 },
        ];

  return (
    <div
      style={{
        position: "relative",
        width: size,
        height: size,
      }}
    >
      <svg width={size} height={size}>
        {circles.map((_c, i) => {
          const start = startFrame + i * circleDuration;
          const op = interpolate(
            frame,
            [start, start + circleDuration],
            [0, 0.35],
            { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
          );
          const strokeOp = interpolate(
            frame,
            [start, start + circleDuration],
            [0, 1],
            { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
          );
          const color = CIRCLE_COLORS[i % CIRCLE_COLORS.length];
          return (
            <g key={i}>
              <circle
                cx={positions[i].x}
                cy={positions[i].y}
                r={r}
                fill={color}
                opacity={op}
              />
              <circle
                cx={positions[i].x}
                cy={positions[i].y}
                r={r}
                fill="none"
                stroke={color}
                strokeWidth={2}
                opacity={strokeOp}
              />
            </g>
          );
        })}
      </svg>
      {circles.map((c, i) => {
        const start = startFrame + i * circleDuration + 4;
        const labelOp = interpolate(
          frame,
          [start, start + 15],
          [0, 1],
          { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
        );
        const labelY =
          circles.length === 2
            ? positions[i].y - r - 12
            : i === 0
              ? positions[i].y - r - 12
              : positions[i].y + r + 12;
        return (
          <div
            key={`label-${i}`}
            style={{
              position: "absolute",
              left: 0,
              top: labelY,
              width: "100%",
              textAlign: i === 1 && circles.length === 3 ? "left" : i === 2 ? "right" : "center",
              paddingLeft: i === 1 && circles.length === 3 ? 40 : 0,
              paddingRight: i === 2 ? 40 : 0,
              opacity: labelOp,
              fontFamily: KT_FONT,
              fontWeight: KT_WEIGHTS.bold,
              fontSize: 26,
              color: colors.white,
            }}
          >
            {c.label}
          </div>
        );
      })}
      {intersectionLabel && (
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: cy,
            transform: "translateY(-50%)",
            textAlign: "center",
            opacity: interpolate(
              frame,
              [
                startFrame + circles.length * circleDuration,
                startFrame + circles.length * circleDuration + 20,
              ],
              [0, 1],
              { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
            ),
          }}
        >
          <div
            style={{
              display: "inline-block",
              backgroundColor: "rgba(255, 255, 255, 0.7)",
              padding: "10px 20px",
              borderRadius: 16,
              border: `1.5px solid ${colors.coralLight}`,
              fontFamily: KT_FONT,
              fontWeight: KT_WEIGHTS.extraBold,
              fontSize: 26,
              color: colors.white,
              boxShadow: `0 8px 20px ${colors.coral}20`,
            }}
          >
            {intersectionLabel}
          </div>
        </div>
      )}
    </div>
  );
};
