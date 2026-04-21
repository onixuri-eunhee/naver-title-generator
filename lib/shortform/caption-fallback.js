/**
 * 숏폼 캡션 폴백 생성기 — Claude가 captionInstagram/captionYouTube를 누락했을 때 호출.
 *
 * 목표:
 * - Instagram / YouTube 문법 차이를 구조적으로 보장
 * - scenes 기반으로 핵심 키워드와 본문 요약을 재구성
 * - YouTube에는 항상 #Shorts 포함
 * - 너무 짧거나 뻔한 2문장 캡션이 되지 않도록 방어
 */

const DEFAULT_IG_TAGS = ['릴스', '숏폼', '저장각', '실전팁', '꿀팁'];
const DEFAULT_YT_TAGS = ['Shorts', '쇼츠', '숏츠'];
const STOPWORDS = new Set([
  '그리고', '하지만', '그래서', '이번', '오늘', '바로', '정말', '진짜', '이거', '이건',
  '이제', '여기', '저기', '먼저', '다음', '마지막', '영상', '정리', '핵심', '설명',
  '방법', '이유', '문장', '한번', '한번에', '하나', '둘', '세', '번째', '해주세요',
  '해보세요', '드릴게요', '드립니다', '있어요', '좋아요', '부탁드려요', '구독',
  '알림', '설정', '프로필', '저장', '필요', '정도', '때문', '관련', '콘텐츠',
]);

function cleanText(value) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

function trimBlock(text, maxLength) {
  const normalized = cleanText(text);
  if (!normalized) return '';
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function extractKeywords(scripts) {
  const counts = new Map();
  scripts
    .flatMap((script) => cleanText(script).match(/[가-힣A-Za-z0-9]+/g) || [])
    .map((token) => token.replace(/^[^가-힣A-Za-z0-9]+|[^가-힣A-Za-z0-9]+$/g, ''))
    .filter((token) => token.length >= 2 && token.length <= 12)
    .filter((token) => !/^\d+$/.test(token))
    .filter((token) => !STOPWORDS.has(token))
    .forEach((token) => {
      counts.set(token, (counts.get(token) || 0) + 1);
    });

  return [...counts.entries()]
    .sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1];
      return a[0].length - b[0].length;
    })
    .map(([token]) => token)
    .slice(0, 5);
}

function buildHashtagBlock(primaryTags, keywords, maxTags) {
  const tags = [];
  const pushTag = (token) => {
    const normalized = cleanText(token).replace(/\s+/g, '');
    if (!normalized) return;
    if (tags.includes(normalized)) return;
    tags.push(normalized);
  };

  primaryTags.forEach(pushTag);
  keywords.forEach(pushTag);

  return tags
    .slice(0, maxTags)
    .map((tag) => `#${tag}`)
    .join(' ');
}

function buildPointSummary(middleScripts) {
  const summary = middleScripts
    .filter(Boolean)
    .slice(0, 2)
    .join(' ');
  return trimBlock(summary, 120);
}

/**
 * @param {Array<{ script?: string }>} scenes
 * @returns {{ captionInstagram: string, captionYouTube: string }}
 */
export function buildCaptionFallbacks(scenes) {
  const arr = Array.isArray(scenes) ? scenes : [];
  const scripts = arr.map((scene) => cleanText(scene?.script)).filter(Boolean);
  const hook = trimBlock(scripts[0] || '이번 영상 핵심만 빠르게 정리해드릴게요.', 70);
  const cta = trimBlock(scripts[scripts.length - 1] || '저장해두셨다가 필요할 때 바로 꺼내보세요.', 90);
  const middle = scripts.slice(1, Math.max(1, scripts.length - 1));
  const pointSummary = buildPointSummary(middle);
  const keywords = extractKeywords(scripts);
  const primaryKeyword = keywords[0] || '실전팁';
  const secondaryKeyword = keywords[1] || primaryKeyword;
  const instagramHashtags = buildHashtagBlock(DEFAULT_IG_TAGS, keywords, 7);
  const youtubeHashtags = buildHashtagBlock(DEFAULT_YT_TAGS, keywords, 5);

  const igParts = [
    hook,
    pointSummary
      ? trimBlock(`${pointSummary} 저장해두시면 다시 찾기 쉽습니다.`, 130)
      : trimBlock(`${primaryKeyword} 핵심만 바로 써먹기 좋게 짧게 정리해드렸어요. 저장해두세요.`, 130),
    trimBlock(`프로필에서 ${primaryKeyword} 관련 더 많은 팁도 보실 수 있어요.`, 70),
    instagramHashtags,
  ].filter(Boolean);
  const captionInstagram = igParts.join('\n\n').slice(0, 300);

  const ytParts = [
    hook,
    pointSummary
      ? trimBlock(`이번 영상에서는 ${pointSummary}`, 160)
      : trimBlock(`${primaryKeyword} 시작하실 때 바로 적용할 수 있는 기준을 담았습니다.`, 160),
    trimBlock(`실전 적용 포인트는 ${cta}`, 130),
    trimBlock(`도움되셨다면 구독 부탁드려요. 다음 편에서는 ${secondaryKeyword}까지 이어서 정리해드릴게요.`, 90),
    youtubeHashtags,
  ].filter(Boolean);
  let captionYouTube = ytParts.join('\n\n').slice(0, 500);
  if (!/#\s*Shorts/i.test(captionYouTube)) {
    captionYouTube = `${captionYouTube}\n\n#Shorts`;
  }

  return { captionInstagram, captionYouTube };
}

/**
 * 두 캡션의 본문(해시태그 제거 후)이 동일한지 감지. validateScriptQuality /
 * callClaudeABis post-validation 에서 사용.
 *
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
export function captionsAreDuplicate(a, b) {
  if (!a || !b) return false;
  const strip = (s) =>
    String(s)
      .replace(/#[^\s#]+/g, '')
      .replace(/\s+/g, '')
      .trim();
  return strip(a) === strip(b);
}

/**
 * 캡션이 유효한지 (20자 이상 + 비어있지 않음) 확인.
 * @param {string} text
 * @returns {boolean}
 */
export function isValidCaption(text) {
  return typeof text === 'string' && text.trim().length >= 20;
}
