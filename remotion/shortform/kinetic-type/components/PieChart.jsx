import { interpolate, useCurrentFrame } from "remotion";
import { resolveColors, KT_FONT, KT_WEIGHTS } from "../styles";

/**
 * Generate a palette of slice colors from the resolved accent.
 * Produces 5 shades by varying opacity on the coral accent.
 */
function sliceColors(colors) {
  return [
    colors.coralLight,
    `${colors.coral}B3`,   // ~70%
    colors.coral,
    `${colors.coral}CC`,   // ~80%
    `${colors.coral}99`,   // ~60%
  ];
}

export const PieChart = ({
  slices,
  size = 400,
  strokeWidth = 56,
  startFrame = 0,
  sliceDuration = 18,
  centerLabel,
  centerValue,
  preset,
}) => {
  const frame = useCurrentFrame();
  const colors = resolveColors(preset);
  const palette = sliceColors(colors);
  const total = slices.reduce((s, x) => s + x.value, 0);
  const r = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * r;

  let cumulative = 0;

  return (
    <div
      style={{
        position: "relative",
        width: size,
        height: size,
      }}
    >
      <svg
        width={size}
        height={size}
        style={{ transform: "rotate(-90deg)" }}
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={`${colors.coral}20`}
          strokeWidth={strokeWidth}
          opacity={0.5}
        />
        {slices.map((slice, i) => {
          const fraction = slice.value / total;
          const sliceStart = startFrame + i * sliceDuration;
          const appear = interpolate(
            frame,
            [sliceStart, sliceStart + sliceDuration],
            [0, 1],
            { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
          );
          const sliceLen = circumference * fraction * appear;
          const gap = circumference - sliceLen;
          const offset = -circumference * cumulative;
          cumulative += fraction;
          return (
            <circle
              key={i}
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke={palette[i % palette.length]}
              strokeWidth={strokeWidth}
              strokeDasharray={`${sliceLen} ${gap}`}
              strokeDashoffset={offset}
              strokeLinecap="butt"
            />
          );
        })}
      </svg>
      {(centerValue || centerLabel) && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            textAlign: "center",
          }}
        >
          {centerValue && (
            <div
              style={{
                fontFamily: KT_FONT,
                fontWeight: KT_WEIGHTS.black,
                fontSize: 72,
                color: colors.white,
                letterSpacing: -2,
                lineHeight: 1,
              }}
            >
              {centerValue}
            </div>
          )}
          {centerLabel && (
            <div
              style={{
                marginTop: 8,
                fontFamily: KT_FONT,
                fontWeight: KT_WEIGHTS.medium,
                fontSize: 22,
                color: colors.gray,
              }}
            >
              {centerLabel}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
