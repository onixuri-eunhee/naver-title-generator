import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import {
  KT_FONT,
  KT_SPRING,
  KT_TEXT_SHADOW,
  KT_WEIGHTS,
  resolveColors,
} from "../styles.js";

export const IconWithLabel = ({ icon, label, sublabel, startFrame = 0, preset }) => {
  const KT_COLORS = resolveColors(preset);
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const progress = spring({
    frame: frame - startFrame,
    fps,
    config: KT_SPRING,
  });
  const scale = interpolate(progress, [0, 1], [0.85, 1]);
  const op = progress;

  return (
    <div
      style={{
        opacity: op,
        transform: `scale(${scale})`,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 20,
      }}
    >
      <div
        style={{
          width: 120,
          height: 120,
          borderRadius: "50%",
          border: `2px solid ${KT_COLORS.coral}`,
          backgroundColor: "rgba(255, 111, 97, 0.08)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 60,
          color: KT_COLORS.coral,
        }}
      >
        {icon}
      </div>
      <div
        style={{
          fontFamily: KT_FONT,
          fontWeight: KT_WEIGHTS.extraBold,
          fontSize: 52,
          color: KT_COLORS.white,
          letterSpacing: -0.5,
          textAlign: "center",
          textShadow: KT_TEXT_SHADOW,
        }}
      >
        {label}
      </div>
      {sublabel && (
        <div
          style={{
            fontFamily: KT_FONT,
            fontWeight: KT_WEIGHTS.medium,
            fontSize: 32,
            color: KT_COLORS.gray,
          }}
        >
          {sublabel}
        </div>
      )}
    </div>
  );
};
