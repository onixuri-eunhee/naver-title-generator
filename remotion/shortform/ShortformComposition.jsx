import { AbsoluteFill, Audio, Sequence } from 'remotion';
import {
  linearTiming,
  TransitionSeries,
} from '@remotion/transitions';
import { slide } from '@remotion/transitions/slide';
import { BackgroundLayer } from './BackgroundLayer';
import { ProgressBar } from './ProgressBar';
import { HookScene } from './HookScene';
import { BodyScene } from './BodyScene';
import { CTAScene } from './CTAScene';
import { getPreset, DEFAULT_PRESET_KEY } from './presets';
import { SHORTFORM_FPS } from './styles';

const FadeScalePresentation = ({
  children,
  presentationDirection,
  presentationProgress,
}) => {
  const isEntering = presentationDirection === 'entering';
  const opacity = isEntering ? presentationProgress : 1 - presentationProgress;
  const scale = isEntering
    ? 0.9 + presentationProgress * 0.1
    : 1 + presentationProgress * 0.1;
  return (
    <AbsoluteFill style={{ opacity, transform: `scale(${scale})` }}>
      {children}
    </AbsoluteFill>
  );
};

const fadeScale = () => ({
  component: FadeScalePresentation,
  props: {},
});

/**
 * ShortformComposition — 3씬 (Hook → Body → CTA) 단순화 MVP
 *
 * Props:
 * - preset: 프리셋 키 ('ddukddak-basic' | ...)
 * - hook: { badge, title, underlineText, imageUrl?, durationInFrames }
 * - body: { header, cards?, caption?, imageUrl?, durationInFrames }
 * - cta: { headline, buttonText, subtext, durationInFrames }
 * - audio?: { url, durationInFrames }
 */
export const ShortformComposition = ({
  preset: presetKey = DEFAULT_PRESET_KEY,
  hook,
  body,
  cta,
  audio,
}) => {
  const preset = getPreset(presetKey);
  const hookFrames = hook?.durationInFrames || 90;
  const bodyFrames = body?.durationInFrames || 270;
  const ctaFrames = cta?.durationInFrames || 90;
  const transitionFrames = 15;

  return (
    <BackgroundLayer colors={preset.colors} meshCircles={preset.mesh}>
      <TransitionSeries>
        <TransitionSeries.Sequence durationInFrames={hookFrames}>
          <HookScene
            badge={hook?.badge}
            title={hook?.title}
            underlineText={hook?.underlineText}
            imageUrl={hook?.imageUrl}
            preset={preset}
          />
        </TransitionSeries.Sequence>

        <TransitionSeries.Transition
          presentation={slide({ direction: 'from-right' })}
          timing={linearTiming({ durationInFrames: transitionFrames })}
        />

        <TransitionSeries.Sequence durationInFrames={bodyFrames}>
          <BodyScene
            header={body?.header}
            cards={body?.cards}
            caption={body?.caption}
            imageUrl={body?.imageUrl}
            preset={preset}
          />
        </TransitionSeries.Sequence>

        <TransitionSeries.Transition
          presentation={fadeScale()}
          timing={linearTiming({ durationInFrames: transitionFrames })}
        />

        <TransitionSeries.Sequence durationInFrames={ctaFrames}>
          <CTAScene
            headline={cta?.headline}
            buttonText={cta?.buttonText}
            subtext={cta?.subtext}
            preset={preset}
          />
        </TransitionSeries.Sequence>
      </TransitionSeries>
      <ProgressBar color={preset.colors.accent} />
      {audio?.url && (
        <Sequence from={0}>
          <Audio src={audio.url} />
        </Sequence>
      )}
    </BackgroundLayer>
  );
};

export function buildShortformTimeline(props) {
  const hookFrames = props?.hook?.durationInFrames || 90;
  const bodyFrames = props?.body?.durationInFrames || 270;
  const ctaFrames = props?.cta?.durationInFrames || 90;
  const transitionFrames = 15;
  // TransitionSeries는 transition 시간만큼 sequence가 겹치므로 total = sum - 2*transition
  const durationInFrames = hookFrames + bodyFrames + ctaFrames - 2 * transitionFrames;
  return {
    durationInFrames: Math.max(durationInFrames, SHORTFORM_FPS),
  };
}
