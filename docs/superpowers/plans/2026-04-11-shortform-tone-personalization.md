# 숏폼 톤 개인화 + 공감 루프 구조 — 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 숏폼 대본 생성기에 운영자 페르소나/경험 메모 입력 + fingr식 공감 루프 구조 + 정형 CTA 폐기를 적용해 본문/CTA의 "나열 정리체" 문제 해결.

**Architecture:** `api/shortform-script.js` SYSTEM_PROMPT를 4개 섹션(Hook 6종 재해석 / 구조 강제 / Point / CTA)으로 재작성하고 `personaMemo` 필드를 request body에 추가. shortform.html에 optional textarea + blog-writer 핸드오프 수신 + lastMemo 자동 저장. blog-writer.html에 "숏폼 만들기" 버튼 추가해 `localStorage.blogTextForShortform` 송신.

**Tech Stack:** Vanilla JS (정적 HTML), Vercel Serverless Functions, Claude Sonnet 4 (`claude-sonnet-4-20250514`), Node.js ESM 모듈.

**Spec:** `docs/superpowers/specs/2026-04-11-shortform-tone-personalization-design.md`

---

## 사전 메모 — 테스트 인프라

이 프로젝트는 jest/vitest 등 테스트 러너가 없다. 대신 **node 직접 실행 스크립트**(`node scripts/test-shortform-prompt.mjs`)로 프롬프트 문자열 단위 검증을 수행한다. UI 변경은 manual E2E 절차로 검증한다(Task 6에 명시).

---

## File Structure

| 파일 | 역할 | 변경 종류 |
|---|---|---|
| `api/shortform-script.js` | SYSTEM_PROMPT 재작성, `personaMemo` 추출, `buildUserPrompt` 시그니처 확장. SYSTEM_PROMPT/buildUserPrompt를 export해 테스트 가능하게 함 | Modify |
| `scripts/test-shortform-prompt.mjs` | 프롬프트 단위 테스트(금지 문구 0회, 신규 섹션 존재) | Create |
| `shortform.html` | personaMemo textarea, 핸드오프 수신, lastMemo 자동 저장, request body에 personaMemo 추가 | Modify |
| `blog-writer.html` | "숏폼 만들기" 버튼 + `goToShortformGenerator()` 함수 | Modify |

---

## Task 1: 백엔드 — 프롬프트 export + 테스트 스크립트 (실패 케이스)

**Files:**
- Modify: `api/shortform-script.js:39` (`SYSTEM_PROMPT` const에 `export` 추가)
- Modify: `api/shortform-script.js:111` (`buildUserPrompt` 함수에 `export` 추가)
- Create: `scripts/test-shortform-prompt.mjs`

- [ ] **Step 1: `SYSTEM_PROMPT`와 `buildUserPrompt`에 `export` 추가**

`api/shortform-script.js:39` 변경:

