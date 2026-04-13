/**
 * 키네틱 타이포그래피 헬퍼
 *
 * Remotion 스프링/보간을 활용한 텍스트 애니메이션 5가지 변형.
 * 프리셋의 kineticHook / kineticBody 필드로 선택.
 *
 * 각 함수: getXxxStyle(text, frame, fps, delay) → { containerStyle, charStyle(i, total) }
 * 사용처에서 텍스트를 char/word 단위로 분할 후 charStyle 적용.
 */

import { interpolate, spring } from 'remotion';

const SPRING = { damping: 200 };

// ─────────────────────────────────────────────────────
// 1. wordReveal — 단어 단위로 stagger fade-in + slide up
// ─────────────────────────────────────────────────────
export function getWordRevealStyle(frame, fps, delay = 0, wordIndex = 0) {
  const wordDelay = delay + wordIndex * 4; // 4프레임씩 stagger
  const progress = spring({ frame: frame - wordDelay, fps, config: SPRING });
  const y = interpolate(progress, [0, 1], [50, 0]);
  return {
    display: 'inline-block',
    opacity: progress,
    transform: `translateY(${y}px)`,
    marginRight: '0.25em',
  };
}

// ─────────────────────────────────────────────────────
// 2. scaleBounce — 전체 스케일 0.4 → 1 + 약간 회전
// ─────────────────────────────────────────────────────
export function getScaleBounceStyle(frame, fps, delay = 0) {
  const progress = spring({
    frame: frame - delay,
    fps,
    config: { damping: 12, stiffness: 120, mass: 0.6 },
  });
  const scale = interpolate(progress, [0, 1], [0.4, 1]);
  const rotate = interpolate(progress, [0, 1], [-3, 0]);
  return {
    opacity: Math.min(progress * 1.5, 1),
    transform: `scale(${scale}) rotate(${rotate}deg)`,
    transformOrigin: 'center',
  };
}

// ─────────────────────────────────────────────────────
// 3. slideUpMask — 마스크 처리된 슬라이드 업 (영화 자막 느낌)
// ─────────────────────────────────────────────────────
export function getSlideUpMaskStyle(frame, fps, delay = 0) {
  const progress = spring({ frame: frame - delay, fps, config: SPRING });
  const y = interpolate(progress, [0, 1], [80, 0]);
  // clipPath으로 아래에서 위로 마스크 reveal
  const clip = interpolate(progress, [0, 1], [100, 0]);
  return {
    transform: `translateY(${y}px)`,
    clipPath: `inset(${clip}% 0 0 0)`,
    WebkitClipPath: `inset(${clip}% 0 0 0)`,
  };
}

// ─────────────────────────────────────────────────────
// 4. typewriter — 글자 단위로 visibility 토글 (타자기)
// ─────────────────────────────────────────────────────
export function getTypewriterCharStyle(frame, fps, delay = 0, charIndex = 0, total = 1) {
  const charsPerSecond = 18;
  const startFrame = delay + (charIndex * fps) / charsPerSecond;
  const visible = frame >= startFrame;
  const lastChar = charIndex === total - 1;
  // 마지막 글자에 커서 효과
  return {
    opacity: visible ? 1 : 0,
    borderRight: lastChar && visible ? '4px solid currentColor' : 'none',
    paddingRight: lastChar ? 4 : 0,
  };
}

// ─────────────────────────────────────────────────────
// 5. wave — 글자별 sine wave (파도)
// ─────────────────────────────────────────────────────
export function getWaveCharStyle(frame, fps, delay = 0, charIndex = 0) {
  const phase = (frame - delay - charIndex * 2) / 8;
  const intro = spring({
    frame: frame - delay - charIndex * 2,
    fps,
    config: SPRING,
  });
  const y = Math.sin(phase) * 8 + interpolate(intro, [0, 1], [40, 0]);
  return {
    display: 'inline-block',
    opacity: intro,
    transform: `translateY(${y}px)`,
  };
}

