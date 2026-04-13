import { interpolate, useCurrentFrame, useVideoConfig } from 'remotion';

export const ProgressBar = ({ color }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const pct = interpolate(frame, [0, durationInFrames], [0, 100], {
    extrapolateRight: 'clamp',
  });
  return (
    <div
      style={{
        position: 'absolute',
        bottom: 12,
        left: 0,
        width: `${pct}%`,
        height: 4,
        backgroundColor: color,
        pointerEvents: 'none',
      }}
    />
  );
};