```js
export const SYSTEM_PROMPT = `당신은 한국어 숏폼 영상 대본 작가입니다. ...
```

`api/shortform-script.js:111` 변경:

```js
export function buildUserPrompt(topic, blogText, tone, targetDurationSec, targetSceneCount, benchmark) {
```

다른 코드는 건드리지 않는다 (이번 단계는 export 키워드만).

- [ ] **Step 2: 테스트 스크립트 생성 (현재 SYSTEM_PROMPT 기준으로 실패해야 함)**

`scripts/test-shortform-prompt.mjs` 생성:

```js
#!/usr/bin/env node
import { SYSTEM_PROMPT, buildUserPrompt } from '../api/shortform-script.js';

const failures = [];

function assertContains(haystack, needle, label) {
  if (!haystack.includes(needle)) failures.push(`MISSING: ${label} — expected "${needle}"`);
}

function assertNotContains(haystack, needle, label) {
  if (haystack.includes(needle)) failures.push(`FORBIDDEN: ${label} — should not contain "${needle}"`);
}

// ── SYSTEM_PROMPT 검증 ──

// Hook 6종 공감 베이스 재해석
assertContains(SYSTEM_PROMPT, '공감 베이스', 'Hook 6종 재해석 헤더');
assertContains(SYSTEM_PROMPT, '6종 중 토픽에 가장 잘 맞는 것을 매번 다르게 선택', 'Hook 다양성 강제');

// 구조 강제 (공감 루프)
assertContains(SYSTEM_PROMPT, '공감 루프', '구조 섹션 헤더');
assertContains(SYSTEM_PROMPT, '7씬 (30초)', '30초 구조');
assertContains(SYSTEM_PROMPT, '10씬 (45초)', '45초 구조');
assertContains(SYSTEM_PROMPT, '마음읽기 질문', '마음읽기 강제');
assertContains(SYSTEM_PROMPT, 'scene[1]', 'scene[1] 위치 명시');

// Point 섹션
assertContains(SYSTEM_PROMPT, 'personaMemo', 'Point에 메모 변수 참조');
assertContains(SYSTEM_PROMPT, '관찰형 1인칭', '메모 없을 때 폴백');
assertContains(SYSTEM_PROMPT, '추상 나열 금지', 'Point 나열 금지');

// CTA 섹션 — 정형 문구 폐기
assertNotContains(SYSTEM_PROMPT, '궁금한 점 댓글로 남겨주세요\n', 'CTA 정형 문구1 (가이드 본문에 잔존 시)');
// 위 검사는 "금지" 목록에 등장하는 것은 허용하므로, CTA 가이드 안에 있는지 별도 확인
const ctaSectionMatch = SYSTEM_PROMPT.match(/\[CTA[\s\S]*?\]([\s\S]*?)(\[|$)/);
assertContains(SYSTEM_PROMPT, '동료로 호출', 'CTA 동료 호출 톤');
assertContains(SYSTEM_PROMPT, '비슷한 경험 있으면 댓글로 알려주세요', 'CTA 허용 예시');

// ── buildUserPrompt 검증 ──
const userPrompt = buildUserPrompt('테스트 토픽', '', 'casual', 30, 7, { fallback: true }, '저는 15년차 헤어 디자이너입니다');
assertContains(userPrompt, 'personaMemo', 'userPrompt에 personaMemo 라인');
assertContains(userPrompt, '저는 15년차 헤어 디자이너입니다', 'userPrompt에 메모 본문');
assertContains(userPrompt, '템플릿화 금지', 'userPrompt에 변주 강제');

const userPromptNoMemo = buildUserPrompt('테스트', '', 'casual', 30, 7, { fallback: true }, '');
assertContains(userPromptNoMemo, '(없음)', '메모 비었을 때 표시');

// ── 결과 출력 ──
if (failures.length === 0) {
  console.log('[PROMPT TEST] ✅ All assertions passed');
  process.exit(0);
} else {
  console.error('[PROMPT TEST] ❌ ' + failures.length + ' failures:');
  failures.forEach(f => console.error('  - ' + f));
  process.exit(1);
}
```

- [ ] **Step 3: 테스트 실행해서 실패 확인**

```bash
cd /Users/gong-eunhui/Desktop/naver-title-generator && node scripts/test-shortform-prompt.mjs
```

**Expected 출력**:
```
[PROMPT TEST] ❌ N failures:
  - MISSING: Hook 6종 재해석 헤더 — expected "공감 베이스"
  - MISSING: 구조 섹션 헤더 — expected "공감 루프"
  - MISSING: Point에 메모 변수 참조 — expected "personaMemo"
  - ... (다수)
```

(현재 SYSTEM_PROMPT에는 새 키워드가 전혀 없으므로 거의 모든 assertion이 실패해야 한다. 만약 통과하면 테스트 스크립트가 잘못 작성된 것이므로 다시 점검.)

`buildUserPrompt`는 호출 인자가 6개에서 7개로 늘어났는데 함수 시그니처는 아직 6개이므로 7번째 인자(`personaMemo`)는 무시되고 assertion에서 `personaMemo` 라인이 없어 실패한다.

- [ ] **Step 4: 커밋**

```bash
git add api/shortform-script.js scripts/test-shortform-prompt.mjs
git commit -m "test: 숏폼 프롬프트 단위 테스트 스크립트 추가 (실패 상태)

SYSTEM_PROMPT/buildUserPrompt를 export하고 신규 섹션(공감 루프, Hook 6종 재해석, personaMemo 통합) 존재 여부 + 정형 CTA 폐기 여부를 검증하는 노드 스크립트 추가. 다음 커밋에서 프롬프트 본문 작성 후 통과 예정.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: 백엔드 — SYSTEM_PROMPT 재작성 (Hook + 구조 + Point + CTA)

**Files:**
- Modify: `api/shortform-script.js:39-109` (SYSTEM_PROMPT 본문 전면 재작성)

- [ ] **Step 1: SYSTEM_PROMPT 본문 교체**

`api/shortform-script.js:39-109` 전체를 아래로 교체. 기존 `[절대 규칙]` 1~7번은 그대로 유지하고, `[후킹 공식]` ~ `[scenes 규칙]` 사이를 다음으로 재작성:

```js
export const SYSTEM_PROMPT = `당신은 한국어 숏폼 영상 대본 작가입니다. 사용자의 입력을 바탕으로 숏폼 대본을 scenes 배열로 작성하세요.

[절대 규칙]
1. 반드시 존댓말만 사용하세요. 반말, 유행어 남발, 과장된 말투는 금지입니다.
2. 출력은 설명 없이 순수 JSON 객체 하나만 반환하세요. 마크다운 코드블록, 부가 설명, 서문 금지입니다.
3. 사실은 사용자가 제공한 topic과 blogText 안에서만 사용하세요. 입력에 없는 구체적 수치나 사례를 지어내지 마세요.
4. 구어체로 자연스러운 내레이션 문장을 작성하세요. 문어체 금지.
5. 한 문장에 하나의 정보만. 숫자는 구체적으로 (많이→87%, 대부분→10명 중 8명).
6. 같은 말 반복 절대 금지. 씬마다 반드시 새로운 정보를 전달하세요. 표현만 바꿔 같은 내용을 되풀이하면 실패입니다.
7. 한 씬의 script는 최대 28자(공백 포함). 28자를 넘기면 씬을 나누세요. 짧은 문장이 임팩트 있습니다.

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

  ★ 메모(personaMemo)가 있으면: Point 중 최소 1씬은 메모를 28자 압축 가공.
    원문 그대로 X — 핵심 감정/장면/숫자만 추출해 숏폼 톤으로 재구성.
    예) 메모 "15년차 헤어 디자이너, 손님이 '여기 물 맛있다'고 했을 때 뿌듯했음"
        → 씬 "손님이 '물 맛있다' 한마디에 울컥했어요"

  ★ 메모가 없으면: 관찰형 1인칭 허용 — "~인 분들 많으세요", "저도 처음엔 ~인 줄 알았는데"

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
      "script": "대본 문장 (한국어, 1문장, 최대 28자)",
      "section": "hook | point | cta",
      "type": "broll",
      "visual": "구체적인 영어 B-roll 이미지 설명",
      "hookText": "(첫 씬만) 화면에 크게 표시할 후킹 문구 (한국어, 12자 이내)"
    }
  ]
}

