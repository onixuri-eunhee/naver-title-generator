/**
 * 숏폼 캡션 폴백 생성기 — Claude가 captionInstagram/captionYouTube를 누락했을 때만 호출.
 *
 * 기존 route.js (Legacy path) / script-flow.js (Phase D path) 두 곳에 동일한
 * "[hook, cta, #해시태그]" 폴백 코드가 중복돼 있었고, 두 플랫폼 본문이 똑같아지는
 * 버그가 있었음. 이 모듈이 단일 진실 공급자(single source of truth)로서
 *   - Instagram: 압축 후킹 + 저장 CTA + 해시태그 5종 (본문 2블록)
 *   - YouTube:   후킹 + 본문 요약 + CTA + 구독 유도 + #Shorts (본문 4블록)
 * 구조적으로 다른 캡션을 생성해 동일화 방지.
 *
 * 원칙:
 *  - scenes 만으로 구성 가능 (외부 API 호출 없음)
 *  - Instagram ≠ YouTube 구조 보장
 *  - YouTube는 항상 #Shorts 포함
 *  - 길이 상한: IG 300자, YT 500자 (슬라이스)
 */

const IG_HASHTAGS = '#릴스 #숏폼 #인스타 #자영업 #꿀팁';
const YT_HASHTAGS = '#Shorts #쇼츠 #숏츠';

/**
 * @param {Array<{ script?: string }>} scenes
 * @returns {{ captionInstagram: string, captionYouTube: string }}
 */
export function buildCaptionFallbacks(scenes) {
  const arr = Array.isArray(scenes) ? scenes : [];
  const clean = (s) => (typeof s === 'string' ? s.trim() : '');
  const hook = clean(arr[0]?.script);
  const cta = clean(arr[arr.length - 1]?.script);
  const middle = arr
    .slice(1, Math.max(1, arr.length - 1))
    .map((s) => clean(s?.script))
    .filter(Boolean);

  // Instagram — 2블록: 후킹 + 저장 CTA + 해시태그
  const igParts = [
    hook,
    '저장해두고 필요할 때 꺼내보세요. 프로필에 더 많은 팁이 있어요.',
    IG_HASHTAGS,
  ].filter(Boolean);
  const captionInstagram = igParts.join('\n\n').slice(0, 300);

  // YouTube — 4블록: 후킹 + 본문 요약(최대 2씬) + CTA + 구독 유도 + 해시태그
  const pointSummary = middle.slice(0, 2).join(' ');
  const ytParts = [
    hook,
    pointSummary,
    cta,
    '도움되셨다면 구독 부탁드려요. 알림 설정하면 다음 편도 바로 보실 수 있어요.',
    YT_HASHTAGS,
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
      .replace(/#[^\s#]+/g, '')        // 해시태그 제거
      .replace(/\s+/g, '')             // 모든 공백 제거
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
