import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import {
  KT_FONT,
  KT_SPRING,
  KT_WEIGHTS,
  resolveColors,
} from "../styles.js";

export const BigImpactText = ({ text, highlight, startFrame = 0, preset, designTokens }) => {
  const colors = resolveColors(preset);
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const progress = spring({
    frame: frame - startFrame,
    fps,
    config: KT_SPRING,
  });
  const scale = interpolate(progress, [0, 1], [0.85, 1]);
  const op = progress;

  // 텍스트 길이에 따라 폰트 크기 자동 조절 — designTokens.titleSize 기준 스케일
  const len = text?.length || 1;
  const baseSize = designTokens?.titleSize || 88;
  const tokenScale = baseSize / 88;
  const fontSize = Math.round((len <= 8 ? 120 : len <= 15 ? 96 : len <= 25 ? 80 : 64) * tokenScale);

  const renderText = () => {
    if (!highlight) {
      return <span style={{ color: colors.white }}>{text}</span>;
    }
    const idx = text.indexOf(highlight);
    if (idx === -1) return <span style={{ color: colors.white }}>{text}</span>;
    const before = text.slice(0, idx);
    const after = text.slice(idx + highlight.length);
    return (
      <>
        {before && <span style={{ color: colors.white }}>{before}</span>}
        <span style={{ color: colors.coral }}>{highlight}</span>
        {after && <span style={{ color: colors.white }}>{after}</span>}
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
        fontSize,
        letterSpacing: -2,
        lineHeight: 1.25,
        textAlign: "center",
        maxWidth: 900,
        wordBreak: "keep-all",
      }}
    >
      {renderText()}
    </div>
  );
};
