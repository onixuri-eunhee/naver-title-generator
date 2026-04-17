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
  SPRING_CONFIG,
  buildSubtitleStyle,
} from '../styles.js';
import { breathe } from '../utils.js';

/**
 * TestimonialScene — 고객 후기
 *
 * Props:
 *  - quote   (예: "여기 너무 친절해요")
 *  - author  (예: "김○○ 님")
 *  - meta    (optional, 예: "40대 여성, 강남구")
 *  - rating  (optional, 0~5 숫자, 기본 5)
 *  - preset, subtitle, textPosition
 *
 * 디자인:
 *  - 상단/하단 큰 따옴표 (" ") 장식
 *  - 본문 serif italic 톤
 *  - 하단에 author + 짧은 divider
 *  - 별점 옵션 (★★★★★)
 *  - soft 배경 (강한 대비 X)
 */

const DEFAULT_RATING = 5;
const STAR_FULL = '★';
const STAR_EMPTY = '☆';

function renderStars(rating) {
  const n = Math.max(0, Math.min(5, Math.round(Number(rating) || 0)));
  return STAR_FULL.repeat(n) + STAR_EMPTY.repeat(5 - n);
}

export const TestimonialScene = ({
  quote = '',
  author = '',
  meta = '',
  rating = DEFAULT_RATING,
  preset,
  subtitle,
  textPosition,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { colors } = preset;

  const quoteIn = spring({ frame, fps, config: SPRING_CONFIG });
  const authorIn = spring({ frame: frame - 18, fps, config: SPRING_CONFIG });
  const starIn = spring({ frame: frame - 28, fps, config: SPRING_CONFIG });
  const breath = breathe(frame);

  const quoteY = interpolate(quoteIn, [0, 1], [30, 0]);
  const authorY = interpolate(authorIn, [0, 1], [20, 0]);

  const subtitleStyle = buildSubtitleStyle(subtitle, textPosition);
  const softBg = colors.glassBg || 'rgba(255, 255, 255, 0.06)';
  const softBorder = colors.glassBorder || `${colors.accent}22`;

  return (
    <AbsoluteFill
      style={{
        justifyContent: 'center',
        alignItems: 'center',
        padding: 80,
        background: colors.bgBase,
      }}
    >
      <div
        style={{
          opacity: quoteIn,
          transform: `translateY(${quoteY}px)`,
          maxWidth: 900,
          padding: '80px 70px 70px',
          background: softBg,
          backdropFilter: 'blur(30px) saturate(160%)',
          WebkitBackdropFilter: 'blur(30px) saturate(160%)',
          border: `1px solid ${softBorder}`,
          borderRadius: RADIUS.large,
          boxShadow: `0 20px 60px rgba(0, 0, 0, 0.18), inset 0 0 0 1px ${colors.accent}11`,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 32,
          position: 'relative',
        }}
      >
        {/* 상단 큰 따옴표 */}
        <div
          style={{
            position: 'absolute',
            top: -40,
            left: 40,
            fontFamily: 'Georgia, "Noto Serif KR", serif',
            fontSize: 220,
            lineHeight: 0.8,
            color: colors.accent,
            opacity: 0.55,
            fontWeight: 700,
            userSelect: 'none',
          }}
        >
          “
        </div>

        {/* 별점 */}
        <div
          style={{
            opacity: starIn,
            fontSize: 52,
            letterSpacing: 8,
            color: '#FFB800',
            filter: 'drop-shadow(0 2px 8px rgba(255, 184, 0, 0.45))',
          }}
        >
          {renderStars(rating)}
        </div>

        {/* Quote 본문 */}
        <div
          style={{
            fontFamily: '"Noto Serif KR", Georgia, serif',
            fontWeight: 700,
            fontStyle: 'italic',
            fontSize: 64,
            color: colors.textPrimary,
            textAlign: 'center',
            lineHeight: 1.35,
            letterSpacing: -0.5,
            transform: `scale(${breath})`,
            padding: '0 30px',
          }}
        >
          {quote.split('\n').map((line, i) => (
            <div key={i}>{line}</div>
          ))}
        </div>

        {/* Divider */}
        <div
          style={{
            opacity: authorIn,
            width: 120,
            height: 3,
            background: colors.accent,
            borderRadius: 2,
            marginTop: 8,
          }}
        />

        {/* Author */}
        <div
          style={{
            opacity: authorIn,
            transform: `translateY(${authorY}px)`,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <div
            style={{
              fontFamily: FONTS.primary,
              fontWeight: FONTS.weight.black,
              fontSize: 42,
              color: colors.textPrimary,
              letterSpacing: -0.5,
            }}
          >
            {author}
          </div>
          {meta && (
            <div
              style={{
                fontFamily: FONTS.primary,
                fontWeight: FONTS.weight.medium,
                fontSize: 28,
                color: colors.textSecondary || 'rgba(255,255,255,0.7)',
                letterSpacing: 0.2,
              }}
            >
              {meta}
            </div>
          )}
        </div>

        {/* 하단 큰 따옴표 */}
        <div
          style={{
            position: 'absolute',
            bottom: -80,
            right: 40,
            fontFamily: 'Georgia, "Noto Serif KR", serif',
            fontSize: 220,
            lineHeight: 0.8,
            color: colors.accent,
            opacity: 0.55,
            fontWeight: 700,
            userSelect: 'none',
          }}
        >
          ”
        </div>
      </div>

      {subtitleStyle && subtitle?.text && (
        <div
          style={{
            position: 'absolute',
            bottom: 60,
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

export default TestimonialScene;
