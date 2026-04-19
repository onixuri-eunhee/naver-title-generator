import {
  getRedis,
  resolveAdmin,
  extractToken,
  resolveSessionEmail,
  getClientIp,
  jsonResponse,
  handleOptions,
} from '@/lib/api-helpers';
import { getDb, logUsage } from '@/lib/db';
import { generateScriptFlow } from '@/lib/script-flow';
import { buildPromptContextForEmail } from '@/lib/brand-kit';
import {
  publishProgress,
  checkCancelled,
  createJobId,
  cleanupJob,
} from '@/lib/job-progress';
import { CancelledError } from '@/lib/cancelled-error';
// Phase A-bis: settings SSOT — migrate + validate + _version 주입
import {
  migrateSettings,
  validateSettings,
  SETTINGS_SCHEMA_VERSION,
} from '@/lib/shortform/settings.js';
import {
  buildSystemPrompt as buildSystemPromptABis,
  buildUserPrompt as buildUserPromptABis,
  buildSystemPromptSlim,
} from '@/lib/shortform/prompt.js';
import { validateScriptQuality } from '@/lib/shortform/prompt-validator.js';
import { safeParseJson } from '@/lib/shortform/parse-claude-json.js';
import { getReasoningExamples } from '@/lib/shortform/reasoning-copy.js';
import { getDesignTokens } from '@/lib/shortform/design-tokens.js';

export const maxDuration = 300;

// 원가 기반 70% 마진 통일 가격 (2026-04-15 개정)
// 원가 분석 기반: 숏폼 Kling 2클립($0.56) / 롱폼 Kling 1클립($0.28) 고정
const SHORTFORM_CREDIT_COSTS = { 30: 6, 45: 10, 60: 11, 90: 12 };
const LONGFORM_CREDIT_COSTS = { 180: 12, 300: 17, 600: 29 };
const CREDIT_COSTS = {
  shortform: SHORTFORM_CREDIT_COSTS,
  longform: LONGFORM_CREDIT_COSTS,
};
const MODEL = 'claude-opus-4-6';

const SCENE_COUNTS = { 30: 7, 45: 10, 60: 14, 90: 20 };
const LONGFORM_SCENE_COUNT = 7;
const VALID_SHORTFORM_DURATIONS = [30, 45, 60, 90];
const VALID_LONGFORM_DURATIONS = [180, 300, 600];

const CONCEPTS = {
  cinematic: {
    visualStyle: 'warm cinematic, golden hour lighting, shallow depth of field, film grain',
    textCard: 'dark-gradient',
  },
  minimal: {
    visualStyle: 'clean minimal, white background, soft shadows, modern aesthetic',
    textCard: 'white-clean',
  },
  dynamic: {
    visualStyle: 'vibrant colors, high contrast, bold composition, urban energy',
    textCard: 'bold-accent',
  },
  natural: {
    visualStyle: 'natural daylight, candid feel, organic textures, everyday life',
    textCard: 'soft-overlay',
  },
};

function resolveConcept(concept) {
  if (concept === 'random') {
    const keys = Object.keys(CONCEPTS);
    const picked = keys[Math.floor(Math.random() * keys.length)];
    return { key: picked, ...CONCEPTS[picked] };
  }
  return CONCEPTS[concept] ? { key: concept, ...CONCEPTS[concept] } : { key: 'cinematic', ...CONCEPTS.cinematic };
}

