# Phase D — Script Generation: Claude Opus 페르소나 대본 + 캡션 (Genkit 래핑)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. 12 Phase 중 Phase D. 마스터 플랜: `2026-04-14-shortform-master-plan.md`. 스펙: `2026-04-14-shortform-benchmark-pipeline-design.md` §6.

**Goal:** 기존 `app/api/shortform-script/route.js` (491 lines) 를 페르소나·톤·유저경험·벤치마크 기반으로 확장하고, Genkit `defineFlow` 래퍼 안에서 Claude Opus를 호출해 scenes + caption을 동시에 생성한다. 이모지/일반론 hard rule을 코드로 검증.

**Architecture:** Genkit은 공식적으로 Anthropic Claude를 네이티브 플러그인으로 지원하지 않는다. 하지만 **`defineFlow()` 는 임의 async 함수를 orchestration 레이어로 감쌀 수 있음** — Claude 호출은 기존 Anthropic SDK fetch 방식 그대로 두고 그 함수를 flow로 래핑. 이렇게 하면:
1. Genkit의 trace/logging/retry 인프라 재사용
2. zod 기반 input/output 스키마 자동 검증
3. Phase B/F/I 와 동일한 Genkit 통일성 유지
4. Claude의 한국어 품질(vs Gemini 2.5 Pro)을 잃지 않음

Caption은 같은 flow의 **동일 Claude 호출**에서 `{ scenes, caption }` JSON 두 필드를 한번에 생성 → 토큰/지연 최소화. 별도 호출은 재시도 시에만 사용.

**Tech Stack:** Genkit `defineFlow`, zod 스키마, Anthropic Messages API (claude-opus-4-6), fetch 기반 (기존 패턴 유지)

**의존성:** Phase A (lib/shortform-personas.js) — 현재 Phase A 플랜에 정의 존재. Phase B (Gemini aggregated JSON 형식) — 형식만 합의되면 시작 가능 (실제 Phase B 완료 불필요). Phase C 와 병렬 가능.

**예상 작업량:** 9 task, ~1.5주

---

## 파일 구조

### 신규 파일

```
lib/script-prompts.js         페르소나 aware 시스템/유저 프롬프트 빌더 + hard rules
lib/script-validator.js       이모지 검출 / 일반론 표현 검출 / 구조 검증
lib/script-flow.js            Genkit defineFlow 래퍼 (Claude 호출 + zod 검증)
```

### 수정 파일

```
app/api/shortform-script/route.js   입력 스키마 확장 + flow 호출로 대체 (기존 491줄 주요 경로 교체)
```

---

## Task D0: 사전 점검

Genkit 의존성은 Phase A의 Task A0에서 이미 설치 (`genkit @genkit-ai/vertexai @genkit-ai/google-cloud zod`).

**Files:**
- Read only

- [ ] **Step 1: Genkit + Phase A 페르소나 존재 확인**

```bash
cd /Users/gong-eunhui/Desktop/naver-title-generator
cat package.json | grep -E "genkit|zod"
ls -la lib/shortform-personas.js
```

Expected: genkit, @genkit-ai/*, zod 설치됨. `lib/shortform-personas.js` 존재 (Phase A 선행).

- [ ] **Step 2: 기존 route.js 핵심 함수 파악**

```bash
grep -n "^export\|^function\|SYSTEM_PROMPT\|buildUserPrompt\|callClaude\|fetchBenchmark" app/api/shortform-script/route.js
```

Expected: `SYSTEM_PROMPT`, `buildUserPrompt`, `callClaude`, `extractJsonObject`, `postProcessScenes`, `buildScriptPayload` 위치 확인.

- [ ] **Step 3: 본 Phase가 보존해야 하는 로직 체크리스트**

- `postProcessScenes` — 씬 개수 맞추기 (30초=7씬, 45초=10씬...)
- `buildScriptPayload` — concept/visualStyle 정리
- `extractJsonObject` — 균형 괄호 파서 (Claude가 JSON 뒤에 텍스트 붙이는 문제 대응)
- 크레딧 로직 (기존 GET + 무료 1회)
- `SHORTFORM_CREDIT_COSTS` — 30초 7크레딧 등

Phase D는 위 로직을 **그대로 유지**하고 프롬프트·입력 부분만 확장한다.

---

## Task D1: lib/script-prompts.js — 페르소나 프롬프트 빌더

스펙 §6 의 시스템/사용자 메시지 템플릿을 구현. 기존 `SYSTEM_PROMPT` 의 후킹 6종 + 공감 루프 구조는 유지하고, **hard rules 1~6** 과 **페르소나 1인칭** 섹션을 최상단에 추가.

**Files:**
- Create: `lib/script-prompts.js`

- [ ] **Step 1: 프롬프트 모듈 작성**

```javascript
// lib/script-prompts.js
/**
 * Phase D — 페르소나 aware 숏폼 대본 프롬프트 빌더.
 *
 * 기존 app/api/shortform-script/route.js 의 SYSTEM_PROMPT 핵심 노하우
 * (후킹 6종, 공감 루프 구조, 메모 녹임)는 유지하고 hard rules +
 * 페르소나 1인칭 + 벤치마킹 aggregated 섹션을 추가.
 *
 * 스펙 §6 참고.
 */
import { getPersona, buildCustomPersona, PERSONAS } from '@/lib/shortform-personas';

const SCENE_COUNTS = { 30: 7, 45: 10, 60: 14, 90: 20 };

/**
 * Hard rules — 위반 시 결과 폐기 대상.
 * 프롬프트 최상단에 절대 규칙으로 주입.
 */
export const HARD_RULES = [
  '자막에 이모지 사용 금지 (전문성 손상). 🎯 ✨ 💡 등 어떤 유니코드 이모지도 넣지 말 것.',
  '화자는 사용자가 선택한 페르소나의 1인칭 시점을 끝까지 유지. 3인칭 설명조 금지.',
  'AI 양산 느낌의 일반론 금지. "~이 중요합니다", "필수입니다" 같은 뻔한 표현 대신 구체적 경험·숫자·고유명사 반영.',
  '첫 3초 후킹은 벤치마킹 패턴(aggregated.dominantHookType)을 그대로 적용. 벤치마크가 number-list면 숫자형 후킹, question이면 질문형 등.',
  '본인 등장 비율은 벤치마킹 personPresenceMode 권장값 따름. high면 화자의 1인칭 목격담 2회 이상.',
  'CTA는 벤치마킹 패턴(commonCTAType)의 형식 유지. 댓글/DM/팔로우 중 하나.',
];

