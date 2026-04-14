import { Audio, Sequence } from 'remotion';
import {
  linearTiming,
  TransitionSeries,
} from '@remotion/transitions';
import { slide } from '@remotion/transitions/slide';
import { fade } from '@remotion/transitions/fade';
import { BackgroundLayer } from './BackgroundLayer';
import { ProgressBar } from './ProgressBar';
import { HookScene } from './HookScene';
import { BodyScene } from './BodyScene';
import { CTAScene } from './CTAScene';
import { getPreset, DEFAULT_PRESET_KEY } from './presets';
import { SHORTFORM_FPS } from './styles';

/**
 * sceneTransition 값을 Remotion transition 프리셋으로 변환
 * Phase F — Step 6 커스터마이징용.
 */
function resolveTransition(kind) {
  switch (kind) {
    case 'cut':
      return { transitionFrames: 1, transitionPresentation: fade() };
    case 'fade':
      return { transitionFrames: 15, transitionPresentation: fade() };
    case 'fade-long':
      return { transitionFrames: 30, transitionPresentation: fade() };
    case 'slide-fast':
      return { transitionFrames: 8, transitionPresentation: slide({ direction: 'from-right' }) };
    case 'slide':
    default:
      return { transitionFrames: 15, transitionPresentation: slide({ direction: 'from-right' }) };
  }
}

/**
 * ShortformComposition — 3씬 (Hook → Body → CTA)
 *
 * Props:
 * - preset: 컬러 프리셋 키 (기존 10종)
 * - hook/body/cta: 기존
 * - audio: 기존
 * - subtitle?: { color, font, size, position, bgColor, bgOpacity }  (Phase F 신규)
 * - textPosition?: 'top'|'center'|'center-large'|'bottom'|'free'    (Phase F 신규)
 * - cameraMotion?: 'static'|'ken-burns'|'zoom-in'|'pan'              (Phase F 신규)
 * - sceneTransition?: 'cut'|'fade'|'fade-long'|'slide'|'slide-fast'  (Phase F 신규)
 *
 * 신규 props는 모두 optional. 기존 runAll 경로는 무변경.
 */
export const ShortformComposition = ({
  preset: presetKey = DEFAULT_PRESET_KEY,
  hook,
  body,
  cta,
  audio,
  subtitle,
  textPosition = 'bottom',
  cameraMotion = 'ken-burns',
  sceneTransition = 'slide',
}) => {
  const preset = getPreset(presetKey);
  const hookFrames = hook?.durationInFrames || 90;
  const bodyFrames = body?.durationInFrames || 270;
  const ctaFrames = cta?.durationInFrames || 90;

  const { transitionFrames, transitionPresentation } = resolveTransition(sceneTransition);

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
            subtitle={subtitle}
            textPosition={textPosition}
            cameraMotion={cameraMotion}
          />
        </TransitionSeries.Sequence>

        <TransitionSeries.Transition
          presentation={transitionPresentation}
          timing={linearTiming({ durationInFrames: transitionFrames })}
        />

        <TransitionSeries.Sequence durationInFrames={bodyFrames}>
          <BodyScene
            header={body?.header}
            cards={body?.cards}
            caption={body?.caption}
            imageUrl={body?.imageUrl}
            preset={preset}
            subtitle={subtitle}
            textPosition={textPosition}
            cameraMotion={cameraMotion}
          />
        </TransitionSeries.Sequence>

        <TransitionSeries.Transition
          presentation={transitionPresentation}
          timing={linearTiming({ durationInFrames: transitionFrames })}
        />

        <TransitionSeries.Sequence durationInFrames={ctaFrames}>
          <CTAScene
            headline={cta?.headline}
            buttonText={cta?.buttonText}
            subtext={cta?.subtext}
            preset={preset}
            subtitle={subtitle}
            textPosition={textPosition}
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
  const { transitionFrames } = resolveTransition(props?.sceneTransition || 'slide');
  // TransitionSeries는 transition 시간만큼 sequence가 겹치므로 total = sum - 2*transition
  const durationInFrames = hookFrames + bodyFrames + ctaFrames - 2 * transitionFrames;
  return {
    durationInFrames: Math.max(durationInFrames, SHORTFORM_FPS),
  };
}
