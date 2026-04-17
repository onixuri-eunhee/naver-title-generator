/**
 * SceneRouter — scene.layoutType 기반 동적 컴포넌트 라우팅.
 *
 * SceneSequenceComposition이 각 씬을 렌더할 때, layoutType이 있으면
 * KineticType 시각화 컴포넌트로 분기하고, 없으면 기존 SceneCard fallback.
 *
 * layoutType → 컴포넌트 매핑은 LAYOUT_REGISTRY에서 관리.
 * 새 레이아웃 추가 시 여기 1줄 + 컴포넌트 파일 1개만 추가.
 */

import { AbsoluteFill } from 'remotion';
import { SceneCard } from './SceneCard';
import { LottieOverlay } from './kinetic-type/components/effects/LottieOverlay';
import { ConfettiOverlay } from './kinetic-type/components/effects/ConfettiOverlay';
import { SparkleOverlay } from './kinetic-type/components/effects/SparkleOverlay';
import { CheckmarkDraw } from './kinetic-type/components/effects/CheckmarkDraw';
import { DEFAULT_DESIGN_TOKENS } from '../../lib/shortform/design-tokens-shared.js';
import { BigImpactText } from './kinetic-type/components/BigImpactText';
import { BulletList } from './kinetic-type/components/BulletList';
import { ComparisonColumns } from './kinetic-type/components/ComparisonColumns';
import { EmphasisBox } from './kinetic-type/components/EmphasisBox';
import { GiantNumberCounter } from './kinetic-type/components/GiantNumberCounter';
import { ProgressBarBlock } from './kinetic-type/components/ProgressBarBlock';
import { SmallLabel } from './kinetic-type/components/SmallLabel';
import { SubtitleBar } from './kinetic-type/components/SubtitleBar';
import { VerticalBarText } from './kinetic-type/components/VerticalBarText';
import { VennDiagram } from './kinetic-type/components/VennDiagram';
import { BarGraph } from './kinetic-type/components/BarGraph';
import { PieChart } from './kinetic-type/components/PieChart';
import { FlowDiagram } from './kinetic-type/components/FlowDiagram';
import { ComparisonChart } from './kinetic-type/components/ComparisonChart';
import { ConnectingNetwork } from './kinetic-type/components/ConnectingNetwork';
import { StrikethroughText } from './kinetic-type/components/StrikethroughText';
import { NumberSlam } from './kinetic-type/components/NumberSlam';

const LAYOUT_REGISTRY = {
  'big-impact-text': BigImpactText,
  'bullet-list': BulletList,
  'comparison': ComparisonColumns,
  'emphasis-box': EmphasisBox,
  'counter': GiantNumberCounter,
  'progress-bar': ProgressBarBlock,
  'small-label': SmallLabel,
  'subtitle-bar': SubtitleBar,
  'vertical-bar': VerticalBarText,
  'venn-diagram': VennDiagram,
  'bar-chart': BarGraph,
  'pie-chart': PieChart,
  'flow-diagram': FlowDiagram,
  'comparison-chart': ComparisonChart,
  'network': ConnectingNetwork,
  'strikethrough': StrikethroughText,
  'number-slam': NumberSlam,
};

export const LAYOUT_TYPES = Object.keys(LAYOUT_REGISTRY);

export function SceneRouter({
  scene,
  sceneIndex,
  totalScenes,
  preset,
  cameraMotion,
  subtitle,
  textPosition,
  designTokens,
}) {
  const tokens = designTokens || DEFAULT_DESIGN_TOKENS;
  const layoutType = scene?.layoutType;
  const LayoutComponent = layoutType ? LAYOUT_REGISTRY[layoutType] : null;

  if (LayoutComponent) {
    const layoutProps = scene.layoutProps || {};
    const section = scene.section || 'point';

    // designTokens 기반 동적 패딩 — titlePositionPercent를 1920px 세로 기준으로 변환
    const topPadding = Math.round(1920 * (tokens.titlePositionPercent / 100));

    // 이펙트 오버레이 자동 매칭
    let EffectOverlay = null;
    if (section === 'cta') EffectOverlay = ConfettiOverlay;
    else if (layoutType === 'counter' || layoutType === 'number-slam') EffectOverlay = SparkleOverlay;
    else if (layoutType === 'emphasis-box' && layoutProps.variant === 'check') EffectOverlay = CheckmarkDraw;

    return (
      <AbsoluteFill>
        <AbsoluteFill
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-start',
            padding: `${topPadding}px 72px 120px`,
          }}
        >
          <LayoutComponent
            text={scene.text}
            startFrame={0}
            preset={preset}
            designTokens={tokens}
            {...layoutProps}
          />
        </AbsoluteFill>
        {EffectOverlay && <EffectOverlay preset={preset} startFrame={5} />}
        <LottieOverlay layoutType={layoutType} section={section} />
      </AbsoluteFill>
    );
  }

  return (
    <SceneCard
      text={scene.text}
      section={scene.section || 'point'}
      sceneIndex={sceneIndex}
      totalScenes={totalScenes}
      preset={preset}
      imageUrl={scene.imageUrl}
      cameraMotion={cameraMotion}
      subtitle={subtitle}
      textPosition={textPosition}
      badge={scene.badge}
      ctaButtonText={scene.ctaButtonText}
      isFirst={scene.isFirst}
    />
  );
}
