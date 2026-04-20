import React from 'react';
import {
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  spring,
} from 'remotion';
import { buildSubtitleStyle } from './styles.js';

/**
 * KineticSubtitle — 프리셋 `kinetic` 값에 따라 자막에 애니메이션 적용.
 *
 * Remotion 프레임 기반으로 동작하므로 반드시 scene Sequence 내부에서 호출.
 * (useCurrentFrame 은 현재 sequence 내 local frame 반환)
 *
 * kinetic 4종:
 *  - static       : 움직임 없음 (기본)
 *  - light        : fade-in + 살짝 위로 슬라이드 (8프레임)
 *  - heavy        : scale bounce + spring 등장
 *  - word-by-word : 단어를 하나씩 순차 페이드인 (karaoke-lite)
 *
 * Props:
 *  - subtitle      : { text, color, size, font, bgColor, bgOpacity, position?, noShadow? }
 *  - kinetic       : 'static'|'light'|'heavy'|'word-by-word'  (기본 static)
 *  - textPosition  : buildSubtitleStyle 의 sizeBoost 계산용
 *  - enterFrame    : 애니메이션 시작 프레임 (기본 0 — sequence local)
 *
 * return null if subtitle/subtitle.text 없음.
 */
export function KineticSubtitle({
  subtitle,
  kinetic = 'static',
  textPosition,
  enterFrame = 0,
}) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  if (!subtitle || !subtitle.text) return null;

  const baseStyle = buildSubtitleStyle(subtitle, textPosition);
  if (!baseStyle) return null;

  // static — 애니메이션 없이 즉시 표시
  if (kinetic === 'static') {
    return <div style={baseStyle}>{subtitle.text}</div>;
  }

  // light — fade-in + y 슬라이드 (8프레임)
  if (kinetic === 'light') {
    const opacity = interpolate(
      frame,
      [enterFrame, enterFrame + 8],
      [0, 1],
      { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
    );
    const y = interpolate(
      frame,
      [enterFrame, enterFrame + 10],
      [12, 0],
      { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
    );
    return (
      <div
        style={{
          ...baseStyle,
          opacity,
          transform: `translateY(${y}px)`,
        }}
      >
        {subtitle.text}
      </div>
    );
  }

  // heavy — spring scale + overshoot
  if (kinetic === 'heavy') {
    const scaleSpring = spring({
      frame: frame - enterFrame,
      fps,
      config: { damping: 12, stiffness: 180, mass: 0.6 },
    });
    const scale = 0.7 + 0.3 * scaleSpring;
    const opacity = interpolate(
      frame,
      [enterFrame, enterFrame + 4],
      [0, 1],
      { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
    );
    return (
      <div
        style={{
          ...baseStyle,
          opacity,
          transform: `scale(${scale})`,
          transformOrigin: 'center',
        }}
      >
        {subtitle.text}
      </div>
    );
  }

  // word-by-word — 각 단어를 순차 페이드인
  if (kinetic === 'word-by-word') {
    const words = String(subtitle.text).split(/(\s+)/); // 공백 보존
    const FRAMES_PER_WORD = 3;
    return (
      <div style={baseStyle}>
        {words.map((w, i) => {
          if (/^\s+$/.test(w)) return <span key={i}>{w}</span>;
          const wordStart = enterFrame + Math.floor(i / 2) * FRAMES_PER_WORD;
          const op = interpolate(
            frame,
            [wordStart, wordStart + 4],
            [0, 1],
            { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
          );
          return (
            <span
              key={i}
              style={{ opacity: op, display: 'inline-block' }}
            >
              {w}
            </span>
          );
        })}
      </div>
    );
  }

  // fallback (알 수 없는 kinetic) → static
  return <div style={baseStyle}>{subtitle.text}</div>;
}

export default KineticSubtitle;
