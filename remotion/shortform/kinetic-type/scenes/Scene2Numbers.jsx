import { AbsoluteFill } from "remotion";
import {
  GiantNumberCounter,
  SubtitleBar,
  VerticalBarText,
} from "../components/index.js";

export const Scene2Numbers = () => {
  return (
    <AbsoluteFill
      style={{
        justifyContent: "center",
        alignItems: "center",
        padding: 80,
        gap: 60,
      }}
    >
      <VerticalBarText text="그런데 어느 날" startFrame={0} />
      <GiantNumberCounter
        from={0}
        to={1.3}
        decimals={1}
        suffix="억원"
        label="연매출"
        startFrame={20}
        durationInFrames={30}
      />
      <SubtitleBar text="광고비 0원으로" startFrame={70} />
    </AbsoluteFill>
  );
};