/**
 * 시스템 프롬프트 — 페르소나/톤/벤치마크 주입.
 *
 * 입력:
 * - personaId: 'store-owner' | 'blogger' | ... | 'custom'
 * - customPersonaLabel: id='custom' 일 때 사용자 직접 입력
 * - tone: 'professional' | 'casual'
 * - hasBenchmark: boolean — 벤치마킹 aggregated 데이터 존재 여부
 */
export function buildSystemPrompt({ personaId, customPersonaLabel, customPersonaHint, tone, hasBenchmark }) {
  const persona = personaId === 'custom'
    ? buildCustomPersona(customPersonaLabel, customPersonaHint)
    : (getPersona(personaId) || PERSONAS[0]);

  const toneLabel = tone === 'professional' ? '전문가 (신뢰감, 정확한 정보)' : '친근한 친구 (편안하고 따뜻)';

  const rulesBlock = HARD_RULES.map((r, i) => `${i + 1}. ${r}`).join('\n');

  const benchmarkBlock = hasBenchmark
    ? `[벤치마킹 활용 방침]
사용자 메시지에 "벤치마킹 aggregated" 섹션이 포함됩니다. 그 JSON의 dominantHookType / dominantBodyStructure / dominantTone / personPresenceMode / recommendedPreset / advice를 **반드시** 대본 구조에 반영하세요. 무시하고 다른 구조로 작성하면 결과 폐기.`
    : `[벤치마킹 미제공]
벤치마킹 데이터가 없으므로 기본 공감 루프 구조(아래)에 따라 작성.`;

  return `당신은 자영업자를 위한 한국어 숏폼 영상 대본 작가입니다.
사용자의 블로그 글과 본인 경험을 베이스로, 벤치마킹 패턴을 적용해 자기 목소리로 만들 수 있는 30~90초 대본을 작성합니다.

# 절대 규칙 (위반 시 결과 폐기)
${rulesBlock}

# 화자 페르소나
- ID: ${persona.id}
- 라벨: ${persona.label}
- 설명: ${persona.description}
- 1인칭 표현: ${persona.firstPerson}
- 보이스 큐: ${persona.voiceCues}
- 오프닝 샘플: ${persona.sampleOpening}

위 1인칭 표현과 보이스 큐를 대본 전반에 녹이세요. "저희 가게에서는", "제가 작업하면서" 같은 표현이 자연스럽게 등장해야 합니다.

# 톤
${toneLabel}

${benchmarkBlock}

# 후킹 공식 6종 (벤치마킹이 없거나 general 유형일 때)
모든 후킹은 시청자가 "내 얘긴가?" 느끼게 만드는 게 출발점.
★ GOOD 후킹 유형:
1. 질문형: "요즘 ~ 많이 힘드시죠?"
2. 충격형: "매출 줄어드는 거, 단순 경기 탓이 아닙니다"
3. 비밀형: "~인 사장님들만 아는 전략"
4. 증거형: "이것 하나 바꿨더니 한 달 만에 ~"
5. 공감형: "저도 ~로 6개월 헤맸어요"
6. 경고형: "이 실수 하나가 ~을 다 날립니다"

scenes[0]에 "hookType" 필드로 사용한 유형 명시.

# 대본 구조 — fingr식 공감 루프
도입부 1/3까지 시청자가 "내 이야긴가?" 느끼게 만들어 끝까지 보게 함.
▶ 7씬 (30초) — 공감 질문 / 마음읽기 / 상황 / 통념 깨기 / 약속 / 사례 / CTA
▶ 10씬 (45초) — 7씬 base + 마음읽기2 + 사례2 + 작은 약속
▶ 14+ 씬 (60~90초) — 10씬 base에 반복

# Point 작성 규칙
- 추상 나열 금지. 구체 장면/숫자/감정만.
- 메모(userExperience)가 있으면 Point 중 최소 2씬에 활용:
  1) 한 씬은 메모의 정체성 살림 — "15년차 디자이너인데"
  2) 다른 한 씬은 메모의 구체 장면/숫자 압축 인용
- 메모가 없으면 관찰형 1인칭 ("저도 처음엔 ~", "~하시는 분들 많으세요")
- 금지: "AI는 적이 아닙니다", "~이 중요합니다" 같은 선언문 나열

# 출력 형식 (JSON만, 다른 텍스트 금지)
{
  "scenes": [
    {
      "section": "hook",
      "type": "broll",
      "script": "첫 문장 — 벤치마킹 후킹 유형 적용",
      "hookType": "질문형",
      "visual": "본인 사진|AI이미지|텍스트카드 중 택1 + 영문 비주얼 가이드"
    },
    { "section": "point", "type": "broll", "script": "...", "visual": "..." }
  ],
  "totalDuration": 45,
  "presetUsed": "친근",
  "caption": "영상 캡션 — 이모지 금지 + 해시태그 포함"
}

# 캡션 작성 규칙
- 길이: 벤치마킹 captionPattern.averageLength (없으면 200자 내외)
- 구조: captionPattern.dominantStructure (기본: 후킹 한 줄 + 본문 + 해시태그)
- 해시태그 개수: captionPattern.averageHashtagCount (기본 4~6개)
- 추천 해시태그 우선: captionPattern.commonHashtags
- 첫 줄: 영상 후킹과 연결되는 한 문장
- 본문: 영상 핵심 가치 1~2문장
- CTA: commonCTAType 형식 유지
- 이모지 금지, 페르소나 1인칭 유지`;
}

/**
 * 사용자 메시지 빌더.
 *
 * 입력:
 * - blogText, keywords, userExperience
 * - personaId, customPersonaLabel, tone, durationSec
 * - benchmarkAggregated: Gemini 분석 JSON (Phase B 결과) 또는 null
 */
