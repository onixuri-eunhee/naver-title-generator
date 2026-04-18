import { AbsoluteFill } from "remotion";
import {
  GiantNumberCounter,
  SmallLabel,
  SubtitleBar,
} from "../components/index.js";

export const Scene1Opening = () => {
  return (
    <AbsoluteFill
      style={{
        justifyContent: "center",
        alignItems: "center",
        padding: 80,
        gap: 48,
      }}
    >
      <SmallLabel text="어나더핸즈" startFrame={0} />
      <GiantNumberCounter
        from={0}
        to={19}
        suffix="년"
        label="웨딩 컨설팅"
        startFrame={10}
        durationInFrames={30}
      />
      <SubtitleBar text="19년 동안 3500쌍을 만났어요" startFrame={60} />
    </AbsoluteFill>
  );
};
