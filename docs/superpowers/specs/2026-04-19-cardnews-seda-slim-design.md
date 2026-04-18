# 카드뉴스 SEDA 슬림화 + shared-prompts 라이브러리 — Design Spec

- **Date**: 2026-04-19
- **Status**: Approved (pending user file review)
- **Related**: SEDA 법칙 + 프롬프트 슬림화 철학 (메모리 참조)
- **Next**: `writing-plans` skill로 구현 plan 작성

---

## 문제 정의

`app/api/card-news/route.js:324`의 `SLIDE_SYSTEM_PROMPT`가 ~105줄. 14가지 훅 공식, 글자수 7개 필드 표, 줄바꿈 좋은/나쁜 예시, 절대 규칙 8개 등 세세한 규칙이 과다하다. 숏폼에서 프롬프트를 230줄 → 63줄로 줄이자 결과 품질이 오히려 좋아졌음(2026-04-18, 10% 롤아웃 관찰). 카드뉴스에도 동일 철학을 적용한다.

또한 "짧게/쉽게/문단나누기/재독"(SEDA)은 카드뉴스·스레드·숏폼·블로그 등 **모든 콘텐츠 생성기가 공유할 원칙**이다. 각 도구 프롬프트에 반복 기입하지 말고 shared library로 단일 정의한다.

## 목표

1. `SLIDE_SYSTEM_PROMPT` ~105줄 → **~25~30줄**. hard 제약만 남기고 나머지 제거.
2. `lib/shared-prompts/` 디렉토리 신설. SEDA 원칙 + 도구별 글자수 기준 중앙 관리.
3. Overflow 시 **에러 throw 대신 warn 로그만**. Satori ellipsis를 방어선으로 신뢰.
4. 10% 롤아웃으로 점진 관찰.

## 비목표

- 스레드 슬림화 (출시 전 별도 PR, 본 라이브러리 재사용)
- 숏폼 SLIM 리팩토링 (현재 롤아웃 중이라 변수 겹침 — 출시 후)
- 블로그 글·칼럼 (출시 후 확대)
- `validateSlides`의 기타 검증 로직 변경 (shape/필수 필드 등은 그대로)

---

## 아키텍처

### 신규 파일 (2)

```
lib/shared-prompts/
├── seda.js          — SEDA 원칙 + 프롬프트 블록 조립 헬퍼
└── length-rules.js  — 도구별 글자수 기준 중앙 관리
```

### 수정 파일 (2)

- `app/api/card-news/route.js`
  - `SLIDE_SYSTEM_PROMPT` ~105줄 → ~25~30줄로 축소
  - `seda.js`에서 SEDA 블록 import
  - `validateSlides`에서 글자수 hard throw 제거, overflow warn 로그만
- 없음 (길이 검증은 `length-rules.js`에서 import)

### ENV

- `CARDNEWS_SLIM_PROMPT_ROLLOUT` (신규, Vercel): 0~100 정수. **코드 default 0** (배포 시점 비활성, 안전). 요청 시 `hashEmail(email) % 100 < ROLLOUT` 이면 슬림 버전.
- 배포 후 env를 10 → 50 → 100 순차 상승.

---

## 컴포넌트 상세

### 1. `lib/shared-prompts/seda.js`

```js
// lib/shared-prompts/seda.js
//
// SEDA 작문 법칙 — 뚝딱툴 모든 AI 콘텐츠 생성기가 공유하는 원칙.
// S: Shortly(짧게) / E: Easily(쉽게) / D: Divide(문단 나누기) / A: Again(독자 심리로 재독)

export const SEDA_PROMPT_BLOCK = `[SEDA 작문 원칙 — 모든 텍스트에 적용]
- S(Shortly): 불필요한 단어 제거. 한 줄·한 문장 짧게.
- E(Easily): 쉬운 어휘. 전문용어는 괄호로 풀어쓰기. 한 번에 한 메시지.
- D(Divide): 의미 단위로 줄·문단을 나눔. 덩어리 텍스트 금지. 줄바꿈은 \\n.
- A(Again): 작성 후 독자 시선으로 다시 읽기. 오해·지루함·어색한 조사 다듬기.`;

/**
 * 호출자가 원칙 블록을 자기 프롬프트에 삽입.
 * 사용 예: `${SEDA_PROMPT_BLOCK}\n\n[도구 고유 규칙]...`
 */
```

