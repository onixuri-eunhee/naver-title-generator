/**
 * lib/shortform/prompt.js — Phase A-bis SYSTEM_PROMPT 빌더
 *
 * Worker #3 (API + Prompt). Spec §4.2.
 *
 * 규칙:
 * - L1: React/Remotion import 금지
 * - L6: process.env 직접 접근 금지 (호출자가 인자로 주입)
 * - 내부 섹션 함수 export 금지 — buildSystemPrompt / buildUserPrompt만 공개
 * - scriptType === 'story' 시 루프 훅 섹션 빈 문자열
 * - retryAttempt > 0 시 JSON strict 블록 맨 앞 unshift
 * - reasoningExamples 누락 시 해당 섹션 스킵 + 세션당 1회 경고
 * - 600줄 임계 (현재 ~450줄)
 *
 * settings.js chipId와 동일한 파라미터 이름 사용:
 *   category / firstThreeSeconds / scriptType / contentType
 */

// 모듈 레벨 경고 플래그 — reasoningExamples 미제공 시 세션당 1회만 경고
let _warnedMissingReasoningExamples = false;

// ─────────────────────────────────────────────────────────────────────────────
// [섹션 1] 절대 규칙 — 존댓말/JSON/구어체/SEDA/32자 제약
// ─────────────────────────────────────────────────────────────────────────────
function buildAbsoluteRulesBlock({ contentType }) {
  const sceneLengthHint =
    contentType === 'long'
      ? '한 씬의 script는 권장 60~90자. 롱폼은 호흡을 길게 가져갑니다.'
      : '한 씬의 script는 권장 32자(공백 포함). 한국어 문법 정확성이 글자수보다 우선입니다.';

  return `[절대 규칙]
1. 반드시 존댓말만 사용하세요. 반말, 유행어 남발, 과장된 말투는 금지입니다.
2. 출력은 설명 없이 순수 JSON 객체 하나만 반환하세요. 마크다운 코드블록, 부가 설명, 서문 금지입니다.
3. 사실은 사용자가 제공한 topic과 blogText 안에서만 사용하세요. 입력에 없는 구체적 수치나 사례를 지어내지 마세요.
4. 구어체로 자연스러운 내레이션 문장을 작성하세요. 문어체 금지.
5. 한 문장에 하나의 정보만. 숫자는 구체적으로 (많이→87%, 대부분→10명 중 8명).
6. 같은 말 반복 절대 금지. 씬마다 반드시 새로운 정보를 전달하세요. 표현만 바꿔 같은 내용을 되풀이하면 실패입니다.
7. ${sceneLengthHint} 문법이 깨질 것 같으면 글자수를 넘어가지 말고 씬을 나누세요.
8. 생성 전 한 번 더: 각 script를 소리 내 읽었을 때 자연스러운가? 어색한 표현은 즉시 고치세요.`;
}

// ─────────────────────────────────────────────────────────────────────────────
// [섹션 2] First 3 Seconds — Q4 (B) 대본 제약 (style별 글자수)
// ─────────────────────────────────────────────────────────────────────────────
const FIRST_THREE_RULES = {
  auto: {
    label: '자동',
    hint:
      '카테고리와 주제에 가장 적합한 첫 문장 스타일을 스스로 선택하세요. 충격/숫자/스토리 중 어느 것이든 첫 씬이 스크롤을 멈추게 해야 합니다.',
    maxChars: 14,
  },
  shock: {
    label: '충격형',
    hint:
      '통념을 뒤집는 짧고 강한 선언. "틀렸습니다", "아닙니다" 같은 반전 어미를 활용.',
    maxChars: 12,
  },
  number: {
    label: '숫자형',
    hint:
      '첫 문장에 숫자(퍼센트·배수·기간·인원·금액) 하나를 반드시 포함. 숫자가 충격의 코어가 되도록.',
    maxChars: 14,
  },
  story: {
    label: '스토리형',
    hint:
      '구체적 상황·감정 한 컷으로 시작. "어제 ~했어요", "저도 ~였습니다" 같은 1인칭 앵커.',
    maxChars: 20,
  },
};

