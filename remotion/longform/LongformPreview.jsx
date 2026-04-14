import { ShortformComposition, buildShortformTimeline } from '../shortform/ShortformComposition.jsx';
import { LongformComposition, buildLongformTimeline } from './LongformComposition.jsx';

/**
 * v2.1 — contentType에 따라 Shortform / Longform Composition을 자동 선택.
 *
 * Props:
 * - contentType: 'shortform' (기본) | 'longform'
 * - ...rest: 각 composition에 그대로 전달
 *
 * ShortformClient 의 Player는 이 wrapper를 지정하거나,
 * contentType==='longform' 일 때 직접 LongformComposition을 import 해서 쓰면 됨.
 */
export const LongformPreview = (props) => {
  if (props?.contentType === 'longform') {
    return <LongformComposition {...props} />;
  }
  return <ShortformComposition {...props} />;
};

/**
 * 타임라인 계산 — contentType 에 따라 적절한 빌더 호출.
 * Player의 durationInFrames 산출에 사용.
 */
export function buildPreviewTimeline(props) {
  if (props?.contentType === 'longform') {
    return buildLongformTimeline(props);
  }
  return buildShortformTimeline(props);
}
