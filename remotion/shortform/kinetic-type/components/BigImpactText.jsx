import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import {
  KT_COLORS,
  KT_FONT,
  KT_SIZES,
  KT_SPRING,
  KT_TEXT_SHADOW,
  KT_WEIGHTS,
} from "../styles";

export const BigImpactText = ({ text, highlight, startFrame = 0 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const progress = spring({
    frame: frame - startFrame,
    fps,
    config: KT_SPRING,
  });
  const scale = interpolate(progress, [0, 1], [0.82, 1]);
  const op = progress;

  const renderText = () => {
    if (!highlight) {
      return <span style={{ color: KT_COLORS.coral }}>{text}</span>;
    }
    const idx = text.indexOf(highlight);
    if (idx === -1) return <span>{text}</span>;
    const before = text.slice(0, idx);
    const after = text.slice(idx + highlight.length);
    return (
      <>
        {before && <span style={{ color: KT_COLORS.white }}>{before}</span>}
        <span style={{ color: KT_COLORS.coral }}>{highlight}</span>
        {after && <span style={{ color: KT_COLORS.white }}>{after}</span>}
      </>
    );
  };

  return (
    <div
      style={{
        opacity: op,
        transform: `scale(${scale})`,
        fontFamily: KT_FONT,
        fontWeight: KT_WEIGHTS.black,
        fontSize: KT_SIZES.impact,
        letterSpacing: -4,
        lineHeight: 1.05,
        textAlign: "center",
        textShadow: KT_TEXT_SHADOW,
      }}
    >
      {renderText()}
    </div>
  );
};
