import { AbsoluteFill } from "remotion";
import {
  BigImpactText,
  BulletList,
  SubtitleBar,
} from "../components";

export const Scene6Promise = () => {
  return (
    <AbsoluteFill
      style={{
        justifyContent: "center",
        alignItems: "center",
        padding: 80,
        gap: 56,
      }}
    >
      <BigImpactText
        text="당신도 가능합니다"
        highlight="당신도"
        startFrame={0}
      />
      <BulletList
        items={["광고비 0원", "시간 자유", "매출 3배"]}
        highlight
        startFrame={40}
        stagger={12}
      />
      <SubtitleBar text="같은 시스템으로" startFrame={110} />
    </AbsoluteFill>
  );
};
