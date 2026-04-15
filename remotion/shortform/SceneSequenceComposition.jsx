import { Audio, Sequence } from 'remotion';
import {
  linearTiming,
  TransitionSeries,
} from '@remotion/transitions';
import { slide } from '@remotion/transitions/slide';
import { fade } from '@remotion/transitions/fade';
import { BackgroundLayer } from './BackgroundLayer';
import { ProgressBar } from './ProgressBar';
import { SceneCard } from './SceneCard';
import { getPreset, DEFAULT_PRESET_KEY } from './presets';
import { SHORTFORM_FPS } from './styles';

/**
 * SceneSequenceComposition — Phase A "script.scenes[] 1:1 매핑" 렌더러.
 *
 * 기존 ShortformComposition은 전체 대본을 Hook/Body/CTA 3 시퀀스로만 쪼개어,
 * 7~20씬 대본의 15씬이 화면에 나오지 않는 구조적 결함이 있었다. 이 컴포넌트는
 * script.scenes 배열 각 원소를 독립된 TransitionSeries.Sequence로 렌더링한다.
 *
 * Props:
 * - preset: 컬러 프리셋 키
 * - scenes: [{ text, section, durationInFrames, imageUrl?, badge?, ctaButtonText? }]
 *   각 씬의 durationInFrames는 scriptToProps가 사전 계산해서 주입.
 * - totalDurationInFrames: 전체 프레임 수 (buildSceneSequenceTimeline에서 계산)
 * - audio: { url, durationInFrames }
 * - subtitle?: 자막 override
 * - textPosition?: 'top'|'center'|'center-large'|'bottom'|'free'
 * - cameraMotion?: 'static'|'ken-burns'|'zoom-in'|'pan'
 * - sceneTransition?: 'cut'|'fade'|'fade-long'|'slide'|'slide-fast'|'auto'
 *   'auto'면 씬 인덱스 기반으로 slide/fade/cut 순환.
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

// sceneTransition === 'auto' 일 때 인덱스 기반 로테이션
function resolveAutoTransition(sceneIndex) {
  const variants = ['slide-fast', 'fade', 'slide', 'fade-long'];
  return resolveTransition(variants[sceneIndex % variants.length]);
}

export const SceneSequenceComposition = ({
  preset: presetKey = DEFAULT_PRESET_KEY,
  scenes = [],
  // totalDurationInFrames는 buildSceneSequenceTimeline에서만 사용 — 컴포넌트 자체는
  // 각 씬의 durationInFrames 합으로 Remotion이 타임라인을 구성한다.
  audio,
  subtitle,
  textPosition = 'center',
  cameraMotion = 'ken-burns',
  sceneTransition = 'auto',
}) => {
  const preset = getPreset(presetKey);

  if (!Array.isArray(scenes) || scenes.length === 0) {
    // 폴백: 빈 상태
    return (
      <BackgroundLayer colors={preset.colors} meshCircles={preset.mesh}>
        <div />
      </BackgroundLayer>
    );
  }

  const children = [];
  scenes.forEach((scene, i) => {
    children.push(
      <TransitionSeries.Sequence
        key={`seq-${i}`}
        durationInFrames={Math.max(scene.durationInFrames || 30, 30)}
      >
        <SceneCard
          text={scene.text}
          section={scene.section || 'point'}
          sceneIndex={i}
          totalScenes={scenes.length}
          preset={preset}
          imageUrl={scene.imageUrl}
          cameraMotion={cameraMotion}
          subtitle={subtitle}
          textPosition={textPosition}
          badge={scene.badge}
          ctaButtonText={scene.ctaButtonText}
        />
      </TransitionSeries.Sequence>,
    );

    // 마지막 씬 뒤에는 Transition 없음
    if (i < scenes.length - 1) {
      const { transitionFrames, transitionPresentation } =
        sceneTransition === 'auto'
          ? resolveAutoTransition(i)
          : resolveTransition(sceneTransition);
      children.push(
        <TransitionSeries.Transition
          key={`tr-${i}`}
          presentation={transitionPresentation}
          timing={linearTiming({ durationInFrames: transitionFrames })}
        />,
      );
    }
  });

  return (
    <BackgroundLayer colors={preset.colors} meshCircles={preset.mesh}>
      <TransitionSeries>{children}</TransitionSeries>
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
 * Scene Sequence 타임라인 계산 — ShortformComposition과 동일 패턴.
 *
 * scenes 각각의 durationInFrames 합에서, transition 중첩 프레임(씬 간 n-1 개)을
 * 빼야 실제 총 프레임 수가 맞는다.
 */
export function buildSceneSequenceTimeline(props) {
  const scenes = Array.isArray(props?.scenes) ? props.scenes : [];
  if (scenes.length === 0) {
    return { durationInFrames: SHORTFORM_FPS };
  }

  // 'auto' 전환은 씬 간마다 transition 프레임이 다름 — 평균(~17)로 계산
  // 'auto'가 아닌 경우는 단일 transition 값
  const sceneTransition = props?.sceneTransition || 'auto';
  let totalTransition = 0;
  if (sceneTransition === 'auto') {
    const autoVariants = [8, 15, 15, 30]; // slide-fast, fade, slide, fade-long
    for (let i = 0; i < scenes.length - 1; i++) {
      totalTransition += autoVariants[i % autoVariants.length];
    }
  } else {
    const { transitionFrames } = resolveTransition(sceneTransition);
    totalTransition = transitionFrames * Math.max(scenes.length - 1, 0);
  }

  const totalSceneFrames = scenes.reduce(
    (sum, s) => sum + Math.max(s.durationInFrames || 30, 30),
    0,
  );

  const net = totalSceneFrames - totalTransition;
  return {
    durationInFrames: Math.max(net, SHORTFORM_FPS),
  };
}
