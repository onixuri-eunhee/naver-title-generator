import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';
import { noise2D } from '@remotion/noise';
import { seededRand } from './utils';

const PARTICLE_COUNT = 12;

const Particles = ({ color }) => {
  const frame = useCurrentFrame();
  const { height } = useVideoConfig();
  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      {Array.from({ length: PARTICLE_COUNT }, (_, i) => {
        const size = 20 + seededRand(i, 1) * 60;
        const xPercent = seededRand(i, 2) * 100;
        const duration = 300 + seededRand(i, 3) * 200;
        const startOffset = seededRand(i, 4) * 500;
        const progress = ((frame + startOffset) % duration) / duration;
        const y = height + size - progress * (height + size * 2);
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: `${xPercent}%`,
              top: y,
              width: size,
              height: size,
              borderRadius: '50%',
              backgroundColor: color,
            }}
          />
        );
      })}
    </AbsoluteFill>
  );
};

const MeshCircles = ({ meshCircles }) => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      {meshCircles.map((m, i) => {
        const dx = noise2D(`${m.seed}-x`, frame / 60, 0) * 30;
        const dy = noise2D(`${m.seed}-y`, 0, frame / 60) * 30;
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: m.left,
              top: m.top,
              width: m.size,
              height: m.size,
              borderRadius: '50%',
              backgroundColor: m.color,
              opacity: m.opacity,
              filter: `blur(${m.blur}px)`,
              transform: `translate(${dx}px, ${dy}px)`,
            }}
          />
        );
      })}
    </AbsoluteFill>
  );
};

const NoiseTexture = () => (
  <svg
    width="100%"
    height="100%"
    style={{
      position: 'absolute',
      inset: 0,
      opacity: 0.03,
      mixBlendMode: 'multiply',
      pointerEvents: 'none',
    }}
  >
    <filter id="noise-filter">
      <feTurbulence
        type="fractalNoise"
        baseFrequency="0.85"
        numOctaves={3}
        stitchTiles="stitch"
      />
    </filter>
    <rect width="100%" height="100%" filter="url(#noise-filter)" />
  </svg>
);

export const BackgroundLayer = ({ colors, meshCircles, children }) => {
  const frame = useCurrentFrame();
  const shakeX = noise2D('shake-x', frame / 30, 0) * 3;
  const shakeY = noise2D('shake-y', 0, frame / 30) * 3;

  return (
    <AbsoluteFill
      style={{
        backgroundImage: `linear-gradient(135deg, ${colors.bgBase} 0%, ${colors.bgSecondary} 50%, ${colors.bgTertiary} 100%)`,
        boxShadow: 'inset 0 0 200px rgba(0, 0, 0, 0.05)',
        overflow: 'hidden',
      }}
    >
      <MeshCircles meshCircles={meshCircles} />
      <Particles color={colors.particle} />
      <NoiseTexture />
      <AbsoluteFill
        style={{
          transform: `translate(${shakeX}px, ${shakeY}px)`,
        }}
      >
        {children}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
