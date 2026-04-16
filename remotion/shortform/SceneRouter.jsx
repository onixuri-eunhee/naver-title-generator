/**
 * SceneRouter — scene.layoutType 기반 동적 컴포넌트 라우팅.
 *
 * SceneSequenceComposition이 각 씬을 렌더할 때, layoutType이 있으면
 * KineticType 시각화 컴포넌트로 분기하고, 없으면 기존 SceneCard fallback.
 *
 * layoutType → 컴포넌트 매핑은 LAYOUT_REGISTRY에서 관리.
 * 새 레이아웃 추가 시 여기 1줄 + 컴포넌트 파일 1개만 추가.
 */

import { SceneCard } from './SceneCard';
import { BigImpactText } from './kinetic-type/components/BigImpactText';
import { BulletList } from './kinetic-type/components/BulletList';
import { ComparisonColumns } from './kinetic-type/components/ComparisonColumns';
import { EmphasisBox } from './kinetic-type/components/EmphasisBox';
import { GiantNumberCounter } from './kinetic-type/components/GiantNumberCounter';
import { IconWithLabel } from './kinetic-type/components/IconWithLabel';
import { ProgressBarBlock } from './kinetic-type/components/ProgressBarBlock';
import { SmallLabel } from './kinetic-type/components/SmallLabel';
import { SubtitleBar } from './kinetic-type/components/SubtitleBar';
import { VerticalBarText } from './kinetic-type/components/VerticalBarText';

const LAYOUT_REGISTRY = {
  'big-impact-text': BigImpactText,
  'bullet-list': BulletList,
  'comparison': ComparisonColumns,
  'emphasis-box': EmphasisBox,
  'counter': GiantNumberCounter,
  'icon-label': IconWithLabel,
  'progress-bar': ProgressBarBlock,
  'small-label': SmallLabel,
  'subtitle-bar': SubtitleBar,
  'vertical-bar': VerticalBarText,
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
}) {
  const layoutType = scene?.layoutType;
  const LayoutComponent = layoutType ? LAYOUT_REGISTRY[layoutType] : null;

  if (LayoutComponent) {
    const layoutProps = scene.layoutProps || {};
    return (
      <LayoutComponent
        text={scene.text}
        startFrame={0}
        preset={preset}
        {...layoutProps}
      />
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
