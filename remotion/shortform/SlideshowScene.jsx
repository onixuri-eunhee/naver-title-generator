import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import { FONTS, RADIUS, SIZES, SPRING_CONFIG, buildSubtitleStyle } from './styles';
import { breathe } from './utils';
import { KenBurnsImage } from './KenBurnsImage';

/**
 * SlideshowScene — 슬라이드쇼 모드의 단일 슬라이드
 *
 * 이미지 + 텍스트 오버레이 + CTA(마지막 슬라이드만)
 *
 * Props:
 * - imageUrl: string (필수, 이미지 없으면 검은 배경)
 * - text: string (이미지 위 오버레이)
 * - preset: 프리셋 객체
 * - subtitle: Phase F 자막 커스터마이징
 * - textPosition: 텍스트 위치
 * - cameraMotion: 카메라 모션
 * - isFirst: boolean (첫 슬라이드 = badge 표시)
 * - isLast: boolean (마지막 슬라이드 = CTA 버튼)
 * - badge: string (첫 슬라이드용)
 * - ctaButton: string (마지막 슬라이드용)
 */
export const SlideshowScene = ({
  imageUrl,
  text,
  preset,
  subtitle,
  textPosition = 'bottom',
  cameraMotion = 'ken-burns',
  isFirst = false,
  isLast = false,
  badge,
  ctaButton,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { colors } = preset;

  const textIn = spring({ frame: frame - 8, fps, config: SPRING_CONFIG });
  const textY = interpolate(textIn, [0, 1], [40, 0]);
  const badgeIn = spring({ frame: frame - 4, fps, config: SPRING_CONFIG });
  const ctaIn = spring({ frame: frame - 30, fps, config: SPRING_CONFIG });
  const breath = breathe(frame);

  const subtitleStyle = buildSubtitleStyle(subtitle, textPosition);

  // 텍스트 위치에 따라 flex 정렬
  const justifyContent =
    textPosition === 'top' ? 'flex-start'
    : textPosition === 'center' || textPosition === 'center-large' ? 'center'
    : 'flex-end';

  return (
    <AbsoluteFill>
      {imageUrl ? (
        <KenBurnsImage
          src={imageUrl}
          overlay={0.45}
          seed={`slide-${text || 'empty'}`}
          cameraMotion={cameraMotion}
        />
      ) : (
        <AbsoluteFill style={{ backgroundColor: colors.bg || '#1A1A2E' }} />
      )}

      <AbsoluteFill
        style={{
          justifyContent,
          alignItems: 'center',
          padding: '120px 60px',
          gap: 32,
        }}
      >
        {isFirst && badge && (
          <div
            style={{
              opacity: badgeIn,
              transform: `scale(${breath})`,
              backgroundColor: colors.accent,
              color: colors.white,
              fontFamily: FONTS.primary,
              fontWeight: FONTS.weight.black,
              fontSize: SIZES.hookBadge,
              padding: '14px 32px',
              borderRadius: 100,
              letterSpacing: 2,
              boxShadow: `0 8px 24px ${colors.accent}40`,
            }}
          >
            {badge}
          </div>
        )}

        {text && (
          <div
            style={{
              opacity: textIn,
              transform: `translateY(${textY}px) scale(${breath})`,
              fontFamily: FONTS.primary,
              fontWeight: FONTS.weight.black,
              fontSize: isFirst ? SIZES.hookTitle - 16 : SIZES.bodyHeader,
              color: colors.white,
              textAlign: 'center',
              lineHeight: 1.3,
              textShadow: '0 8px 32px rgba(0, 0, 0, 0.75)',
              padding: '28px 40px',
              background: 'rgba(0, 0, 0, 0.42)',
              borderRadius: RADIUS.card,
              backdropFilter: 'blur(24px)',
              WebkitBackdropFilter: 'blur(24px)',
              border: `1px solid ${colors.accent}40`,
              maxWidth: '92%',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              ...(subtitleStyle || {}),
            }}
          >
            {text.split('\n').filter(Boolean).map((line, i) => (
              <div key={i}>{line}</div>
            ))}
          </div>
        )}

        {isLast && ctaButton && (
          <div
            style={{
              opacity: ctaIn,
              transform: `translateY(${interpolate(ctaIn, [0, 1], [30, 0])}px) scale(${breath})`,
              marginTop: 24,
              fontFamily: FONTS.primary,
              fontWeight: FONTS.weight.black,
              fontSize: SIZES.ctaButton,
              color: colors.textPrimary,
              backgroundColor: colors.accent,
              padding: '22px 52px',
              borderRadius: RADIUS.full,
              boxShadow: `0 0 48px 12px ${colors.accentLight || colors.accent}60, 0 8px 24px ${colors.accent}4d`,
            }}
          >
            {ctaButton}
          </div>
        )}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