[scenes 규칙]
- scenes 개수는 targetSceneCount에 맞추세요
- 각 scene의 script는 반드시 1문장, 최대 28자(공백 포함). 28자 넘으면 씬을 나누세요. SEDA 원칙: 짧고(Short), 쉽고(Easy), 직접적이고(Direct), 행동을 유도(Actionable).
- type은 모든 씬에서 반드시 "broll"만 사용. text 타입은 사용 금지.
- visual은 구체적인 영어 이미지 설명 (예: "close-up of hands typing on laptop")
- section은 Hook → Point → CTA 흐름에 맞게 배정
- hookText는 scenes[0]에만 포함, 나머지 씬에는 생략
`;
```

- [ ] **Step 2: 테스트 다시 실행 (`buildUserPrompt`는 아직 변경 안 했으므로 일부 실패 잔존)**

```bash
cd /Users/gong-eunhui/Desktop/naver-title-generator && node scripts/test-shortform-prompt.mjs
```

**Expected 출력**:
```
[PROMPT TEST] ❌ 3 failures:
  - MISSING: userPrompt에 personaMemo 라인 — expected "personaMemo"
  - MISSING: userPrompt에 메모 본문 — expected "저는 15년차 헤어 디자이너입니다"
  - MISSING: userPrompt에 변주 강제 — expected "템플릿화 금지"
```