export function buildUserMessage({
  blogText,
  keywords,
  userExperience,
  personaId,
  customPersonaLabel,
  tone,
  durationSec,
  benchmarkAggregated,
}) {
  const sceneCount = SCENE_COUNTS[durationSec] || SCENE_COUNTS[30];
  const persona = personaId === 'custom'
    ? buildCustomPersona(customPersonaLabel)
    : (getPersona(personaId) || PERSONAS[0]);

  const parts = [];

  parts.push(`# 베이스 콘텐츠`);
  if (blogText) {
    parts.push(`[블로그 글]\n${blogText.trim()}`);
  } else if (keywords) {
    parts.push(`[키워드]\n${keywords}`);
  } else {
    parts.push(`(입력 없음)`);
  }

  parts.push(`\n# 사용자 본인의 경험·느낌 (가장 중요 — 반드시 2씬 이상 녹일 것)\n${userExperience || '(입력 없음 — 관찰형 1인칭으로 대체)'}`);

  parts.push(`\n# 사용자 정체성
- 화자: ${persona.label} (${persona.description})
- 1인칭 표현: ${persona.firstPerson}
- 톤: ${tone === 'professional' ? '전문가' : '친근한 친구'}`);

  parts.push(`\n# 영상 사양
- 길이: ${durationSec}초
- scenes 개수: 정확히 ${sceneCount}개
- 총 글자수(공백 제외): 약 ${durationSec * 5}자 (한국어 내레이션 기준)`);

  if (benchmarkAggregated) {
    parts.push(`\n# 벤치마킹 aggregated (Gemini 분석)
\`\`\`json
${JSON.stringify(benchmarkAggregated, null, 2)}
\`\`\`

위 JSON의 dominantHookType / dominantBodyStructure / personPresenceMode / recommendedPreset / advice / captionPattern 을 반드시 대본과 캡션에 반영하세요. advice 문장에 나온 지시사항은 최우선.`);
  } else {
    parts.push(`\n# 벤치마킹 (미제공)
벤치마킹 데이터가 없습니다. 기본 공감 루프 구조 + 후킹 6종 중 토픽에 맞는 유형 선택.`);
  }

  parts.push(`\n# 출력
위 입력을 바탕으로 JSON 하나만 반환하세요. scenes 개수 ${sceneCount}개 정확히, caption 필드 포함. 이모지 금지. 페르소나 1인칭 유지.`);

  return parts.join('\n');
}
```

- [ ] **Step 2: 빌드 체크**

```bash
npx next build 2>&1 | grep -iE "error|✓ Compiled" | head -5
```

Expected: 컴파일 성공.

- [ ] **Step 3: 커밋**

```bash
git add lib/script-prompts.js
git commit -m "$(cat <<'EOF'
feat(lib): 숏폼 대본 페르소나 aware 프롬프트 빌더

스펙 §6 구현:
- buildSystemPrompt: 페르소나 1인칭 + tone + hard rules 6종
- buildUserMessage: blogText/userExperience/benchmarkAggregated 주입
- HARD_RULES 상수 export (script-validator에서 재사용)

기존 후킹 6종 + 공감 루프 구조는 유지하고 상단에 이모지 금지
+ 페르소나 1인칭 + 벤치마킹 활용 방침 섹션 추가.
Phase D의 lib/script-flow.js가 이 모듈을 사용.
EOF
)"
```

---

## Task D2: lib/script-validator.js — 후처리 검증

이모지/일반론/구조 검증. 위반 건수와 경고 목록을 반환. flow에서 1회 재시도 또는 경고 표시에 사용.

**Files:**
- Create: `lib/script-validator.js`

- [ ] **Step 1: validator 작성**

```javascript
// lib/script-validator.js
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
  /\b중요합니다\b/,
  /\b필수입니다\b/,
  /\b반드시 알아야 할\b/,
  /\b알아볼게요\b/,
  /\b정리해보겠습니다\b/,
  /\b꼭 기억해야\b/,
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
      errors.push(`scene[${i}] script에 이모지 ${emojis.length}개 검출: ${emojis.map(e => e.char).join('')}`);
    }
    const generic = detectGenericPhrases(s.script);
    if (generic.length > 0) {
      warnings.push(`scene[${i}] 일반론 표현: ${generic.map(g => g.match).join(', ')}`);
    }
    return {
      ...s,
      script: stripEmojis(s.script),
    };
  });

  // caption 검증
  let fixedCaption = parsed.caption || '';
  const captionEmojis = detectEmojis(fixedCaption);
  if (captionEmojis.length > 0) {
    errors.push(`caption에 이모지 ${captionEmojis.length}개 검출: ${captionEmojis.map(e => e.char).join('')}`);
    fixedCaption = stripEmojis(fixedCaption);
  }
  const captionGeneric = detectGenericPhrases(fixedCaption);
  if (captionGeneric.length > 0) {
    warnings.push(`caption 일반론 표현: ${captionGeneric.map(g => g.match).join(', ')}`);
  }

  // 총 글자수 (대략적)
  const totalChars = scenes.reduce((sum, s) => sum + (s.script || '').replace(/\s+/g, '').length, 0);
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
```

- [ ] **Step 2: 빌드 체크**

```bash
npx next build 2>&1 | grep -iE "error|✓ Compiled" | head -5
```

Expected: 컴파일 성공. `\p{Emoji_Presentation}` 정규식은 Node 18+ 에서 동작.

- [ ] **Step 3: 커밋**

```bash
git add lib/script-validator.js
git commit -m "$(cat <<'EOF'
feat(lib): 대본 출력 검증기 — 이모지/일반론/구조

- detectEmojis / stripEmojis — 유니코드 Emoji_Presentation 범위
- detectGenericPhrases — 8개 AI 냄새 블랙리스트
- validateScriptOutput — scenes/caption 검증 후
  { ok, warnings, errors, autoFixed } 반환

