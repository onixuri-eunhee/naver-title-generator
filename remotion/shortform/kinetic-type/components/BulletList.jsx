import { interpolate, useCurrentFrame } from "remotion";
import { KT_FONT, KT_WEIGHTS, resolveColors } from "../styles.js";

export const BulletList = ({ items, highlight = true, startFrame = 0, stagger = 10, preset }) => {
  const KT_COLORS = resolveColors(preset);
  const frame = useCurrentFrame();
  const accent = highlight ? KT_COLORS.coral : KT_COLORS.white;

  // Phase 1 safe area: 6개+ 세로 넘침 → 최대 5개로 클램프.
  const safeItems = Array.isArray(items) ? items.slice(0, 5) : [];

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 18,
        alignItems: "flex-start",
        maxWidth: 920,
      }}
    >
      {safeItems.map((item, i) => {
        const start = startFrame + i * stagger;
        const op = interpolate(
          frame,
          [start, start + 15],
          [0, 1],
          { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
        );
        const x = interpolate(
          frame,
          [start, start + 18],
          [-20, 0],
          { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
        );
        return (
          <div
            key={i}
            style={{
              opacity: op,
              transform: `translateX(${x}px)`,
              display: "flex",
              alignItems: "center",
              gap: 18,
              fontFamily: KT_FONT,
              fontWeight: KT_WEIGHTS.extraBold,
              fontSize: 56,
              color: KT_COLORS.white,
              letterSpacing: -0.5,
              wordBreak: "keep-all",
            }}
          >
            <span
              style={{
                width: 18,
                height: 18,
                borderRadius: "50%",
                backgroundColor: accent,
                display: "inline-block",
                flexShrink: 0,
              }}
            />
            <span>{item}</span>
          </div>
        );
      })}
    </div>
  );
};
