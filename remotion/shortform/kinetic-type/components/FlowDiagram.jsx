import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { resolveColors, KT_FONT, KT_WEIGHTS, KT_SPRING } from "../styles";

const CARD_RADIUS = 24;

export const FlowDiagram = ({
  steps,
  direction = "vertical",
  startFrame = 0,
  stepStagger = 12,
  activeIndex,
  preset,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const colors = resolveColors(preset);

  const isH = direction === "horizontal";

  /* Derived card styles from resolved colors */
  const cardShadow = [
    `0 1px 1px ${colors.coral}0D`,
    `0 4px 8px ${colors.coral}0F`,
    `0 12px 24px ${colors.coral}12`,
    `0 24px 48px ${colors.coral}0D`,
    "inset 0 1px 0 rgba(255, 255, 255, 0.7)",
  ].join(", ");

  return (
    <div
      style={{
        display: "flex",
        flexDirection: isH ? "row" : "column",
        alignItems: isH ? "center" : "stretch",
        gap: 18,
        width: "100%",
      }}
    >
      {steps.map((step, i) => {
        const stepStart = startFrame + i * stepStagger;
        const stepIn = spring({
          frame: frame - stepStart,
          fps,
          config: KT_SPRING,
        });
        const stepShift = interpolate(stepIn, [0, 1], [20, 0]);
        const arrowStart = stepStart + 6;
        const arrowIn = spring({
          frame: frame - arrowStart,
          fps,
          config: KT_SPRING,
        });
        const isActive = activeIndex === i;
        const borderColor = isActive ? colors.coral : colors.coralLight;

        return (
          <div
            key={i}
            style={{
              display: "flex",
              flexDirection: isH ? "row" : "column",
              alignItems: "center",
              flex: isH ? 1 : undefined,
            }}
          >
            <div
              style={{
                opacity: stepIn,
                transform: isH
                  ? `translateY(${stepShift}px)`
                  : `translateX(${stepShift}px)`,
                backgroundColor: `${colors.coral}08`,
                border: `1.5px solid ${borderColor}`,
                borderRadius: CARD_RADIUS,
                padding: "22px 28px",
                display: "flex",
                alignItems: "center",
                gap: 18,
                width: "100%",
                boxShadow: isActive ? cardShadow : "none",
              }}
            >
              <div
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: "50%",
                  backgroundColor: `${colors.coral}10`,
                  border: `1.5px solid ${colors.coralLight}`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontFamily: KT_FONT,
                  fontWeight: KT_WEIGHTS.extraBold,
                  fontSize: 20,
                  color: colors.coral,
                  flexShrink: 0,
                }}
              >
                {step.label}
              </div>
              <div
                style={{
                  fontFamily: KT_FONT,
                  fontWeight: KT_WEIGHTS.bold,
                  fontSize: 28,
                  color: colors.white,
                }}
              >
                {step.title}
              </div>
            </div>
            {i < steps.length - 1 ? (
              <div
                style={{
                  display: "flex",
                  justifyContent: "center",
                  alignItems: "center",
                  padding: isH ? "0 8px" : "8px 0",
                  opacity: arrowIn,
                  color: colors.coralLight,
                  fontFamily: KT_FONT,
                  fontSize: 32,
                  fontWeight: KT_WEIGHTS.bold,
                  transform: isH ? "none" : "rotate(90deg)",
                }}
              >
                →
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
};