매우 단순. 문자열 상수 하나 + 향후 확장용 공간.

### 2. `lib/shared-prompts/length-rules.js`

```js
// lib/shared-prompts/length-rules.js
//
// 도구별 글자수 기준. 프롬프트에서 상세 표 제거했으므로 이곳이 단일 진실.
// validateSlides 등 서버측 검증과 overflow 로깅에서 사용.

export const CARD_NEWS_LIMITS = Object.freeze({
  'cover.title':      20,
  'cover.subtitle':   25,
  'summary.title':    18,
  'summary.body':     60,
  'content.title':    15,
  'content.body':     60,
  'cta.title':        18,
  'compare.title':    22,
  'compare.label':    10,   // leftLabel / rightLabel
  'compare.item':     20,   // leftItems[] / rightItems[] 각 항목
  'flow.title':       22,
  'flow.step.title':  12,
  'flow.step.body':   30,
});

// 향후 확장:
// export const THREADS_LIMITS = { ... };  // 스레드 PR에서 추가
// export const SHORTFORM_LIMITS = { 'onScreenText': 15 };  // 출시 후 이관

/**
 * 필드 경로(dot-notation)로 길이 기준 조회.
 * @param {Object} limits CARD_NEWS_LIMITS 등
 * @param {string} path 예: 'cover.title'
 * @returns {number|null}
 */
export function getLimit(limits, path) {
  return limits?.[path] ?? null;
}

/**
 * 슬라이드 필드 중 길이 초과를 찾아 배열로 반환. throw하지 않음.
 * @returns {Array<{ slideIndex, field, limit, actual }>}
 */
export function findOverflows(slides, limits, fieldMap) {
  const overflows = [];
  slides.forEach((slide, idx) => {
    const fields = fieldMap[slide.type] || [];
    for (const field of fields) {
      const value = readPath(slide, field.path);
      const lim = limits[field.limitKey];
      if (!value || !lim) continue;
      // \n은 글자수에서 제외 (줄바꿈은 시각 요소)
      const len = String(value).replace(/\n/g, '').length;
      if (len > lim) {
        overflows.push({
          slideIndex: idx, field: field.path, limit: lim, actual: len,
        });
      }
    }
  });
  return overflows;
}

function readPath(obj, path) { /* dot-notation 안전 읽기 */ }
```

`findOverflows`는 **발견만**, 수정·차단 안 함. 호출자가 warn 로그를 찍는다.

### 3. 슬림 프롬프트 (`app/api/card-news/route.js` 내)

기존 `SLIDE_SYSTEM_PROMPT`를 남겨두고(롤아웃 fallback), **신규 `SLIDE_SYSTEM_PROMPT_SLIM`**을 추가한다.

```js
import { SEDA_PROMPT_BLOCK } from '@/lib/shared-prompts/seda';

const SLIDE_SYSTEM_PROMPT_SLIM = `당신은 블로그 글을 인스타그램 카드뉴스 슬라이드로 변환하는 전문가입니다.

${SEDA_PROMPT_BLOCK}

[슬라이드 타입]
- cover: 표지 (강한 훅 제목 + 부제)
- summary: 전체 요약 (1문장)
- content: 번호형 본문 (number + title + body)
- compare: A vs B 대비 (leftLabel/leftItems + rightLabel/rightItems)
- flow: 3~5단계 절차 (steps[])
- quote: 핵심 인용 1문장
- data: 숫자 임팩트
- cta: 팔로우/저장/댓글 유도

[필수 규칙]
1. 요청된 슬라이드 수를 정확히 맞춘다.
2. 첫 슬라이드(cover)는 스크롤을 멈출 강한 훅으로 시작한다.
3. 이모지·이모티콘 금지 (Satori 렌더 제약).
4. 출력은 순수 JSON만. 마크다운 코드블록·설명 텍스트 금지.
5. SNS 핸들(@아이디) 제공 시 cover.brand와 cta.body에 포함.
6. compare·flow의 items/steps 내부에는 \\n 줄바꿈 금지 (레이아웃 자동 배치).

