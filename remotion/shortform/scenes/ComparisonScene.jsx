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
 * ComparisonScene — 2열 비교 (Before/After, A vs B)
 *
 * Props:
 *  - leftLabel, leftContent  (예: "Before", "이전 매출 300만원")
 *  - rightLabel, rightContent (예: "After", "지금 매출 1200만원")
 *  - preset, subtitle, textPosition
 *
 * 디자인:
 *  - 50/50 split + 중앙 세로 divider
 *  - 좌: dim/붉은 톤, 우: accent 강조
 *  - 양쪽에서 slide-in 등장
 *  - "300만원" 같은 숫자는 count-up 자동 감지
 *  - 중앙 "VS" 배지
 */

const COUNTUP_DURATION = 18;
const NUMBER_REGEX = /(\d[\d,]*)/;

function parseNumberToken(text) {
  if (!text) return null;
  const match = String(text).match(NUMBER_REGEX);
  if (!match) return null;
  const raw = match[1];
  const numeric = parseInt(raw.replace(/,/g, ''), 10);
  if (!Number.isFinite(numeric)) return null;
  const [prefix, suffix] = String(text).split(raw);
  return { prefix: prefix || '', suffix: suffix || '', target: numeric, raw };
}

function formatWithCommas(n) {
  return n.toLocaleString('ko-KR');
}

const CountUpText = ({ content, startFrame, style }) => {
  const frame = useCurrentFrame();
  const parsed = parseNumberToken(content);

  if (!parsed) {
    return <div style={style}>{content}</div>;
  }

  const progress = interpolate(
    frame,
    [startFrame, startFrame + COUNTUP_DURATION],
    [0, parsed.target],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  );
  const current = Math.floor(progress);
  return (
    <div style={style}>
      {parsed.prefix}
      <span style={{ fontVariantNumeric: 'tabular-nums' }}>
        {formatWithCommas(current)}
      </span>
      {parsed.suffix}
    </div>
  );
};

const ComparisonColumn = ({
  label,
  content,
  side, // 'left' | 'right'
  colors,
  isAccent,
  delay,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const inProgress = spring({ frame: frame - delay, fps, config: SPRING_CONFIG });
  const translateX = interpolate(
    inProgress,
    [0, 1],
    [side === 'left' ? -200 : 200, 0],
  );
  const breath = breathe(frame);

  const bgColor = isAccent
    ? `${colors.accent}14`
    : 'rgba(0, 0, 0, 0.25)';
  const borderColor = isAccent
    ? colors.accent
    : 'rgba(255, 255, 255, 0.15)';
  const labelColor = isAccent ? colors.accent : colors.textSecondary || '#9CA3AF';
  const contentColor = isAccent ? colors.textPrimary : colors.textSecondary || '#C4C4C4';

  return (
    <div
      style={{
        flex: 1,
        opacity: inProgress,
        transform: `translateX(${translateX}px)`,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 28,
        padding: '60px 40px',
        background: bgColor,
        border: `2px solid ${borderColor}`,
        borderRadius: RADIUS.card,
        boxShadow: isAccent
          ? `0 0 40px ${colors.accent}33, inset 0 0 0 1px ${colors.accent}40`
          : 'none',
      }}
    >
      <div
        style={{
          fontFamily: FONTS.primary,
          fontWeight: FONTS.weight.black,
          fontSize: 42,
          color: labelColor,
          letterSpacing: 2,
          textTransform: 'uppercase',
          padding: '10px 24px',
          border: `2px solid ${labelColor}`,
          borderRadius: 100,
          opacity: isAccent ? 1 : 0.7,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: FONTS.primary,
          fontWeight: FONTS.weight.black,
          fontSize: 60,
          color: contentColor,
          textAlign: 'center',
          lineHeight: 1.2,
          letterSpacing: -1,
          transform: `scale(${breath})`,
          textShadow: isAccent ? `0 4px 20px ${colors.accent}55` : 'none',
          filter: isAccent ? 'none' : 'saturate(0.6)',
        }}
      >
        <CountUpText
          content={content}
          startFrame={delay + 8}
          style={{ display: 'block' }}
        />
      </div>
    </div>
  );
};

export const ComparisonScene = ({
  leftLabel = 'BEFORE',
  leftContent = '',
  rightLabel = 'AFTER',
  rightContent = '',
  preset,
  subtitle,
  textPosition,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { colors } = preset;

  const vsIn = spring({ frame: frame - 20, fps, config: SPRING_CONFIG });
  const vsScale = interpolate(vsIn, [0, 1], [0.3, 1]);
  const subtitleStyle = buildSubtitleStyle(subtitle, textPosition);

  return (
    <AbsoluteFill
      style={{
        justifyContent: 'center',
        alignItems: 'stretch',
        padding: 50,
        background: colors.bgBase,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'stretch',
          gap: 24,
          width: '100%',
          height: '100%',
          position: 'relative',
        }}
      >
        <ComparisonColumn
          label={leftLabel}
          content={leftContent}
          side="left"
          colors={colors}
          isAccent={false}
          delay={8}
        />

        {/* 중앙 VS 배지 */}
        <div
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: `translate(-50%, -50%) scale(${vsScale})`,
            opacity: vsIn,
            width: 140,
            height: 140,
            borderRadius: '50%',
            background: colors.accent,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: FONTS.primary,
            fontWeight: FONTS.weight.black,
            fontSize: 52,
            color: colors.white,
            letterSpacing: -1,
            boxShadow: `0 10px 40px ${colors.accent}66, 0 0 0 6px ${colors.bgBase}`,
            zIndex: 2,
          }}
        >
          VS
        </div>

        <ComparisonColumn
          label={rightLabel}
          content={rightContent}
          side="right"
          colors={colors}
          isAccent={true}
          delay={14}
        />
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

export default ComparisonScene;
