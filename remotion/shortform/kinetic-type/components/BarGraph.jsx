import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { resolveColors, KT_FONT, KT_WEIGHTS, KT_SPRING } from "../styles";

export const BarGraph = ({
  bars,
  text,
  height = 520,
  startFrame = 0,
  barStagger = 8,
  maxValue,
  preset,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const colors = resolveColors(preset);
  const max = maxValue ?? Math.max(...bars.map((b) => Number(b.value) || 0));

  const chartHeight = height - 100;

  return (
    <div style={{ width: "100%", maxWidth: 800 }}>
      {text && (
        <div
          style={{
            fontFamily: KT_FONT,
            fontWeight: KT_WEIGHTS.bold,
            fontSize: 40,
            color: colors.white,
            marginBottom: 28,
            lineHeight: 1.4,
            wordBreak: "keep-all",
            textAlign: "center",
          }}
        >
          {text}
        </div>
      )}
      <div
        style={{
          position: "relative",
          height: chartHeight,
          borderBottom: `2px solid ${colors.gray}30`,
          borderLeft: `2px solid ${colors.gray}30`,
          paddingLeft: 12,
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "space-evenly",
            paddingBottom: 4,
            paddingLeft: 12,
            paddingRight: 12,
          }}
        >
          {bars.map((bar, i) => {
            const barStart = startFrame + i * barStagger;
            const growIn = spring({
              frame: frame - barStart,
              fps,
              config: KT_SPRING,
            });
            const h = Math.max((bar.value / max) * chartHeight * growIn, 2);
            const isHighlight = bar.highlight !== false;

            const valueOp = interpolate(
              frame,
              [barStart + 10, barStart + 22],
              [0, 1],
              { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
            );
            const valueY = interpolate(
              frame,
              [barStart + 10, barStart + 22],
              [8, 0],
              { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
            );

            return (
              <div
                key={i}
                style={{
                  flex: 1,
                  maxWidth: 120,
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
                    transform: `translateY(${valueY}px)`,
                    fontFamily: KT_FONT,
                    fontWeight: KT_WEIGHTS.black,
                    fontSize: 28,
                    color: colors.white,
                    marginBottom: 10,
                  }}
                >
                  {bar.displayValue ?? bar.value}
                </div>
                <div
                  style={{
                    width: "65%",
                    height: h,
                    background: isHighlight
                      ? `linear-gradient(180deg, ${colors.coral} 0%, ${colors.coral}CC 100%)`
                      : `linear-gradient(180deg, ${colors.coralLight} 0%, ${colors.coralLight}99 100%)`,
                    borderRadius: "10px 10px 0 0",
                    boxShadow: isHighlight
                      ? `0 -4px 20px ${colors.coral}30, inset 0 1px 0 rgba(255,255,255,0.2)`
                      : `inset 0 1px 0 rgba(255,255,255,0.15)`,
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
          justifyContent: "space-evenly",
          marginTop: 20,
          paddingLeft: 12,
          paddingRight: 12,
        }}
      >
        {bars.map((bar, i) => {
          const labelOp = interpolate(
            frame,
            [startFrame + i * barStagger + 5, startFrame + i * barStagger + 18],
            [0, 1],
            { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
          );
          return (
            <div
              key={i}
              style={{
                flex: 1,
                maxWidth: 120,
                textAlign: "center",
                fontFamily: KT_FONT,
                fontWeight: KT_WEIGHTS.bold,
                fontSize: 24,
                color: colors.gray,
                opacity: labelOp,
                lineHeight: 1.3,
              }}
            >
              {bar.label}
            </div>
          );
        })}
      </div>
    </div>
  );
};
