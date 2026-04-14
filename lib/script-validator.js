/**
 * Phase D — 대본 출력 검증.
 * 이모지 / 일반론 / 구조 (scenes 개수, hookType 존재, caption 길이) 체크.
 */

// 주요 유니코드 이모지 범위 (BMP + Emoticons + Symbols & Pictographs + Transport & Map)
const EMOJI_REGEX = /(\p{Emoji_Presentation}|\p{Extended_Pictographic})/gu;

/**
 * 일반론 표현 블랙리스트.
 * 벤치마킹 infographic에 자주 등장하는 AI 냄새 패턴.
 */
const GENERIC_PATTERNS = [
  /중요합니다/,
  /필수입니다/,
  /반드시 알아야 할/,
  /알아볼게요/,
  /정리해보겠습니다/,
  /꼭 기억해야/,
  /여러분$/m,
  /^안녕하세요/m,
];

/**
 * 텍스트에서 이모지 발견 위치와 문자열을 반환.
 * @returns {Array<{ char: string, index: number }>}
 */
export function detectEmojis(text) {
  if (!text) return [];
  const matches = [];
  let match;
  const re = new RegExp(EMOJI_REGEX);
  while ((match = re.exec(text)) !== null) {
    matches.push({ char: match[0], index: match.index });
  }
  return matches;
}

/**
 * 텍스트에서 이모지를 모두 제거 (후처리 자동 수정).
 */
export function stripEmojis(text) {
  if (!text) return text;
  return text.replace(EMOJI_REGEX, '').replace(/\s+/g, ' ').trim();
}

/**
 * 일반론 표현 검출. 검출된 패턴 목록 반환.
 */
export function detectGenericPhrases(text) {
  if (!text) return [];
  const hits = [];
  for (const pat of GENERIC_PATTERNS) {
    const m = text.match(pat);
    if (m) hits.push({ pattern: pat.source, match: m[0] });
  }
  return hits;
}

/**
 * 전체 출력 검증.
 *
 * @param {object} parsed - Claude 파싱 결과 { scenes, totalDuration, presetUsed, caption }
 * @param {object} opts - { durationSec, expectedSceneCount }
 * @returns {{ ok: boolean, warnings: string[], errors: string[], autoFixed: object }}
 */
export function validateScriptOutput(parsed, opts = {}) {
  const warnings = [];
  const errors = [];
  const { durationSec, expectedSceneCount } = opts;

  if (!parsed || typeof parsed !== 'object') {
    errors.push('parsed 객체가 없습니다.');
    return { ok: false, warnings, errors, autoFixed: parsed };
  }

  const scenes = Array.isArray(parsed.scenes) ? parsed.scenes : [];
  if (scenes.length === 0) {
    errors.push('scenes 배열이 비어 있습니다.');
  }

  // 씬 개수 검증 (경고만 — postProcessScenes가 이후 맞춤)
  if (expectedSceneCount && scenes.length !== expectedSceneCount) {
    warnings.push(`scenes 개수 ${scenes.length} ≠ 기대값 ${expectedSceneCount}. postProcessScenes가 조정할 예정.`);
  }

  // hookType 검증
  if (scenes[0] && !scenes[0].hookType) {
    warnings.push('scenes[0].hookType 누락. 후킹 유형 식별 불가.');
  }

  // 각 scene의 script 이모지 검증 + 자동 제거
  const fixedScenes = scenes.map((s, i) => {
    const emojis = detectEmojis(s.script);
    if (emojis.length > 0) {
      errors.push(`scene[${i}] script에 이모지 ${emojis.length}개 검출: ${emojis.map((e) => e.char).join('')}`);
    }
    const generic = detectGenericPhrases(s.script);
    if (generic.length > 0) {
      warnings.push(`scene[${i}] 일반론 표현: ${generic.map((g) => g.match).join(', ')}`);
    }
    return {
      ...s,
      script: stripEmojis(s.script),
    };
  });

  // 구조 검증: scenes 양 끝단 (Task D6)
  if (fixedScenes.length >= 2) {
    if (fixedScenes[0].section !== 'hook') {
      warnings.push(`scenes[0].section 이 'hook' 이 아님 (실제: ${fixedScenes[0].section})`);
    }
    if (fixedScenes[fixedScenes.length - 1].section !== 'cta') {
      warnings.push(`scenes[마지막].section 이 'cta' 가 아님 (실제: ${fixedScenes[fixedScenes.length - 1].section})`);
    }
  }

  // 중복 script 검증 (Task D6 — 같은 내용 반복 금지)
  const scriptSet = new Set();
  fixedScenes.forEach((s, i) => {
    const normalized = (s.script || '').replace(/\s+/g, '');
    if (!normalized) return;
    if (scriptSet.has(normalized)) {
      warnings.push(`scene[${i}] script 중복 (이전 씬과 동일)`);
    }
    scriptSet.add(normalized);
  });

  // caption 검증
  let fixedCaption = parsed.caption || '';
  const captionEmojis = detectEmojis(fixedCaption);
  if (captionEmojis.length > 0) {
    errors.push(`caption에 이모지 ${captionEmojis.length}개 검출: ${captionEmojis.map((e) => e.char).join('')}`);
    fixedCaption = stripEmojis(fixedCaption);
  }
  const captionGeneric = detectGenericPhrases(fixedCaption);
  if (captionGeneric.length > 0) {
    warnings.push(`caption 일반론 표현: ${captionGeneric.map((g) => g.match).join(', ')}`);
  }

  // 총 글자수 (대략적)
  const totalChars = fixedScenes.reduce((sum, s) => sum + (s.script || '').replace(/\s+/g, '').length, 0);
  if (durationSec) {
    const expected = durationSec * 5;
    const tolerance = Math.ceil(expected * 0.3);
    if (Math.abs(totalChars - expected) > tolerance) {
      warnings.push(`총 글자수 ${totalChars} ≠ 기대값 ${expected}±${tolerance}`);
    }
  }

  return {
    ok: errors.length === 0,
    warnings,
    errors,
    autoFixed: {
      ...parsed,
      scenes: fixedScenes,
      caption: fixedCaption,
    },
  };
}
