import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import {
  KT_FONT,
  KT_SIZES,
  KT_WEIGHTS,
  resolveColors,
} from "../styles.js";

const SLAM_SPRING = { damping: 12, stiffness: 180, mass: 1 };

export const NumberSlam = ({ text, subtitle, preset, startFrame = 0 }) => {
  const colors = resolveColors(preset);
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const relFrame = frame - startFrame;

  // Bouncy slam: scale overshoots then settles (low damping)
  const slam = spring({
    frame: Math.max(0, relFrame),
    fps,
    config: SLAM_SPRING,
  });
  const scale = interpolate(slam, [0, 1], [0.3, 1]);
  const op = interpolate(slam, [0, 1], [0, 1]);

  // Subtitle fades in after the slam settles
  const subOp = subtitle
    ? interpolate(relFrame, [20, 40], [0, 1], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      })
    : 0;

  return (
    <AbsoluteFill
      style={{
        justifyContent: "center",
        alignItems: "center",
        gap: 24,
        maxWidth: 900,
      }}
    >
      <div
        style={{
          opacity: op,
          transform: `scale(${scale})`,
          fontFamily: KT_FONT,
          fontWeight: KT_WEIGHTS.black,
          // Phase 1 방어: text가 4자 초과면 축소 (giant=220은 1~4자 기준 임팩트).
          fontSize:
            (text || "").length <= 4
              ? KT_SIZES.giant
              : (text || "").length <= 7
                ? KT_SIZES.giant * 0.7
                : KT_SIZES.giant * 0.55,
          color: colors.coral,
          letterSpacing: -10,
          lineHeight: 0.9,
          wordBreak: "keep-all",
        }}
      >
        {text}
      </div>
      {subtitle && (
        <div
          style={{
            opacity: subOp,
            fontFamily: KT_FONT,
            fontWeight: KT_WEIGHTS.medium,
            fontSize: KT_SIZES.small,
            color: colors.gray,
            letterSpacing: 2,
            textTransform: "uppercase",
          }}
        >
          {subtitle}
        </div>
      )}
    </AbsoluteFill>
  );
};