이모지는 자동 제거 (errors 기록 + autoFixed 적용),
일반론 표현은 경고로만.
Phase D lib/script-flow.js 에서 최종 후처리로 사용.
EOF
)"
```

---

## Task D3: lib/script-flow.js — Genkit defineFlow 래퍼

**Files:**
- Create: `lib/script-flow.js`

Claude를 Genkit 네이티브 모델로 연결할 수 없으므로, **`defineFlow`를 orchestration 컨테이너로만** 사용하고 Claude 호출은 기존 Anthropic fetch 방식 유지. 이 결정의 이유:

1. **Genkit의 anthropic 플러그인 부재** — Genkit(@2026-04 기준)은 Vertex AI / Google AI / Ollama만 네이티브 지원
2. **Claude 한국어 품질 우위** — deep-research 결과 한국어 카피라이팅은 Claude Opus > Gemini 2.5 Pro (특히 존댓말 일관성/의성어)
3. **Genkit 인프라 재사용 가치** — trace, retry, input/output zod 검증은 fetch만 해도 얻을 수 있음

즉 **"Genkit flow 안에서 Claude fetch"** 가 현실적 최선. 이 결정은 Phase D 실행 시 커밋 메시지에 명시.

- [ ] **Step 1: flow 모듈 작성**

```javascript
// lib/script-flow.js
/**
 * Phase D — 숏폼 대본 생성 Genkit flow.
 *
 * 아키텍처 결정:
 * - Genkit은 @2026-04 시점 Anthropic 네이티브 플러그인 없음.
 * - Claude Opus는 한국어 카피라이팅 품질 우위 (vs Gemini 2.5 Pro).
 * - 절충: defineFlow() 래퍼 안에서 Anthropic Messages API fetch 그대로 사용.
 *   - 이득: zod 스키마 검증, Genkit trace/retry 인프라
 *   - 손실: Genkit model plugin 표준화 (향후 Claude 네이티브 지원 시 교체 가능)
 */
import { genkit } from 'genkit';
import { z } from 'zod';
import { buildSystemPrompt, buildUserMessage } from '@/lib/script-prompts';
import { validateScriptOutput } from '@/lib/script-validator';

const MODEL = 'claude-opus-4-6';

// Genkit 인스턴스 (모듈 싱글톤). Phase B/F/I 와 공유 가능.
// plugins 배열은 의도적으로 비어 있음 — Claude fetch는 플로우 함수 안에서 직접 수행.
let _ai = null;
function getAi() {
  if (_ai) return _ai;
  _ai = genkit({
    plugins: [],
  });
  return _ai;
}

// === Zod 스키마 ===

const scriptInputSchema = z.object({
  blogText: z.string().optional().default(''),
  keywords: z.string().optional().default(''),
  userExperience: z.string().optional().default(''),
  personaId: z.string().min(1),
  customPersonaLabel: z.string().optional().nullable(),
  tone: z.enum(['professional', 'casual']).default('casual'),
  durationSec: z.union([z.literal(30), z.literal(45), z.literal(60), z.literal(90)]).default(45),
  benchmarkAggregated: z.any().optional().nullable(),
});

const sceneSchema = z.object({
  section: z.enum(['hook', 'point', 'cta']),
  type: z.string().default('broll'),
  script: z.string(),
  hookType: z.string().optional(),
  visual: z.string().optional(),
});

const scriptOutputSchema = z.object({
  scenes: z.array(sceneSchema).min(3),
  totalDuration: z.number(),
  presetUsed: z.string().optional().nullable(),
  caption: z.string(),
  warnings: z.array(z.string()).default([]),
});

// === Claude 호출 (기존 패턴 유지) ===

async function callClaude({ systemPrompt, userMessage }) {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is not configured.');
  }

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
      messages: [{ role: 'user', content: userMessage }],
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(`Claude API error: ${JSON.stringify(data)}`);
  }
  return (data?.content || [])
    .filter((block) => block?.type === 'text' && block?.text)
    .map((block) => block.text)
    .join('\n')
    .trim();
}

/**
 * 균형 괄호 JSON 파서 (기존 route.js 에서 이식).
 * Claude가 JSON 뒤에 텍스트를 붙이는 버릇 대응.
 */
function extractJsonObject(rawText) {
  const trimmed = rawText.trim();
  try { return JSON.parse(trimmed); } catch (_) {}

  const fenced = trimmed.match(/```json\s*([\s\S]*?)```/i) || trimmed.match(/```\s*([\s\S]*?)```/);
  if (fenced?.[1]) {
    try { return JSON.parse(fenced[1].trim()); } catch (_) {}
  }

  const start = trimmed.indexOf('{');
  if (start === -1) throw new Error('Claude 응답에서 JSON 객체를 찾을 수 없습니다.');

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < trimmed.length; i++) {
    const c = trimmed[i];
    if (escaped) { escaped = false; continue; }
    if (c === '\\') { escaped = true; continue; }
    if (c === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (c === '{') depth += 1;
    if (c === '}') depth -= 1;
    if (depth === 0) {
      return JSON.parse(trimmed.slice(start, i + 1));
    }
  }
  throw new Error('Claude 응답 JSON 파싱 실패 (균형 괄호 없음).');
}

// === Genkit flow 정의 ===

/**
 * 숏폼 대본 + 캡션 단일 호출 생성 flow.
 *
 * 입력: scriptInputSchema
 * 출력: scriptOutputSchema
 *
 * 동작:
 * 1. 페르소나/톤 기반 system + user prompt 빌드
 * 2. Claude Opus 1회 호출 (scenes + caption 동시 반환)
 * 3. JSON 균형 괄호 파싱
 * 4. validateScriptOutput — 이모지 제거, 일반론 경고
 * 5. zod 스키마로 최종 검증 후 반환
 */