// ─────────────────────────────────────────────────────────────────────────────
// LEGACY: 기존 SYSTEM_PROMPT — Phase A-bis prompt.js로 교체됨.
// scripts/test-shortform-prompt.mjs 역호환용으로 export 유지.
// 본 POST 핸들러는 이 상수를 더 이상 사용하지 않음.
// ─────────────────────────────────────────────────────────────────────────────
export const SYSTEM_PROMPT = `당신은 한국어 숏폼 영상 대본 작가입니다. 사용자의 입력을 바탕으로 숏폼 대본을 scenes 배열로 작성하세요.

[절대 규칙]
1. 반드시 존댓말만 사용하세요. 반말, 유행어 남발, 과장된 말투는 금지입니다.
2. 출력은 설명 없이 순수 JSON 객체 하나만 반환하세요. 마크다운 코드블록, 부가 설명, 서문 금지입니다.
3. 사실은 사용자가 제공한 topic과 blogText 안에서만 사용하세요. 입력에 없는 구체적 수치나 사례를 지어내지 마세요.
4. 구어체로 자연스러운 내레이션 문장을 작성하세요. 문어체 금지.
5. 한 문장에 하나의 정보만. 숫자는 구체적으로 (많이→87%, 대부분→10명 중 8명).
6. 같은 말 반복 절대 금지. 씬마다 반드시 새로운 정보를 전달하세요. 표현만 바꿔 같은 내용을 되풀이하면 실패입니다.
7. 한 씬의 script는 권장 32자(공백 포함). 한국어 문법 정확성이 글자수보다 우선입니다. 문법이 깨질 것 같으면 글자수를 넘어가지 말고 씬을 나누세요. 조사/어미 하나 틀리면 의미가 파괴됩니다.
8. 생성 전 한 번 더: 각 script를 소리 내 읽었을 때 자연스러운가? 어색한 표현은 즉시 고치세요.

[후킹 공식 — 6종 다양성 유지, 공감 베이스]
모든 후킹은 시청자가 "내 얘긴가?" 느끼게 만드는 게 출발점입니다.
6종 중 토픽에 가장 잘 맞는 것을 매번 다르게 선택해 다양성 확보. 같은 운영자가 5개 영상 만들면 5개가 다 다른 유형이어야 합니다.

★ BAD (이렇게 쓰면 0점):
- "안녕하세요", "오늘은 ~에 대해 알아볼게요", "여러분 ~"
- "~해보셨나요?" (그냥 yes/no 질문)
- "~이 중요합니다" (누구나 아는 말)

★ GOOD 후킹 유형 6종 + 예시:
1. 질문형 (공감 질문 default): "요즘 ~ 많이 힘드시죠?" / "블로그 하루 3시간 쓰는데 왜 방문자가 10명일까요?"
2. 충격형 (공감 베이스 통념 뒤집기): "매출 줄어드는 거, 단순 경기 탓이 아닙니다" / "키워드 검색량, 높을수록 좋다고요? 틀렸습니다"
3. 비밀형 (희소성): "~인 사장님들만 아는 전략이 있어요" / "상위 1% 블로거만 쓰는 기능이 있습니다"
4. 증거형 (구체 결과): "이것 하나 바꿨더니 한 달 만에 ~" / "이 설정 하나로 방문자 3배"
5. 공감형 (고통 동일시): "저도 ~로 6개월 헤맸어요" / "매일 글 쓰는데 상위노출 안 되죠?"
6. 경고형 (손실 경고): "이 실수 하나가 ~을 다 날립니다" / "이거 모르고 쓰면 광고비만 새요"

★ 후킹 품질 체크리스트 (scenes[0] 작성 후 자가검증):
□ 첫 문장만 읽고도 "다음이 궁금한가?" → 아니면 다시 쓰세요
□ 시청자가 "내 얘긴가?" 느끼는가?
□ 구체적 숫자나 기간이 들어갔는가? (3배, 6개월, 10명 등)
□ "~에 대해 알아볼게요" 패턴이 아닌가?

★ scenes[0]에 반드시 "hookType" 필드 출력: 사용한 유형을 명시 (질문형 | 충격형 | 비밀형 | 증거형 | 공감형 | 경고형 중 하나).
   같은 토픽이라도 매 생성마다 **다른 유형**을 고르세요. "토픽 특성상 질문형이 자연스럽다" 같은 판단 금지 — 6종은 모두 어떤 토픽에도 적용 가능합니다.

[대본 구조 — fingr식 공감 루프]
도입부 1/3까지 시청자가 "내 이야긴가?" 느끼게 만들어 끝까지 보게 합니다.
총 씬 수에 따라 다음 구조를 base로 삼되, 변주를 허용합니다.

▶ 7씬 (30초) — 1사이클:
  scene[0] 공감 질문 (Hook)
  scene[1] 마음읽기 질문 — "솔직히 ~ 싶으셨을 거예요"
  scene[2] 상황 설명 — "그런데 사실 ~"
  scene[3] 통념 깨기 — "이건 ~ 때문이 아니라 ~"
  scene[4] 약속/해법 — "이렇게 하면 ~"
  scene[5] 사례 + 경험 (메모 녹임 지점) — "어제 ~했어요"
  scene[6] CTA 동료 호출

▶ 10씬 (45초) — 1.5사이클: 7씬 base + scene[5~8]에 [마음읽기2 / 사례2 / 작은 약속] 삽입
▶ 14씬+ (60~90초) — 2사이클+: 10씬 base에 [추가 마음읽기 / 두 번째 사례 / 작은 약속] 자유 반복

★ scene[1]은 반드시 마음읽기 질문 형태로 작성하세요. ("솔직히 ~", "혹시 ~ 아니세요?", "~ 싶으셨을 거예요")
★ 구조 변주 강제: 같은 base여도 매번 표현·순서가 달라야 합니다. 템플릿화 금지.

[Point 작성 규칙]
- 추상 나열 금지. 구체 장면/숫자/감정만 씁니다.

  ★ 메모(personaMemo)가 있으면: Point 중 최소 2씬에 메모를 활용.
    (1) 한 씬은 **메모의 직업/업종/정체성**을 살림 — "15년차 디자이너인데", "카페 사장님이신데" 등
    (2) 다른 한 씬은 메모의 구체 장면/숫자를 압축 인용
    원문 그대로 X — 핵심 감정/장면/숫자만 추출해 숏폼 톤으로 재구성.
    예) 메모 "15년차 헤어 디자이너, 손님이 '여기 물 맛있다'고 했을 때 뿌듯했음"
        → 씬A "15년차 디자이너도 처음엔 막막했어요" (정체성)
        → 씬B "손님 물 맛있다 한마디에 울컥했어요" (장면)

  ★ 메모가 없으면: 관찰형 1인칭 사용 — Point 중 최소 1씬에 반드시 등장
    허용 패턴: "~인 분들 많으세요", "저도 처음엔 ~인 줄 알았는데", "~하시는 분들 공통된 고민이에요"
    금지: 선언문만 나열 ("AI는 적이 아닙니다", "~이 중요합니다" 등)

  ★ 나열 vs 경험 예시 (반드시 후자):
    ❌ "키워드 분석, 카테고리 설정, 콘텐츠 발행이 중요합니다"
    ⭕ "어제 알림 50개 떴어요"
    ❌ "꾸준한 노력이 필요합니다"
    ⭕ "6개월간 매일 쓰다가 한 달 쉬었더니 다 무너졌어요"

[CTA 작성 규칙]
- 마지막 1~2씬은 정형 문구 금지. 시청자를 동료로 호출하세요.

  ★ 금지 문구 (이걸 쓰면 실패):
    "궁금한 점 댓글로 남겨주세요"
    "유용했다면 팔로우 부탁드려요"
    "도움 됐으면 좋아요"
    "나중에 다시 보려면 저장해두세요"
    "감사합니다"

  ★ 허용 톤 예시:
    "혹시 비슷한 경험 있으면 댓글로 알려주세요"
    "다음 영상에서 더 깊이 다뤄볼까요?"
    메모 있을 때: "저처럼 [메모 핵심 키워드]로 고민이라면 댓글 남겨주세요"

  ★ CTA도 28자 제약 동일 적용

[첫 씬 규칙 — 매우 중요]
- scenes[0]은 반드시 type: "broll" (텍스트 카드 아님)
- scenes[0]의 script는 후킹 공식을 적용한 강렬한 첫 문장
- scenes[0]의 visual은 "scroll-stopping"한 구체적 영어 이미지 설명 (dramatic, high contrast, cinematic 포함)
- scenes[0]에 hookText 필드 추가: 화면에 크게 표시할 후킹 핵심 문구 (한국어, 12자 이내, 임팩트 있게)

[출력 JSON 스키마]
{
  "scenes": [
    {
      "script": "대본 문장 (한국어, 1문장, 권장 32자, 문법 우선)",
      "section": "hook | point | cta",
      "type": "broll",
      "visual": "구체적인 영어 B-roll 이미지 설명",
      "hookText": "(첫 씬만) 화면에 크게 표시할 후킹 문구 (한국어, 12자 이내)",
      "hookType": "(첫 씬만) 질문형|충격형|비밀형|증거형|공감형|경고형 중 하나"
    }
  ]
}

[scenes 규칙]
- scenes 개수는 targetSceneCount에 맞추세요
- 각 scene의 script는 반드시 1문장, 권장 32자 (문법이 깨지면 글자수 완화). SEDA 원칙: 짧고(Short), 쉽고(Easy), 직접적이고(Direct), 행동을 유도(Actionable).
- type은 모든 씬에서 반드시 "broll"만 사용. text 타입은 사용 금지.
- visual은 구체적인 영어 이미지 설명 (예: "close-up of hands typing on laptop")
- section은 Hook → Point → CTA 흐름에 맞게 배정
- hookText와 hookType은 scenes[0]에만 포함, 나머지 씬에는 생략
`;