(SYSTEM_PROMPT 관련 assertion은 모두 통과해야 한다. userPrompt 관련만 실패.)

- [ ] **Step 3: 커밋**

```bash
git add api/shortform-script.js
git commit -m "feat: 숏폼 SYSTEM_PROMPT 재작성 — 공감 루프 + Hook 6종 재해석 + Point/CTA

- Hook 6종 유지하되 공감 베이스로 재해석 (다양성 신호)
- 대본 구조: 7/10/14/20씬 base + 변주 룰
- scene[1] 마음읽기 질문 강제
- Point: personaMemo 가공 인용 + 관찰형 1인칭 폴백
- CTA: 정형 문구 4종 폐기, 동료 호출 톤

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: 백엔드 — buildUserPrompt + handler에 personaMemo 통합

**Files:**
- Modify: `api/shortform-script.js:111-158` (`buildUserPrompt` 시그니처 + 본문)
- Modify: `api/shortform-script.js:330` (`callClaude` 시그니처 + 본문)
- Modify: `api/shortform-script.js:397-430` (handler에서 `personaMemo` 추출)

- [ ] **Step 1: `buildUserPrompt` 시그니처에 `personaMemo` 추가**

`api/shortform-script.js:111` 변경:

```js
export function buildUserPrompt(topic, blogText, tone, targetDurationSec, targetSceneCount, benchmark, personaMemo) {
  const inputSummary = [
    `tone: ${tone}`,
    `targetDuration: ${targetDurationSec}초`,
    `targetSceneCount: ${targetSceneCount}`,
    topic ? `topic: ${topic}` : null,
    blogText ? `blogText:\n${blogText}` : null,
    `personaMemo: ${(personaMemo && personaMemo.trim()) ? personaMemo.trim() : '(없음)'}`,
  ].filter(Boolean).join('\n\n');
```

그리고 함수 마지막 `return` 문(현재 line 151~157)을 다음으로 교체:

```js
  return `${inputSummary}${benchmarkSection}

위 입력을 바탕으로 숏폼 영상 대본을 scenes 배열로 작성하세요.
- scenes 개수: 정확히 ${targetSceneCount}개
- 각 scene의 script를 합산한 총 글자수(공백 제외)가 ${targetDurationSec}초 분량에 맞아야 합니다 (약 ${targetDurationSec * 5}자).
- Hook → Point(공감 루프) → CTA가 각각 뚜렷해야 합니다.
- 너무 긴 서론 없이 바로 몰입되게 시작하세요.
- 위 [대본 구조] base를 따르되 매번 변주하세요. 템플릿화 금지.
- personaMemo가 있으면 Point 중 최소 1씬에 가공해 녹이세요. 없으면 관찰형 1인칭으로.`;
}
```

- [ ] **Step 2: `callClaude`에 `personaMemo` 전달**

`api/shortform-script.js:330` 변경:

```js
async function callClaude(topic, blogText, tone, targetDurationSec, concept, targetSceneCount, benchmark, personaMemo) {
```

그리고 같은 함수 안에서 `messages` 배열의 `content` 호출(현재 line 347):

```js
      messages: [{ role: 'user', content: buildUserPrompt(topic, blogText, tone, targetDurationSec, targetSceneCount, benchmark, personaMemo) }],
```

- [ ] **Step 3: handler에서 `personaMemo` 추출**

`api/shortform-script.js:398-410` 부근 수정. 기존 body 파싱 직후에 한 줄 추가:

```js
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const topic = toSentence(body.topic);
    const blogText = String(body.blogText || '').trim();
    const personaMemo = String(body.personaMemo || '').trim();
    const tone = body.tone === 'professional' ? 'professional' : 'casual';
```

그리고 같은 handler 안에서 `callClaude` 호출(현재 line 426)을 다음으로 교체:

```js
    const script = await callClaude(topic, blogText, tone, targetDurationSec, concept, targetSceneCount, benchmark, personaMemo);
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
cd /Users/gong-eunhui/Desktop/naver-title-generator && node scripts/test-shortform-prompt.mjs
```

**Expected 출력**:
```
[PROMPT TEST] ✅ All assertions passed
```

만약 실패가 남아있으면 어떤 assertion이 실패하는지 보고 해당 부분 수정. 통과까지 반복.

- [ ] **Step 5: 기존 호출 사이트가 깨지지 않았는지 grep**

```bash
cd /Users/gong-eunhui/Desktop/naver-title-generator && grep -rn "buildUserPrompt\|callClaude" api/ services/ scripts/ 2>&1 | grep -v test-shortform-prompt
```

**Expected**: `api/shortform-script.js` 안의 정의 + 호출 외에는 다른 파일에서 import하지 않아야 한다. 만약 외부 호출이 있으면 그 호출 사이트도 7번째 인자 추가 필요. 없으면 OK.

- [ ] **Step 6: 커밋**

```bash
git add api/shortform-script.js
git commit -m "feat: 숏폼 API에 personaMemo 필드 추가

buildUserPrompt/callClaude/handler 시그니처에 personaMemo 추가, inputSummary와 마무리 지시문에 메모 라인 통합. 단위 테스트 통과.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: 프론트엔드 — shortform.html에 personaMemo textarea + 핸드오프 수신

**Files:**
- Modify: `shortform.html:1432-1436` (blogTextInput 아래에 personaMemo textarea 삽입)
- Modify: `shortform.html:1744` (`els` 객체에 `personaMemoInput` 추가)
- Modify: `shortform.html:2664-2667` (request body에 `personaMemo` 추가)
- Modify: `shortform.html:3804-3807` (init 블록에 핸드오프 수신 + lastMemo 자동 채움)

- [ ] **Step 1: HTML — personaMemo textarea 추가**

`shortform.html:1436` 다음 줄(`</div>` 닫는 태그 바로 다음)에 새 input-group 삽입:

```html
        </div>

        <div class="input-group">
          <label class="input-label" for="personaMemoInput">내 경험 한 줄 <span style="font-weight:400; color:#6B7280;">(선택)</span></label>
          <textarea id="personaMemoInput" placeholder="본인의 경험·페르소나·실패담을 한 줄로 적어주세요. 비워도 됩니다.&#10;예: 15년차 헤어 디자이너, 처음엔 반신반의했는데 한 달 뒤 머릿결이 확 달라짐"></textarea>
        </div>

        <div class="btn-row">
```

(즉 기존 `<div class="btn-row">` 위에 새 input-group 한 블록 삽입.)

- [ ] **Step 2: `els` 객체에 element ref 추가**

`shortform.html:1744` 다음 줄에 추가:

```js
        blogTextInput: document.getElementById('blogTextInput'),
        personaMemoInput: document.getElementById('personaMemoInput'),
        generateScriptBtn: document.getElementById('generateScriptBtn'),
```

- [ ] **Step 3: request body에 `personaMemo` 필드 추가**

`shortform.html:2664-2667` 부분 수정:

```js
              blogText: els.blogTextInput.value.trim(),
              personaMemo: els.personaMemoInput.value.trim(),
              sourceText: els.blogTextInput.value.trim(),
              sourceType: els.blogTextInput.value.trim() ? 'blog' : 'keyword'
```

- [ ] **Step 4: init 블록에 핸드오프 수신 + lastMemo 자동 채움**

`shortform.html:3807` 직전(`showSignupBannerIfNeeded();` 위)에 추가:

```js
      // ── blog-writer 핸드오프 수신 ──
      try {
        var handoffRaw = localStorage.getItem('blogTextForShortform');
        if (handoffRaw) {
          var handoff = JSON.parse(handoffRaw);
          if (handoff && typeof handoff === 'object') {
            if (handoff.body && els.blogTextInput) els.blogTextInput.value = String(handoff.body);
            if (handoff.memo && els.personaMemoInput) els.personaMemoInput.value = String(handoff.memo);
            if (handoff.topic && els.keywordInput && !els.keywordInput.value) els.keywordInput.value = String(handoff.topic);
          }
          localStorage.removeItem('blogTextForShortform');
        }
      } catch (_) {}

      // ── lastMemo 자동 채움 (직접 진입 사용자) ──
      try {
        if (els.personaMemoInput && !els.personaMemoInput.value) {
          var lastMemo = localStorage.getItem('shortformLastMemo');
          if (lastMemo) els.personaMemoInput.value = lastMemo;
        }
        if (els.personaMemoInput) {
          els.personaMemoInput.addEventListener('blur', function() {
            try { localStorage.setItem('shortformLastMemo', els.personaMemoInput.value.trim()); } catch (_) {}
          });
        }
      } catch (_) {}

      showSignupBannerIfNeeded();
```

- [ ] **Step 5: 브라우저 수동 검증**

```bash
cd /Users/gong-eunhui/Desktop/naver-title-generator && python3 -m http.server 8000 &
sleep 1
echo "→ http://localhost:8000/shortform.html 열고 다음 확인:"
echo "  1) '내 경험 한 줄' 라벨과 textarea가 blogTextInput 아래에 보이는가?"
echo "  2) DevTools Console에서 localStorage.setItem('blogTextForShortform', JSON.stringify({body:'테스트 본문', memo:'테스트 메모'})) 후 페이지 새로고침 → blogTextInput에 '테스트 본문', personaMemoInput에 '테스트 메모'가 자동 채워지는가?"
echo "  3) localStorage.getItem('blogTextForShortform') 가 null인가? (수신 후 삭제 확인)"
echo "  4) personaMemoInput에 '운영자 메모' 입력 후 다른 곳 클릭 → 새로고침 → 자동 채워지는가? (lastMemo)"
echo "  5) Network 탭에서 '대본 생성' 클릭 → /api/shortform-script POST request body에 personaMemo 필드가 보이는가?"
echo ""
echo "테스트 끝나면: kill %1 (백그라운드 서버 종료)"
```

운영자가 위 5개 다 확인 후 다음 step.

- [ ] **Step 6: 커밋**

```bash
git add shortform.html
git commit -m "feat: shortform.html에 personaMemo 입력 + blog-writer 핸드오프 수신

- 내 경험 한 줄 (선택) textarea 추가
- request body에 personaMemo 포함
- blogTextForShortform localStorage 키로 blog-writer 인계 수신 (1회성)
- shortformLastMemo로 마지막 입력 자동 저장/복원

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: 프론트엔드 — blog-writer.html에 "숏폼 만들기" 버튼

**Files:**
- Modify: `blog-writer.html:1678` 부근 (premiumImageBtn 다음 줄에 숏폼 버튼 삽입)
- Modify: `blog-writer.html:3358` (`goToPremiumImageGenerator` 함수 다음에 `goToShortformGenerator` 추가)

- [ ] **Step 1: 핸드오프 송신 함수 추가**

`blog-writer.html:3358` (`goToPremiumImageGenerator` 함수 닫는 `}` 다음 줄)에 추가:

```js
  // ─── 숏폼 대본 생성기로 글 + 메모 전달 ───
  function goToShortformGenerator() {
    if (!generatedData) { alert('먼저 글을 생성해주세요.'); return; }
    var parts = [];
    if (generatedData.title) parts.push(generatedData.title);
    if (generatedData.hook) parts.push(generatedData.hook);
    if (generatedData.body) parts.push(generatedData.body);
    if (generatedData.cta) parts.push(generatedData.cta);
    var fullText = parts.join('\n\n');
    var memoEl = document.getElementById('memo');
    var memoVal = memoEl ? memoEl.value.trim() : '';
    var topicEl = document.getElementById('topic');
    var topicVal = topicEl ? topicEl.value.trim() : '';
    try {
      localStorage.setItem('blogTextForShortform', JSON.stringify({
        body: fullText,
        memo: memoVal,
        topic: topicVal,
      }));
    } catch (e) {}
    window.location.href = 'shortform.html';
  }