[출력 JSON]
{
  "slides": [
    { "type": "cover", "title": "훅 제목\\n(의미 단위)", "subtitle": "부제", "brand": "@handle" },
    { "type": "summary", "title": "요약\\n제목", "body": "한 줄 요약\\n" },
    { "type": "content", "number": "01", "title": "포인트", "body": "내용\\n의미 단위" },
    { "type": "compare", "title": "대비 제목", "leftLabel": "이전", "leftItems": ["항목1","항목2"], "rightLabel": "이후", "rightItems": ["항목1","항목2"] },
    { "type": "flow", "title": "흐름 제목", "steps": [{"number":"01","title":"단계","body":"설명"}] },
    { "type": "cta", "title": "CTA 문구", "buttonText": "팔로우하기", "body": "@handle\\n저장해두세요" }
  ]
}`;
```

**제거된 것** (기존 대비):
- 14가지 훅 공식 Tier 1~3 블록 (~22줄)
- 줄바꿈 원칙 + 나쁜/좋은 예시 (~18줄)
- 글자수 제한 표 7개 (~10줄, `length-rules.js`로 이동)
- 본문 레이아웃 선택 가이드 상세 예시 (~6줄)
- compare/flow 글자수 가이드 (~6줄)
- 절대 규칙 중복 항목 (한국어 조사, 핵심만 추출 등, ~3줄)

**남긴 것**:
- JSON shape (렌더 깨짐 방지)
- 슬라이드 타입 enum 1줄씩 설명 (선택 가이드 겸용)
- 이모지 금지 + 이유 (Satori 기술 제약)
- 슬라이드 수 준수
- SNS 핸들 조건부 규칙 (동적 사용자 입력)
- compare/flow의 items 내부 줄바꿈 금지 (레이아웃 제약)

목표 결과 ~27줄.

### 4. 롤아웃 분기 (`app/api/card-news/route.js`)

`callSonnet` 호출 직전 분기:

```js
import { hashEmail } from '@/lib/user-images'; // 기존 숏폼 SLIM과 동일 헬퍼 재사용

function shouldUseSlim(email) {
  const rollout = Number(process.env.CARDNEWS_SLIM_PROMPT_ROLLOUT) || 0;
  if (rollout <= 0) return false;
  if (rollout >= 100) return true;
  if (!email) return false;
  return (hashEmail(email) % 100) < rollout;
}

const systemPrompt = shouldUseSlim(email)
  ? SLIDE_SYSTEM_PROMPT_SLIM
  : SLIDE_SYSTEM_PROMPT;
```

**Non-logged-in 사용자**: 현재 card-news는 로그인 필수라 email이 항상 존재.

### 5. Overflow 로그 (`validateSlides` 개선)

```js
import { CARD_NEWS_LIMITS, findOverflows } from '@/lib/shared-prompts/length-rules';

// validateSlides 내부, 마지막 정합성 체크 후:
const overflows = findOverflows(slides, CARD_NEWS_LIMITS, CARD_NEWS_FIELD_MAP);
if (overflows.length > 0) {
  console.warn(
    '[cardnews-overflow]',
    JSON.stringify({
      promptVariant: useSlim ? 'slim' : 'full',
      email: hashEmail(email), // 원문 이메일 로그 금지
      overflows, // [{slideIndex, field, limit, actual}]
    }),
  );
}
// throw 없음 — Satori ellipsis가 시각적으로 방어.
```

`CARD_NEWS_FIELD_MAP`은 각 슬라이드 타입에서 어떤 필드를 어떤 key로 검증할지 매핑하는 상수. `route.js` 내부에 선언.

---

## 데이터 플로우

```
사용자 (card-news.html)
    ↓ POST /api/card-news
route.js
    ↓ shouldUseSlim(email) ?
    ├─ true  → SLIDE_SYSTEM_PROMPT_SLIM (SEDA 포함)
    └─ false → SLIDE_SYSTEM_PROMPT (기존)
    ↓ callSonnet → Claude Sonnet 4
    ↓ parseClaudeJson
    ↓ validateSlides
        ├─ shape/필수 필드 → throw (기존 유지)
        └─ findOverflows → warn 로그만
    ↓ Satori 렌더 (ellipsis로 overflow 방어)
    ↓ 이미지 URL 응답
```