// LEGACY: scripts/test-shortform-prompt.mjs 역호환용 export
export function buildUserPrompt(topic, blogText, tone, targetDurationSec, targetSceneCount, benchmark, personaMemo) {
  const inputSummary = [
    `tone: ${tone}`,
    `targetDuration: ${targetDurationSec}초`,
    `targetSceneCount: ${targetSceneCount}`,
    topic ? `topic: ${topic}` : null,
    blogText ? `blogText:\n${blogText}` : null,
    `personaMemo: ${(personaMemo && personaMemo.trim()) ? personaMemo.trim() : '(없음)'}`,
  ].filter(Boolean).join('\n\n');

  let benchmarkSection = '';
  if (benchmark && benchmark.patterns && !benchmark.fallback) {
    const p = benchmark.patterns;
    const videoList = (benchmark.videos || []).slice(0, 3).map((v, i) =>
      `  ${i + 1}. "${v.title}" (조회수 ${(v.viewCount || 0).toLocaleString()}, 구독자 ${(v.subscriberCount || 0).toLocaleString()}, 비율 ${(v.viewToSubRatio || 0).toFixed(1)}배)`
    ).join('\n');

    benchmarkSection = `

[★★★ 벤치마킹 — 이 키워드에서 실제로 조회수가 터진 공식. 이 규칙을 어기면 실패 ★★★]

실제 바이럴 영상 (구독자 낮은데 조회수 높은 영상):
${videoList}

이 영상들의 공통 패턴 (반드시 동일하게 적용):
1. 후킹 유형: ${p.hookType || '미분석'} → scenes[0]에 이 유형 그대로 적용
2. 후킹 패턴: ${p.hookPattern || '미분석'} → 이 패턴대로 첫 문장 구성
3. 대본 구조: ${p.structure || '미분석'} → 이 구조를 그대로 따를 것
4. 바이럴 공식: ${p.viralFormula || '미분석'} → 모든 씬에 이 공식 적용

추천 첫 문장: "${p.suggestedHook || ''}"
→ 이 문장의 구조와 톤을 유지하면서 더 강렬하게 변형

[위반 금지]
- 벤치마킹 후킹 유형을 무시하고 다른 유형을 쓰면 실패
- 벤치마킹 대본 구조와 다른 구조를 쓰면 실패
- 벤치마킹 바이럴 공식을 반영하지 않으면 실패
- 이 규칙은 [절대 규칙]보다 우선합니다`;
  }

  return `${inputSummary}${benchmarkSection}

위 입력을 바탕으로 숏폼 영상 대본을 scenes 배열로 작성하세요.
- scenes 개수: 정확히 ${targetSceneCount}개
- 각 scene의 script를 합산한 총 글자수(공백 제외)가 ${targetDurationSec}초 분량에 맞아야 합니다. 최소 ${Math.round(targetDurationSec * 4.8)}자, 목표 ${targetDurationSec * 5}자. 부족하면 Point 씬을 보강하세요.
- Hook → Point(공감 루프) → CTA가 각각 뚜렷해야 합니다.
- 너무 긴 서론 없이 바로 몰입되게 시작하세요.
- 위 [대본 구조] base를 따르되 매번 변주하세요. 템플릿화 금지.
- personaMemo가 있으면 Point 중 최소 1씬에 가공해 녹이세요. 없으면 관찰형 1인칭으로.`;
}

function extractClaudeText(data) {
  return (data?.content || [])
    .filter((block) => block?.type === 'text' && block?.text)
    .map((block) => block.text)
    .join('\n')
    .trim();
}

function extractJsonObject(rawText) {
  const trimmed = rawText.trim();

  try {
    return JSON.parse(trimmed);
  } catch (_) {}

  const fenced = trimmed.match(/```json\s*([\s\S]*?)```/i) || trimmed.match(/```\s*([\s\S]*?)```/);
  if (fenced?.[1]) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch (_) {}
  }

  const start = trimmed.indexOf('{');
  if (start === -1) {
    throw new Error('Claude 응답에서 JSON 객체를 찾을 수 없습니다.');
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < trimmed.length; i++) {
    const char = trimmed[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === '{') depth += 1;
    if (char === '}') depth -= 1;
    if (depth === 0) {
      return JSON.parse(trimmed.slice(start, i + 1));
    }
  }

  throw new Error('Claude 응답 JSON 파싱에 실패했습니다.');
}

