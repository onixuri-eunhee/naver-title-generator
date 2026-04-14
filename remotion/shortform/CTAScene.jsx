import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import { FONTS, RADIUS, SIZES, SPRING_CONFIG, buildSubtitleStyle } from './styles';
import { breathe } from './utils';

export const CTAScene = ({
  headline,
  buttonText,
  subtext,
  preset,
  subtitle,
  textPosition,
}) => {
  const subtitleStyle = buildSubtitleStyle(subtitle, textPosition);
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { colors } = preset;

  const bgIn = spring({ frame: frame - 15, fps, config: SPRING_CONFIG });
  const logoIn = spring({ frame: frame - 25, fps, config: SPRING_CONFIG });
  const textIn = spring({ frame: frame - 35, fps, config: SPRING_CONFIG });
  const arrowIn = spring({ frame: frame - 45, fps, config: SPRING_CONFIG });

  const logoScale = interpolate(logoIn, [0, 1], [0.6, 1]);
  const textY = interpolate(textIn, [0, 1], [40, 0]);
  const arrowX = interpolate(arrowIn, [0, 1], [-30, 0]);
  const bgScale = interpolate(bgIn, [0, 1], [0.85, 1]);
  const breath = breathe(frame);

  const headlineLines = (headline || '').split('\n');

  return (
    <AbsoluteFill
      style={{
        justifyContent: 'center',
        alignItems: 'center',
        padding: 80,
      }}
    >
      <div
        style={{
          transform: `scale(${bgScale})`,
          opacity: bgIn,
          backgroundColor: colors.accent,
          borderRadius: RADIUS.large,
          padding: '80px 60px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 32,
          width: '100%',
          boxShadow: `0 30px 90px ${colors.accent}59, 0 12px 36px ${colors.accent}33`,
        }}
      >
        {subtext && (
          <div
            style={{
              opacity: logoIn,
              transform: `scale(${logoScale * breath})`,
              fontFamily: FONTS.primary,
              fontWeight: FONTS.weight.black,
              fontSize: SIZES.ctaBrand,
              color: colors.textPrimary,
              letterSpacing: -0.5,
            }}
          >
            {subtext}
          </div>
        )}
        <div
          style={{
            opacity: textIn,
            transform: `translateY(${textY}px) scale(${breath})`,
            fontFamily: FONTS.primary,
            fontWeight: FONTS.weight.bold,
            fontSize: SIZES.ctaHeadline,
            color: colors.white,
            textAlign: 'center',
            lineHeight: 1.2,
            letterSpacing: -0.5,
            // Phase F — subtitle override
            ...(subtitleStyle || {}),
          }}
        >
          {headlineLines.map((line, i) => (
            <div key={i}>{line}</div>
          ))}
        </div>
        {buttonText && (
          <div
            style={{
              opacity: arrowIn,
              transform: `translateX(${arrowX}px) scale(${breath})`,
              marginTop: 16,
              fontFamily: FONTS.primary,
              fontWeight: FONTS.weight.black,
              fontSize: SIZES.ctaButton,
              color: colors.textPrimary,
              backgroundColor: colors.white,
              padding: '22px 52px',
              borderRadius: RADIUS.full,
              boxShadow: `0 0 48px 12px ${colors.accentLight}8c, 0 8px 24px ${colors.accent}4d`,
            }}
          >
            {buttonText}
          </div>
        )}
      </div>
    </AbsoluteFill>
  );
};
