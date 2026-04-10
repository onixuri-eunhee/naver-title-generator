import {useMemo} from 'react';
import {
  AbsoluteFill,
  Audio,
  Img,
  OffthreadVideo,
  Sequence,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import {buildShortformTimeline, SHORTFORM_FPS, SHORTFORM_HEIGHT, SHORTFORM_WIDTH} from './timeline.js';

const WORD_FADE_SECONDS = {
  slow: 0.25,
  normal: 0.15,
  fast: 0.08,
};

const ACCENT = '#ff5f1f';

const overlayStyle = {
  background: 'linear-gradient(180deg, rgba(4, 10, 18, 0.28) 0%, rgba(4, 10, 18, 0.48) 44%, rgba(4, 10, 18, 0.78) 100%)',
};

const backgroundStyle = {
  width: '100%',
  height: '100%',
  objectFit: 'cover',
};

const textWrapStyle = {
  justifyContent: 'center',
  alignItems: 'center',
  padding: '0 60px',
};

const textShellStyle = {
  width: '100%',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 10,
  textAlign: 'center',
};

const textStyle = {
  fontFamily: '"Noto Sans KR", "Apple SD Gothic Neo", sans-serif',
  fontWeight: 800,
  lineHeight: 1.08,
  letterSpacing: '-0.04em',
  color: '#ffffff',
  textAlign: 'center',
  textShadow: '0 16px 40px rgba(0, 0, 0, 0.42)',
};

const fallbackStyle = {
  background: 'linear-gradient(180deg, #0b1220 0%, #132238 55%, #1f314a 100%)',
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function getSceneFontSize() {
  return 58;
}

function getWordVisualState(word, currentTimeSec, fadeDurationSec) {
  if (currentTimeSec < word.start) {
    return {
      color: '#ffffff',
      opacity: 0.7,
      scale: 1,
      blur: 0,
    };
  }

  const progress = clamp((currentTimeSec - word.start) / fadeDurationSec, 0, 1);
  if (currentTimeSec < word.end) {
    return {
      color: ACCENT,
      opacity: 0.88 + progress * 0.12,
      scale: 1.02 + progress * 0.03,
      blur: 0,
    };
  }

  return {
    color: '#ffffff',
    opacity: 1,
    scale: 1,
    blur: 0,
  };
}

const KEN_BURNS_PRESETS = [
  {scaleFrom: 1.0, scaleTo: 1.12, xFrom: 0, xTo: -15, yFrom: 0, yTo: -10},
  {scaleFrom: 1.12, scaleTo: 1.0, xFrom: -10, xTo: 10, yFrom: -8, yTo: 8},
  {scaleFrom: 1.0, scaleTo: 1.10, xFrom: 10, xTo: -5, yFrom: 5, yTo: -5},
  {scaleFrom: 1.08, scaleTo: 1.0, xFrom: 0, xTo: 12, yFrom: -10, yTo: 0},
  {scaleFrom: 1.0, scaleTo: 1.14, xFrom: -8, xTo: 0, yFrom: 8, yTo: -8},
];

function getKenBurnsPreset(url) {
  let hash = 0;
  for (let i = 0; i < (url || '').length; i++) {
    hash = ((hash << 5) - hash + (url || '').charCodeAt(i)) | 0;
  }
  return KEN_BURNS_PRESETS[Math.abs(hash) % KEN_BURNS_PRESETS.length];
}

const HOOK_FADE_IN_FRAMES = 6;
const HOOK_FADE_OUT_FRAMES = 6;

const HookOverlay = ({text, durationInFrames}) => {
  const frame = useCurrentFrame();
  const cleanText = (text || '').trim();
  if (!cleanText) return null;

  const totalLen = cleanText.replace(/\s+/g, '').length;
  const fontSize = totalLen <= 6 ? 108 : totalLen <= 10 ? 88 : 72;

  const fadeIn = interpolate(frame, [0, HOOK_FADE_IN_FRAMES], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const fadeOut = interpolate(
    frame,
    [Math.max(0, durationInFrames - HOOK_FADE_OUT_FRAMES), durationInFrames],
    [1, 0],
    {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'}
  );
  const opacity = Math.min(fadeIn, fadeOut);
  const translateY = interpolate(fadeIn, [0, 1], [30, 0]);
  const scale = interpolate(fadeIn, [0, 1], [0.92, 1]);

  return (
    <AbsoluteFill
      style={{
        justifyContent: 'center',
        alignItems: 'center',
        padding: '0 80px',
      }}
    >
      <div
        style={{
          opacity,
          transform: `translateY(${translateY}px) scale(${scale})`,
          textAlign: 'center',
        }}
      >
        <div
          style={{
            fontFamily: '"Noto Sans KR", "Apple SD Gothic Neo", sans-serif',
            fontWeight: 900,
            fontSize,
            lineHeight: 1.3,
            color: '#ffffff',
            wordBreak: 'keep-all',
            overflowWrap: 'break-word',
            textShadow: '0 4px 24px rgba(0,0,0,0.7), 0 2px 8px rgba(0,0,0,0.5)',
          }}
        >
          {cleanText}
        </div>
      </div>
    </AbsoluteFill>
  );
};

const CROSSFADE_FRAMES = 8;
const VIDEO_FADEOUT_FRAMES = 18;

const BackgroundLayer = ({visual, durationInFrames}) => {
  const frame = useCurrentFrame();
  const isVideo = visual?.type === 'video';

  const fadeInFrames = CROSSFADE_FRAMES;
  const fadeOutFrames = isVideo ? VIDEO_FADEOUT_FRAMES : CROSSFADE_FRAMES;

  const fadeIn = interpolate(frame, [0, fadeInFrames], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const fadeOut = interpolate(
    frame,
    [Math.max(0, durationInFrames - fadeOutFrames), durationInFrames],
    [1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  );
  const opacity = Math.min(fadeIn, fadeOut);

  if (!visual) {
    return <AbsoluteFill style={{...fallbackStyle, opacity}} />;
  }

  if (isVideo) {
    return (
      <AbsoluteFill style={{opacity}}>
        <OffthreadVideo src={visual.url} muted loop style={backgroundStyle} />
      </AbsoluteFill>
    );
  }

  const kb = getKenBurnsPreset(visual.url);
  const progress = interpolate(frame, [0, durationInFrames], [0, 1], {
    extrapolateRight: 'clamp',
  });
  const scale = kb.scaleFrom + (kb.scaleTo - kb.scaleFrom) * progress;
  const translateX = kb.xFrom + (kb.xTo - kb.xFrom) * progress;
  const translateY = kb.yFrom + (kb.yTo - kb.yFrom) * progress;

  return (
    <AbsoluteFill
      style={{
        opacity,
        transform: `scale(${scale}) translate(${translateX}px, ${translateY}px)`,
      }}
    >
      <Img src={visual.url} style={backgroundStyle} />
    </AbsoluteFill>
  );
};

const TextLayer = ({scene, motionSpeed}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const localTimeSec = frame / fps;
  const currentTimeSec = localTimeSec + (scene.startSec || 0);

  // 항상 표시, word accent(흐린→진하게)가 시각 효과를 담당
  const fontSize = getSceneFontSize(scene);
  const fadeDurationSec = WORD_FADE_SECONDS[motionSpeed] || WORD_FADE_SECONDS.normal;

  const hasWordTiming = scene.wordLines?.some((line) => line.words?.length);

  return (
    <AbsoluteFill style={textWrapStyle}>
      <div
        style={textShellStyle}
      >
        {hasWordTiming ? scene.wordLines.map((line, lineIndex) => (
          <div
            key={`${scene.id}-line-${lineIndex}`}
            style={{
              ...textStyle,
              fontSize,
              whiteSpace: 'pre-wrap',
            }}
          >
            {(line.words || []).map((word, wordIndex) => {
              const wordState = getWordVisualState(word, currentTimeSec, fadeDurationSec);
              return (
                <span
                  key={`${scene.id}-word-${lineIndex}-${wordIndex}-${word.start}`}
                  style={{
                    color: wordState.color,
                    opacity: wordState.opacity,
                    display: 'inline-block',
                    transform: `scale(${wordState.scale})`,
                    filter: wordState.blur ? `blur(${wordState.blur}px)` : 'none',
                    transition: 'none',
                  }}
                >
                  {`${word.prefix || ''}${word.text}`}
                </span>
              );
            })}
          </div>
        )) : scene.displayLines.map((line, lineIndex) => (
            <div
              key={`${scene.id}-fallback-line-${lineIndex}`}
              style={{
                ...textStyle,
                fontSize,
              }}
            >
              {line}
            </div>
        ))}
        <div
          style={{
            width: SHORTFORM_WIDTH * 0.12,
            height: 4,
            borderRadius: 999,
            background: ACCENT,
            marginTop: 18,
          }}
        />
      </div>
    </AbsoluteFill>
  );
};

export const ShortformComposition = (props) => {
  const timeline = useMemo(() => buildShortformTimeline(props), [props]);
  // 텍스트 카드 폐지 → 모든 spans가 broll, 필터 불필요
  const backgroundVisualSpans = timeline.visualSpans;

  return (
    <AbsoluteFill
      style={{
        width: SHORTFORM_WIDTH,
        height: SHORTFORM_HEIGHT,
        backgroundColor: '#0b1220',
        overflow: 'hidden',
      }}
    >
      {backgroundVisualSpans.map((visual, index) => {
        const originalIndex = timeline.visualSpans.indexOf(visual);

        return (
          <Sequence
            key={`visual-bg-${originalIndex}-${visual.startFrame}`}
            from={visual.startFrame}
            durationInFrames={visual.durationInFrames}
          >
            <>
              <BackgroundLayer visual={visual} durationInFrames={visual.durationInFrames} />
              <AbsoluteFill style={overlayStyle} />
            </>
          </Sequence>
        );
      })}
      {props.audioSrc ? (
        <Audio
          src={props.audioSrc}
          startFrom={Math.floor((timeline.trimStartSec || 0) * SHORTFORM_FPS)}
        />
      ) : null}
      {timeline.textScenes.map((scene) => (
          <Sequence
            key={`text-${scene.id}-${scene.startFrame}`}
            from={scene.startFrame}
            durationInFrames={scene.durationInFrames}
          >
            <TextLayer
              scene={scene}
              motionSpeed={timeline.motionSpeed}
            />
          </Sequence>
        ))}
      {props.hookText && timeline.visualSpans.length > 0 ? (
        <Sequence
          key={`hook-overlay-${timeline.visualSpans[0].startFrame}`}
          from={timeline.visualSpans[0].startFrame}
          durationInFrames={timeline.visualSpans[0].durationInFrames}
        >
          <HookOverlay text={props.hookText} durationInFrames={timeline.visualSpans[0].durationInFrames} />
        </Sequence>
      ) : null}
    </AbsoluteFill>
  );
};
