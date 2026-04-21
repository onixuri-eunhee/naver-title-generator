import { interpolate, useCurrentFrame } from "remotion";
import {
  KT_FONT,
  KT_WEIGHTS,
  resolveColors,
} from "../styles.js";

export const ProgressBarBlock = ({ label, percent, startFrame = 0, durationInFrames = 60, preset }) => {
  const KT_COLORS = resolveColors(preset);
  const frame = useCurrentFrame();
  const progress = interpolate(
    frame,
    [startFrame, startFrame + durationInFrames],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  const filled = progress * (Number(percent) || 0);
  const countDisplay = Math.round(filled);

  const labelOp = interpolate(
    frame,
    [startFrame - 6, startFrame + 10],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 18,
        width: "100%",
        maxWidth: 940,
        opacity: labelOp,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
        }}
      >
        <div
          style={{
            fontFamily: KT_FONT,
            fontWeight: KT_WEIGHTS.bold,
            fontSize: 60,
            color: KT_COLORS.white,
            letterSpacing: -0.5,
            wordBreak: "keep-all",
          }}
        >
          {label}
        </div>
        <div
          style={{
            fontFamily: KT_FONT,
            fontWeight: KT_WEIGHTS.black,
            fontSize: 88,
            color: KT_COLORS.coral,
            letterSpacing: -1,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {countDisplay}%
        </div>
      </div>
      <div
        style={{
          width: "100%",
          height: 30,
          backgroundColor: "rgba(255, 255, 255, 0.1)",
          borderRadius: 12,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${filled}%`,
            height: "100%",
            backgroundColor: KT_COLORS.coral,
            borderRadius: 8,
            boxShadow: "0 0 20px rgba(255, 111, 97, 0.4)",
          }}
        />
      </div>
    </div>
  );
};