function toSentence(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function postProcessScenes(scenes, targetSceneCount) {
  if (!Array.isArray(scenes) || scenes.length === 0) return scenes;

  while (scenes.length < targetSceneCount && scenes.length > 0) {
    const longest = scenes.reduce((max, s, i) => s.script.length > (scenes[max]?.script.length || 0) ? i : max, 0);
    const s = scenes[longest];
    const mid = Math.ceil(s.script.length / 2);
    const breakAt = s.script.indexOf('.', mid - 10);
    const splitPos = breakAt > 0 && breakAt < s.script.length - 2 ? breakAt + 1 : mid;
    const first = { ...s, script: s.script.slice(0, splitPos).trim() };
    const second = { ...s, script: s.script.slice(splitPos).trim() };
    scenes.splice(longest, 1, first, second);
  }
  while (scenes.length > targetSceneCount && scenes.length > 1) {
    let shortestIdx = 0;
    for (let i = 1; i < scenes.length - 1; i++) {
      if (scenes[i].script.length < scenes[shortestIdx].script.length) shortestIdx = i;
    }
    const mergeWith = shortestIdx > 0 ? shortestIdx - 1 : shortestIdx + 1;
    const [a, b] = shortestIdx < mergeWith ? [shortestIdx, mergeWith] : [mergeWith, shortestIdx];
    scenes[a] = { ...scenes[a], script: scenes[a].script + ' ' + scenes[b].script };
    scenes.splice(b, 1);
  }

  if (scenes[0] && scenes[0].type !== 'broll') {
    scenes[0] = { ...scenes[0], type: 'broll', visual: 'scroll-stopping dramatic cinematic visual for the narration' };
  }
  if (scenes[0] && !scenes[0].hookText) {
    scenes[0].hookText = scenes[0].script.replace(/[^가-힣a-zA-Z0-9\s]/g, '').slice(0, 12);
  }

  scenes.forEach((s) => {
    if (s.type !== 'broll') {
      s.type = 'broll';
      if (!s.visual || !/[a-zA-Z]/.test(s.visual)) {
        s.visual = 'supporting visual for the narration';
      }
    }
  });

  return scenes;
}

/**
 * 롱폼 전용 payload 빌더 — section/type 보존.
 * postProcessScenes(숏폼 전용 greedy 병합/분할) 건드리지 않음.
 * 7씬 구조 (hook / body1~4 / conclusion / cta) 검증만 수행.
 */
const LONGFORM_SECTIONS = ['hook', 'body1', 'body2', 'body3', 'body4', 'conclusion', 'cta'];

function buildLongformScriptPayload(parsed, concept) {
  let scenes = Array.isArray(parsed?.scenes) ? parsed.scenes : [];
  scenes = scenes.filter((s) => s && typeof s.script === 'string' && s.script.trim());

  if (scenes.length < 3) {
    throw new Error('Claude 롱폼 응답에서 유효한 scenes가 3개 미만입니다.');
  }

  scenes.forEach((s, i) => {
    s.script = toSentence(s.script);
    // 섹션 기본값 보정 — 없거나 잘못되면 위치 기반 추론
    if (!LONGFORM_SECTIONS.includes(s.section)) {
      s.section = LONGFORM_SECTIONS[i] || 'body1';
    }
    // scene type (v2.1) 보존. 허용값 아니면 text 폴백.
    const allowed = ['text', 'comparison', 'emphasis', 'testimonial', 'data', 'flow', 'broll'];
    if (!allowed.includes(s.type)) s.type = 'text';
    if (s.type === 'broll') s.type = 'text'; // 롱폼은 broll 개념 없음
    s.visual = toSentence(s.visual) || 'long-form cinematic supporting visual for the narration';
  });

  // 7씬에 못 미치면 마지막 씬 복제로 패딩 (Claude가 짧게 내린 경우)
  while (scenes.length < 7) {
    const last = scenes[scenes.length - 1];
    scenes.push({ ...last, section: LONGFORM_SECTIONS[scenes.length] || 'body4' });
  }
  // 7씬 초과면 절단
  if (scenes.length > 7) scenes = scenes.slice(0, 7);

  // 섹션 재할당 (위치 기반 고정)
  scenes.forEach((s, i) => { s.section = LONGFORM_SECTIONS[i]; });

  const hook = scenes[0]?.script || '';
  const body = scenes.slice(1, 5).map((s) => s.script);
  const conclusion = scenes[5]?.script || '';
  const cta = scenes[6]?.script || '';
  const fullScript = scenes.map((s) => s.script).join('\n\n');
  const spokenLength = fullScript.replace(/\s+/g, '').length;
  const estimatedSeconds = Math.max(1, Math.round(spokenLength / 5));

  const hookText = scenes[0]?.hookText || '';

  return {
    contentType: 'longform',
    hook,
    body,
    points: body, // 역호환 별칭
    conclusion,
    cta,
    fullScript,
    estimatedSeconds,
    scenes,
    visualStyle: concept.visualStyle,
    textCardTemplate: concept.textCard,
    conceptKey: concept.key,
    hookText,
  };
}

const SHORTFORM_SCENE_TYPES = ['text', 'comparison', 'emphasis', 'testimonial', 'data', 'flow'];

function buildScriptPayload(parsed, concept, targetSceneCount) {
  let scenes = Array.isArray(parsed?.scenes) ? parsed.scenes : [];

  scenes = scenes.filter((s) => s && typeof s.script === 'string' && s.script.trim());
  scenes.forEach((s) => {
    s.script = toSentence(s.script);
    s.section = ['hook', 'point', 'cta'].includes(s.section) ? s.section : 'point';
    // v2.1: scene type 보존 (text/comparison/emphasis/testimonial/data/flow).
    // 레거시 'broll' 또는 미지정 → 'text'로 통일. BodyScene이 type별 라우팅.
    if (!SHORTFORM_SCENE_TYPES.includes(s.sceneKind)) {
      // sceneKind에 원본 저장 (새 필드, Agent A의 scriptToProps가 읽음)
      const originalType = s.type;
      s.sceneKind = SHORTFORM_SCENE_TYPES.includes(originalType) ? originalType : 'text';
    }
    // 레거시 type 필드는 'broll'로 유지 (기존 postProcessScenes/파이프라인 호환)
    s.type = 'broll';
    s.visual = toSentence(s.visual) || 'generic B-roll scene';
  });

  if (scenes.length < 3) {
    throw new Error('Claude 응답에서 유효한 scenes가 3개 미만입니다.');
  }

  scenes = postProcessScenes(scenes, targetSceneCount);

  const visualStyle = concept.visualStyle;
  const textCardTemplate = concept.textCard;

  const hook = scenes.filter((s) => s.section === 'hook').map((s) => s.script).join(' ');
  const points = scenes.filter((s) => s.section === 'point').map((s) => s.script);
  const cta = scenes.filter((s) => s.section === 'cta').map((s) => s.script).join(' ');
  const fullScript = scenes.map((s) => s.script).join('\n\n');
  const spokenLength = fullScript.replace(/\s+/g, '').length;
  const estimatedSeconds = Math.max(1, Math.round(spokenLength / 5));

  const hookText = scenes[0]?.hookText || '';

  return {
    hook,
    points,
    cta,
    fullScript,
    estimatedSeconds,
    scenes,
    visualStyle,
    textCardTemplate,
    conceptKey: concept.key,
    hookText,
  };
}

// 내부 self-call 비밀키: Vercel Deployment Protection 우회 + 인증 바이패스용
// CRON_SECRET이 없으면 랜덤 fallback (매 cold-start마다 다름 → 사실상 비활성)
const INTERNAL_SECRET = process.env.CRON_SECRET || process.env.INTERNAL_API_SECRET || '';

async function fetchBenchmark(keyword, authHeader, jobId, contentType = 'shortform') {
  try {
    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL
      || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null)
      || 'http://localhost:3000';
    const res = await fetch(`${baseUrl}/api/shortform-benchmark`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(authHeader ? { Authorization: authHeader } : {}),
        // 내부 self-call 식별 헤더: benchmark route에서 인증 바이패스 허용
        ...(INTERNAL_SECRET ? { 'x-internal-secret': INTERNAL_SECRET } : {}),
      },
      // jobId 전달: shortform-benchmark가 같은 jobId로 진행 이벤트 발행
      // → 클라이언트가 키워드추출/후보영상검색 단계 SSE로 수신.
      // benchmark route는 body.keywords (복수) 를 읽으므로 keyword → keywords 매핑.
      body: JSON.stringify({ keywords: keyword, jobId, contentType }),
    });
    if (res.ok) return await res.json();
    const errText = await res.text().catch(() => '');
    console.warn(`[SHORTFORM-SCRIPT] Benchmark HTTP ${res.status}: ${errText.slice(0, 200)}`);
  } catch (e) {
    console.warn('[SHORTFORM-SCRIPT] Benchmark fetch failed:', e.message);
  }
  return { fallback: true, candidates: [], videos: [], patterns: null };
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase A-bis: inferCategory + classifyScriptType + callClaudeABis + withRetry
// spec §5.1 Happy Path 완전 이행. refine/route.js와 동일 패턴.
// ─────────────────────────────────────────────────────────────────────────────

