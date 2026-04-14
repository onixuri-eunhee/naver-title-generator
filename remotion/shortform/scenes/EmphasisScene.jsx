import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import {
  FONTS,
  RADIUS,
  SIZES,
  SPRING_CONFIG,
  buildSubtitleStyle,
} from '../styles';
import { breathe } from '../utils';

/**
 * EmphasisScene — 강조 박스 (중요 포인트, CTA 강조)
 *
 * Props:
 *  - title     (예: "지금 예약하면 30% 할인")
 *  - subtitle  (optional, 본문 subtitle 프롭과 별개 — emphasisSubtitle 겸용)
 *  - emphasisSub (optional, 예: "이벤트 7일 한정")
 *  - countdown (optional, 숫자)
 *  - preset, subtitle, textPosition
 *
 * 디자인:
 *  - 큰 둥근 accent 테두리 박스 중앙 정렬
 *  - subtle glow + pulse 애니메이션 (1.0 → 1.05 → 1.0)
 *  - ✨ sparkle 아이콘 상단
 *  - 선택적 카운트다운 하단
 */

export const EmphasisScene = ({
  title = '',
  emphasisSub = '',
  countdown,
  preset,
  subtitle,
  textPosition,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { colors } = preset;

  const boxIn = spring({ frame, fps, config: SPRING_CONFIG });
  const boxScale = interpolate(boxIn, [0, 1], [0.7, 1]);
  const subIn = spring({ frame: frame - 18, fps, config: SPRING_CONFIG });

  // Pulse (2초 주기: 60프레임)
  const pulse = 1 + 0.035 * Math.sin((2 * Math.PI * frame) / 60);
  const glowPulse = 0.6 + 0.4 * (0.5 + 0.5 * Math.sin((2 * Math.PI * frame) / 60));
  const sparkleY = Math.sin((2 * Math.PI * frame) / 45) * 6;

  const subtitleStyle = buildSubtitleStyle(subtitle, textPosition);

  return (
    <AbsoluteFill
      style={{
        justifyContent: 'center',
        alignItems: 'center',
        padding: 80,
        background: colors.bgBase,
      }}
    >
      {/* Background radial glow */}
      <div
        style={{
          position: 'absolute',
          width: 1200,
          height: 1200,
          borderRadius: '50%',
          background: `radial-gradient(circle, ${colors.accent}33 0%, transparent 60%)`,
          opacity: glowPulse,
          filter: 'blur(40px)',
        }}
      />

      <div
        style={{
          opacity: boxIn,
          transform: `scale(${boxScale * pulse})`,
          padding: '90px 80px',
          minWidth: 720,
          maxWidth: 900,
          background: `linear-gradient(135deg, ${colors.accent}22, ${colors.accent}11)`,
          border: `4px solid ${colors.accent}`,
          borderRadius: RADIUS.large,
          boxShadow: [
            `0 0 60px ${colors.accent}66`,
            `0 0 120px ${colors.accent}33`,
            `inset 0 0 40px ${colors.accent}18`,
          ].join(', '),
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 36,
          position: 'relative',
        }}
      >
        {/* Sparkle 아이콘 */}
        <div
          style={{
            fontSize: 72,
            transform: `translateY(${sparkleY}px)`,
            filter: `drop-shadow(0 0 20px ${colors.accent})`,
            lineHeight: 1,
          }}
        >
          ✨
        </div>

        <div
          style={{
            fontFamily: FONTS.primary,
            fontWeight: FONTS.weight.black,
            fontSize: 76,
            color: colors.textPrimary,
            textAlign: 'center',
            lineHeight: 1.2,
            letterSpacing: -1.5,
            textShadow: `0 4px 24px ${colors.accent}55`,
          }}
        >
          {title.split('\n').map((line, i) => (
            <div key={i}>{line}</div>
          ))}
        </div>

        {emphasisSub && (
          <div
            style={{
              opacity: subIn,
              fontFamily: FONTS.primary,
              fontWeight: FONTS.weight.bold,
              fontSize: 38,
              color: colors.accent,
              textAlign: 'center',
              padding: '14px 36px',
              background: `${colors.accent}15`,
              border: `2px solid ${colors.accent}55`,
              borderRadius: 100,
              letterSpacing: -0.3,
            }}
          >
            {emphasisSub}
          </div>
        )}

        {countdown != null && countdown !== '' && (
          <div
            style={{
              marginTop: 12,
              fontFamily: FONTS.primary,
              fontWeight: FONTS.weight.black,
              fontSize: 120,
              color: colors.accent,
              lineHeight: 0.9,
              letterSpacing: -4,
              fontVariantNumeric: 'tabular-nums',
              textShadow: `0 8px 32px ${colors.accent}88`,
            }}
          >
            {countdown}
          </div>
        )}
      </div>

      {subtitleStyle && subtitle?.text && (
        <div
          style={{
            position: 'absolute',
            bottom: 80,
            left: 0,
            right: 0,
            textAlign: 'center',
          }}
        >
          <div style={subtitleStyle}>{subtitle.text}</div>
        </div>
      )}
    </AbsoluteFill>
  );
};

export default EmphasisScene;