```

- [ ] **Step 2: 버튼 추가**

`blog-writer.html:1678`의 premiumImageBtn `<button>` 다음 줄에 새 버튼 삽입:

```html
    <button id="premiumImageBtn" onclick="goToPremiumImageGenerator()" style="...">PREMIUM 프리미엄 이미지 생성하기</button>
    <button id="shortformBtn" onclick="goToShortformGenerator()" style="display:inline-block; margin-top:12px; margin-left:8px; background:linear-gradient(135deg, #EC4899, #BE185D); color:#fff; padding:14px 32px; border-radius:12px; font-size:15px; font-weight:700; border:none; cursor:pointer; transition:all 0.2s; box-shadow:0 4px 16px rgba(236,72,153,0.25); font-family:'Noto Sans KR',sans-serif;" onmouseover="this.style.transform='translateY(-2px)';this.style.boxShadow='0 8px 24px rgba(236,72,153,0.35)'" onmouseout="this.style.transform='none';this.style.boxShadow='0 4px 16px rgba(236,72,153,0.25)'">NEW 이 글로 숏폼 만들기</button>
```

- [ ] **Step 3: 브라우저 수동 검증**

```bash
cd /Users/gong-eunhui/Desktop/naver-title-generator && python3 -m http.server 8000 &
sleep 1
echo "→ http://localhost:8000/blog-writer.html 열고 다음 확인:"
echo "  1) 임의 글 생성 (또는 generatedData 채워진 상태에서)"
echo "  2) '이 글로 숏폼 만들기' 버튼이 PREMIUM 버튼 옆에 보이는가?"
echo "  3) 버튼 클릭 → shortform.html로 이동 → blogTextInput에 글, personaMemoInput에 memo, keywordInput에 topic이 자동 채워지는가?"
echo "  4) shortform.html DevTools Console에서 localStorage.getItem('blogTextForShortform')이 null인가?"
echo ""
echo "테스트 끝나면: kill %1"
```

운영자가 4개 다 확인 후 다음 step.

- [ ] **Step 4: 커밋**

```bash
git add blog-writer.html
git commit -m "feat: blog-writer에서 숏폼 만들기 버튼 + 핸드오프 송신