const HAIKU_MODEL = 'claude-haiku-4-5-20251001';
const MAX_RETRIES = 2;
const BASE_DELAY_MS = 1000;

// ─────────────────────────────────────────────────────────────────────────────
// SLIM 프롬프트 롤아웃 — 이메일 해시 기반 deterministic bucket
// spec: docs/superpowers/plans/2026-04-18-shortform-prompt-slim.md Task 3
// ─────────────────────────────────────────────────────────────────────────────

function _simpleHash(str) {
  let h = 0;
  if (!str) return 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h) + str.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

function resolveSlimPromptFlag(email) {
  const raw = process.env.SHORTFORM_SLIM_PROMPT_ROLLOUT ?? '0';
  const rollout = Number.parseInt(raw, 10);
  if (!Number.isFinite(rollout) || rollout <= 0) return false;
  if (rollout >= 100) return true;
  return (_simpleHash(email || 'anon') % 100) < rollout;
}

const JITTER_MAX_MS = 300;
const VALID_CATEGORIES = ['wedding', 'food', 'realestate', 'ai_education', 'beauty', 'fitness', 'lifestyle', 'business', 'other'];
const VALID_SCRIPT_TYPES = ['question', 'list', 'story'];

async function inferCategory(topic) {
  if (!process.env.ANTHROPIC_API_KEY || !topic) return 'other';
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: HAIKU_MODEL,
        max_tokens: 50,
        temperature: 0,
        messages: [{
          role: 'user',
          content: `주제: "${topic}"\n\n위 주제의 카테고리를 아래 9종 중 정확히 하나만 답하세요. 모르면 가장 가까운 것을 고르세요.\n${VALID_CATEGORIES.join(' / ')}\n\n답(한 단어만):`,
        }],
      }),
    });
    const data = await res.json();
    const text = extractClaudeText(data).trim().toLowerCase();
    const match = VALID_CATEGORIES.find((c) => text.includes(c));
    return match || 'other';
  } catch (err) {
    console.warn('[shortform-script] inferCategory failed, fallback=other:', err?.message);
    return 'other';
  }
}

async function classifyScriptType(topic) {
  if (!process.env.ANTHROPIC_API_KEY || !topic) return 'question';
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 50,
        temperature: 0,
        messages: [{
          role: 'user',
          content: `주제: "${topic}"\n\n위 주제에 가장 어울리는 숏폼 스크립트 유형을 하나만 답하세요.\n- question: 질문으로 시작, 질문으로 끝나는 순환형\n- list: 핵심 포인트 나열 후 요약\n- story: 스토리텔링 흐름\n\n답(한 단어만):`,
        }],
      }),
    });
    const data = await res.json();
    const text = extractClaudeText(data).trim().toLowerCase();
    const match = VALID_SCRIPT_TYPES.find((t) => text.includes(t));
    return match || 'question';
  } catch (err) {
    console.warn('[shortform-script] classifyScriptType failed, fallback=question:', err?.message);
    return 'question';
  }
}

