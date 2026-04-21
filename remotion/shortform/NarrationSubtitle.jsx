import { FONTS, buildSubtitleStyle, getSubtitlePositionStyle } from './styles.js';

const MAX_SUBTITLE_LINES = 2;
const MAX_SUBTITLE_CHARS_PER_LINE = 18;

function splitLongToken(token, maxCharsPerLine) {
  if (token.length <= maxCharsPerLine) return [token];
  const parts = [];
  for (let index = 0; index < token.length; index += maxCharsPerLine) {
    parts.push(token.slice(index, index + maxCharsPerLine));
  }
  return parts;
}

function formatSubtitleLines(text, maxLines = MAX_SUBTITLE_LINES, maxCharsPerLine = MAX_SUBTITLE_CHARS_PER_LINE) {
  const normalized = String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return [];

  const tokens = normalized
    .split(' ')
    .flatMap((token) => splitLongToken(token, maxCharsPerLine));

  const lines = [];
  let currentLine = '';

  while (tokens.length > 0 && lines.length < maxLines) {
    const token = tokens.shift();
    const nextLine = currentLine ? `${currentLine} ${token}` : token;

    if (!currentLine || nextLine.length <= maxCharsPerLine) {
      currentLine = nextLine;
      continue;
    }

    lines.push(currentLine);
    currentLine = token;
  }

  if (currentLine && lines.length < maxLines) {
    lines.push(currentLine);
  }

  if (tokens.length > 0 && lines.length > 0) {
    const lastIndex = lines.length - 1;
    const baseLine = lines[lastIndex].slice(0, Math.max(0, maxCharsPerLine - 1)).trimEnd();
    lines[lastIndex] = `${baseLine}…`;
  }

  return lines.filter(Boolean).slice(0, maxLines);
}

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
  const subtitleLines = formatSubtitleLines(text);

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
          maxWidth: 920,
          margin: '0 auto',
          overflow: 'hidden',
          display: '-webkit-box',
          WebkitLineClamp: MAX_SUBTITLE_LINES,
          WebkitBoxOrient: 'vertical',
          ...(subtitleStyle || {}),
        }}
      >
        {subtitleLines.map((line, index) => (
          <div key={index}>{line}</div>
        ))}
      </div>
    </div>
  );
};
