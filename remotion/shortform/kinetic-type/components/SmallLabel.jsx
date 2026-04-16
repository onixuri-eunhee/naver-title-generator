import { interpolate, useCurrentFrame } from "remotion";
import { KT_COLORS, KT_FONT, KT_SIZES, KT_WEIGHTS } from "../styles";

export const SmallLabel = ({ text, startFrame = 0 }) => {
  const frame = useCurrentFrame();
  const op = interpolate(
    frame,
    [startFrame, startFrame + 15],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  return (
    <div
      style={{
        opacity: op,
        fontFamily: KT_FONT,
        fontWeight: KT_WEIGHTS.medium,
        fontSize: KT_SIZES.small,
        color: KT_COLORS.gray,
        letterSpacing: 2,
        textTransform: "uppercase",
      }}
    >
      {text}
    </div>
  );
};
