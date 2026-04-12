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

export const KenBurnsImage = ({ src, overlay = 0.35, seed = 'default' }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const preset = pickPreset(seed || src || 'default');

  const progress = frame / durationInFrames;
  const scale = interpolate(progress, [0, 1], [preset.scaleFrom, preset.scaleTo]);
  const x = interpolate(progress, [0, 1], [preset.xFrom, preset.xTo]);
  const y = interpolate(progress, [0, 1], [preset.yFrom, preset.yTo]);

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
