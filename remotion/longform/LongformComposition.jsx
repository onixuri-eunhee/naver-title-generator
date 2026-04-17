import { Audio, Sequence } from 'remotion';
import {
  linearTiming,
  TransitionSeries,
} from '@remotion/transitions';
import { slide } from '@remotion/transitions/slide';
import { fade } from '@remotion/transitions/fade';
import { BackgroundLayer } from '../shortform/BackgroundLayer.jsx';
import { ProgressBar } from '../shortform/ProgressBar.jsx';
import { HookScene } from '../shortform/HookScene.jsx';
import { BodyScene } from '../shortform/BodyScene.jsx';
import { CTAScene } from '../shortform/CTAScene.jsx';
import { getPreset, DEFAULT_PRESET_KEY } from '../shortform/presets.js';
import { SHORTFORM_FPS } from '../shortform/styles.js';

/**
 * LongformComposition — 7씬 (Hook → Body1~4 → Conclusion → CTA)
 *
 * v2.1 신규. ShortformComposition 패턴을 기반으로 롱폼 (3/5/10분) 구조 확장.
 *
 * Props:
 * - preset: 컬러 프리셋 키
 * - audio, subtitle, textPosition, cameraMotion, sceneTransition (ShortformComposition과 동일)
 * - hook/body1/body2/body3/body4/conclusion/cta: 각각 { imageUrl?, title?, caption?, durationInFrames, type?, typeProps? }
 * - totalDurationInFrames: 총 프레임 수 — 주어지면 7씬에 비례 분배
 *
 * 타임라인 비율 (totalDurationInFrames 기준):
 * - Hook 10% / Body1~4 각 17.5% (합 70%) / Conclusion 10% / CTA 10%
 *
 * 각 body 씬의 type 필드(comparison/emphasis/testimonial/data/flow/text)는
 * BodyScene이 routing 처리 (Agent A가 확장).
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
 * 7씬 비례 분배.
 * @param {number} total totalDurationInFrames
 * @returns {{hook, body1, body2, body3, body4, conclusion, cta}}
 */
function proportionalFrames(total) {
  // 합 = 1.0
  const ratios = {
    hook: 0.10,
    body1: 0.175,
    body2: 0.175,
    body3: 0.175,
    body4: 0.175,
    conclusion: 0.10,
    cta: 0.10,
  };
  const out = {};
  let sum = 0;
  Object.entries(ratios).forEach(([k, r]) => {
    out[k] = Math.max(30, Math.round(total * r));
    sum += out[k];
  });
  // 반올림 오차 보정 — body2에 귀속
  const diff = total - sum;
  out.body2 += diff;
  return out;
}

function resolveSectionFrames(props) {
  const total = Number(props?.totalDurationInFrames) || 0;
  if (total > 0) {
    const computed = proportionalFrames(total);
    return {
      hook: props?.hook?.durationInFrames || computed.hook,
      body1: props?.body1?.durationInFrames || computed.body1,
      body2: props?.body2?.durationInFrames || computed.body2,
      body3: props?.body3?.durationInFrames || computed.body3,
      body4: props?.body4?.durationInFrames || computed.body4,
      conclusion: props?.conclusion?.durationInFrames || computed.conclusion,
      cta: props?.cta?.durationInFrames || computed.cta,
    };
  }
  // totalDurationInFrames 없으면 3분 디폴트 (180s × 30fps = 5400)
  const fallback = proportionalFrames(5400);
  return {
    hook: props?.hook?.durationInFrames || fallback.hook,
    body1: props?.body1?.durationInFrames || fallback.body1,
    body2: props?.body2?.durationInFrames || fallback.body2,
    body3: props?.body3?.durationInFrames || fallback.body3,
    body4: props?.body4?.durationInFrames || fallback.body4,
    conclusion: props?.conclusion?.durationInFrames || fallback.conclusion,
    cta: props?.cta?.durationInFrames || fallback.cta,
  };
}

