import { AbsoluteFill } from "remotion";
import {
  ProgressBarBlock,
  SmallLabel,
  SubtitleBar,
} from "../components/index.js";

export const Scene5Evidence = () => {
  return (
    <AbsoluteFill
      style={{
        justifyContent: "center",
        alignItems: "stretch",
        padding: 80,
        gap: 44,
      }}
    >
      <SmallLabel text="검증된 결과" startFrame={0} />
      <ProgressBarBlock
        label="콘텐츠 조회율"
        percent={95}
        startFrame={12}
        durationInFrames={60}
      />
      <ProgressBarBlock
        label="전환율"
        percent={87}
        startFrame={27}
        durationInFrames={60}
      />
      <ProgressBarBlock
        label="재구매율"
        percent={82}
        startFrame={42}
        durationInFrames={60}
      />
      <SubtitleBar text="수치가 증명합니다" startFrame={160} />
    </AbsoluteFill>
  );
};