function buildFirstThreeSecondsBlock({ firstThreeSeconds, category }) {
  const rule = FIRST_THREE_RULES[firstThreeSeconds] ?? FIRST_THREE_RULES.auto;
  const categoryHint =
    category && category !== 'auto'
      ? `카테고리: ${category} — 이 타겟이 스크롤을 멈출 만한 정서·언어를 우선하세요.`
      : '';

  return `[첫 3초 — ${rule.label}]
${rule.hint}
★ scenes[0].script는 ${rule.maxChars}자 이내로 임팩트, 단 음성으로 1.0초 이상 발화되도록 여유를 주세요.
★ scenes[0].hookText는 화면 강조용 8~12자 한국어 핵심 문구.
★ scenes[0].hookType은 "질문형|충격형|비밀형|증거형|공감형|경고형" 중 사용한 유형을 반드시 기입.
${categoryHint}`.trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// [섹션 3] 후킹 공식 + 대본 구조 + scriptType 루프 훅 분기
// ─────────────────────────────────────────────────────────────────────────────
function buildHookFormulaBlock({ scriptType, contentType }) {
  const structureByContentType =
    contentType === 'long'
      ? `[대본 구조 — 롱폼]
hook → body1 → body2 → body3 → body4 → conclusion → cta (7씬 고정)
각 body는 서로 다른 각도/사례/숫자로 주제를 파고듭니다. 반복 금지.`
      : `[대본 구조 — fingr식 공감 루프]
총 씬 수에 따라 base 구조를 따르되, 표현·순서를 매번 변주하세요. 템플릿화 금지.

▶ 7씬 (30초) — 1사이클:
  scene[0] 공감 질문 (Hook)
  scene[1] 마음읽기 질문 — "솔직히 ~ 싶으셨을 거예요"
  scene[2] 상황 설명 — "그런데 사실 ~"
  scene[3] 통념 깨기 — "이건 ~ 때문이 아니라 ~"
  scene[4] 약속/해법 — "이렇게 하면 ~"
  scene[5] 사례 + 경험 — "어제 ~했어요"
  scene[6] CTA 동료 호출

▶ 10씬 (45초) — 1.5사이클: 7씬 base + scene[5~8]에 [마음읽기2 / 사례2 / 작은 약속] 삽입
▶ 14씬+ (60~90초) — 2사이클+: 자유 반복

★ scene[1]은 반드시 마음읽기 질문 형태 ("솔직히 ~", "혹시 ~ 아니세요?", "~ 싶으셨을 거예요")`;

  const loopHookBlock = buildLoopHookBlock({ scriptType });

  return `[후킹 공식 — 6종 다양성 유지, 공감 베이스]
모든 후킹은 시청자가 "내 얘긴가?" 느끼게 만드는 게 출발점입니다.
6종 중 토픽에 가장 잘 맞는 것을 매번 다르게 선택해 다양성 확보.

★ BAD (0점):
- "안녕하세요", "오늘은 ~에 대해 알아볼게요", "여러분 ~"
- "~해보셨나요?" (단순 yes/no)
- "~이 중요합니다" (누구나 아는 말)

★ GOOD 후킹 유형 6종:
1. 질문형: "블로그 하루 3시간 쓰는데 왜 방문자가 10명일까요?"
2. 충격형: "키워드 검색량, 높을수록 좋다고요? 틀렸습니다"
3. 비밀형: "상위 1% 블로거만 쓰는 기능이 있습니다"
4. 증거형: "이 설정 하나로 방문자 3배"
5. 공감형: "저도 ~로 6개월 헤맸어요"
6. 경고형: "이거 모르고 쓰면 광고비만 새요"

★ scenes[0]에 hookType 필드 출력 필수.

${structureByContentType}

[Point 작성 규칙]
- 추상 나열 금지. 구체 장면/숫자/감정만 사용.
- personaMemo가 있으면 Point 중 최소 2씬에 활용 (정체성 1 + 구체 장면/숫자 1).
- 없으면 관찰형 1인칭 Point 최소 1씬: "~인 분들 많으세요", "저도 처음엔 ~"

[CTA 작성 규칙 — 마지막 씬 전까지의 사전 준비]
- 정형 문구 금지 ("궁금한 점 댓글로", "유용했다면 팔로우", "감사합니다").
- 실제 CTA Variant 본문은 Remotion CTAVariantScene이 대체하므로, 본 대본 CTA 씬은
  음성/시각 흐름을 끊지 않는 연결고리 역할로 충분.
${loopHookBlock}`.trim();
}

/**
 * scriptType 분기 루프 훅.
 * - question: scripts[0] 질문 재사용
 * - list: 키워드 3개 flash 요약
 * - story: 루프 훅 없음 (빈 문자열)
 */
function buildLoopHookBlock({ scriptType }) {
  if (scriptType === 'story') {
    // 제약 (§4.2): story는 루프 훅 블록 빈 문자열
    return '';
  }
  if (scriptType === 'question') {
    return `
[루프 훅 — question형]
★ 마지막 씬은 scripts[0]의 질문을 재사용해 순환 고리 형성:
   "그래서 다시 물어볼게요, {첫 씬 질문}"
   → 시청자가 영상 처음으로 되돌아갈 확률 상승.`;
  }
  if (scriptType === 'list') {
    return `
[루프 훅 — list형]
★ 마지막 씬은 본문에서 다룬 핵심 키워드 3개를 flash 요약 + "처음부터 다시 보실까요?"
   → 리플레이 유도, 저장 확률 상승.`;
  }
  // auto 또는 미지정 — Claude에게 판단 위임 (story/question/list 중 자가 선택)
  return `
[루프 훅 — 자동 판단]
★ 주제 성격상 질문형이면 scripts[0] 질문 재사용, 리스트형이면 키워드 3개 flash 요약.
   스토리형이면 루프 훅 미적용. 선택을 scripts[last].loopHook 필드에 메타로 기록.`;
}

// ─────────────────────────────────────────────────────────────────────────────
// [섹션 4] Reasoning Guidance — 툴팁 카피 규칙 + few-shot 주입
// ─────────────────────────────────────────────────────────────────────────────
function buildReasoningGuidanceBlock({ reasoningExamples }) {
  if (!reasoningExamples) {
    if (!_warnedMissingReasoningExamples) {
      console.warn(
        '[prompt] reasoningExamples missing — skipping reasoning guidance section (warn once)',
      );
      _warnedMissingReasoningExamples = true;
    }
    return '';
  }

  const copies = Array.isArray(reasoningExamples.copies) ? reasoningExamples.copies : [];
  const fewShots = Array.isArray(reasoningExamples.fewShots) ? reasoningExamples.fewShots : [];
  if (copies.length === 0 && fewShots.length === 0) return '';

  const copiesList = copies.map((c, i) => `  ${i + 1}. ${c}`).join('\n');
  const fewShotsList = fewShots
    .map((f) => `  - chip=${f.chip}, value=${f.value} → "${f.reasoning}"`)
    .join('\n');

  return `[reasoning 메타 카피 규칙 — 각 scene.reasoning 필드]
목적: 칩 선택 툴팁과 "왜 이 선택이 최적인가" 노출. 30~50자 모바일 툴팁 최적.

★ 규칙:
- 타겟 구체 행동/심리 1개 + 결과 1개
- 추상어 금지 ("효과적", "최적화", "적합합니다")
- 숫자 가산점 ("리플레이 확률 ~30% ↑")
- ❌ "이 카테고리에 가장 적합한 톤입니다"
- ✅ "예비부부는 '진짜 그럴까?' 의심형에 댓글 다는 비율이 2배 높음"

★ 카테고리 큐레이션 예시:
${copiesList}

★ few-shot (칩별 reasoning 샘플):
${fewShotsList}`.trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// [섹션 5] 출력 JSON 스키마 — scriptType에 따른 필드 조정
// ─────────────────────────────────────────────────────────────────────────────
function buildOutputSchemaBlock({ scriptType }) {
  const loopHookField =
    scriptType === 'story'
      ? ''
      : `    "loopHook": "(마지막 씬만) question=첫 질문 재사용, list=키워드 3개 flash, story=생략"`;

  return `[출력 JSON 스키마]
{
  "scenes": [
    {
      "script": "대본 문장 (한국어, 1문장)",
      "section": "hook | point | cta",
      "type": "broll",
      "visual": "구체적인 영어 B-roll 이미지 설명",
      "hookText": "(scenes[0]만) 화면 강조 문구 (한국어, 8~12자)",
      "hookType": "(scenes[0]만) 질문형|충격형|비밀형|증거형|공감형|경고형",
      "reasoning": "30~50자 툴팁 카피 (왜 이 선택이 최적인지 — 구체 행동/심리 + 결과)"${loopHookField ? ',\n' + loopHookField : ''}
    }
  ],
  "metadata": {
    "scriptType": "(자가 판별) question | list | story",
    "hookTypeChosen": "scenes[0].hookType과 동일"
  }
}

[scenes 규칙]
- scenes 개수는 targetSceneCount와 정확히 일치.
- type은 모든 씬에서 "broll". text 타입 금지.
- visual은 영어 설명 (예: "close-up of hands typing on laptop").
- section은 Hook → Point → CTA 흐름에 맞게 배정.`;
}

// ─────────────────────────────────────────────────────────────────────────────
// [섹션 6] 레이아웃 타입 — visualStyle === 'kinetic' 일 때만 활성
// ─────────────────────────────────────────────────────────────────────────────
function buildLayoutTypeBlock({ visualStyle }) {
  if (visualStyle !== 'kinetic') return '';

  return `[비주얼 레이아웃 — 텍스트형 모드]
각 씬에 layoutType 필드를 반드시 포함하세요. 이미지 없이 텍스트/데이터 시각화만으로 구성합니다.

사용 가능한 layoutType:
- "big-impact-text": 대형 텍스트 1줄. 후킹, CTA, 핵심 메시지에 사용.
- "counter": 큰 숫자 + 단위 + 설명. 성과/통계에 사용. layoutProps: { value: 숫자, suffix: "단위", label: "설명" }
- "comparison": 좌우 비교표. layoutProps: { leftTitle: "일반", rightTitle: "뚝딱툴", rows: [{feature:"시간", left:"3시간", right:"5분"}] }
- "emphasis-box": 강조 박스. layoutProps: { variant: "check"|"warning"|"info" }
- "bullet-list": 불릿 리스트 순차 등장. layoutProps: { items: ["항목1", "항목2", ...] }
- "progress-bar": 프로그레스 바. layoutProps: { value: 87, label: "달성률" }
- "vertical-bar": 세로 바 + 텍스트. 구분선 강조.
- "icon-label": 아이콘 + 라벨. layoutProps: { icon: "이모지", label: "텍스트" }
- null: layoutType 미지정 시 기본 텍스트 카드.

규칙:
- 첫 씬(hook)은 "big-impact-text" 권장.
- 숫자 언급 시 "counter" 사용 (예: "매출 3배" → counter).
- 비교 내용 시 "comparison" 사용.
- 마지막 씬(CTA)은 "big-impact-text" 권장.
- 모든 씬에 layoutType 지정 필수 (빠뜨리지 마세요).
- layoutProps는 해당 타입에 필요한 데이터만 포함.`;
}

// ─────────────────────────────────────────────────────────────────────────────
// JSON strictness — 재시도 시 assembler 맨 앞에 unshift
// ─────────────────────────────────────────────────────────────────────────────
function buildJsonStrictnessBlock({ retryAttempt }) {
  if (!retryAttempt || retryAttempt <= 0) return '';
  const total = 3; // 총 시도 횟수 표기 (MAX_RETRIES 2 + 첫 시도 = 3)
  return `[JSON 엄격 모드 — 시도 ${retryAttempt}/${total}]
직전 응답이 JSON으로 파싱되지 않았습니다. 다음 형식을 반드시 지키세요.
- 출력은 순수 JSON 객체 하나. 앞뒤에 어떤 문자·개행도 붙이지 마세요.
- 첫 글자는 { 마지막 글자는 }.
- 마크다운 코드블록 (\`\`\`json, \`\`\`) 금지.
- 주석·설명·서문·후언·이모지 금지.
- 문자열 내부의 "는 반드시 \\"로 이스케이프.`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * SYSTEM_PROMPT assembler.
 *
 * 섹션 순서:
 *   [strict?] → absoluteRules → firstThreeSeconds → hookFormula → reasoning → outputSchema
 *
 * @param {{
 *   category: string,
 *   scriptType: 'auto'|'question'|'list'|'story',
 *   firstThreeSeconds: 'auto'|'shock'|'number'|'story',
 *   reasoningExamples?: { copies: string[], fewShots: Array<object> },
 *   contentType: 'short' | 'long',
 *   retryAttempt?: number,
 * }} params
 * @returns {string}
 */
export function buildSystemPrompt({
  category,
  scriptType,
  firstThreeSeconds,
  reasoningExamples,
  contentType,
  visualStyle,
  retryAttempt = 0,
} = {}) {
  const sections = [
    buildAbsoluteRulesBlock({ contentType }),
    buildFirstThreeSecondsBlock({ firstThreeSeconds, category }),
    buildHookFormulaBlock({ scriptType, contentType }),
    buildReasoningGuidanceBlock({ reasoningExamples }),
    buildLayoutTypeBlock({ visualStyle }),
    buildOutputSchemaBlock({ scriptType }),
  ];

  if (retryAttempt > 0) {
    sections.unshift(buildJsonStrictnessBlock({ retryAttempt }));
  }

  return sections.filter(Boolean).join('\n\n');
}

/**
 * USER_PROMPT builder.
 *
 * @param {{
 *   topic: string,
 *   tone: 'casual'|'professional',
 *   targetSceneCount: number,
 *   targetDurationSec?: number,
 *   blogText?: string,
 *   personaMemo?: string,
 *   benchmark?: object | null,
 * }} params
 * @returns {string}
 */
export function buildUserPrompt({
  topic,
  tone,
  targetSceneCount,
  targetDurationSec,
  blogText,
  personaMemo,
  benchmark,
} = {}) {
  const inputSummary = [
    `tone: ${tone || 'casual'}`,
    targetDurationSec ? `targetDuration: ${targetDurationSec}초` : null,
    `targetSceneCount: ${targetSceneCount || 7}`,
    topic ? `topic: ${topic}` : null,
    blogText ? `blogText:\n${blogText}` : null,
    `personaMemo: ${personaMemo && personaMemo.trim() ? personaMemo.trim() : '(없음)'}`,
  ]
    .filter(Boolean)
    .join('\n\n');

  let benchmarkSection = '';
  if (benchmark && benchmark.patterns && !benchmark.fallback) {
    const p = benchmark.patterns;
    const videoList = Array.isArray(benchmark.videos)
      ? benchmark.videos
          .slice(0, 3)
          .map(
            (v, i) =>
              `  ${i + 1}. "${v.title}" (조회수 ${(v.viewCount || 0).toLocaleString()}, 구독자 ${(v.subscriberCount || 0).toLocaleString()}, 비율 ${(v.viewToSubRatio || 0).toFixed(1)}배)`,
          )
          .join('\n')
      : '';

    benchmarkSection = `

[★★★ 벤치마킹 — 이 키워드에서 실제로 조회수가 터진 공식 ★★★]

실제 바이럴 영상:
${videoList}

공통 패턴 (반드시 동일하게 적용):
1. 후킹 유형: ${p.hookType || '미분석'} → scenes[0]에 이 유형 적용
2. 후킹 패턴: ${p.hookPattern || '미분석'}
3. 대본 구조: ${p.structure || '미분석'}
4. 바이럴 공식: ${p.viralFormula || '미분석'}

추천 첫 문장: "${p.suggestedHook || ''}"

[위반 금지]
- 벤치마킹 후킹/구조/공식을 무시하면 실패.
- 이 규칙은 [절대 규칙]보다 우선합니다.`;
  }

  const targetChars = targetDurationSec ? Math.round(targetDurationSec * 10) : 0;
  const minPerScene = 25;
  const effectiveSceneCount = targetSceneCount || 7;
  const targetCharsHint = targetDurationSec
    ? `- ★ 분량 필수: 모든 scene.script의 글자수 합계(공백 포함) ≥ ${targetChars}자. 이보다 적으면 영상이 ${targetDurationSec}초보다 짧아져 사용자 기대를 배신합니다.
- 각 씬은 최소 ${minPerScene}자, 권장 ${Math.round(targetChars / effectiveSceneCount)}자/씬.`
    : '';

  return `${inputSummary}${benchmarkSection}

위 입력을 바탕으로 숏폼 대본을 scenes 배열로 작성하세요.
- scenes 개수: 정확히 ${effectiveSceneCount}개
${targetCharsHint}
- Hook → Point(공감 루프) → CTA 흐름, 템플릿화 금지.
- personaMemo가 있으면 Point 중 최소 1씬에 가공해 녹이세요.`.trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// 테스트 전용 헬퍼 — 세션당 1회 경고 플래그 리셋 (tests/unit/prompt.test.js용)
// 런타임에서는 호출하지 말 것. export는 `@internal` 태그로 소비자 혼동 방지.
// ─────────────────────────────────────────────────────────────────────────────
/** @internal */
export function __resetReasoningWarning() {
  _warnedMissingReasoningExamples = false;
}
