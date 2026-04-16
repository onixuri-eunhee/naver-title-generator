import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { resolveColors, KT_FONT, KT_WEIGHTS, KT_SPRING } from "../styles";

export const BarGraph = ({
  bars,
  height = 420,
  startFrame = 0,
  barStagger = 8,
  maxValue,
  preset,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const colors = resolveColors(preset);
  const max = maxValue ?? Math.max(...bars.map((b) => b.value));

  const chartHeight = height - 80;
  const gridLines = 4;

  return (
    <div style={{ width: "100%" }}>
      <div
        style={{
          position: "relative",
          height: chartHeight,
          borderBottom: `1.5px solid ${colors.coral}20`,
        }}
      >
        {Array.from({ length: gridLines }, (_, i) => (
          <div
            key={`grid-${i}`}
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top: ((i + 1) / (gridLines + 1)) * chartHeight,
              height: 1,
              backgroundColor: `${colors.coral}20`,
              opacity: 0.6,
            }}
          />
        ))}

        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "space-around",
            gap: 16,
          }}
        >
          {bars.map((bar, i) => {
            const barStart = startFrame + i * barStagger;
            const growIn = spring({
              frame: frame - barStart,
              fps,
              config: KT_SPRING,
            });
            const h = (bar.value / max) * chartHeight * growIn;
            const color = bar.highlight ? colors.coral : colors.coralLight;
            const valueOp = interpolate(
              frame,
              [barStart + 8, barStart + 20],
              [0, 1],
              { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
            );
            return (
              <div
                key={i}
                style={{
                  flex: 1,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "flex-end",
                  height: "100%",
                }}
              >
                <div
                  style={{
                    opacity: valueOp,
                    fontFamily: KT_FONT,
                    fontWeight: KT_WEIGHTS.extraBold,
                    fontSize: 24,
                    color: bar.highlight ? colors.coral : colors.gray,
                    marginBottom: 8,
                  }}
                >
                  {bar.displayValue ?? bar.value}
                </div>
                <div
                  style={{
                    width: "70%",
                    height: h,
                    backgroundColor: color,
                    borderRadius: "8px 8px 0 0",
                    boxShadow: bar.highlight
                      ? `0 12px 24px ${colors.coral}26`
                      : "none",
                  }}
                />
              </div>
            );
          })}
        </div>
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-around",
          gap: 16,
          marginTop: 16,
        }}
      >
        {bars.map((bar, i) => (
          <div
            key={i}
            style={{
              flex: 1,
              textAlign: "center",
              fontFamily: KT_FONT,
              fontWeight: KT_WEIGHTS.medium,
              fontSize: 22,
              color: colors.gray,
            }}
          >
            {bar.label}
          </div>
        ))}
      </div>
    </div>
  );
};
