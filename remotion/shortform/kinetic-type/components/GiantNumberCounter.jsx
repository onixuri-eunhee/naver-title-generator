import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import {
  KT_FONT,
  KT_SIZES,
  KT_SPRING,
  KT_WEIGHTS,
  resolveColors,
} from "../styles.js";

export const GiantNumberCounter = ({
  from = 0,
  to,
  value,
  suffix = "",
  label,
  decimals = 0,
  startFrame = 0,
  durationInFrames = 30,
  preset,
}) => {
  const KT_COLORS = resolveColors(preset);
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Claude가 value 또는 to로 보낼 수 있음 + 문자열 방어
  const numFrom = Number(from) || 0;
  const numTo = Number(to ?? value) || 0;

  const raw = interpolate(
    frame,
    [startFrame, startFrame + durationInFrames],
    [numFrom, numTo],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  const factor = Math.pow(10, decimals);
  const rounded = Math.round(raw * factor) / factor;
  const display = rounded.toFixed(decimals);

  const containerIn = spring({
    frame: frame - startFrame,
    fps,
    config: KT_SPRING,
  });
  const scale = interpolate(containerIn, [0, 1], [0.85, 1]);
  const op = containerIn;

  const labelOp = interpolate(
    frame,
    [startFrame, startFrame + 15],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );

  return (
    <div
      style={{
        opacity: op,
        transform: `scale(${scale})`,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        maxWidth: 920,
      }}
    >
      {label && (
        <div
          style={{
            opacity: labelOp,
            fontFamily: KT_FONT,
            fontWeight: KT_WEIGHTS.medium,
            fontSize: KT_SIZES.small,
            color: KT_COLORS.gray,
            letterSpacing: 2,
            textTransform: "uppercase",
            marginBottom: 16,
          }}
        >
          {label}
        </div>
      )}
      <div
        style={{
          fontFamily: KT_FONT,
          fontWeight: KT_WEIGHTS.black,
          fontSize: KT_SIZES.giant,
          color: KT_COLORS.coral,
          letterSpacing: -6,
          lineHeight: 0.9,
          fontVariantNumeric: "tabular-nums",
          wordBreak: "keep-all",
        }}
      >
        {display}
        {suffix && (
          <span
            style={{
              fontSize: KT_SIZES.giant * 0.45,
              marginLeft: 16,
              letterSpacing: -2,
            }}
          >
            {suffix}
          </span>
        )}
      </div>
    </div>
  );
};