export const LongformComposition = ({
  preset: presetKey = DEFAULT_PRESET_KEY,
  hook,
  body1,
  body2,
  body3,
  body4,
  conclusion,
  cta,
  audio,
  subtitle,
  textPosition = 'center',
  cameraMotion = 'ken-burns',
  sceneTransition = 'slide',
  totalDurationInFrames,
}) => {
  const preset = getPreset(presetKey);
  const frames = resolveSectionFrames({
    hook, body1, body2, body3, body4, conclusion, cta, totalDurationInFrames,
  });

  const { transitionFrames, transitionPresentation } = resolveTransition(sceneTransition);

  // body 씬 렌더러 — type 필드에 따라 BodyScene이 분기 (Agent A 확장)
  function renderBody(bodyProps, keyPrefix) {
    return (
      <BodyScene
        header={bodyProps?.header || bodyProps?.title}
        title={bodyProps?.title}
        caption={bodyProps?.caption}
        cards={bodyProps?.cards}
        imageUrl={bodyProps?.imageUrl}
        type={bodyProps?.type || 'text'}
        typeProps={bodyProps?.typeProps}
        preset={preset}
        subtitle={subtitle}
        textPosition={textPosition}
        cameraMotion={cameraMotion}
      />
    );
  }

  return (
    <BackgroundLayer colors={preset.colors} meshCircles={preset.mesh}>
      <TransitionSeries>
        {/* Hook */}
        <TransitionSeries.Sequence durationInFrames={frames.hook}>
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

        {/* Body 1 */}
        <TransitionSeries.Sequence durationInFrames={frames.body1}>
          {renderBody(body1, 'body1')}
        </TransitionSeries.Sequence>

        <TransitionSeries.Transition
          presentation={transitionPresentation}
          timing={linearTiming({ durationInFrames: transitionFrames })}
        />

        {/* Body 2 */}
        <TransitionSeries.Sequence durationInFrames={frames.body2}>
          {renderBody(body2, 'body2')}
        </TransitionSeries.Sequence>

        <TransitionSeries.Transition
          presentation={transitionPresentation}
          timing={linearTiming({ durationInFrames: transitionFrames })}
        />

        {/* Body 3 */}
        <TransitionSeries.Sequence durationInFrames={frames.body3}>
          {renderBody(body3, 'body3')}
        </TransitionSeries.Sequence>

        <TransitionSeries.Transition
          presentation={transitionPresentation}
          timing={linearTiming({ durationInFrames: transitionFrames })}
        />

        {/* Body 4 */}
        <TransitionSeries.Sequence durationInFrames={frames.body4}>
          {renderBody(body4, 'body4')}
        </TransitionSeries.Sequence>

        <TransitionSeries.Transition
          presentation={transitionPresentation}
          timing={linearTiming({ durationInFrames: transitionFrames })}
        />

        {/* Conclusion (summary) */}
        <TransitionSeries.Sequence durationInFrames={frames.conclusion}>
          {renderBody(conclusion, 'conclusion')}
        </TransitionSeries.Sequence>

        <TransitionSeries.Transition
          presentation={transitionPresentation}
          timing={linearTiming({ durationInFrames: transitionFrames })}
        />

        {/* CTA */}
        <TransitionSeries.Sequence durationInFrames={frames.cta}>
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

/**
 * Longform 타임라인 계산 — 7씬 + 6 transition.
 * TransitionSeries에서 transition 시간만큼 sequence가 겹침 → total = sum - 6 * transition.
 */
export function buildLongformTimeline(props) {
  const { transitionFrames } = resolveTransition(props?.sceneTransition || 'slide');
  const frames = resolveSectionFrames(props);
  const sumFrames =
    frames.hook + frames.body1 + frames.body2 + frames.body3 + frames.body4
    + frames.conclusion + frames.cta;
  // 6 transitions between 7 sequences
  const durationInFrames = sumFrames - 6 * transitionFrames;
  return {
    durationInFrames: Math.max(durationInFrames, SHORTFORM_FPS),
  };
}