PREMIUM 이미지 버튼 옆에 NEW 핑크 그라디언트 버튼 추가. 클릭 시 generatedData(title+hook+body+cta)와 memo, topic을 blogTextForShortform localStorage 키로 전달 후 shortform.html 이동.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: 통합 검증 (운영자 수동 E2E)

**Files:** (변경 없음, 검증만)

- [ ] **Step 1: 메모 있는 케이스 — 동일 토픽 3회 생성 (변주 검증)**

```bash
cd /Users/gong-eunhui/Desktop/naver-title-generator && python3 -m http.server 8000 &
```

운영자 절차:
1. http://localhost:8000/shortform.html 열기
2. keyword: `"AI 시대 자영업자 생존 전략"` 입력
3. personaMemo: `"15년차 헤어 디자이너, 처음엔 AI가 무서웠는데 챗지피티로 인스타 문구 30분 만에 만들고 깜짝 놀람"` 입력
4. 30초 / cinematic / casual로 3회 연속 생성
5. 다음 체크:
   - [ ] 3개 결과의 Hook 유형이 서로 다른가? (질문/충격/비밀/증거/공감/경고 중 다른 것)
   - [ ] scene[1]이 모두 마음읽기 질문 형태인가? ("솔직히 ~", "혹시 ~ 아니세요?", "~ 싶으셨을 거예요" 등)
   - [ ] 메모의 "헤어 디자이너", "챗지피티", "30분", "인스타" 중 하나 이상이 Point 씬에 가공돼 등장하는가?
   - [ ] CTA에 금지 문구(`"궁금한 점 댓글로 남겨주세요"`, `"유용했다면 팔로우 부탁드려요"`, `"감사합니다"`)가 0회 등장하는가?
   - [ ] 3개 결과의 구조 순서가 완전히 동일하지 않은가?

