export const SHORTFORM_WIDTH = 1080;
export const SHORTFORM_HEIGHT = 1920;
export const SHORTFORM_FPS = 30;

const MAX_LINE_CHARS = 18;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function toCleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function splitLongToken(token, maxChars) {
  const chunks = [];
  for (let i = 0; i < token.length; i += maxChars) {
    chunks.push(token.slice(i, i + maxChars));
  }
  return chunks;
}

function splitDisplayLines(text) {
  const source = toCleanText(text);
  if (!source) return [];

  const clauses = source
    .split(/(?<=[,，·])/)
    .map((part) => toCleanText(part))
    .filter(Boolean);

  const units = clauses.length ? clauses : [source];
  const lines = [];

  units.forEach((unit) => {
    if (unit.length <= MAX_LINE_CHARS) {
      lines.push(unit);
      return;
    }

    const tokens = unit.split(/\s+/).filter(Boolean);
    if (tokens.length <= 1) {
      lines.push(...splitLongToken(unit, MAX_LINE_CHARS));
      return;
    }

    let buffer = '';
    tokens.forEach((token) => {
      const candidate = buffer ? `${buffer} ${token}` : token;
      if (candidate.length > MAX_LINE_CHARS && buffer) {
        lines.push(buffer);
        buffer = token;
      } else if (candidate.length > MAX_LINE_CHARS) {
        lines.push(...splitLongToken(candidate, MAX_LINE_CHARS));
        buffer = '';
      } else {
        buffer = candidate;
      }
    });

    if (buffer) lines.push(buffer);
  });

  return lines.filter(Boolean);
}

function normalizeSections(script) {
  const hook = toCleanText(script?.hook);
  const points = Array.isArray(script?.points)
    ? script.points.map((point) => toCleanText(point)).filter(Boolean)
    : [];
  const cta = toCleanText(script?.cta);

  return [hook, ...points, cta].filter(Boolean);
}

function getTargetVisualCount(seconds) {
  if (seconds < 40) return 3;
  if (seconds < 65) return 4;
  return 5;
}

function normalizeVisuals(visuals, durationSec) {
  const targetCount = getTargetVisualCount(durationSec);
  return (Array.isArray(visuals) ? visuals : [])
    .filter((item) => item && item.url)
    .slice(0, targetCount)
    .map((item, index) => ({
      type: item.type === 'video' ? 'video' : 'image',
      url: String(item.url),
      thumbnail: String(item.thumbnail || item.url),
      title: toCleanText(item.title) || `추천 소재 ${index + 1}`,
      provider: toCleanText(item.provider),
      fallbackFrom: toCleanText(item.fallbackFrom),
      fallbackReason: toCleanText(item.fallbackReason),
    }));
}

function buildVisualSpans(visuals, durationSec) {
  if (!visuals.length) return [];
  const spanSec = durationSec / visuals.length;
  return visuals.map((visual, index) => {
    const startSec = index * spanSec;
    const endSec = index === visuals.length - 1 ? durationSec : (index + 1) * spanSec;
    return {
      ...visual,
      startSec,
      endSec,
      startFrame: Math.floor(startSec * SHORTFORM_FPS),
      durationInFrames: Math.max(1, Math.round((endSec - startSec) * SHORTFORM_FPS)),
    };
  });
}

function buildTextScenes(lines, durationSec) {
  if (!lines.length) {
    return [{
      text: '대본이 비어 있습니다.',
      startSec: 0,
      endSec: durationSec,
      startFrame: 0,
      durationInFrames: Math.max(1, Math.round(durationSec * SHORTFORM_FPS)),
    }];
  }

  const totalChars = lines.reduce((sum, line) => sum + line.replace(/\s+/g, '').length, 0) || lines.length;
  let cursor = 0;

  return lines.map((line, index) => {
    const chars = line.replace(/\s+/g, '').length || 1;
    const remaining = Math.max(0.5, durationSec - cursor);
    const rawDuration = index === lines.length - 1
      ? remaining
      : clamp(durationSec * (chars / totalChars), 0.9, remaining);
    const endSec = index === lines.length - 1 ? durationSec : Math.min(durationSec, cursor + rawDuration);
    const scene = {
      text: line,
      startSec: cursor,
      endSec,
      startFrame: Math.floor(cursor * SHORTFORM_FPS),
      durationInFrames: Math.max(1, Math.round((endSec - cursor) * SHORTFORM_FPS)),
    };
    cursor = endSec;
    return scene;
  });
}

export function buildShortformTimeline(inputProps) {
  const audioDurationSec = Number(inputProps?.audioDurationSec) || 0;
  const estimatedSeconds = Number(inputProps?.estimatedSeconds) || 30;
  const trimStartSec = Math.max(0, Number(inputProps?.trimStartSec) || 0);
  const rawTrimEndSec = inputProps?.trimEndSec;
  const trimEndSec = rawTrimEndSec === null || rawTrimEndSec === undefined || rawTrimEndSec === ''
    ? null
    : Math.max(0, Number(rawTrimEndSec));

  const sourceDuration = audioDurationSec > 0 ? audioDurationSec : estimatedSeconds;
  const effectiveDurationSec = Math.max(
    1,
    trimEndSec !== null
      ? trimEndSec - trimStartSec
      : sourceDuration - trimStartSec
  );

  const sections = normalizeSections(inputProps?.script || {});
  const lines = sections.flatMap((section) => splitDisplayLines(section));
  const visuals = normalizeVisuals(inputProps?.visuals, effectiveDurationSec);
  const visualSpans = buildVisualSpans(visuals, effectiveDurationSec);
  const textScenes = buildTextScenes(lines, effectiveDurationSec);

  return {
    durationSec: effectiveDurationSec,
    durationInFrames: Math.max(1, Math.round(effectiveDurationSec * SHORTFORM_FPS)),
    visuals,
    visualSpans,
    textScenes,
    trimStartSec,
    trimEndSec,
  };
}