// ─────────────────────────────────────────────────────
// 6. rotate3d — Y축 회전 fly-in
// ─────────────────────────────────────────────────────
export function getRotate3dStyle(frame, fps, delay = 0) {
  const progress = spring({
    frame: frame - delay,
    fps,
    config: { damping: 14, stiffness: 110, mass: 0.7 },
  });
  const rotateY = interpolate(progress, [0, 1], [-90, 0]);
  const opacity = Math.min(progress * 2, 1);
  return {
    opacity,
    transform: `perspective(1200px) rotateY(${rotateY}deg)`,
    transformOrigin: 'left center',
  };
}

// ─────────────────────────────────────────────────────
// KineticText 컴포넌트 — 변형별 텍스트 렌더
// ─────────────────────────────────────────────────────
/**
 * variant: 'wordReveal' | 'scaleBounce' | 'slideUpMask' | 'typewriter' | 'wave' | 'rotate3d'
 * text: string (줄바꿈 \n 허용)
 * frame, fps: Remotion current frame + fps
 * delay: 시작 지연 프레임 수
 * baseStyle: 외부 텍스트 스타일 (font/color/size/align)
 */
export function KineticText({ variant, text, frame, fps, delay = 0, baseStyle = {} }) {
  const lines = (text || '').split('\n');
  const safeVariant = variant || 'wordReveal';

  // ── Container-level 애니메이션 (scaleBounce / slideUpMask / rotate3d) ──
  if (safeVariant === 'scaleBounce' || safeVariant === 'slideUpMask' || safeVariant === 'rotate3d') {
    const getStyle =
      safeVariant === 'scaleBounce'
        ? getScaleBounceStyle
        : safeVariant === 'slideUpMask'
          ? getSlideUpMaskStyle
          : getRotate3dStyle;
    return (
      <div style={baseStyle}>
        {lines.map((line, i) => (
          <div key={i} style={getStyle(frame, fps, delay + i * 6)}>
            {line || '\u00a0'}
          </div>
        ))}
      </div>
    );
  }

  // ── 단어 단위 (wordReveal) ──
  if (safeVariant === 'wordReveal') {
    let globalWordIdx = 0;
    return (
      <div style={baseStyle}>
        {lines.map((line, i) => {
          const words = line.split(' ');
          const lineStartIdx = globalWordIdx;
          globalWordIdx += words.length;
          return (
            <div key={i}>
              {words.map((word, wi) => (
                <span key={wi} style={getWordRevealStyle(frame, fps, delay, lineStartIdx + wi)}>
                  {word}
                </span>
              ))}
            </div>
          );
        })}
      </div>
    );
  }

  // ── 글자 단위 (typewriter / wave) ──
  if (safeVariant === 'typewriter' || safeVariant === 'wave') {
    const totalChars = lines.join('').length;
    let globalCharIdx = 0;
    return (
      <div style={baseStyle}>
        {lines.map((line, li) => (
          <div key={li}>
            {line.split('').map((ch, ci) => {
              const idx = globalCharIdx++;
              const charStyle =
                safeVariant === 'typewriter'
                  ? getTypewriterCharStyle(frame, fps, delay, idx, totalChars)
                  : getWaveCharStyle(frame, fps, delay, idx);
              return (
                <span key={ci} style={charStyle}>
                  {ch === ' ' ? '\u00a0' : ch}
                </span>
              );
            })}
          </div>
        ))}
      </div>
    );
  }

  // 기본 fallback
  return (
    <div style={baseStyle}>
      {lines.map((line, i) => (
        <div key={i}>{line || '\u00a0'}</div>
      ))}
    </div>
  );
}

export const KINETIC_VARIANTS = [
  'wordReveal',
  'scaleBounce',
  'slideUpMask',
  'typewriter',
  'wave',
  'rotate3d',
];
