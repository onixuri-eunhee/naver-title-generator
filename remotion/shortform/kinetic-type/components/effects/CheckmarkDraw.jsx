import { useCurrentFrame, interpolate } from 'remotion';
import { resolveColors } from '../../styles';

/**
 * CheckmarkDraw — animated SVG checkmark with circle border.
 *
 * Circle draws in first (frames 0-15), then checkmark draws left-to-right (frames 10-30).
 * Uses strokeDashoffset animation. Deterministic, no randomness needed.
 */
export const CheckmarkDraw = ({
  preset,
  startFrame = 0,
  size = 80,
}) => {
  const frame = useCurrentFrame();
  const f = frame - startFrame;
  if (f < 0) return null;

  const colors = resolveColors(preset);
  const strokeWidth = Math.max(size * 0.08, 3);

  // Circle: circumference for dasharray/dashoffset
  const radius = size * 0.42;
  const circumference = 2 * Math.PI * radius;
  const circleProgress = interpolate(f, [0, 15], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const circleOffset = circumference * (1 - circleProgress);

  // Checkmark path length (approximate for the viewBox-relative path)
  const checkPathLength = 60;
  const checkProgress = interpolate(f, [10, 30], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const checkOffset = checkPathLength * (1 - checkProgress);

  return (
    <div
      style={{
        position: 'absolute',
        width: size,
        height: size,
        pointerEvents: 'none',
      }}
    >
      <svg
        viewBox="0 0 100 100"
        width={size}
        height={size}
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* Circle border */}
        <circle
          cx="50"
          cy="50"
          r={42}
          stroke={colors.coralLight}
          strokeWidth={strokeWidth / (size / 100)}
          strokeDasharray={circumference}
          strokeDashoffset={circleOffset}
          strokeLinecap="round"
          transform="rotate(-90 50 50)"
        />
        {/* Checkmark */}
        <path
          d="M28 52 L44 68 L72 36"
          stroke={colors.coral}
          strokeWidth={(strokeWidth * 1.2) / (size / 100)}
          strokeDasharray={checkPathLength}
          strokeDashoffset={checkOffset}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
};
