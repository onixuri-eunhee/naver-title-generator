import { useCurrentFrame, spring, interpolate } from 'remotion';
import { resolveColors } from '../../styles';
import { SHORTFORM_FPS } from '../../../styles';

/**
 * Deterministic seeded random.
 */
function seededRandom(seed) {
  const x = Math.sin(seed * 9301 + 49297) * 233280;
  return x - Math.floor(x);
}

/**
 * SparkleOverlay — pulsing diamond sparkles for number-slam / counter scenes.
 *
 * 8-12 small diamond shapes that scale+fade in and out with staggered timing.
 * Positioned around center 60% of frame. Deterministic.
 */
export const SparkleOverlay = ({
  preset,
  startFrame = 0,
  count = 10,
}) => {
  const frame = useCurrentFrame();
  const f = frame - startFrame;
  if (f < 0) return null;

  const colors = resolveColors(preset);
  const fps = SHORTFORM_FPS;

  const sparkles = Array.from({ length: count }, (_, i) => {
    const r = seededRandom;
    // Center 60% = x: 216..864, y: 384..1536
    const cx = 216 + r(i * 5 + 1) * 648;
    const cy = 384 + r(i * 5 + 2) * 1152;
    const size = 8 + r(i * 5 + 3) * 12;
    const delay = Math.floor(r(i * 5 + 4) * 20); // stagger up to 20 frames
    const color = i % 2 === 0 ? colors.coral : colors.coralLight;

    const localF = f - delay;
    if (localF < 0) return null;

    // spring for scale pulse — cycles via modulo
    const cycleDuration = 30;
    const cyclePos = localF % cycleDuration;
    const scaleUp = cyclePos < cycleDuration / 2;

    const scale = spring({
      frame: scaleUp ? cyclePos : cycleDuration - cyclePos,
      fps,
      config: { damping: 12, stiffness: 150 },
    });

    const opacity = interpolate(scale, [0, 1], [0, 1], {
      extrapolateRight: 'clamp',
    });

    return (
      <div
        key={i}
        style={{
          position: 'absolute',
          left: cx - size / 2,
          top: cy - size / 2,
          width: size,
          height: size,
          backgroundColor: color,
          opacity,
          transform: `rotate(45deg) scale(${scale})`,
        }}
      />
    );
  });

  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: 1080,
        height: 1920,
        pointerEvents: 'none',
      }}
    >
      {sparkles}
    </div>
  );
};
