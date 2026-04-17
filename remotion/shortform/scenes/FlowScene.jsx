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
 * FlowScene — 단계별 프로세스
 *
 * Props:
 *  - steps   [{ label, description }] (3~5 단계 권장)
 *  - header  (optional, 상단 타이틀)
 *  - preset, subtitle, textPosition
 *
 * 디자인:
 *  - Vertical flow (3~5 단계 최적)
 *  - 번호 원형 → label → description
 *  - 단계 사이 화살표 (↓)
 *  - 각 단계 15프레임 간격으로 sequential spring 등장
 *  - 예: 상담 → 디자인 → 시공 → AS
 */

const STEP_INITIAL_DELAY = 8;
const STEP_STAGGER = 15;

const StepItem = ({ step, index, total, colors, delay }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const progress = spring({ frame: frame - delay, fps, config: SPRING_CONFIG });
  const translateX = interpolate(progress, [0, 1], [-80, 0]);
  const circleScale = interpolate(progress, [0, 1], [0.5, 1]);
  const breath = breathe(frame);

  // 화살표 등장 (원형 이후 5프레임)
  const arrowIn = spring({
    frame: frame - delay - 5,
    fps,
    config: SPRING_CONFIG,
  });

  const isLast = index === total - 1;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'stretch',
        width: '100%',
      }}
    >
      <div
        style={{
          opacity: progress,
          transform: `translateX(${translateX}px)`,
          display: 'flex',
          alignItems: 'center',
          gap: 30,
          padding: '22px 32px',
          background: colors.glassBg || 'rgba(255, 255, 255, 0.06)',
          border: `2px solid ${colors.accent}55`,
          borderRadius: RADIUS.card,
          backdropFilter: 'blur(20px) saturate(160%)',
          WebkitBackdropFilter: 'blur(20px) saturate(160%)',
          boxShadow: `0 8px 24px ${colors.accent}14, inset 0 0 0 1px rgba(255,255,255,0.08)`,
        }}
      >
        {/* 번호 원형 */}
        <div
          style={{
            width: 120,
            height: 120,
            borderRadius: '50%',
            background: colors.accent,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            transform: `scale(${circleScale})`,
            boxShadow: `0 8px 28px ${colors.accent}66, inset 0 -4px 12px rgba(0,0,0,0.15)`,
          }}
        >
          <div
            style={{
              fontFamily: FONTS.primary,
              fontWeight: FONTS.weight.black,
              fontSize: 64,
              color: colors.white,
              lineHeight: 1,
              letterSpacing: -2,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {index + 1}
          </div>
        </div>

        {/* 텍스트 */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            flex: 1,
            transform: `scale(${breath})`,
            transformOrigin: 'left center',
          }}
        >
          <div
            style={{
              fontFamily: FONTS.primary,
              fontWeight: FONTS.weight.black,
              fontSize: 52,
              color: colors.textPrimary,
              lineHeight: 1.1,
              letterSpacing: -0.8,
            }}
          >
            {step.label}
          </div>
          {step.description && (
            <div
              style={{
                fontFamily: FONTS.primary,
                fontWeight: FONTS.weight.medium,
                fontSize: 28,
                color: colors.textSecondary || 'rgba(255,255,255,0.75)',
                lineHeight: 1.3,
                letterSpacing: -0.2,
              }}
            >
              {step.description}
            </div>
          )}
        </div>
      </div>

      {/* 화살표 (마지막 제외) */}
      {!isLast && (
        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            padding: '6px 0',
            opacity: arrowIn,
            transform: `scale(${interpolate(arrowIn, [0, 1], [0.6, 1])})`,
          }}
        >
          <div
            style={{
              fontSize: 52,
              lineHeight: 1,
              color: colors.accent,
              textShadow: `0 2px 12px ${colors.accent}66`,
              fontWeight: 900,
            }}
          >
            ↓
          </div>
        </div>
      )}
    </div>
  );
};

export const FlowScene = ({
  steps = [],
  header = '',
  preset,
  subtitle,
  textPosition,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { colors } = preset;

  const safeSteps = Array.isArray(steps) ? steps.slice(0, 5) : [];

  const headerIn = spring({ frame, fps, config: SPRING_CONFIG });
  const headerY = interpolate(headerIn, [0, 1], [-30, 0]);
  const breath = breathe(frame);

  const subtitleStyle = buildSubtitleStyle(subtitle, textPosition);

  return (
    <AbsoluteFill
      style={{
        justifyContent: 'center',
        alignItems: 'stretch',
        padding: '60px 60px',
        background: colors.bgBase,
      }}
    >
      {header && (
        <div
          style={{
            opacity: headerIn,
            transform: `translateY(${headerY}px) scale(${breath})`,
            fontFamily: FONTS.primary,
            fontWeight: FONTS.weight.black,
            fontSize: 58,
            color: colors.textPrimary,
            textAlign: 'center',
            marginBottom: 36,
            letterSpacing: -1,
            lineHeight: 1.15,
          }}
        >
          {header}
        </div>
      )}

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'stretch',
          gap: 0,
        }}
      >
        {safeSteps.map((step, i) => (
          <StepItem
            key={i}
            step={step}
            index={i}
            total={safeSteps.length}
            colors={colors}
            delay={STEP_INITIAL_DELAY + i * STEP_STAGGER}
          />
        ))}
      </div>

      {subtitleStyle && subtitle?.text && (
        <div
          style={{
            position: 'absolute',
            bottom: 40,
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

export default FlowScene;
