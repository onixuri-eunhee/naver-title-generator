import { AbsoluteFill } from 'remotion';

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

export const BackgroundLayer = ({ colors, children }) => {
  return (
    <AbsoluteFill
      style={{
        backgroundImage: `linear-gradient(160deg, ${colors.bgBase} 0%, ${colors.bgSecondary} 100%)`,
        overflow: 'hidden',
      }}
    >
      <NoiseTexture />
      <AbsoluteFill>
        {children}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
