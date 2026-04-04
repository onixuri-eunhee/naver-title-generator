export const SHORTFORM_WIDTH = 1080;
export const SHORTFORM_HEIGHT = 1920;
export const SHORTFORM_FPS = 30;

const MAX_LINE_CHARS = 18;
const SENTENCE_BREAK_GAP_SEC = 0.55;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function toCleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function getCompactLength(value) {
  return toCleanText(value).replace(/\s+/g, '').length;
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
  const explicitPoints = Array.isArray(script?.points)
    ? script.points.map((point) => toCleanText(point)).filter(Boolean)
    : [];
  const pointText = String(script?.point || '');
  const derivedPoints = explicitPoints.length
    ? explicitPoints
    : pointText
        .split(/\n+/)
        .map((point) => toCleanText(point))
        .filter(Boolean);
  const cta = toCleanText(script?.cta);

  return [hook, ...derivedPoints, cta].filter(Boolean);
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

function normalizeTimedEntries(entries, trimStartSec, durationSec) {
  return (Array.isArray(entries) ? entries : [])
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null;

      const start = Math.max(0, Number(entry.start) - trimStartSec || 0);
      const rawEnd = entry.end === null || entry.end === undefined ? null : Number(entry.end);
      const end = rawEnd === null ? null : Math.min(durationSec, Math.max(0, rawEnd - trimStartSec));
      const text = toCleanText(entry.text || entry.word);

      return {start, end, text};
    })
    .filter((entry) => {
      if (!entry?.text) return false;
      const visibleEnd = entry.end === null ? entry.start + 0.2 : entry.end;
      return visibleEnd > 0 && entry.start < durationSec;
    })
    .sort((left, right) => left.start - right.start);
}

