import { interpolate, useCurrentFrame } from "remotion";
import { resolveColors } from "../styles";

export const ConnectingNetwork = ({
  nodes,
  edges,
  startFrame = 0,
  staggerInFrames = 8,
  fadeInFrames = 20,
  width,
  height,
  x = 0,
  y = 0,
  nodeRadius = 5,
  nodeColor,
  edgeColor,
  edgeWidth = 1.2,
  preset,
}) => {
  const colors = resolveColors(preset);
  const frame = useCurrentFrame();
  const resolvedNodeColor = nodeColor || colors.coral;
  const resolvedEdgeColor = edgeColor || colors.coralLight;

  return (
    <svg
      width={width}
      height={height}
      style={{ position: "absolute", left: x, top: y, pointerEvents: "none" }}
    >
      {edges.map((e, i) => {
        const a = nodes[e[0]];
        const b = nodes[e[1]];
        const appearAt =
          startFrame + Math.max(e[0], e[1]) * staggerInFrames + 4;
        const op = interpolate(
          frame,
          [appearAt, appearAt + fadeInFrames],
          [0, 0.9],
          { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
        );
        return (
          <line
            key={`e-${i}`}
            x1={a.x}
            y1={a.y}
            x2={b.x}
            y2={b.y}
            stroke={resolvedEdgeColor}
            strokeWidth={edgeWidth}
            opacity={op}
          />
        );
      })}
      {nodes.map((n, i) => {
        const appearAt = startFrame + i * staggerInFrames;
        const op = interpolate(
          frame,
          [appearAt, appearAt + fadeInFrames],
          [0, 1],
          { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
        );
        const r = interpolate(
          frame,
          [appearAt, appearAt + fadeInFrames],
          [0, nodeRadius],
          { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
        );
        return (
          <circle
            key={`n-${i}`}
            cx={n.x}
            cy={n.y}
            r={r}
            fill={resolvedNodeColor}
            opacity={op}
          />
        );
      })}
    </svg>
  );
};
