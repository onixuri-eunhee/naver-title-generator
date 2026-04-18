import { useCurrentFrame, interpolate } from 'remotion';
import { resolveColors } from '../../styles.js';

/**
 * Deterministic seeded random — index-based, no Math.random().
 * Returns value in [0, 1).
 */
function seededRandom(seed) {
  const x = Math.sin(seed * 9301 + 49297) * 233280;
  return x - Math.floor(x);
}

/**
 * ConfettiOverlay — particle burst for CTA / celebration scenes.
 *
 * 30-40 small colored shapes burst from center, spread outward, and fall
 * with simulated gravity. Fully deterministic for Remotion rendering.
 */
export const ConfettiOverlay = ({
  preset,
  startFrame = 0,
  // Phase 2 (2026-04-18): 35→14로 축소. "유함" 피드백 반영 (성숙한 톤).
  particleCount = 14,
}) => {
  const frame = useCurrentFrame();
  const f = frame - startFrame;
  if (f < 0) return null;

  const colors = resolveColors(preset);
  // 브랜드 코랄 전용 — white/gray 제거해 난잡함 감소
  const palette = [colors.coral, colors.coralLight];
  const FADE_DURATION = 45;
  const GRAVITY = 0.12;

  const particles = Array.from({ length: particleCount }, (_, i) => {
    const r = seededRandom;
    const angle = r(i * 7 + 1) * Math.PI * 2;
    const speed = 3 + r(i * 7 + 2) * 5;       // 4+8 → 3+5 (더 부드러운 확산)
    const rotSpeed = (r(i * 7 + 3) - 0.5) * 8;  // 12 → 8
    const size = 4 + r(i * 7 + 4) * 6;          // 6+10 → 4+6 (더 미니멀)
    const isCircle = r(i * 7 + 5) > 0.5;
    const color = palette[Math.floor(r(i * 7 + 6) * palette.length)];

    // Position: burst from center (540, 960)
    const vx = Math.cos(angle) * speed;
    const vy = Math.sin(angle) * speed;
    const x = 540 + vx * f;
    const y = 960 + vy * f + 0.5 * GRAVITY * f * f;
    const rotation = rotSpeed * f;

    // opacity 피크 1→0.75로 낮춤 (차분한 축하감)
    const opacity = interpolate(f, [0, 10, FADE_DURATION], [0, 0.75, 0], {
      extrapolateRight: 'clamp',
      extrapolateLeft: 'clamp',
    });

    if (opacity <= 0) return null;

    return (
      <div
        key={i}
        style={{
          position: 'absolute',
          left: x,
          top: y,
          width: size,
          height: isCircle ? size : size * 1.4,
          borderRadius: isCircle ? '50%' : 2,
          backgroundColor: color,
          opacity,
          transform: `rotate(${rotation}deg)`,
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
        overflow: 'hidden',
      }}
    >
      {particles}
    </div>
  );
};