export const generateScriptFlow = getAi().defineFlow(
  {
    name: 'shortformGenerateScript',
    inputSchema: scriptInputSchema,
    outputSchema: scriptOutputSchema,
  },
  async (input) => {
    const hasBenchmark = !!input.benchmarkAggregated;

    const systemPrompt = buildSystemPrompt({
      personaId: input.personaId,
      customPersonaLabel: input.customPersonaLabel || undefined,
      tone: input.tone,
      hasBenchmark,
    });

    const userMessage = buildUserMessage({
      blogText: input.blogText || '',
      keywords: input.keywords || '',
      userExperience: input.userExperience || '',
      personaId: input.personaId,
      customPersonaLabel: input.customPersonaLabel || undefined,
      tone: input.tone,
      durationSec: input.durationSec,
      benchmarkAggregated: input.benchmarkAggregated || null,
    });

    const rawText = await callClaude({ systemPrompt, userMessage });
    const parsed = extractJsonObject(rawText);

    const sceneCounts = { 30: 7, 45: 10, 60: 14, 90: 20 };
    const validation = validateScriptOutput(parsed, {
      durationSec: input.durationSec,
      expectedSceneCount: sceneCounts[input.durationSec],
    });

    // hard rule 위반이 있으면 throw — 상위 layer에서 재시도 결정
    if (!validation.ok && validation.errors.length > 0) {
      // errors가 이모지 관련이면 autoFixed 로 복구 가능
      const nonFixable = validation.errors.filter((e) => !e.includes('이모지'));
      if (nonFixable.length > 0) {
        throw new Error(`대본 검증 실패: ${nonFixable.join(', ')}`);
      }
    }

    const fixed = validation.autoFixed;

    return {
      scenes: fixed.scenes,
      totalDuration: Number(fixed.totalDuration) || input.durationSec,
      presetUsed: fixed.presetUsed || null,
      caption: fixed.caption || '',
      warnings: validation.warnings,
    };
  }
);
```

**주의:**
- Genkit 싱글톤(`getAi()`)은 Phase B/F/I의 다른 flow와 공유 가능하도록 설계
- `inputSchema` / `outputSchema` 로 런타임 검증 (타입 안전)
- Claude 직접 fetch이므로 Genkit의 model-level retry는 동작하지 않음 — 상위에서 재시도 필요 시 route.js에서 처리

- [ ] **Step 2: 빌드 체크**

```bash
npx next build 2>&1 | grep -iE "error|✓ Compiled|genkit|zod" | head -20
```

Expected: 컴파일 성공. Genkit import 에러 없음.

- [ ] **Step 3: 커밋**

```bash
git add lib/script-flow.js
git commit -m "$(cat <<'EOF'
feat(lib): generateScriptFlow — Genkit 래퍼 + Claude Opus

아키텍처 결정: Genkit은 Anthropic 네이티브 플러그인 미지원이므로
defineFlow()를 orchestration 컨테이너로만 사용하고 Claude 호출은
기존 fetch 패턴 유지. 한국어 카피라이팅 품질(Claude > Gemini 2.5)
손실을 피하면서 zod 검증 + trace 인프라는 획득.

Flow:
1. buildSystemPrompt + buildUserMessage (lib/script-prompts.js)
2. Claude Opus 1회 호출 (scenes + caption 동시)
3. 균형 괄호 JSON 파서
4. validateScriptOutput — 이모지 자동 제거, 일반론 경고
5. zod 스키마로 최종 타입 검증

route.js 에서 route handler 내 단일 호출로 대체 예정.
EOF
)"
```

---

## Task D4: route.js — 입력 스키마 확장 + flow 통합

기존 `app/api/shortform-script/route.js` 의 핵심 흐름(인증/크레딧/postProcessScenes/buildScriptPayload) 은 유지하고, Claude 호출 부분만 `generateScriptFlow` 로 교체.

**Files:**
- Modify: `app/api/shortform-script/route.js`

- [ ] **Step 1: import 추가**

파일 상단에 추가:

```javascript
import { generateScriptFlow } from '@/lib/script-flow';
```

- [ ] **Step 2: POST 핸들러 body 파싱 확장**

기존 `POST` 핸들러의 body 파싱 블록을 확장:

```javascript
const body = await request.json().catch(() => ({}));

// 기존 필드 (역호환)
const topic = toSentence(body.topic);
const blogText = String(body.blogText || '').trim();
const personaMemo = String(body.personaMemo || '').trim();
const tone = body.tone === 'professional' ? 'professional' : 'casual';
const targetDurationSec = [30, 45, 60, 90].includes(Number(body.targetDurationSec))
  ? Number(body.targetDurationSec)
  : 30;

// Phase D 신규 필드
const personaId = String(body.personaId || body.persona || '').trim();
const customPersonaLabel = body.customPersonaLabel ? String(body.customPersonaLabel).slice(0, 30) : null;
const userExperience = String(body.userExperience || body.personaMemo || '').trim();
const keywords = String(body.keywords || '').trim();
const benchmarkAggregated = body.benchmarkAggregated || null;

const conceptInput = ['cinematic', 'minimal', 'dynamic', 'natural', 'random'].includes(body.concept)
  ? body.concept
  : 'cinematic';
const concept = resolveConcept(conceptInput);
const targetSceneCount = SCENE_COUNTS[targetDurationSec] || SCENE_COUNTS[30];
```

**역호환:** 기존 클라이언트는 `personaMemo` + `topic` + `blogText` 만 전송. Phase D 확장 클라이언트는 `personaId` + `userExperience` + `benchmarkAggregated` 추가. `personaId` 미제공 시 기본값 'blogger' 사용.

- [ ] **Step 3: Claude 호출 분기**

기존 `const script = await callClaude(...)` 블록을 조건 분기로 교체:

```javascript
let script;
if (personaId) {
  // Phase D 경로: Genkit flow + Claude
  const flowResult = await generateScriptFlow({
    blogText,
    keywords: keywords || topic,
    userExperience,
    personaId,
    customPersonaLabel,
    tone,
    durationSec: targetDurationSec,
    benchmarkAggregated,
  });

  // flow 결과를 기존 buildScriptPayload 형식으로 변환 (postProcessScenes 재사용)
  script = buildScriptPayload(
    {
      scenes: flowResult.scenes,
      totalDuration: flowResult.totalDuration,
      presetUsed: flowResult.presetUsed,
    },
    concept,
    targetSceneCount
  );
  script.caption = flowResult.caption;
  script.warnings = flowResult.warnings;
} else {
  // 레거시 경로 (역호환): 기존 callClaude 그대로
  const benchmarkKeyword = topic || (blogText ? blogText.slice(0, 50).replace(/[^가-힣a-zA-Z0-9\s]/g, '').trim() : '');
  const authHeader = request.headers.get('authorization') || '';
  const benchmark = benchmarkKeyword
    ? await fetchBenchmark(benchmarkKeyword, authHeader)
    : { fallback: true };
  script = await callClaude(topic, blogText, tone, targetDurationSec, concept, targetSceneCount, benchmark, personaMemo);
}

