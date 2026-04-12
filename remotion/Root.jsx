import React from 'react';
import { Composition } from 'remotion';
import {
  ShortformComposition,
  buildShortformTimeline,
} from './shortform/ShortformComposition.jsx';
import {
  SHORTFORM_FPS,
  SHORTFORM_HEIGHT,
  SHORTFORM_WIDTH,
} from './shortform/styles.js';

export const SHORTFORM_REMOTION_ID = 'ShortformRemotion';

const defaultProps = {
  preset: 'ddukddak-basic',
  hook: {
    badge: 'STOP',
    title: '콘텐츠 제작에\n3시간씩 쓰세요?',
    underlineText: '3시간 낭비 금지',
    durationInFrames: 90,
  },
  body: {
    header: 'AI 자동화\n3가지 방법',
    cards: [
      { number: '01', title: '스크립트 생성', description: 'AI가 초안을 만든다' },
      { number: '02', title: '이미지·영상', description: '생성형 AI로 제작' },
      { number: '03', title: '자동 편집', description: '템플릿으로 원클릭' },
    ],
    durationInFrames: 270,
  },
  cta: {
    headline: '5분 만에\n끝내세요',
    buttonText: '지금 시작 →',
    subtext: '뚝딱툴',
    durationInFrames: 90,
  },
};

export const RemotionRoot = () => {
  return (
    <Composition
      id={SHORTFORM_REMOTION_ID}
      component={ShortformComposition}
      width={SHORTFORM_WIDTH}
      height={SHORTFORM_HEIGHT}
      fps={SHORTFORM_FPS}
      durationInFrames={450}
      defaultProps={defaultProps}
      calculateMetadata={({ props }) => {
        const { durationInFrames } = buildShortformTimeline(props);
        return {
          durationInFrames,
          fps: SHORTFORM_FPS,
          width: SHORTFORM_WIDTH,
          height: SHORTFORM_HEIGHT,
        };
      }}
    />
  );
};
