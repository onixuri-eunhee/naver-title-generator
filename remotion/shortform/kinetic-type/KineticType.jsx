import { AbsoluteFill } from "remotion";
import {
  linearTiming,
  TransitionSeries,
} from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { KT_COLORS } from "./styles";
import { Scene1Opening } from "./scenes/Scene1Opening";
import { Scene2Numbers } from "./scenes/Scene2Numbers";
import { Scene3Comparison } from "./scenes/Scene3Comparison";
import { Scene4CoreMessage } from "./scenes/Scene4CoreMessage";
import { Scene5Evidence } from "./scenes/Scene5Evidence";
import { Scene6Promise } from "./scenes/Scene6Promise";
import { Scene7CTA } from "./scenes/Scene7CTA";

// Scene durations (includes 15f transition overlap where applicable)
// Target total = 1800f (60s @ 30fps)
// Sum = 165 + 165 + 315 + 315 + 465 + 315 + 150 = 1890
// Minus 6 transitions × 15f = 1800 ✓
const SCENES = [
  { Component: Scene1Opening, dur: 165 },
  { Component: Scene2Numbers, dur: 165 },
  { Component: Scene3Comparison, dur: 315 },
  { Component: Scene4CoreMessage, dur: 315 },
  { Component: Scene5Evidence, dur: 465 },
  { Component: Scene6Promise, dur: 315 },
  { Component: Scene7CTA, dur: 150 },
];

export const KINETIC_TYPE_DURATION = 1800;

export const KineticType = () => {
  return (
    <AbsoluteFill style={{ backgroundColor: KT_COLORS.bg }}>
      <TransitionSeries>
        {SCENES.map((s, i) => {
          const { Component } = s;
          const nodes = [];
          if (i > 0) {
            nodes.push(
              <TransitionSeries.Transition
                key={`t-${i}`}
                presentation={fade()}
                timing={linearTiming({ durationInFrames: 15 })}
              />,
            );
          }
          nodes.push(
            <TransitionSeries.Sequence
              key={`s-${i}`}
              durationInFrames={s.dur}
            >
              <Component />
            </TransitionSeries.Sequence>,
          );
          return nodes;
        })}
      </TransitionSeries>
    </AbsoluteFill>
  );
};