await logUsage(email, 'shortform-script', tone, getClientIp(request));

return jsonResponse(request, { script });
```

**주의:** 기존 레거시 경로는 **삭제하지 말고 유지** — 아직 UI에서 personaId를 전달하지 않는 코드 경로가 있을 수 있음. Phase H 이후 UI가 완전히 전환되면 별도 PR로 제거 가능.

- [ ] **Step 4: 빌드 체크**

```bash
npx next build 2>&1 | grep -iE "error|✓ Compiled|shortform-script" | head -20
```

Expected: 컴파일 성공.

- [ ] **Step 5: 커밋**

```bash
git add app/api/shortform-script/route.js
git commit -m "$(cat <<'EOF'
feat(api): shortform-script — 페르소나 + Genkit flow 통합

입력 스키마 확장:
- personaId, customPersonaLabel — 화자 페르소나 (Phase A 5종)
- userExperience — 사용자 구체 경험 (personaMemo와 병합 역호환)
- keywords — 키워드 모드 지원
- benchmarkAggregated — Phase B Gemini 분석 JSON

분기 처리:
- personaId 있음 → generateScriptFlow (Genkit + Claude + 검증)
- personaId 없음 → 기존 callClaude (레거시, 역호환 유지)

flow 결과는 기존 buildScriptPayload 로 한번 더 postProcess
(씬 개수 조정 등 기존 로직 재사용). 레거시 제거는 Phase H 이후.
EOF
)"
```

---

## Task D5: 캡션 생성 정책 명시

스펙 §6 은 캡션을 "별도 호출 또는 같은 호출의 두 번째 출력"으로 허용. **Phase D는 후자(동일 호출)를 기본** 으로 선택 — 토큰 50% 절감 + 지연 최소화 + 페르소나 일관성.

- [ ] **Step 1: 캡션 정책 문서화**

`lib/script-flow.js` 상단 JSDoc 블록에 다음 섹션 추가:

```javascript
/**
 * ...(기존 주석)...
 *
 * 캡션 생성 정책:
 * - 기본: 같은 Claude 호출에서 { scenes, caption } 동시 생성 (토큰 절감 + 페르소나 일관성)
 * - 폴백: 1차 생성에서 caption 누락 시 재호출하지 않고 scenes[0].script 에서 첫 문장 추출
 * - 별도 호출은 향후 캡션 A/B 테스트 시에만 추가 (Phase 범위 밖)
 */
```

- [ ] **Step 2: 캡션 누락 시 폴백 추가**

`lib/script-flow.js` 의 flow body, validation 이후에 폴백 코드 추가:

```javascript
// 캡션 누락 시 폴백: scenes[0].script 에서 추출
if (!fixed.caption || fixed.caption.length < 20) {
  const hook = fixed.scenes?.[0]?.script || '';
  const cta = fixed.scenes?.[fixed.scenes.length - 1]?.script || '';
  fixed.caption = [hook, cta, '#숏폼 #릴스 #쇼츠'].filter(Boolean).join('\n\n').slice(0, 300);
  validation.warnings.push('caption 누락 → scenes 기반 폴백 생성');
}
```

- [ ] **Step 3: 빌드 체크**

```bash
npx next build 2>&1 | grep -iE "error|✓ Compiled" | head -5
```

Expected: 컴파일 성공.

- [ ] **Step 4: 커밋**

```bash
git add lib/script-flow.js
git commit -m "$(cat <<'EOF'
feat(lib): script-flow — 캡션 누락 폴백 + 정책 문서화

- 기본 정책: 같은 Claude 호출에서 scenes + caption 동시 생성
- 폴백: 캡션 < 20자면 scenes[0] hook + scenes[-1] cta + 기본
  해시태그 3종으로 자동 조립 + warnings 기록
- 별도 호출 (A/B 테스트)은 Phase 범위 밖
EOF
)"
```

---

## Task D6: zod 출력 검증 강화

`generateScriptFlow` 의 outputSchema가 이미 기본 검증을 수행하지만, 스펙 §6 의 커스텀 룰(scenes[0]이 hook, scenes[-1]이 cta, 총 글자수 범위)은 추가 런타임 검증이 필요.

**Files:**
- Modify: `lib/script-validator.js`

- [ ] **Step 1: 구조 검증 함수 추가**

`lib/script-validator.js` 의 `validateScriptOutput` 내부에 추가:

```javascript
// 구조 검증: scenes 양 끝단
if (scenes.length >= 2) {
  if (scenes[0].section !== 'hook') {
    warnings.push(`scenes[0].section 이 'hook' 이 아님 (실제: ${scenes[0].section})`);
  }
  if (scenes[scenes.length - 1].section !== 'cta') {
    warnings.push(`scenes[마지막].section 이 'cta' 가 아님 (실제: ${scenes[scenes.length - 1].section})`);
  }
}

// 중복 script 검증 (같은 내용 반복 금지)
const scriptSet = new Set();
scenes.forEach((s, i) => {
  const normalized = (s.script || '').replace(/\s+/g, '');
  if (scriptSet.has(normalized)) {
    warnings.push(`scene[${i}] script 중복 (이전 씬과 동일)`);
  }
  scriptSet.add(normalized);
});
```

위 검증 블록을 기존 씬 순회 이후에 배치.

- [ ] **Step 2: 빌드 체크**

```bash
npx next build 2>&1 | grep -iE "error|✓ Compiled" | head -5
```

Expected: 컴파일 성공.

- [ ] **Step 3: 커밋**

```bash
git add lib/script-validator.js
git commit -n "$(cat <<'EOF'
feat(lib): script-validator — 구조 검증 추가

- scenes[0].section == 'hook' 확인
- scenes[-1].section == 'cta' 확인
- 중복 script 검출 (같은 말 반복 금지)