function needsWordSpace(previousText, currentText) {
  if (!previousText) return false;
  if (/^[,.;:!?%)\]}/]/.test(currentText)) return false;
  if (/[(\[{/]$/.test(previousText)) return false;
  return true;
}

function joinDisplayWords(words) {
  return words
    .map((word, index) => {
      const prefix = index > 0 && needsWordSpace(words[index - 1].text, word.text) ? ' ' : '';
      return `${prefix}${word.text}`;
    })
    .join('')
    .trim();
}

function decorateSentenceWords(words) {
  return words.map((word, index) => ({
    start: word.start,
    end: word.end,
    text: word.text,
    prefix: index > 0 && needsWordSpace(words[index - 1].text, word.text) ? ' ' : '',
  }));
}

function createSentence(words, index) {
  const decoratedWords = decorateSentenceWords(words);
  return {
    id: `sentence-${index}`,
    words: decoratedWords,
    text: joinDisplayWords(words),
    startSec: words[0].start,
    endSec: words[words.length - 1].end,
  };
}

function groupWordsIntoSentences(words) {
  if (!words.length) return [];

  const sentences = [];
  let bucket = [];

  words.forEach((word, index) => {
    const previous = bucket[bucket.length - 1];
    const shouldStartNew =
      previous &&
      (
        /[.!?。！？]$/.test(previous.text) ||
        word.start - previous.end >= SENTENCE_BREAK_GAP_SEC
      );

    if (shouldStartNew) {
      sentences.push(createSentence(bucket, sentences.length));
      bucket = [];
    }

    bucket.push(word);

    if (index === words.length - 1 && bucket.length) {
      sentences.push(createSentence(bucket, sentences.length));
    }
  });

  return sentences;
}

function buildSectionRanges(sections, durationSec) {
  if (!sections.length) {
    return [{
      index: 0,
      text: '',
      startSec: 0,
      endSec: durationSec,
    }];
  }

  const lengths = sections.map((section) => Math.max(1, getCompactLength(section)));
  const totalLength = lengths.reduce((sum, length) => sum + length, 0) || 1;

  let accumulated = 0;
  return sections.map((section, index) => {
    const startSec = durationSec * (accumulated / totalLength);
    accumulated += lengths[index];
    const endSec = index === sections.length - 1
      ? durationSec
      : durationSec * (accumulated / totalLength);

    return {
      index,
      text: section,
      startSec,
      endSec,
    };
  });
}

function getSectionIndexForTime(sectionRanges, timeSec) {
  const index = sectionRanges.findIndex((range) => timeSec >= range.startSec && timeSec < range.endSec);
  return index === -1 ? Math.max(0, sectionRanges.length - 1) : index;
}

function assignWordsToLines(words, lines) {
  if (!lines.length) return [];
  if (!words.length) {
    return lines.map((line) => ({text: line, words: []}));
  }

  const lineTargets = lines.map((line) => Math.max(1, getCompactLength(line)));
  const totalTarget = lineTargets.reduce((sum, length) => sum + length, 0) || 1;
  const totalWordChars = words.reduce((sum, word) => sum + Math.max(1, getCompactLength(word.text)), 0) || words.length;

  const result = [];
  let consumedWordChars = 0;
  let runningTarget = 0;
  let wordIndex = 0;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    if (lineIndex === lines.length - 1) {
      result.push({
        text: lines[lineIndex],
        words: words.slice(wordIndex),
      });
      break;
    }

    runningTarget += lineTargets[lineIndex];
    const targetCharCount = Math.round(totalWordChars * (runningTarget / totalTarget));
    const lineWords = [];

    while (wordIndex < words.length - (lines.length - lineIndex - 1)) {
      const word = words[wordIndex];
      lineWords.push(word);
      consumedWordChars += Math.max(1, getCompactLength(word.text));
      wordIndex += 1;

      if (consumedWordChars >= targetCharCount) {
        break;
      }
    }

    result.push({
      text: lines[lineIndex],
      words: lineWords,
    });
  }

  while (result.length < lines.length) {
    result.push({
      text: lines[result.length],
      words: [],
    });
  }

  return result;
}

function createScene({id, text, startSec, endSec, displayLines, wordLines, sectionIndex}) {
  return {
    id,
    text,
    startSec,
    endSec,
    startFrame: Math.floor(startSec * SHORTFORM_FPS),
    durationInFrames: Math.max(1, Math.round((endSec - startSec) * SHORTFORM_FPS)),
    displayLines,
    wordLines,
    sectionIndex,
  };
}

function buildWordTimedScenes(words, sectionRanges, durationSec) {
  const sentences = groupWordsIntoSentences(words);
  if (!sentences.length) return [];

  return sentences
    .map((sentence, index) => {
      const startSec = clamp(sentence.startSec, 0, durationSec);
      const nextSentence = sentences[index + 1];
      const rawEndSec = nextSentence
        ? Math.min(nextSentence.startSec, sentence.endSec + 0.18)
        : sentence.endSec;
      const endSec = clamp(Math.max(startSec + 0.2, rawEndSec), startSec + 0.2, durationSec);
      const displayLines = splitDisplayLines(sentence.text);
      const wordLines = assignWordsToLines(sentence.words, displayLines);
      const midpoint = (startSec + endSec) / 2;

      return createScene({
        id: sentence.id,
        text: sentence.text,
        startSec,
        endSec,
        displayLines,
        wordLines,
        sectionIndex: getSectionIndexForTime(sectionRanges, midpoint),
      });
    })
    .filter((scene) => scene.durationInFrames > 0);
}

function buildSegmentTimedScenes(entries, sectionRanges, durationSec) {
  if (!entries.length) return [];

  const scenes = [];

  entries.forEach((entry, index) => {
    const displayLines = splitDisplayLines(entry.text);
    if (!displayLines.length) return;

    const startSec = clamp(entry.start, 0, durationSec);
    const nextEntry = entries[index + 1];
    const rawEndSec = entry.end === null
      ? (nextEntry ? nextEntry.start : durationSec)
      : entry.end;
    const endSec = clamp(Math.max(startSec + 0.25, rawEndSec), startSec + 0.25, durationSec);
    const totalChars = displayLines.reduce((sum, line) => sum + Math.max(1, getCompactLength(line)), 0) || displayLines.length;
    let cursor = startSec;

    displayLines.forEach((line, lineIndex) => {
      const remaining = Math.max(0.2, endSec - cursor);
      const lineChars = Math.max(1, getCompactLength(line));
      const rawDuration = lineIndex === displayLines.length - 1
        ? remaining
        : (endSec - startSec) * (lineChars / totalChars);
      const lineEndSec = lineIndex === displayLines.length - 1
        ? endSec
        : clamp(cursor + rawDuration, cursor + 0.2, endSec);
      const midpoint = (cursor + lineEndSec) / 2;

      scenes.push(createScene({
        id: `segment-${index}-${lineIndex}`,
        text: line,
        startSec: cursor,
        endSec: lineEndSec,
        displayLines: [line],
        wordLines: [],
        sectionIndex: getSectionIndexForTime(sectionRanges, midpoint),
      }));

      cursor = lineEndSec;
    });
  });

  return scenes;
}

function buildFallbackScenes(lines, sectionRanges, durationSec) {
  if (!lines.length) {
    return [createScene({
      id: 'fallback-empty',
      text: '대본이 비어 있습니다.',
      startSec: 0,
      endSec: durationSec,
      displayLines: ['대본이 비어 있습니다.'],
      wordLines: [],
      sectionIndex: 0,
    })];
  }

  const totalChars = lines.reduce((sum, line) => sum + Math.max(1, getCompactLength(line)), 0) || lines.length;
  let cursor = 0;

  return lines.map((line, index) => {
    const lineChars = Math.max(1, getCompactLength(line));
    const remaining = Math.max(0.5, durationSec - cursor);
    const rawDuration = index === lines.length - 1
      ? remaining
      : durationSec * (lineChars / totalChars);
    const endSec = index === lines.length - 1
      ? durationSec
      : clamp(cursor + rawDuration, cursor + 0.5, durationSec);
    const midpoint = (cursor + endSec) / 2;
    const scene = createScene({
      id: `fallback-${index}`,
      text: line,
      startSec: cursor,
      endSec,
      displayLines: [line],
      wordLines: [],
      sectionIndex: getSectionIndexForTime(sectionRanges, midpoint),
    });
    cursor = endSec;
    return scene;
  });
}

function normalizeMotionSpeed(value) {
  return ['slow', 'normal', 'fast'].includes(value) ? value : 'normal';
}

function normalizeTextRevealMode(value) {
  return ['line', 'paragraph'].includes(value) ? value : 'line';
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
  const sectionRanges = buildSectionRanges(sections, effectiveDurationSec);

  const normalizedWords = normalizeTimedEntries(inputProps?.sttWords, trimStartSec, effectiveDurationSec)
    .filter((entry) => entry.end !== null);
  const normalizedSegments = normalizeTimedEntries(inputProps?.sttSegments, trimStartSec, effectiveDurationSec);

  const textScenes = normalizedWords.length
    ? buildWordTimedScenes(normalizedWords, sectionRanges, effectiveDurationSec)
    : normalizedSegments.length
        ? buildSegmentTimedScenes(normalizedSegments, sectionRanges, effectiveDurationSec)
        : buildFallbackScenes(lines, sectionRanges, effectiveDurationSec);

  return {
    durationSec: effectiveDurationSec,
    durationInFrames: Math.max(1, Math.round(effectiveDurationSec * SHORTFORM_FPS)),
    visuals,
    visualSpans,
    textScenes,
    sectionRanges,
    trimStartSec,
    trimEndSec,
    motionSpeed: normalizeMotionSpeed(inputProps?.motionSpeed),
    textRevealMode: normalizeTextRevealMode(inputProps?.textRevealMode),
  };
}
