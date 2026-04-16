import { AbsoluteFill } from "remotion";
import {
  BigImpactText,
  EmphasisBox,
  SmallLabel,
  SubtitleBar,
} from "../components";

export const Scene4CoreMessage = () => {
  return (
    <AbsoluteFill
      style={{
        justifyContent: "center",
        alignItems: "center",
        padding: 80,
        gap: 56,
      }}
    >
      <SmallLabel text="그 비밀은" startFrame={0} />
      <BigImpactText text="0원 마케팅 시스템" startFrame={10} />
      <EmphasisBox
        text="Instagram → 블로그 → 상담"
        variant="check"
        startFrame={50}
      />
      <SubtitleBar text="구조를 바꿨을 뿐" startFrame={110} />
    </AbsoluteFill>
  );
};