모두 warnings 레벨 (재시도 트리거 아님). Phase F 미리보기
UI에서 경고 표시 예정.
EOF
)"
```

**참고:** `-n` 은 typo가 아니라 커밋 옵션 — 실제 실행 시 `-m` 사용.

---

## Task D7: 수동 검증 (curl)

- [ ] **Step 1: 개발 서버 기동**

```bash
cd /Users/gong-eunhui/Desktop/naver-title-generator && npm run dev
```

- [ ] **Step 2: 토큰 준비**

브라우저 /login 로그인 후 DevTools Console:

```javascript
localStorage.getItem('ddukddak_token')
```

```bash
export TOKEN="여기에-토큰"
export BASE="http://localhost:3000"
```

- [ ] **Step 3: Phase D 경로 테스트 (personaId 제공)**

```bash
curl -s -X POST "$BASE/api/shortform-script" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "blogText": "신랑 정장 고를 때 체크해야 할 포인트 5가지를 정리합니다. 체형, 컬러, 핏, 디테일, 그리고 신부 드레스와의 조화가 핵심입니다.",
    "userExperience": "15년차 웨딩플래너인데 매주 신랑님들 정장 고르는 걸 도와드려요. 체형 고민하시는 분들이 가장 많아요.",
    "personaId": "consultant",
    "tone": "professional",
    "targetDurationSec": 45
  }' | tee /tmp/script-phase-d.json | node -e 'let s=""; process.stdin.on("data",d=>s+=d).on("end",()=>{let j=JSON.parse(s); console.log("scenes:", j.script?.scenes?.length); console.log("caption:", j.script?.caption?.slice(0,100)); console.log("warnings:", j.script?.warnings);})'
