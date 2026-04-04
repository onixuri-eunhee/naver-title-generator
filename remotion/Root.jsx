import React from 'react';
import {Composition} from 'remotion';
import {ShortformComposition} from './shortform/ShortformComposition.jsx';
import {buildShortformTimeline, SHORTFORM_FPS, SHORTFORM_HEIGHT, SHORTFORM_WIDTH} from './shortform/timeline.js';

export const SHORTFORM_REMOTION_ID = 'ShortformRemotion';

const defaultProps = {
  script: {
    hook: '지금 렌더 테스트 중입니다.',
    point: '배경 자산 위에 단어별 자막 타이밍을 반영합니다.',
    cta: '최소 MVP 구성을 확인하세요.',
  },
  estimatedSeconds: 30,
  visuals: [],
  audioDurationSec: 30,
  sttWords: [],
  sttSegments: [],
  motionSpeed: 'normal',
  textRevealMode: 'line',
  trimStartSec: 0,
  trimEndSec: null,
};

export const RemotionRoot = () => {
  return (
    <Composition
      id={SHORTFORM_REMOTION_ID}
      component={ShortformComposition}
      width={SHORTFORM_WIDTH}
      height={SHORTFORM_HEIGHT}
      fps={SHORTFORM_FPS}
      durationInFrames={Math.round(30 * SHORTFORM_FPS)}
      defaultProps={defaultProps}
      calculateMetadata={({props}) => {
        const timeline = buildShortformTimeline(props);
        return {
          durationInFrames: timeline.durationInFrames,
          fps: SHORTFORM_FPS,
          width: SHORTFORM_WIDTH,
          height: SHORTFORM_HEIGHT,
        };
      }}
    />
  );
};
