import React from 'react';
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';

const TEMPLATES = {
  'dark-gradient': {
    background: 'linear-gradient(160deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)',
    color: '#ffffff',
    fontFamily: '"Noto Sans KR", sans-serif',
    fontWeight: 900,
    animation: 'fadeSlideUp',
  },
  'white-clean': {
    background: '#fafafa',
    color: '#111111',
    fontFamily: '"Noto Sans KR", sans-serif',
    fontWeight: 700,
    animation: 'typing',
    accent: '#111111',
  },
  'bold-accent': {
    background: '#222222',
    color: '#ffffff',
    fontFamily: '"Noto Sans KR", sans-serif',
    fontWeight: 900,
    animation: 'scaleBounce',
    accent: '#ff5f1f',
  },
  'soft-overlay': {
    background: 'linear-gradient(170deg, #f5f0e8 0%, #e8e0d0 100%)',
    color: '#4a3728',
    fontFamily: '"Noto Serif KR", "Noto Sans KR", serif',
    fontWeight: 600,
    animation: 'softFade',
  },
};

function splitTextLines(text) {
  if (!text) return [''];
  var maxChars = 8;
  var words = text.split('');
  var lines = [];
  var current = '';
  for (var i = 0; i < words.length; i++) {
    if (current.length >= maxChars) {
      lines.push(current);
      current = '';
    }
    current += words[i];
  }
  if (current) lines.push(current);
  return lines.length ? lines : [text];
}

export const TextCard = ({ template, text, durationInFrames }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = TEMPLATES[template] || TEMPLATES['dark-gradient'];
  const lines = splitTextLines(text);
  const totalLen = (text || '').length;
  const fontSize = totalLen <= 8 ? 96 : totalLen <= 12 ? 84 : totalLen <= 16 ? 72 : 64;

  let opacity = 1;
  let translateY = 0;
  let scale = 1;

  if (t.animation === 'fadeSlideUp') {
    opacity = interpolate(frame, [0, 15], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
    translateY = interpolate(frame, [0, 15], [30, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  } else if (t.animation === 'scaleBounce') {
    var s = spring({ fps, frame, config: { damping: 12, stiffness: 200, mass: 0.8 } });
    scale = interpolate(s, [0, 1], [0.7, 1]);
    opacity = interpolate(frame, [0, 8], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  } else if (t.animation === 'softFade') {
    opacity = interpolate(frame, [0, 20], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  } else if (t.animation === 'typing') {
    opacity = interpolate(frame, [0, 10], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  }

  // fade out
  var fadeOut = interpolate(frame, [Math.max(0, durationInFrames - 10), durationInFrames], [1, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });
  opacity = Math.min(opacity, fadeOut);

  return (
    <AbsoluteFill style={{ background: t.background, justifyContent: 'center', alignItems: 'center', padding: '0 80px' }}>
      <div style={{
        opacity,
        transform: `translateY(${translateY}px) scale(${scale})`,
        textAlign: 'center',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}>
        {lines.map((line, i) => (
          <div key={i} style={{
            fontFamily: t.fontFamily,
            fontWeight: t.fontWeight,
            fontSize,
            lineHeight: 1.2,
            color: i === 0 && t.accent ? t.accent : t.color,
          }}>
            {line}
          </div>
        ))}
      </div>
    </AbsoluteFill>
  );
};