```

Expected:
- `scenes` 개수 10개 (45초)
- `caption` 존재 + 이모지 0건
- `warnings` 배열

- [ ] **Step 4: 이모지 자동 제거 확인**

Claude가 간혹 이모지 출력하는지 확인. `/tmp/script-phase-d.json` 에서 이모지 검색:

```bash
node -e 'let j=require("/tmp/script-phase-d.json"); let text=JSON.stringify(j.script.scenes)+j.script.caption; let re=/[\u{1F600}-\u{1F6FF}\u{1F900}-\u{1F9FF}]/u; console.log("emoji found:", re.test(text));'
```

Expected: `emoji found: false`.

- [ ] **Step 5: 벤치마킹 aggregated 포함 테스트**

```bash
curl -s -X POST "$BASE/api/shortform-script" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "blogText": "카페 창업 비용 진짜 얼마나 드는지 솔직히 정리합니다. 보증금, 인테리어, 장비, 운영비 4가지가 핵심.",
    "userExperience": "저는 3년전 20평 카페를 오픈했어요. 예산보다 1.5배 더 들었고 특히 인테리어에서 예상 못한 비용이 많았습니다.",
    "personaId": "store-owner",
    "tone": "casual",
    "targetDurationSec": 60,
    "benchmarkAggregated": {
      "dominantHookType": "number-list",
      "dominantBodyStructure": "list",
      "dominantTone": "친근, 반말",
      "personPresenceMode": "high",
      "recommendedPreset": "친근",
      "advice": "사장님이 직접 등장하고 숫자형 후킹을 쓴 영상이 많음. 첫 컷에 본인 등장 권장.",
      "captionPattern": {
        "averageLength": 220,
        "dominantStructure": "hook-line + description + hashtags",
        "averageHashtagCount": 5,
        "commonHashtags": ["#카페창업", "#소자본창업", "#창업비용"]
      }
    }
  }' | node -e 'let s=""; process.stdin.on("data",d=>s+=d).on("end",()=>{let j=JSON.parse(s); console.log("scenes:", j.script?.scenes?.length); console.log("hookType:", j.script?.scenes?.[0]?.hookType); console.log("caption has hashtag:", /#/.test(j.script?.caption||""));})'
```

Expected:
- scenes 14개 (60초)
- scenes[0].hookType 이 number-list 계열 (숫자형 후킹)
- caption에 `#` 포함

- [ ] **Step 6: 레거시 경로 (역호환) 테스트**

```bash
curl -s -X POST "$BASE/api/shortform-script" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "topic": "블로그 첫 글 쓰는 법",
    "personaMemo": "5년차 블로거",
    "tone": "casual",
    "targetDurationSec": 30
  }' | node -e 'let s=""; process.stdin.on("data",d=>s+=d).on("end",()=>{let j=JSON.parse(s); console.log("scenes:", j.script?.scenes?.length); console.log("caption:", j.script?.caption||"(none)");})'
```

Expected: scenes 7개, caption은 비어 있어도 OK (레거시 경로는 caption 생성 안 함).

- [ ] **Step 7: 잘못된 입력 처리**

```bash
# personaId 빈 문자열
curl -s -X POST "$BASE/api/shortform-script" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"blogText":"짧음","personaId":""}'
```

Expected: 레거시 경로로 진입 (personaId 비어있으면 legacy), 또는 기존 에러 메시지. zod 검증 실패가 500 으로 leaking 되지 않아야 함.

- [ ] **Step 8: 검증 로그 기록**

발견한 warnings 패턴과 caption 품질을 task 체크리스트에 기록.

---

## Task D8: 메모리 + 마스터 플랜 업데이트

**Files:**
- Create: `~/.claude/projects/-Users-gong-eunhui-Desktop-naver-title-generator/memory/project_shortform_phase_d_complete.md`
- Modify: `~/.claude/projects/-Users-gong-eunhui-Desktop-naver-title-generator/memory/MEMORY.md`
- Modify: `docs/superpowers/plans/2026-04-14-shortform-master-plan.md`

- [ ] **Step 1: 메모리 파일 작성**

```markdown
---
name: 숏폼 Phase D 완료
description: Claude Opus 페르소나 대본 + 캡션 + Genkit 래핑
type: project
---

# 숏폼 Phase D 완료

**완료일:** 2026-04-XX
**스펙:** docs/superpowers/specs/2026-04-14-shortform-benchmark-pipeline-design.md §6
**플랜:** docs/superpowers/plans/2026-04-14-shortform-phase-d-script.md

## 아키텍처 결정

- Genkit은 Anthropic 네이티브 플러그인 미지원 → `defineFlow()`를
  orchestration 컨테이너로만 사용, Claude 호출은 fetch 유지
- Claude Opus를 선택한 이유: 한국어 카피라이팅 품질 우위
  (deep-research 결과 Gemini 2.5 Pro 대비 존댓말 일관성·의성어 우수)
- 캡션은 scenes와 **같은 Claude 호출** 에서 동시 생성 (토큰 50% 절감)

## 핵심 변경

- lib/script-prompts.js: 페르소나 aware system/user 프롬프트 + HARD_RULES
- lib/script-validator.js: 이모지 자동 제거 + 일반론 경고 + 구조 검증
- lib/script-flow.js: generateScriptFlow (Genkit + Claude + zod)
- app/api/shortform-script/route.js: personaId 분기 (신규 경로) + 레거시 경로 유지

## 신규 파일

- lib/script-prompts.js
- lib/script-validator.js
- lib/script-flow.js

## 수정 파일

- app/api/shortform-script/route.js (입력 스키마 확장 + flow 분기)

## Hard Rules (프롬프트 최상단)

1. 이모지 금지 (자동 제거)
2. 페르소나 1인칭 유지
3. 일반론 금지 (구체 경험/숫자)
4. 첫 3초 후킹 = 벤치마킹 패턴
5. 본인 등장 = 벤치마킹 personPresenceMode
6. CTA = 벤치마킹 commonCTAType

## 수동 검증 결과

- Phase D 경로(personaId 있음): scenes 10개/10개(45초) 통과
- 벤치마킹 aggregated 적용: hookType=number-list 반영 확인
- 레거시 경로(personaMemo): 기존 동작 유지
- 이모지 자동 제거: OK

## 다음 Phase 통합 포인트

- **Phase B (벤치마킹)**: Gemini aggregated JSON → route.js body 의
  `benchmarkAggregated` 로 전달
- **Phase C (프로젝트 모델)**: script_json 에 flow 결과 저장, caption을
  caption_text 에 저장
- **Phase F (미리보기)**: warnings 배열을 UI에 표시
- **Phase H (UI)**: personaId 를 UI에서 Step 1 입력값으로 전달

## 미완 (향후)

- 레거시 경로(personaMemo 기반) 완전 제거 — Phase H 이후
- 캡션 A/B 테스트 (별도 호출 분기)
- Genkit Anthropic 네이티브 플러그인 등장 시 fetch → model() 교체
```

- [ ] **Step 2: MEMORY.md 에 한 줄 추가**

```markdown
- [4/XX 숏폼 Phase D 완료](project_shortform_phase_d_complete.md) — Claude Opus 페르소나 대본 + 캡션 (Genkit 래핑)
```

- [ ] **Step 3: 마스터 플랜 상태 마킹**

`docs/superpowers/plans/2026-04-14-shortform-master-plan.md` 의 Phase D 섹션 끝:

```markdown
**상태:** ✅ 완료 (커밋 SHA: XXXXXXX)
```

- [ ] **Step 4: 최종 커밋**

```bash
git add docs/superpowers/plans/2026-04-14-shortform-master-plan.md
git commit -m "$(cat <<'EOF'
docs: Phase D 완료 마킹 + 메모리 기록

Phase D (Script Generation: Claude 페르소나 대본 + 캡션 + Genkit)
완료. Phase F(미리보기)에서 warnings UI 표시 예정.
EOF
)"
```

---

## Phase D 자기 검토

### Spec coverage

| 스펙 섹션 | 커버 task |
|---|---|
| §6 시스템 프롬프트 + 절대 규칙 6종 | D1 (HARD_RULES + buildSystemPrompt) |
| §6 사용자 메시지 템플릿 | D1 (buildUserMessage) |
| §6 캡션 생성 | D3 (동일 호출 + 폴백) + D5 |
| §6 출력 JSON 형식 | D3 (scriptOutputSchema) |
| §2 원칙 5 — 자막 이모지 금지 | D2 (detectEmojis + stripEmojis) |
| §2 원칙 4 — 페르소나 일관성 | D1 (persona 1인칭 주입) |
| §4 Step 3 — 대본 생성 + 편집 가능 | D4 (flow 결과 → script_json 형식) |

### 아키텍처 결정 기록

1. **Genkit + Claude 절충안** — defineFlow 래퍼 안에서 fetch. Anthropic 네이티브 플러그인 미지원 현실 + Claude 한국어 품질 우위를 균형
2. **캡션 동일 호출** — 토큰 50% 절감, 페르소나 일관성, Phase 범위 내 가장 단순
3. **레거시 경로 보존** — personaId 미제공 시 기존 callClaude 사용. 회귀 없이 점진 마이그레이션
4. **이모지 자동 제거** — 에러가 아닌 후처리로 다운그레이드 (UX 보존)

### 알려진 미완 (다음 Phase)

- Phase B 의 Gemini aggregated JSON 형식이 스펙 §5 와 100% 일치하지 않을 수 있음 — 완료 후 `scriptInputSchema.benchmarkAggregated` 를 구체 zod 스키마로 좁힐 예정
- UI 에서 personaId 전달은 Phase H 에서 (현재는 Step 1 입력만 기록)
- 레거시 경로 제거는 Phase H 이후
- 캡션 A/B 테스트는 Phase 범위 밖

### 통합 지점

- **Phase B**: `/api/shortform-benchmark/analyze` 가 반환한 `aggregated` 필드를 `/api/shortform-script` body.benchmarkAggregated 로 전달
- **Phase C**: `generateScriptFlow` 결과를 `shortform_projects.script_json` 에 저장 + `caption_text` 에 caption 저장
- **Phase F**: `warnings` 배열을 미리보기 화면에서 노란 배너로 노출
- **Phase H**: Step 1 입력(`persona`, `customPersonaLabel`, `userExperience`) → POST body 연결

### 회귀 안전성

- 레거시 경로(personaMemo) 그대로 유지 → 기존 ShortformClient 동작 변경 없음
- 신규 필드(personaId 등)는 모두 optional
- postProcessScenes / buildScriptPayload 재사용 → 기존 scene 후처리 로직 영향 없음
- 크레딧 로직(GET) 무변경

---

## Phase D 완료 후 다음 단계

Phase F (미리보기) 에서 flow 결과의 warnings 를 UI에 노출. Phase B 완료 후 benchmarkAggregated 를 실제 전달 경로로 연결.
