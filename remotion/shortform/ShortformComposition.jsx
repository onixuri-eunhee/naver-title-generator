import React, {useMemo} from 'react';
import {
  AbsoluteFill,
  Audio,
  Img,
  OffthreadVideo,
  Sequence,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import {buildShortformTimeline, SHORTFORM_HEIGHT, SHORTFORM_WIDTH} from './timeline.js';

const overlayStyle = {
  background: 'linear-gradient(180deg, rgba(4, 10, 18, 0.32) 0%, rgba(4, 10, 18, 0.5) 46%, rgba(4, 10, 18, 0.72) 100%)',
};

const backgroundStyle = {
  width: '100%',
  height: '100%',
  objectFit: 'cover',
};

const textWrapStyle = {
  justifyContent: 'center',
  alignItems: 'center',
  padding: '0 92px',
};

const textStyle = {
  fontFamily: '"Noto Sans KR", "Apple SD Gothic Neo", sans-serif',
  fontWeight: 800,
  fontSize: 112,
  lineHeight: 1.08,
  letterSpacing: '-0.04em',
  color: '#ffffff',
  textAlign: 'center',
  textWrap: 'balance',
  textShadow: '0 16px 40px rgba(0, 0, 0, 0.42)',
};

const fallbackStyle = {
  background: 'linear-gradient(180deg, #0b1220 0%, #132238 55%, #1f314a 100%)',
};

const BackgroundLayer = ({visual, durationInFrames}) => {
  const frame = useCurrentFrame();

  if (!visual) {
    return <AbsoluteFill style={fallbackStyle} />;
  }

  if (visual.type === 'video') {
    return (
      <AbsoluteFill>
        <OffthreadVideo src={visual.url} muted loop style={backgroundStyle} />
      </AbsoluteFill>
    );
  }

  const scale = interpolate(frame, [0, durationInFrames], [1, 1.06], {
    extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill
      style={{
        transform: `scale(${scale})`,
      }}
    >
      <Img src={visual.url} style={backgroundStyle} />
    </AbsoluteFill>
  );
};

const TextLayer = ({text, durationInFrames}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();

  const enter = spring({
    fps,
    frame,
    config: {
      damping: 200,
      stiffness: 180,
      mass: 0.9,
    },
  });
  const exitStart = Math.max(0, durationInFrames - Math.round(fps * 0.35));
  const exitProgress = interpolate(frame, [exitStart, durationInFrames], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const opacity = Math.min(1, enter) * exitProgress;
  const translateY = interpolate(opacity, [0, 1], [34, 0]);
  const scale = interpolate(opacity, [0, 1], [0.985, 1]);

  const fontSize = text.length <= 10 ? 126 : text.length <= 16 ? 112 : 96;

  return (
    <AbsoluteFill style={textWrapStyle}>
      <div
        style={{
          ...textStyle,
          fontSize,
          opacity,
          transform: `translateY(${translateY}px) scale(${scale})`,
        }}
      >
        {text}
      </div>
    </AbsoluteFill>
  );
};

export const ShortformComposition = (props) => {
  const timeline = useMemo(() => buildShortformTimeline(props), [props]);

  return (
    <AbsoluteFill
      style={{
        width: SHORTFORM_WIDTH,
        height: SHORTFORM_HEIGHT,
        backgroundColor: '#0b1220',
        overflow: 'hidden',
      }}
    >
      {timeline.visualSpans.map((visual) => (
        <Sequence
          key={`${visual.url}-${visual.startFrame}`}
          from={visual.startFrame}
          durationInFrames={visual.durationInFrames}
        >
          <BackgroundLayer visual={visual} durationInFrames={visual.durationInFrames} />
        </Sequence>
      ))}
      <AbsoluteFill style={overlayStyle} />
      {props.audioSrc ? (
        <Audio
          src={props.audioSrc}
          startFrom={Math.floor((timeline.trimStartSec || 0) * 30)}
        />
      ) : null}
      {timeline.textScenes.map((scene) => (
        <Sequence
          key={`${scene.text}-${scene.startFrame}`}
          from={scene.startFrame}
          durationInFrames={scene.durationInFrames}
        >
          <TextLayer text={scene.text} durationInFrames={scene.durationInFrames} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};