- [ ] **Step 2: 메모 없는 케이스 — 1회 생성**

1. shortform.html 새로고침 (또는 personaMemo 비움)
2. 같은 keyword로 1회 생성
3. 체크:
   - [ ] Point 씬에 관찰형 1인칭(`"~인 분들 많으세요"`, `"저도 처음엔 ~"`)이 등장하는가?
   - [ ] CTA가 정형 문구가 아닌 동료 호출형(`"비슷한 경험 있으면 댓글로"` 등)인가?

- [ ] **Step 3: blog-writer → shortform 핸드오프 E2E**

1. http://localhost:8000/blog-writer.html 열기
2. 메모 필드에 짧은 페르소나 입력 (`"강남 미용실 원장, 단골 30%가 30대 직장인"`)
3. 글 생성
4. "이 글로 숏폼 만들기" 버튼 클릭
5. shortform.html로 이동 후 체크:
   - [ ] blogTextInput에 글 본문이 자동 채워졌는가?
   - [ ] personaMemoInput에 메모가 자동 채워졌는가?
   - [ ] DevTools Console: `localStorage.getItem('blogTextForShortform')` → `null`인가?
6. 그대로 대본 생성 → Point에 메모 키워드(`"단골 30%"`, `"30대 직장인"` 등) 가공 등장 확인

