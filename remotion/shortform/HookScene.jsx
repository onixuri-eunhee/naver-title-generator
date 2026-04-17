import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import { FONTS, SIZES, SPRING_CONFIG, buildSubtitleStyle, textPositionToAlign } from './styles.js';
import { breathe } from './utils.js';
import { KenBurnsImage } from './KenBurnsImage.jsx';
import { KineticText } from './kineticText.js';

const CORNER_DOT_POSITIONS = [
  { top: 120, left: 120 },
  { top: 120, right: 120 },
  { bottom: 160, right: 120 },
];

export const HookScene = ({
  badge,
  title,
  underlineText,
  imageUrl,
  preset,
  subtitle,
  textPosition = 'center',
  cameraMotion,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { colors } = preset;

  const badgeIn = spring({ frame: frame - 10, fps, config: SPRING_CONFIG });
  const underlineIn = spring({ frame: frame - 20, fps, config: SPRING_CONFIG });

  const badgeY = interpolate(badgeIn, [0, 1], [40, 0]);
  const barWidth = interpolate(underlineIn, [0, 1], [0, 520]);
  const breath = breathe(frame);

  const kineticVariant = preset.kineticHook || 'wordReveal';

  // Phase F: subtitle override 스타일
  // 훅 제목은 항상 중앙 정렬 (textPosition은 자막에만 영향)
  const subtitleStyle = buildSubtitleStyle(subtitle, textPosition);

  return (
    <AbsoluteFill>
      {imageUrl && (
        <KenBurnsImage
          src={imageUrl}
          overlay={0.5}
          seed={`hook-${title}`}
          cameraMotion={cameraMotion}
        />
      )}
      <AbsoluteFill
        style={{
          justifyContent: 'center',
          alignItems: 'center',
          padding: 80,
        }}
      >
        {CORNER_DOT_POSITIONS.map((pos, i) => (
          <div
            key={i}
            style={{
              position: 'absolute',
              width: 8,
              height: 8,
              borderRadius: '50%',
              backgroundColor: colors.accent,
              opacity: 0.4,
              ...pos,
            }}
          />
        ))}
        {badge && (
          <div
            style={{
              opacity: badgeIn,
              transform: `translateY(${badgeY}px) scale(${breath})`,
              backgroundColor: colors.accent,
              color: colors.white,
              fontFamily: FONTS.primary,
              fontWeight: FONTS.weight.black,
              fontSize: SIZES.hookBadge,
              padding: '14px 32px',
              borderRadius: 100,
              marginBottom: 40,
              letterSpacing: 2,
              boxShadow: `0 8px 24px ${colors.accent}40`,
            }}
          >
            {badge}
          </div>
        )}
        <KineticText
          variant={kineticVariant}
          text={title || ''}
          frame={frame}
          fps={fps}
          delay={0}
          baseStyle={{
            fontFamily: FONTS.primary,
            fontWeight: FONTS.weight.black,
            fontSize: SIZES.hookTitle,
            color: imageUrl ? colors.white : colors.textPrimary,
            textAlign: 'center',
            lineHeight: 1.15,
            letterSpacing: -0.5,
            textShadow: imageUrl ? '0 8px 32px rgba(0,0,0,0.6)' : 'none',
            transform: `scale(${breath})`,
            // Phase F — subtitle override
            ...(subtitleStyle || {}),
          }}
        />
        {underlineText && (
          <div
            style={{
              marginTop: 32,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
            }}
          >
            <div
              style={{
                opacity: underlineIn,
                transform: `scale(${breath})`,
                fontFamily: FONTS.primary,
                fontWeight: FONTS.weight.black,
                fontSize: SIZES.hookUnderline,
                color: colors.accent,
                letterSpacing: -0.5,
                textShadow: imageUrl ? '0 4px 16px rgba(0,0,0,0.5)' : 'none',
              }}
            >
              {underlineText}
            </div>
            <div
              style={{
                marginTop: 16,
                height: 8,
                width: barWidth,
                backgroundColor: colors.accent,
                borderRadius: 4,
              }}
            />
          </div>
        )}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
