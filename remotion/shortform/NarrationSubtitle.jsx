import { FONTS, buildSubtitleStyle, getSubtitlePositionStyle } from './styles.js';

export const NarrationSubtitle = ({
  text,
  subtitle,
  imageUrl = false,
  defaultColor = '#ffffff',
  positionOverride = null,
}) => {
  if (!text) return null;

  const subtitleStyle = buildSubtitleStyle(subtitle);
  const positionStyle = getSubtitlePositionStyle(positionOverride || subtitle?.position);

  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        padding: '0 72px',
        textAlign: 'center',
        pointerEvents: 'none',
        ...positionStyle,
      }}
    >
      <div
        style={{
          fontFamily: FONTS.primary,
          fontWeight: FONTS.weight.bold,
          fontSize: 44,
          color: defaultColor,
          letterSpacing: -0.5,
          lineHeight: 1.35,
          textShadow: imageUrl ? '0 4px 16px rgba(0,0,0,0.6)' : 'none',
          wordBreak: 'keep-all',
          opacity: 0.92,
          ...(subtitleStyle || {}),
        }}
      >
        {String(text)
          .split('\n')
          .filter(Boolean)
          .map((line, index) => (
            <div key={index}>{line}</div>
          ))}
      </div>
    </div>
  );
};
