import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { resolveColors, KT_FONT, KT_WEIGHTS, KT_SPRING } from "../styles.js";

const Check = ({ positive, colors }) => {
  const bg = positive ? colors.coral : `${colors.gray}60`;
  return (
    <div
      style={{
        width: 40,
        height: 40,
        borderRadius: 12,
        backgroundColor: bg,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "#fff",
        fontFamily: KT_FONT,
        fontWeight: KT_WEIGHTS.black,
        fontSize: 22,
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
        fontSize: 34,
        color: emphasize ? colors.coral : colors.gray,
        textAlign: "center",
        lineHeight: 1.3,
      }}
    >
      {value}
    </div>
  );
};

export const ComparisonChart = ({
  leftLabel,
  text,
  rightLabel,
  rows: rawRows,
  highlightRight = true,
  rowStagger = 8,
  startFrame = 0,
  preset,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const colors = resolveColors(preset);
  // Phase 1 safe area: 7행+ 세로 넘침 → 최대 6행 클램프.
  const rows = Array.isArray(rawRows) ? rawRows.slice(0, 6) : [];

  const headerIn = spring({
    frame: frame - startFrame,
    fps,
    config: KT_SPRING,
  });
  const headerY = interpolate(headerIn, [0, 1], [-16, 0]);

  return (
    <div
      style={{ width: "100%", maxWidth: 800 }}
    >
      {text && (
        <div style={{
          fontFamily: KT_FONT, fontWeight: KT_WEIGHTS.bold, fontSize: 40,
          color: colors.white, marginBottom: 24, lineHeight: 1.4,
          wordBreak: "keep-all", textAlign: "center",
        }}>{text}</div>
      )}
      <div
      style={{
        width: "100%",
        backgroundColor: `${colors.coral}06`,
        border: `2px solid ${colors.coralLight}30`,
        borderRadius: 24,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          opacity: headerIn,
          transform: `translateY(${headerY}px)`,
          display: "grid",
          gridTemplateColumns: "1.4fr 1fr 1fr",
          alignItems: "center",
          padding: "28px 32px",
          backgroundColor: `${colors.coral}10`,
          borderBottom: `2px solid ${colors.coral}15`,
        }}
      >
        <div
          style={{
            fontFamily: KT_FONT,
            fontWeight: KT_WEIGHTS.bold,
            fontSize: 28,
            color: colors.gray,
          }}
        />
        <div
          style={{
            fontFamily: KT_FONT,
            fontWeight: KT_WEIGHTS.bold,
            fontSize: 32,
            color: colors.gray,
            textAlign: "center",
          }}
        >
          {leftLabel}
        </div>
        <div
          style={{
            fontFamily: KT_FONT,
            fontWeight: KT_WEIGHTS.black,
            fontSize: 32,
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
        const rowX = interpolate(rowIn, [0, 1], [-12, 0]);
        return (
          <div
            key={i}
            style={{
              opacity: rowIn,
              transform: `translateX(${rowX}px)`,
              display: "grid",
              gridTemplateColumns: "1.4fr 1fr 1fr",
              alignItems: "center",
              padding: "24px 32px",
              borderBottom: i < rows.length - 1 ? `1px solid ${colors.coral}12` : "none",
            }}
          >
            <div
              style={{
                fontFamily: KT_FONT,
                fontWeight: KT_WEIGHTS.bold,
                fontSize: 34,
                color: colors.white,
                lineHeight: 1.3,
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
    </div>
  );
};
