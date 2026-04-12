import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import { FONTS, RADIUS, SIZES, SPRING_CONFIG } from './styles';
import { breathe } from './utils';
import { KenBurnsImage } from './KenBurnsImage';

const CARD_INITIAL_DELAY = 15;
const CARD_STAGGER = 30;
const COUNTUP_DURATION = 15;
const NUMBER_BADGE_SIZE = 180;

/**
 * BodyScene — 2가지 모드 지원
 * 1. cards 모드: 3개의 글래스 카드 (my-video 원본)
 * 2. image 모드: 이미지 + Ken Burns + 캡션 오버레이
 *
 * cards 프롭 있으면 cards 모드, imageUrl 있으면 image 모드
 */

const MethodRow = ({ card, delay, colors }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const progress = spring({ frame: frame - delay, fps, config: SPRING_CONFIG });
  const x = interpolate(progress, [0, 1], [-120, 0]);
  const breath = breathe(frame);

  const target = parseInt(card.number, 10) || 0;
  const padLen = (card.number || '').length || 2;
  const count = Math.floor(
    interpolate(frame, [delay, delay + COUNTUP_DURATION], [0, target], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    }),
  );
  const formatted = count.toString().padStart(padLen, '0');

  const glassShadow = [
    '0 1px 2px rgba(0, 0, 0, 0.04)',
    `0 4px 12px ${colors.accent}14`,
    'inset 0 0 0 1px rgba(255, 255, 255, 0.6)',
  ].join(', ');

  return (
    <div
      style={{
        opacity: progress,
        transform: `translateX(${x}px)`,
        display: 'flex',
        alignItems: 'center',
        gap: 28,
        padding: '28px 36px',
        backgroundColor: colors.glassBg,
        backdropFilter: 'blur(30px) saturate(180%)',
        WebkitBackdropFilter: 'blur(30px) saturate(180%)',
        border: `1px solid ${colors.glassBorder}`,
        boxShadow: glassShadow,
        borderRadius: RADIUS.card,
        marginBottom: 24,
      }}
    >
      <div
        style={{
          width: NUMBER_BADGE_SIZE,
          height: NUMBER_BADGE_SIZE,
          borderRadius: '50%',
          backgroundColor: colors.numberBadgeBg,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <div
          style={{
            fontFamily: FONTS.primary,
            fontWeight: FONTS.weight.black,
            fontSize: SIZES.cardNumber,
            color: colors.accent,
            lineHeight: 0.85,
            letterSpacing: -4,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {formatted}
        </div>
      </div>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          transform: `scale(${breath})`,
          transformOrigin: 'left center',
        }}
      >
        <div
          style={{
            fontFamily: FONTS.primary,
            fontWeight: FONTS.weight.black,
            fontSize: SIZES.cardTitle,
            color: colors.textPrimary,
            lineHeight: 1.1,
            letterSpacing: -0.5,
          }}
        >
          {card.title}
        </div>
        <div
          style={{
            fontFamily: FONTS.primary,
            fontWeight: FONTS.weight.medium,
            fontSize: SIZES.cardDescription,
            color: colors.textSecondary,
          }}
        >
          {card.description}
        </div>
      </div>
    </div>
  );
};

const CardsMode = ({ header, cards, preset }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { colors } = preset;

  const headerIn = spring({ frame, fps, config: SPRING_CONFIG });
  const headerY = interpolate(headerIn, [0, 1], [-40, 0]);
  const breath = breathe(frame);
  const headerLines = (header || '').split('\n');

  return (
    <AbsoluteFill
      style={{
        justifyContent: 'center',
        alignItems: 'stretch',
        padding: 50,
      }}
    >
      {header && (
        <div
          style={{
            opacity: headerIn,
            transform: `translateY(${headerY}px) scale(${breath})`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 20,
            marginBottom: 40,
          }}
        >
          <div
            style={{
              width: 4,
              height: 40,
              backgroundColor: colors.accent,
              borderRadius: 2,
            }}
          />
          <div
            style={{
              fontFamily: FONTS.primary,
              fontWeight: FONTS.weight.black,
              fontSize: SIZES.bodyHeader,
              textAlign: 'left',
              letterSpacing: -0.5,
              lineHeight: 1.1,
            }}
          >
            {headerLines.map((line, i) => (
              <div
                key={i}
                style={{
                  color:
                    i === headerLines.length - 1 ? colors.accent : colors.textPrimary,
                }}
              >
                {line}
              </div>
            ))}
          </div>
        </div>
      )}
      {(cards || []).map((card, i) => (
        <MethodRow
          key={i}
          card={card}
          delay={CARD_INITIAL_DELAY + i * CARD_STAGGER}
          colors={colors}
        />
      ))}
    </AbsoluteFill>
  );
};

const ImageMode = ({ header, caption, imageUrl, preset }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { colors } = preset;

  const captionIn = spring({ frame: frame - 10, fps, config: SPRING_CONFIG });
  const captionY = interpolate(captionIn, [0, 1], [60, 0]);
  const headerIn = spring({ frame, fps, config: SPRING_CONFIG });
  const headerY = interpolate(headerIn, [0, 1], [-40, 0]);
  const breath = breathe(frame);

  return (
    <AbsoluteFill>
      <KenBurnsImage src={imageUrl} overlay={0.45} seed={`body-${header || caption || imageUrl}`} />
      <AbsoluteFill
        style={{
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '100px 60px',
        }}
      >
        {header && (
          <div
            style={{
              opacity: headerIn,
              transform: `translateY(${headerY}px) scale(${breath})`,
              fontFamily: FONTS.primary,
              fontWeight: FONTS.weight.black,
              fontSize: SIZES.bodyHeader,
              color: colors.white,
              textAlign: 'center',
              lineHeight: 1.15,
              textShadow: '0 8px 32px rgba(0,0,0,0.7)',
            }}
          >
            {header.split('\n').map((line, i) => (
              <div key={i}>{line}</div>
            ))}
          </div>
        )}
        {caption && (
          <div
            style={{
              opacity: captionIn,
              transform: `translateY(${captionY}px) scale(${breath})`,
              fontFamily: FONTS.primary,
              fontWeight: FONTS.weight.bold,
              fontSize: SIZES.bodyCaption,
              color: colors.white,
              textAlign: 'center',
              lineHeight: 1.35,
              padding: '24px 36px',
              background: 'rgba(0, 0, 0, 0.35)',
              borderRadius: RADIUS.card,
              backdropFilter: 'blur(20px)',
              WebkitBackdropFilter: 'blur(20px)',
              border: `1px solid ${colors.accent}40`,
              maxWidth: '90%',
              textShadow: '0 4px 16px rgba(0,0,0,0.8)',
            }}
          >
            {caption}
          </div>
        )}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

export const BodyScene = ({ header, cards, caption, imageUrl, preset }) => {
  if (imageUrl) {
    return <ImageMode header={header} caption={caption} imageUrl={imageUrl} preset={preset} />;
  }
  return <CardsMode header={header} cards={cards || []} preset={preset} />;
};
