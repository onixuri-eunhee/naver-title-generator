import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { resolveColors, KT_FONT, KT_WEIGHTS, KT_SPRING } from "../styles";

export const FlowDiagram = ({
  steps,
  startFrame = 0,
  stepStagger = 12,
  activeIndex,
  preset,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const colors = resolveColors(preset);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "stretch",
        gap: 0,
        width: "100%",
        maxWidth: 700,
      }}
    >
      {steps.map((step, i) => {
        const stepStart = startFrame + i * stepStagger;
        const stepIn = spring({
          frame: frame - stepStart,
          fps,
          config: KT_SPRING,
        });
        const stepY = interpolate(stepIn, [0, 1], [24, 0]);
        const isActive = activeIndex === i;

        return (
          <div
            key={i}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
            }}
          >
            <div
              style={{
                opacity: stepIn,
                transform: `translateY(${stepY}px)`,
                backgroundColor: isActive ? `${colors.coral}15` : `${colors.coral}08`,
                border: `2px solid ${isActive ? colors.coral : `${colors.coralLight}60`}`,
                borderRadius: 20,
                padding: "36px 44px",
                display: "flex",
                alignItems: "center",
                gap: 24,
                width: "100%",
              }}
            >
              <div
                style={{
                  width: 72,
                  height: 72,
                  borderRadius: 20,
                  backgroundColor: isActive ? colors.coral : `${colors.coral}20`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontFamily: KT_FONT,
                  fontWeight: KT_WEIGHTS.black,
                  fontSize: 32,
                  color: isActive ? "#fff" : colors.coral,
                  flexShrink: 0,
                }}
              >
                {step.label}
              </div>
              <div
                style={{
                  fontFamily: KT_FONT,
                  fontWeight: KT_WEIGHTS.bold,
                  fontSize: 48,
                  color: colors.white,
                  lineHeight: 1.3,
                }}
              >
                {step.title}
              </div>
            </div>
            {i < steps.length - 1 && (
              <div
                style={{
                  width: 3,
                  height: 32,
                  backgroundColor: `${colors.coralLight}50`,
                  opacity: stepIn,
                }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
};
