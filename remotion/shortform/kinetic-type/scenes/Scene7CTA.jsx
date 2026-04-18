import { AbsoluteFill } from "remotion";
import {
  EmphasisBox,
  SubtitleBar,
  VerticalBarText,
} from "../components/index.js";

export const Scene7CTA = () => {
  return (
    <AbsoluteFill
      style={{
        justifyContent: "center",
        alignItems: "center",
        padding: 80,
        gap: 56,
      }}
    >
      <VerticalBarText text="지금 시작" startFrame={0} />
      <EmphasisBox text="무료 강의 신청" variant="info" startFrame={20} />
      <SubtitleBar text="선착순 마감" startFrame={60} />
    </AbsoluteFill>
  );
};
