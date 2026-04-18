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

export const StrikethroughText = ({
  text,
  strikeWord,
  preset,
  startFrame = 0,
}) => {
  const colors = resolveColors(preset);
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const relFrame = frame - startFrame;

  // Text entrance via spring
  const inProg = spring({
    frame: Math.max(0, relFrame),
    fps,
    config: { damping: 18, stiffness: 140 },
  });
  const opMain = interpolate(inProg, [0, 1], [0, 1]);
  const dyMain = interpolate(inProg, [0, 1], [16, 0]);

  // Strikethrough draws left-to-right after text settles
  const strikeProgress = interpolate(relFrame, [25, 55], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Split text around the strikeWord
  const idx = text.indexOf(strikeWord);
  if (idx === -1) {
    // No match — render plain text
    return (
      <AbsoluteFill
        style={{ justifyContent: "center", alignItems: "center" }}
      >
        <div
          style={{
            opacity: opMain,
            transform: `translateY(${dyMain}px)`,
            fontFamily: KT_FONT,
            fontWeight: KT_WEIGHTS.black,
            // Phase 1 방어: title=110은 ~14자 기준. 20자+면 축소.
            fontSize:
              (text || "").length <= 14
                ? KT_SIZES.title
                : (text || "").length <= 20
                  ? 80
                  : 60,
            color: colors.white,
            letterSpacing: -3,
            textAlign: "center",
            lineHeight: 1.1,
            wordBreak: "keep-all",
          }}
        >
          {text}
        </div>
      </AbsoluteFill>
    );
  }

  const before = text.slice(0, idx);
  const after = text.slice(idx + strikeWord.length);

  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
      <div
        style={{
          opacity: opMain,
          transform: `translateY(${dyMain}px)`,
          fontFamily: KT_FONT,
          fontWeight: KT_WEIGHTS.black,
          fontSize: KT_SIZES.title,
          color: colors.white,
          letterSpacing: -3,
          textAlign: "center",
          lineHeight: 1.1,
          position: "relative",
          display: "inline-block",
          wordBreak: "keep-all",
        }}
      >
        {before && <span>{before}</span>}
        <span
          style={{
            position: "relative",
            display: "inline-block",
            color: colors.gray,
          }}
        >
          {strikeWord}
          <div
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top: "55%",
              height: 10,
              backgroundColor: colors.coral,
              transformOrigin: "left center",
              transform: `scaleX(${strikeProgress})`,
              borderRadius: 4,
              boxShadow: "0 2px 6px rgba(255, 111, 97, 0.35)",
            }}
          />
        </span>
        {after && <span>{after}</span>}
      </div>
    </AbsoluteFill>
  );
};
