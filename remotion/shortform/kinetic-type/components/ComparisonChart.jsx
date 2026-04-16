import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { resolveColors, KT_FONT, KT_WEIGHTS, KT_SPRING } from "../styles";

const CARD_RADIUS = 24;

const Check = ({ positive, colors }) => {
  const bg = positive ? colors.coral : colors.gray;
  return (
    <div
      style={{
        width: 32,
        height: 32,
        borderRadius: "50%",
        backgroundColor: bg,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "#ffffff",
        fontFamily: KT_FONT,
        fontWeight: KT_WEIGHTS.black,
        fontSize: 20,
        lineHeight: 1,
      }}
    >
      {positive ? "\u2713" : "\u2715"}
    </div>
  );
};

const Cell = ({ value, emphasize, colors }) => {
  if (typeof value === "boolean") {
    return (
      <div style={{ display: "flex", justifyContent: "center" }}>
        <Check positive={value} colors={colors} />
      </div>
    );
  }
  return (
    <div
      style={{
        fontFamily: KT_FONT,
        fontWeight: emphasize ? KT_WEIGHTS.extraBold : KT_WEIGHTS.medium,
        fontSize: 28,
        color: emphasize ? colors.coral : colors.gray,
        textAlign: "center",
      }}
    >
      {value}
    </div>
  );
};

export const ComparisonChart = ({
  leftLabel,
  rightLabel,
  rows,
  highlightRight = true,
  rowStagger = 8,
  startFrame = 0,
  preset,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const colors = resolveColors(preset);

  const headerIn = spring({
    frame: frame - startFrame,
    fps,
    config: KT_SPRING,
  });
  const headerY = interpolate(headerIn, [0, 1], [-20, 0]);

  /* Derived card tokens from resolved colors */
  const cardBg = "rgba(255, 255, 255, 0.7)";
  const cardBorder = `1px solid ${colors.coralLight}40`;
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
        width: "100%",
        backgroundColor: cardBg,
        border: cardBorder,
        borderRadius: CARD_RADIUS,
        boxShadow: cardShadow,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          opacity: headerIn,
          transform: `translateY(${headerY}px)`,
          display: "grid",
          gridTemplateColumns: "1.2fr 1fr 1fr",
          alignItems: "center",
          padding: "22px 28px",
          backgroundColor: `${colors.coral}10`,
          borderBottom: `1px solid ${colors.coral}20`,
        }}
      >
        <div
          style={{
            fontFamily: KT_FONT,
            fontWeight: KT_WEIGHTS.medium,
            fontSize: 22,
            color: colors.gray,
            letterSpacing: 1,
            textTransform: "uppercase",
          }}
        >
          Feature
        </div>
        <div
          style={{
            fontFamily: KT_FONT,
            fontWeight: KT_WEIGHTS.bold,
            fontSize: 26,
            color: colors.gray,
            textAlign: "center",
          }}
        >
          {leftLabel}
        </div>
        <div
          style={{
            fontFamily: KT_FONT,
            fontWeight: KT_WEIGHTS.extraBold,
            fontSize: 26,
            color: highlightRight ? colors.coral : colors.gray,
            textAlign: "center",
          }}
        >
          {rightLabel}
        </div>
      </div>

      {rows.map((row, i) => {
        const rowStart = startFrame + 6 + i * rowStagger;
        const rowIn = spring({
          frame: frame - rowStart,
          fps,
          config: KT_SPRING,
        });
        const rowX = interpolate(rowIn, [0, 1], [-16, 0]);
        return (
          <div
            key={i}
            style={{
              opacity: rowIn,
              transform: `translateX(${rowX}px)`,
              display: "grid",
              gridTemplateColumns: "1.2fr 1fr 1fr",
              alignItems: "center",
              padding: "22px 28px",
              borderBottom:
                i < rows.length - 1
                  ? `1px solid ${colors.coral}20`
                  : "none",
            }}
          >
            <div
              style={{
                fontFamily: KT_FONT,
                fontWeight: KT_WEIGHTS.bold,
                fontSize: 28,
                color: colors.white,
              }}
            >
              {row.feature}
            </div>
            <Cell value={row.left} colors={colors} />
            <Cell value={row.right} emphasize={highlightRight} colors={colors} />
          </div>
        );
      })}
    </div>
  );
};
