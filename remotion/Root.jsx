import React from 'react';
import {Composition} from 'remotion';
import {ShortformComposition} from './shortform/ShortformComposition.jsx';
import {buildShortformTimeline, SHORTFORM_FPS, SHORTFORM_HEIGHT, SHORTFORM_WIDTH} from './shortform/timeline.js';

export const SHORTFORM_REMOTION_ID = 'ShortformRemotion';

export const RemotionRoot = () => {
  const defaultProps = {
    script: {
      hook: '지금 렌더 테스트 중입니다.',
      points: ['배경 자산 위에 한 줄 텍스트만 노출합니다.'],
      cta: '최소 MVP 구성을 확인하세요.',
    },
    estimatedSeconds: 30,
    visuals: [],
    audioDurationSec: 30,
    trimStartSec: 0,
    trimEndSec: null,
  };
  const timeline = buildShortformTimeline(defaultProps);

  return (
    <Composition
      id={SHORTFORM_REMOTION_ID}
      component={ShortformComposition}
      width={SHORTFORM_WIDTH}
      height={SHORTFORM_HEIGHT}
      fps={SHORTFORM_FPS}
      durationInFrames={timeline.durationInFrames}
      defaultProps={defaultProps}
    />
  );
};
