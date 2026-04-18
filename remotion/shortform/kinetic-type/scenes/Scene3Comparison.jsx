import { AbsoluteFill } from "remotion";
import {
  ComparisonColumns,
  SmallLabel,
  SubtitleBar,
} from "../components/index.js";

export const Scene3Comparison = () => {
  return (
    <AbsoluteFill
      style={{
        justifyContent: "center",
        alignItems: "center",
        padding: 60,
        gap: 48,
      }}
    >
      <SmallLabel text="비교하자면" startFrame={0} />
      <ComparisonColumns
        leftIcon="😩"
        leftTitle="일반 사업가"
        leftPoints={["시간 부족", "광고비 부담", "효과 미미"]}
        rightIcon="💪"
        rightTitle="어나더핸즈"
        rightPoints={["시간 자유", "0원 마케팅", "매출 폭발"]}
        rightHighlight
        startFrame={12}
      />
      <SubtitleBar text="차이는 단 하나" startFrame={120} />
    </AbsoluteFill>
  );
};
