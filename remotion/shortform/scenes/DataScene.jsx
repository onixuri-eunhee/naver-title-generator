import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import {
  FONTS,
  SPRING_CONFIG,
  buildSubtitleStyle,
} from '../styles.js';
import { breathe } from '../utils.js';

/**
 * DataScene — 숫자/통계 강조
 *
 * Props:
 *  - value  (예: "127", "95", "95%")
 *  - unit   (예: "명", "%", "%p")
 *  - label  (예: "재방문율", "단골 고객 수")
 *  - delta  (optional, 예: "+47%", "-12%")
 *  - preset, subtitle, textPosition
 *
 * 디자인:
 *  - 초대형 숫자 (320px)
 *  - 0 → value count-up 애니메이션 (BodyScene.MethodRow 패턴 차용)
 *  - label 상단 소문자, unit 우측 작은 글자
 *  - delta ↑/↓ 화살표 + green/red 색
 */

const COUNTUP_DURATION = 30;

function parseValue(raw) {
  if (raw == null) return { prefix: '', num: 0, suffix: '', valid: false };
  const str = String(raw).trim();
  const match = str.match(/^(\D*)([\d,]+(?:\.\d+)?)(.*)$/);
  if (!match) return { prefix: '', num: 0, suffix: str, valid: false };
  const prefix = match[1] || '';
  const numStr = match[2] || '0';
  const suffix = match[3] || '';
  const num = parseFloat(numStr.replace(/,/g, ''));
  const isInt = !numStr.includes('.');
  return {
    prefix,
    num: Number.isFinite(num) ? num : 0,
    suffix,
    isInt,
    valid: Number.isFinite(num),
  };
}

function formatNumber(n, isInt) {
  if (isInt) {
    return Math.floor(n).toLocaleString('ko-KR');
  }
  return n.toFixed(1);
}

export const DataScene = ({
  value = '0',
  unit = '',
  label = '',
  delta,
  preset,
  subtitle,
  textPosition,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { colors } = preset;

  const parsed = parseValue(value);
  const labelIn = spring({ frame, fps, config: SPRING_CONFIG });
  const valueIn = spring({ frame: frame - 10, fps, config: SPRING_CONFIG });
  const deltaIn = spring({ frame: frame - 40, fps, config: SPRING_CONFIG });
  const breath = breathe(frame);

  const labelY = interpolate(labelIn, [0, 1], [-30, 0]);
  const valueScale = interpolate(valueIn, [0, 1], [0.6, 1]);

  // Count-up (BodyScene MethodRow 패턴)
  const counted = parsed.valid
    ? interpolate(
        frame,
        [12, 12 + COUNTUP_DURATION],
        [0, parsed.num],
        { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
      )
    : parsed.num;

  const displayValue = parsed.valid
    ? `${parsed.prefix}${formatNumber(counted, parsed.isInt)}${parsed.suffix}`
    : String(value);

  // Delta 색상/방향
  const deltaStr = delta != null ? String(delta).trim() : '';
  const deltaIsPositive = deltaStr.startsWith('+') || (!deltaStr.startsWith('-') && parseFloat(deltaStr) > 0);
  const deltaIsNegative = deltaStr.startsWith('-') || parseFloat(deltaStr) < 0;
  const deltaColor = deltaIsPositive
    ? '#22C55E'
    : deltaIsNegative
    ? '#EF4444'
    : colors.textSecondary || '#9CA3AF';
  const deltaArrow = deltaIsPositive ? '↑' : deltaIsNegative ? '↓' : '';

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
      {/* 배경 halo */}
      <div
        style={{
          position: 'absolute',
          width: 1000,
          height: 1000,
          borderRadius: '50%',
          background: `radial-gradient(circle, ${colors.accent}22 0%, transparent 65%)`,
          filter: 'blur(60px)',
        }}
      />

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 24,
          position: 'relative',
        }}
      >
        {/* Label */}
        {label && (
          <div
            style={{
              opacity: labelIn,
              transform: `translateY(${labelY}px)`,
              fontFamily: FONTS.primary,
              fontWeight: FONTS.weight.bold,
              fontSize: 44,
              color: colors.textSecondary || 'rgba(255,255,255,0.75)',
              letterSpacing: 2,
              textTransform: 'none',
              padding: '10px 28px',
              background: `${colors.accent}15`,
              border: `2px solid ${colors.accent}55`,
              borderRadius: 100,
            }}
          >
            {label}
          </div>
        )}

        {/* 거대 숫자 */}
        <div
          style={{
            opacity: valueIn,
            transform: `scale(${valueScale * breath})`,
            display: 'flex',
            alignItems: 'baseline',
            gap: 8,
          }}
        >
          <div
            style={{
              fontFamily: FONTS.primary,
              fontWeight: FONTS.weight.black,
              fontSize: 340,
              color: colors.accent,
              lineHeight: 0.85,
              letterSpacing: -12,
              fontVariantNumeric: 'tabular-nums',
              textShadow: `0 12px 60px ${colors.accent}55`,
            }}
          >
            {displayValue}
          </div>
          {unit && (
            <div
              style={{
                fontFamily: FONTS.primary,
                fontWeight: FONTS.weight.black,
                fontSize: 120,
                color: colors.textPrimary,
                lineHeight: 0.9,
                letterSpacing: -2,
                marginLeft: 4,
              }}
            >
              {unit}
            </div>
          )}
        </div>

        {/* Delta */}
        {deltaStr && (
          <div
            style={{
              opacity: deltaIn,
              transform: `translateY(${interpolate(deltaIn, [0, 1], [20, 0])}px)`,
              display: 'flex',
              alignItems: 'center',
              gap: 14,
              padding: '14px 32px',
              background: `${deltaColor}22`,
              border: `2px solid ${deltaColor}`,
              borderRadius: 100,
              fontFamily: FONTS.primary,
              fontWeight: FONTS.weight.black,
              fontSize: 48,
              color: deltaColor,
              letterSpacing: -0.5,
            }}
          >
            {deltaArrow && <span style={{ fontSize: 56, lineHeight: 1 }}>{deltaArrow}</span>}
            <span>{deltaStr}</span>
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

export default DataScene;