- [ ] **Step 4: lastMemo 자동 복원**

1. shortform.html 새로고침
2. personaMemoInput이 직전 입력값으로 자동 채워지는가?
3. 다른 메모 입력 후 blur → 새로고침 → 새 메모로 갱신되는가?

- [ ] **Step 5: 종료**

```bash
kill %1
```

- [ ] **Step 6: 검증 결과 메모 업데이트**

`/Users/gong-eunhui/.claude/projects/-Users-gong-eunhui-Desktop-naver-title-generator/memory/MEMORY.md`와 `project_session_0411.md`에 결과 한 줄 추가:
- 통과 항목, 실패/이슈 항목, 후속 작업 필요 사항

```bash
# 메모 파일 직접 편집 후
git add docs/superpowers/  # plan/spec 변경 없으면 생략
```

(메모는 git 추적 외 디렉토리이므로 별도 commit 불필요. 통과/실패만 사용자에게 보고.)

---

## 최종 푸시

- [ ] **모든 task 완료 후 origin/main 푸시**

```bash
cd /Users/gong-eunhui/Desktop/naver-title-generator && git log origin/main..HEAD --oneline
```

5개 커밋(Task 1~5)이 보여야 한다. 확인 후:

```bash
git push origin main
```

Vercel 자동 배포 트리거 확인.

---

## 리스크 — 구현 시 주의

1. **`buildUserPrompt` 외부 import 점검** (Task 3 Step 5): 다른 파일에서 import하면 시그니처 변경으로 깨질 수 있음. grep으로 확인 필수.
2. **localStorage 키 충돌**: `blogTextForShortform`, `shortformLastMemo` 두 신규 키. 기존 코드에서 사용하지 않음을 grep으로 확인했음.
3. **JSON.parse 안전성**: 핸드오프 수신 시 try/catch로 감쌌지만, JSON이 손상돼도 전체 init이 깨지지 않도록 확인.
4. **scene[1] 마음읽기 강제 검증의 한계**: 프롬프트 강제는 100% 보장 안 됨. Task 6 Step 1에서 3회 생성 시 1회라도 어기면 프롬프트 강도 추가 조정 필요. 그 경우 Task 2의 `scene[1]은 반드시 마음읽기 질문 형태` 라인을 더 강하게(`★★★ 절대 규칙`) 격상하고 재검증.
5. **CTA 금지 문구 회피의 한계**: AI가 정확히 같은 문구는 안 쓰더라도 비슷한 정형(`"댓글 부탁드려요"`)을 만들 수 있음. Task 6에서 관찰 후 필요 시 금지 목록 확장.