async function callClaudeABis({
  topic, blogText, tone, targetDurationSec,
  concept, targetSceneCount, benchmark, personaMemo, settings, layoutMode, email,
}) {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is not configured.');
  }

  // 1. settings 기반 category / scriptType 결정
  let category = settings.category;
  let scriptType = settings.scriptType;
  if (category === 'auto') {
    category = await inferCategory(topic || (blogText || '').slice(0, 100));
    console.log(`[SHORTFORM-SCRIPT] inferCategory → ${category}`);
  }
  if (scriptType === 'auto') {
    scriptType = await classifyScriptType(topic || (blogText || '').slice(0, 100));
    console.log(`[SHORTFORM-SCRIPT] classifyScriptType → ${scriptType}`);
  }

  // 2. reasoning 주입
  const reasoningExamples = getReasoningExamples(category);

  const useSlimPrompt = resolveSlimPromptFlag(email);

  // 3. withRetry + safeParseJson
  const runOnce = async (retryAttempt) => {
    const systemPrompt = useSlimPrompt
      ? buildSystemPromptSlim({ targetSceneCount })
      : buildSystemPromptABis({
          category,
          scriptType,
          firstThreeSeconds: settings.firstThreeSeconds || 'auto',
          reasoningExamples,
          contentType: 'short',
          visualStyle: layoutMode === 'kinetic' ? 'kinetic' : (concept?.visualStyle || 'image'),
          retryAttempt,
        });

    const userPrompt = buildUserPromptABis({
      topic,
      tone,
      targetSceneCount,
      targetDurationSec,
      blogText,
      personaMemo,
      benchmark,
    });

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 4000,
        temperature: 0.7,
        system: [
          { type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } },
        ],
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      const e = new Error(`Claude HTTP ${response.status}`);
      e.status = response.status;
      throw e;
    }

    const rawText = extractClaudeText(data);
    const parsed = safeParseJson(rawText);
    if (!parsed || !Array.isArray(parsed.scenes)) {
      // fallback: extractJsonObject (기존 파서도 시도)
      try {
        return extractJsonObject(rawText);
      } catch (_) {}
      const e = new Error('claude_json_parse_failed');
      e.code = 'claude_json_parse_failed';
      throw e;
    }
    return parsed;
  };

  let lastErr;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const parsed = await runOnce(attempt);

      // SLIM/FULL 모드 모두 post-generation 검증 + 메트릭 로깅
      const validation = validateScriptQuality(parsed);
      const emailPrefix = (email || 'anon').slice(0, 3) + '***';
      console.log(
        '[SHORTFORM-METRICS]',
        JSON.stringify({
          mode: useSlimPrompt ? 'slim' : 'full',
          attempt,
          ok: validation.ok,
          errors: validation.errors,
          warnings: validation.warnings,
          stats: validation.stats,
          emailPrefix,
          timestamp: new Date().toISOString(),
        }),
      );

      // SLIM 모드 전용: 심각한 errors(layoutType 누락/오타) → 재시도 유도
      if (useSlimPrompt && !validation.ok && attempt < MAX_RETRIES) {
        const e = new Error(`slim_validation_failed:${validation.errors.join(',')}`);
        e.code = 'slim_validation_failed';
        throw e;
      }

      const payload = buildScriptPayload(parsed, concept, targetSceneCount);
      // A-bis 메타데이터 주입
      payload._resolvedCategory = category;
      payload._resolvedScriptType = scriptType;
      return payload;
    } catch (err) {
      lastErr = err;
      const retriable =
        err?.code === 'claude_json_parse_failed' ||
        err?.code === 'slim_validation_failed' ||
        (typeof err?.status === 'number' && (err.status >= 500 || err.status === 429)) ||
        /ECONNRESET|ETIMEDOUT|fetch failed/i.test(err?.message || '');
      if (!retriable || attempt === MAX_RETRIES) throw err;
      const delay = BASE_DELAY_MS * Math.pow(2, attempt) + Math.random() * JITTER_MAX_MS;
      console.warn(`[shortform-script] retry attempt=${attempt + 1} delay=${Math.round(delay)}ms: ${err?.message}`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

export async function OPTIONS(request) {
  return handleOptions(request);
}

export async function GET(request) {
  try {
    const isAdmin = await resolveAdmin(request);
    if (isAdmin) {
      return jsonResponse(request, {
        remaining: 999,
        admin: true,
        creditCosts: SHORTFORM_CREDIT_COSTS,
        shortformCreditCosts: SHORTFORM_CREDIT_COSTS,
        longformCreditCosts: LONGFORM_CREDIT_COSTS,
      });
    }

    const email = await resolveSessionEmail(extractToken(request));
    if (!email) {
      return jsonResponse(request, {
        remaining: 0,
        loginRequired: true,
        creditCosts: SHORTFORM_CREDIT_COSTS,
        shortformCreditCosts: SHORTFORM_CREDIT_COSTS,
        longformCreditCosts: LONGFORM_CREDIT_COSTS,
      });
    }

    const freeUsed = await getRedis().get(`shortform-free:${email}`);
    const sql = getDb();
    const [user] = await sql`SELECT credits FROM users WHERE email = ${email}`;

    return jsonResponse(request, {
      freeAvailable: !freeUsed,
      credits: user?.credits || 0,
      creditCosts: SHORTFORM_CREDIT_COSTS,
      shortformCreditCosts: SHORTFORM_CREDIT_COSTS,
      longformCreditCosts: LONGFORM_CREDIT_COSTS,
    });
  } catch {
    return jsonResponse(request, {
      remaining: 0,
      creditCosts: SHORTFORM_CREDIT_COSTS,
      shortformCreditCosts: SHORTFORM_CREDIT_COSTS,
      longformCreditCosts: LONGFORM_CREDIT_COSTS,
    });
  }
}

/**
 * 숏폼 크레딧 차감 지점 (Phase I 결정).
 *
 * 차감 시점은 Step 7 영상 렌더 시작으로 이동 예정. Phase F(Preview) 완료 후
 * 실제 렌더 라우트가 이 함수를 호출. 현재는 skeleton — Phase F에서 wire-up.
 *
 * @param {object} params { email, durationSec, isFreeFirst }
 * @returns {Promise<{ charged: number, reason: string }>}
 */
export async function chargeShortformCredits(_params) {
  // TODO(Phase F): Step 7 진입 시 실제 차감 로직 이동.
  // 현재는 script 라우트가 크레딧을 직접 차감하지 않으므로 no-op.
  return { charged: 0, reason: 'pre-render: charging deferred to Step 7' };
}

export async function POST(request) {
  const body = await request.json().catch(() => ({}));

  // Phase I: jobId + SSE
  const jobId = body.jobId || createJobId();

  try {
    // 기존 필드 (역호환)
    const topic = toSentence(body.topic);
    const blogText = String(body.blogText || '').trim();
    const personaMemo = String(body.personaMemo || '').trim();
    const tone = body.tone === 'professional' ? 'professional' : 'casual';

    // Phase A-bis: settings 수신 + 마이그레이션 + 검증
    // 누락 시 DEFAULT_SETTINGS 병합(_version 자동 주입), 실패 시 경고만 로그 후 계속 진행.
    // 기존 SYSTEM_PROMPT 경로는 settings와 무관하게 그대로 유지 — 점진 전환 원칙.
    const settings = migrateSettings(body.settings || {});
    const settingsCheck = validateSettings(settings);
    if (!settingsCheck.ok) {
      console.warn(
        `[shortform-script] settings validation failed, continuing with merged defaults:`,
        settingsCheck.errors,
      );
    }

    // v2.1: contentType 분기 (shortform | longform)
    const contentType = body.contentType === 'longform' ? 'longform' : 'shortform';
    const isLongform = contentType === 'longform';

    const validDurations = isLongform ? VALID_LONGFORM_DURATIONS : VALID_SHORTFORM_DURATIONS;
    const defaultDuration = isLongform ? 180 : 30;
    const targetDurationSec = validDurations.includes(Number(body.targetDurationSec))
      ? Number(body.targetDurationSec)
      : defaultDuration;

    // 크레딧 비용 산출 (Phase F Step 7 실제 차감 시 사용)
    const creditCost = CREDIT_COSTS[contentType]?.[targetDurationSec] || 0;

    // Phase D 신규 필드
    const personaId = String(body.personaId || body.persona || '').trim();
    const customPersonaLabel = body.customPersonaLabel
      ? String(body.customPersonaLabel).slice(0, 30)
      : null;
    const customPersonaHint = body.customPersonaHint
      ? String(body.customPersonaHint).slice(0, 100)
      : null;
    const userExperience = String(body.userExperience || body.personaMemo || '').trim();
    const keywords = String(body.keywords || '').trim();
    const benchmarkAggregated = body.benchmarkAggregated || null;

    const layoutMode = body.visualStyle === 'kinetic' ? 'kinetic' : 'image';

    const conceptInput = ['cinematic', 'minimal', 'dynamic', 'natural', 'random'].includes(body.concept)
      ? body.concept
      : 'cinematic';
    const concept = resolveConcept(conceptInput);
    const targetSceneCount = isLongform
      ? LONGFORM_SCENE_COUNT
      : (SCENE_COUNTS[targetDurationSec] || SCENE_COUNTS[30]);

    if (!topic && !blogText && !keywords) {
      return jsonResponse(request, { error: 'topic/blogText/keywords 중 하나는 필요합니다.' }, { status: 400 });
    }

    const isAdmin = await resolveAdmin(request);
    const email = await resolveSessionEmail(extractToken(request));
    if (!isAdmin && !email) {
      return jsonResponse(request, { error: '로그인이 필요합니다.' }, { status: 401 });
    }

    let script;

    // Phase I: script-generation draft sub-step
    await publishProgress(jobId, {
      type: 'step',
      step: 'script-generation',
      status: 'running',
      progress: 0,
      subStep: 'draft',
    });
    await checkCancelled(jobId, 'script:draft-start');

    if (personaId) {
      // Phase D 경로: Genkit flow + Claude + 페르소나 + 벤치마킹 aggregated + 브랜드킷
      let brandContext = null;
      if (email) {
        brandContext = await buildPromptContextForEmail(email);
      }

      console.log(
        `[SHORTFORM-SCRIPT] Phase D path: type=${contentType} persona=${personaId} tone=${tone} dur=${targetDurationSec}s ` +
        `cost=${creditCost}cr benchmark=${benchmarkAggregated ? 'yes' : 'no'} brandKit=${brandContext ? 'yes' : 'no'}`
      );

      console.log(
        '[SHORTFORM-METRICS]',
        JSON.stringify({
          mode: 'phaseD_bypass',
          personaId,
          contentType,
          emailPrefix: (email || 'anon').slice(0, 3) + '***',
          timestamp: new Date().toISOString(),
        }),
      );

      const flowResult = await generateScriptFlow({
        blogText,
        keywords: keywords || topic,
        userExperience,
        personaId,
        customPersonaLabel,
        customPersonaHint,
        tone,
        contentType,
        durationSec: targetDurationSec,
        benchmarkAggregated,
        brandContext,
      });

      await publishProgress(jobId, {
        type: 'step',
        step: 'script-generation',
        status: 'running',
        progress: 60,
        subStep: 'caption',
      });
      await checkCancelled(jobId, 'script:caption-done');

      // flow 결과를 payload 형식으로 변환
      if (isLongform) {
        // 롱폼: postProcessScenes 미적용, section/type 보존
        script = buildLongformScriptPayload(
          {
            scenes: flowResult.scenes,
            totalDuration: flowResult.totalDuration,
            presetUsed: flowResult.presetUsed,
          },
          concept,
        );
      } else {
        // 숏폼: 기존 buildScriptPayload 재사용 (postProcessScenes 포함)
        script = buildScriptPayload(
          {
            scenes: flowResult.scenes,
            totalDuration: flowResult.totalDuration,
            presetUsed: flowResult.presetUsed,
          },
          concept,
          targetSceneCount,
        );
      }
      // 플랫폼별 캡션 2종 (Instagram Reels + YouTube Shorts).
      // 레거시 caption 필드도 유지 (captionInstagram과 동일값) — 기존 소비처 호환.
      script.captionInstagram = flowResult.captionInstagram || flowResult.caption || '';
      script.captionYouTube = flowResult.captionYouTube || '';
      script.caption = flowResult.caption || flowResult.captionInstagram || '';
      script.warnings = flowResult.warnings;
      script.personaId = personaId;
      script.contentType = contentType;
      script.creditCost = creditCost;
    } else {
      // 레거시 경로 (역호환): 기존 callClaude 그대로
      // jobId를 benchmark에도 전달해 키워드추출/후보영상검색/영상분석 SSE 이벤트가
      // 클라이언트까지 전달되도록 함.
      const benchmarkKeyword = topic || (blogText ? blogText.slice(0, 50).replace(/[^가-힣a-zA-Z0-9\s]/g, '').trim() : '');
      const authHeader = request.headers.get('authorization') || '';
      const benchmark = benchmarkKeyword
        ? await fetchBenchmark(benchmarkKeyword, authHeader, jobId, contentType)
        : { fallback: true, candidates: [] };
      const candidateCount = (benchmark.candidates || benchmark.videos || []).length;
      console.log(`[SHORTFORM-SCRIPT] Legacy path: ${benchmarkKeyword} → ${benchmark.fallback ? 'FALLBACK' : `${candidateCount} videos`}`);

      await publishProgress(jobId, {
        type: 'step',
        step: 'script-generation',
        status: 'running',
        progress: 40,
        subStep: 'claude',
      });
      await checkCancelled(jobId, 'script:claude-call');

      script = await callClaudeABis({
        topic, blogText, tone, targetDurationSec,
        concept, targetSceneCount, benchmark, personaMemo, settings, layoutMode,
        email,
      });

      // 플랫폼별 캡션 2종 (Instagram Reels + YouTube Shorts) — Legacy path 폴백.
      // Phase D(generateScriptFlow) 는 script-flow.js 내부에서 처리되지만 Legacy path는
      // callClaudeABis → buildScriptPayload 가 캡션 필드를 포함하지 않으므로 여기서 보강.
      {
        const hook = script?.scenes?.[0]?.script || '';
        const cta = script?.scenes?.[script.scenes.length - 1]?.script || '';
        const legacyCaption = script?.caption || '';
        const hasInsta = typeof script?.captionInstagram === 'string' && script.captionInstagram.length >= 20;
        const hasYT = typeof script?.captionYouTube === 'string' && script.captionYouTube.length >= 20;
        if (!hasInsta) {
          script.captionInstagram =
            legacyCaption ||
            [hook, cta, '#릴스 #숏폼 #인스타'].filter(Boolean).join('\n\n').slice(0, 300);
        }
        if (!hasYT) {
          let yt = [hook, cta, '#Shorts #쇼츠'].filter(Boolean).join('\n\n').slice(0, 400);
          if (!/#\s*Shorts/i.test(yt)) yt = `${yt}\n\n#Shorts`;
          script.captionYouTube = yt;
        }
        // 레거시 caption 필드도 채움 (captionInstagram과 동일)
        if (!script.caption) script.caption = script.captionInstagram || '';
      }

      // 벤치마크 후보 영상을 script payload에 첨부 (UI 카드 노출용).
      // 최대 6개, 가벼운 필드만 — 썸네일/제목/채널/조회수/링크.
      const candidatesRaw = benchmark.candidates || benchmark.videos || [];
      script.benchmarkCandidates = candidatesRaw.slice(0, 6).map((v) => ({
        videoId: v.videoId || null,
        title: v.title || '',
        thumbnail: v.thumbnail || '',
        channelName: v.channelName || v.channelTitle || '',
        viewCount: v.viewCount || 0,
        url: v.url || (v.videoId ? `https://www.youtube.com/watch?v=${v.videoId}` : ''),
      }));
      script.benchmarkKeywords = benchmark.searchKeywords || null;
      script.benchmarkFallback = !!benchmark.fallback;
    }

    // 대본 분량 체크: 목표 대비 85% 미만이면 경고 로그
    if (script?.estimatedSeconds && script.estimatedSeconds < targetDurationSec * 0.85) {
      const fullText = (script.scenes || []).map((s) => s.script || '').join('');
      const charCount = fullText.replace(/\s+/g, '').length;
      console.warn(
        `[SHORTFORM-SCRIPT] 분량 부족: ${charCount}자 (목표 ${targetDurationSec * 5}자), ` +
        `추정 ${script.estimatedSeconds}초 (목표 ${targetDurationSec}초)`
      );
    }

    await publishProgress(jobId, {
      type: 'step',
      step: 'script-generation',
      status: 'done',
      progress: 100,
      result: { sceneCount: script?.scenes?.length || 0 },
    });

    await logUsage(email, 'shortform-script', tone, getClientIp(request));

    // 카테고리별 디자인 토큰 조회 (Remotion props로 전달)
    const resolvedCategory = script?._resolvedCategory || settings?.category || '';
    const designTokens = resolvedCategory && resolvedCategory !== 'auto'
      ? await getDesignTokens(resolvedCategory)
      : await getDesignTokens('other');

    // Phase A-bis: 응답에 settings + _version 포함 (Step 3 칩 렌더에 사용).
    // 기존 소비자는 script 필드만 읽으므로 역호환 OK.
    const responsePayload = {
      jobId,
      script,
      settings,
      settingsVersion: SETTINGS_SCHEMA_VERSION,
      designTokens,
    };

    await publishProgress(jobId, {
      type: 'complete',
      result: { jobId, script, settings },
    });

    return jsonResponse(request, responsePayload);
  } catch (error) {
    if (error instanceof CancelledError) {
      await publishProgress(jobId, {
        type: 'cancelled',
        cancelledAt: error.checkpoint,
      });
      return jsonResponse(
        request,
        { cancelled: true, checkpoint: error.checkpoint, jobId },
        { status: 499 },
      );
    }
    console.error('shortform-script API Error:', error);
    await publishProgress(jobId, {
      type: 'error',
      error: error?.message || 'script generation error',
      step: 'script-generation',
    });
    return jsonResponse(request, { error: '숏폼 대본 생성 중 오류가 발생했습니다.' }, { status: 500 });
  } finally {
    await cleanupJob(jobId);
  }
}
