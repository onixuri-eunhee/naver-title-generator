import { AbsoluteFill, Img, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';

/**
 * 이미지에 Ken Burns 효과 적용 — 천천히 scale 1.0 → 1.15 + 카메라 팬
 *
 * 프리셋 4종 중 seed로 자동 선택 (부드러운 변주)
 */
const KEN_BURNS_PRESETS = [
  { scaleFrom: 1.0, scaleTo: 1.15, xFrom: 0, xTo: -30, yFrom: 0, yTo: -20 },
  { scaleFrom: 1.15, scaleTo: 1.0, xFrom: -20, xTo: 20, yFrom: -15, yTo: 15 },
  { scaleFrom: 1.0, scaleTo: 1.12, xFrom: 20, xTo: -10, yFrom: 10, yTo: -10 },
  { scaleFrom: 1.08, scaleTo: 1.0, xFrom: -15, xTo: 15, yFrom: 15, yTo: -15 },
];

function pickPreset(seedString) {
  let hash = 0;
  for (let i = 0; i < seedString.length; i++) {
    hash = (hash * 31 + seedString.charCodeAt(i)) | 0;
  }
  const idx = Math.abs(hash) % KEN_BURNS_PRESETS.length;
  return KEN_BURNS_PRESETS[idx];
}

/**
 * KenBurnsImage 4종 카메라 모션 지원
 * Props:
 * - src: string
 * - overlay: number (0~1)
 * - seed: string (ken-burns 변형 선택용)
 * - cameraMotion?: 'static'|'ken-burns'|'zoom-in'|'pan'  (기본 ken-burns — 하위 호환)
 */
export const KenBurnsImage = ({ src, overlay = 0.35, seed = 'default', cameraMotion = 'ken-burns' }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const kbPreset = pickPreset(seed || src || 'default');

  const progress = frame / durationInFrames;

  let scale = 1;
  let x = 0;
  let y = 0;

  switch (cameraMotion) {
    case 'static':
      scale = 1;
      break;
    case 'zoom-in':
      scale = interpolate(progress, [0, 1], [1.0, 1.25]);
      break;
    case 'pan':
      x = interpolate(progress, [0, 1], [-40, 40]);
      scale = 1.1;
      break;
    case 'ken-burns':
    default:
      scale = interpolate(progress, [0, 1], [kbPreset.scaleFrom, kbPreset.scaleTo]);
      x = interpolate(progress, [0, 1], [kbPreset.xFrom, kbPreset.xTo]);
      y = interpolate(progress, [0, 1], [kbPreset.yFrom, kbPreset.yTo]);
      break;
  }

  return (
    <AbsoluteFill style={{ overflow: 'hidden' }}>
      <Img
        src={src}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          transform: `scale(${scale}) translate(${x}px, ${y}px)`,
          transformOrigin: 'center center',
        }}
      />
      {overlay > 0 && (
        <AbsoluteFill
          style={{
            background: `linear-gradient(180deg, rgba(0,0,0,${overlay * 0.6}) 0%, rgba(0,0,0,${overlay}) 100%)`,
            pointerEvents: 'none',
          }}
        />
      )}
    </AbsoluteFill>
  );
};