---

## 에러 핸들링

기존 validateSlides의 **shape/필수 필드/enum 검증**은 그대로 유지 (Hard). 이건 렌더 깨짐 방지.

**변경점**: 글자수 검증을 hard → soft 로.

| 시나리오 | 이전 | 이후 |
|---|---|---|
| cover.title이 25자 (>20) | throw → 전체 실패 or 재시도 | warn 로그 + 그대로 진행, Satori ellipsis |
| content.body가 80자 (>60) | 위와 동일 | 위와 동일 |
| slides 배열 누락 | throw | throw (변경 없음) |
| slide.type enum 밖 값 | throw | throw (변경 없음) |
| slide.number 형식 오류 | throw | throw (변경 없음) |
| 이모지 포함 | 사용자 눈에 깨진 문자 | 동일 (프롬프트 강조) |

---

## 테스트 전략

### Layer 1 — Unit tests (신규 2 파일)

`tests/unit/shared-prompts-length-rules.test.js`:
- `CARD_NEWS_LIMITS` 상수 값 회귀 테스트 (숫자 변경 시 실패)
- `getLimit` 존재/부재 케이스
- `findOverflows`:
  - overflow 없으면 빈 배열
  - 단일 overflow 감지
  - 복수 슬라이드 복수 필드 overflow
  - `\n`은 길이에서 제외
  - compare의 items 배열 각 항목 체크
  - flow의 steps 중첩 필드 체크
  - throw하지 않음 (모든 케이스)

`tests/unit/shared-prompts-seda.test.js`:
- `SEDA_PROMPT_BLOCK`에 S/E/D/A 네 원칙 키워드 모두 포함 회귀 테스트
- 길이 합리성 (너무 길면 프롬프트 비효율)

### Layer 2 — 수동 E2E (배포 후)

- [ ] `CARDNEWS_SLIM_PROMPT_ROLLOUT=10` 활성 후 카드뉴스 5회 생성, slim/full 분기 확인 (hashEmail 기반)
- [ ] slim 결과가 기존 대비 "짧고 임팩트 있는지" 사용자 확인 (체감 기준)
- [ ] Vercel 로그에서 `[cardnews-overflow]` 발생 빈도 체크
  - 샘플 20개+ 축적 후 overflow 발생률 < 20%이면 유지
  - 초과 시 slim 프롬프트에 "짧게" 한 줄 보강 고려

### Layer 3 — 로그 기반 관찰 (출시 후 1주)

- `promptVariant: 'slim'`와 `'full'` 각각의 overflow 빈도 비교
- 사용자 불만(다운로드 후 잘림 호소) 모니터링

---

## 롤아웃 / 배포 순서

1. 코드 배포 + `CARDNEWS_SLIM_PROMPT_ROLLOUT=0` (기존 프롬프트 유지, 안전)
2. Vercel env를 `=10`으로 변경 → 10% 트래픽에 slim 노출
3. 로그·결과 관찰 (1~2일)
4. 만족하면 `=50` → `=100` 순차 상승
5. `=100` 유지 상태로 1주 관찰 후 기존 프롬프트 코드 제거(별도 PR)

출시(4/25) 전 롤아웃 가능. 스레드 슬림도 같은 shared lib 재사용하여 다음 PR로.

---

## 환경변수 영향

| 이름 | 상태 | 설명 |
|---|---|---|
| `CARDNEWS_SLIM_PROMPT_ROLLOUT` | **신규** (Vercel) | 0~100 정수. 코드 default 0 (배포 후 env로 10부터 활성화). |

---

## Open Questions

없음. 핵심 6개 결정 완료:
1. 카드뉴스만 먼저 (스레드·숏폼 리팩토링은 다음 PR)
2. shared lib 2파일 (seda.js + length-rules.js)
3. 슬림 프롬프트 공격적 (~27줄)
4. Overflow는 warn 로그만, Satori ellipsis 신뢰
5. 10% 롤아웃 분기 (hashEmail 기반, 숏폼 SLIM 패턴 재사용)
6. SEDA 정의: Shortly/Easily/Divide/Again
