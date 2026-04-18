import { Sequence } from 'remotion';
import { Audio } from '@remotion/media';
import {
  linearTiming,
  TransitionSeries,
} from '@remotion/transitions';
import { slide } from '@remotion/transitions/slide';
import { fade } from '@remotion/transitions/fade';
import { wipe } from '@remotion/transitions/wipe';
import { BackgroundLayer } from './BackgroundLayer.jsx';
import { ProgressBar } from './ProgressBar.jsx';
import { SceneRouter } from './SceneRouter.jsx';
import { CTAVariantScene } from './CTAVariantScene.jsx';
import { getPreset, DEFAULT_PRESET_KEY } from './presets.js';
import { SHORTFORM_FPS } from './styles.js';
import { getTransitionOverlapFrames, AUDIO_PREROLL_FRAMES } from '../../lib/shortform/scene-timing.js';

// Phase A-bis auto 전환 로테이션 — lib/shortform/scene-timing.js 의 내부 상수와 동일 순서.
// getTransitionOverlapFrames()는 'auto' 파라미터에 평균값을 주므로, 씬별 값은 이 배열로 조회.
// Phase 2 (2026-04-18): wipe/clock-wipe/flip 제거 — 복잡 레이아웃(ComparisonColumns 등)에서
// 중첩 프레임이 시각적으로 "tear"를 만드는 문제. fade 중심 + 제한적 slide-fast로 교체.
const AUTO_TRANSITION_ROTATION = ['fade', 'slide-fast', 'fade-long', 'fade', 'slide-fast', 'fade', 'fade-long', 'slide-fast'];

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
  // transitionFrames는 lib/shortform/scene-timing.js 의 TRANSITION_OVERLAP_BY_KIND와
  // 동기화되어 있어야 한다. 두 곳에서 한 진실의 근원을 가지도록 getTransitionOverlapFrames로
  // 조회. transitionPresentation은 Remotion 타입이라 여기서 직접 생성.
  const transitionFrames = getTransitionOverlapFrames(kind, SHORTFORM_FPS);
  switch (kind) {
    case 'cut':
      return { transitionFrames, transitionPresentation: fade() };
    case 'fade':
    case 'fade-long':
      return { transitionFrames, transitionPresentation: fade() };
    case 'clock-wipe':
    case 'wipe':
      return {
        transitionFrames,
        transitionPresentation: wipe({ direction: 'from-left' }),
      };
    case 'flip':
      return {
        transitionFrames,
        transitionPresentation: wipe({ direction: 'from-top' }),
      };
    case 'slide-fast':
    case 'slide':
    default:
      return {
        transitionFrames,
        transitionPresentation: slide({ direction: 'from-right' }),
      };
  }
}

// sceneTransition === 'auto' 일 때 인덱스 기반 로테이션
function resolveAutoTransition(sceneIndex) {
  return resolveTransition(
    AUTO_TRANSITION_ROTATION[sceneIndex % AUTO_TRANSITION_ROTATION.length],
  );
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
  designTokens,
}) => {
  const preset = getPreset(presetKey);

  if (!Array.isArray(scenes) || scenes.length === 0) {
    // 폴백: 빈 상태
    return (
      <BackgroundLayer colors={preset.colors} >
        <div />
      </BackgroundLayer>
    );
  }

  const children = [];
  scenes.forEach((scene, i) => {
    const isLast = i === scenes.length - 1;
    const isFirst = i === 0;
    // Phase A-bis: 마지막 씬이 Phase A-bis 필드(ctaVariantProps)를 가지면 CTAVariantScene으로 렌더.
    // 레거시 scriptToProps 출력은 이 필드가 없으므로 기존 SceneCard 경로 유지 — 가드레일.
    const useCtaVariant = isLast && scene.ctaVariantProps;

    children.push(
      <TransitionSeries.Sequence
        key={`seq-${i}`}
        durationInFrames={Math.max(scene.durationInFrames || 30, 30)}
      >
        {useCtaVariant ? (
          <CTAVariantScene
            variantProps={scene.ctaVariantProps}
            copy={scene.ctaCopy}
            brandKit={scene.brandKit}
          />
        ) : (
          <SceneRouter
            scene={{ ...scene, isFirst }}
            sceneIndex={i}
            totalScenes={scenes.length}
            preset={preset}
            cameraMotion={cameraMotion}
            subtitle={subtitle}
            textPosition={textPosition}
            designTokens={designTokens}
          />
        )}
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
    <BackgroundLayer colors={preset.colors} >
      <TransitionSeries>{children}</TransitionSeries>
      <ProgressBar color={preset.colors.accent} />
      {audio?.url && (
        /* Phase 2 (2026-04-18): 오디오를 AUDIO_PREROLL_FRAMES 뒤에 시작.
           LayoutComponent spring 진입 애니메이션이 완료된 뒤 음성이 나오도록 하여
           "음성이 영상보다 빠르다" 느낌 제거.
           premountFor (Remotion best practice): 오디오 버퍼링 사전 로드로 playback 끊김 방지.
           layout="none": Audio는 visual이 없어 AbsoluteFill 래퍼 불필요. */
        <Sequence
          from={AUDIO_PREROLL_FRAMES}
          layout="none"
          premountFor={SHORTFORM_FPS}
        >
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

  // 'auto' 전환은 씬 간마다 transition 프레임이 다름 — AUTO_TRANSITION_ROTATION 순회.
  // 값은 lib/shortform/scene-timing.js 의 TRANSITION_OVERLAP_BY_KIND가 진실의 근원.
  const sceneTransition = props?.sceneTransition || 'auto';
  let totalTransition = 0;
  if (sceneTransition === 'auto') {
    for (let i = 0; i < scenes.length - 1; i++) {
      const kind = AUTO_TRANSITION_ROTATION[i % AUTO_TRANSITION_ROTATION.length];
      totalTransition += getTransitionOverlapFrames(kind, SHORTFORM_FPS);
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
