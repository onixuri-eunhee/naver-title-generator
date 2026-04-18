# 카드뉴스 SEDA 슬림화 + shared-prompts 라이브러리 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `app/api/card-news/route.js`의 `SLIDE_SYSTEM_PROMPT` ~105줄을 SEDA 원칙 기반 ~27줄 슬림 버전으로 축소하고, 향후 스레드·숏폼 재사용 가능한 `lib/shared-prompts/` 공통 라이브러리를 신설한다.

**Architecture:** SEDA 원칙·도구별 글자수·롤아웃 해시 헬퍼를 3개 순수 모듈로 분리 (TDD 가능). 카드뉴스 라우트는 이들을 import해서 슬림 프롬프트 조립 + `hashEmail(email) % 100 < ROLLOUT` 분기로 10% 점진 노출. Overflow는 `throw` 대신 `console.warn` 로그만, Satori ellipsis가 시각적 방어.

**Tech Stack:** Next.js App Router, Node 20 `node:test`, Claude Sonnet 4 (`callSonnet`), Satori.

**Spec Reference:** `/Users/gong-eunhui/Desktop/naver-title-generator/docs/superpowers/specs/2026-04-19-cardnews-seda-slim-design.md`

---

## File Structure

**신규 파일 (6)**
- `lib/shared-prompts/seda.js` — `SEDA_PROMPT_BLOCK` 상수
- `lib/shared-prompts/length-rules.js` — `CARD_NEWS_LIMITS`, `findOverflows`, `getLimit`
- `lib/shared-prompts/rollout.js` — `simpleHash`, `resolveRolloutFlag` (카드뉴스·스레드·숏폼 공용)
- `tests/unit/shared-prompts-seda.test.js` — SEDA 블록 구성 회귀
- `tests/unit/shared-prompts-length-rules.test.js` — 상수·getLimit·findOverflows
- `tests/unit/shared-prompts-rollout.test.js` — 해시 안정성·분기 비율

**수정 파일 (1)**
- `app/api/card-news/route.js`
  - `SLIDE_SYSTEM_PROMPT_SLIM` 상수 추가 (기존 `SLIDE_SYSTEM_PROMPT`는 fallback으로 보존)
  - `shouldUseSlim(email)` 분기 함수 (rollout.js `resolveRolloutFlag` wrap)
  - `callSonnet` 호출부 분기
  - `validateSlides` 내부에서 `findOverflows` 호출 → `console.warn` 로그만 (throw 없음)
  - `CARD_NEWS_FIELD_MAP` 상수 (슬라이드 타입별 검증 경로)

**원칙**
- 3개 shared 모듈 = 각각 단일 책임, 외부 의존 0 (Node 내장만). TDD 가능.
- `route.js` 수정은 integration — 수동 E2E로 커버 (Task 5 체크리스트).
- 기존 `SLIDE_SYSTEM_PROMPT`는 ENV `CARDNEWS_SLIM_PROMPT_ROLLOUT=0` 시 그대로 사용 → 롤아웃 fallback 확보.

---

## Task 1: SEDA prompt block (`lib/shared-prompts/seda.js`)

**Files:**
- Create: `lib/shared-prompts/seda.js`
- Create: `tests/unit/shared-prompts-seda.test.js`

- [ ] **Step 1.1: Write failing tests**

Create `tests/unit/shared-prompts-seda.test.js`:

```js
// tests/unit/shared-prompts-seda.test.js
//
// SEDA 원칙 블록 회귀 — 네 원칙 키워드가 프롬프트에 모두 포함되는지 보장.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { SEDA_PROMPT_BLOCK } from '../../lib/shared-prompts/seda.js';

test('SEDA 블록에 S/E/D/A 네 원칙 모두 포함', () => {
  assert.match(SEDA_PROMPT_BLOCK, /Shortly/);
  assert.match(SEDA_PROMPT_BLOCK, /Easily/);
  assert.match(SEDA_PROMPT_BLOCK, /Divide/);
  assert.match(SEDA_PROMPT_BLOCK, /Again/);
});

test('SEDA 블록에 한글 풀이 포함 (짧게·쉽게·나누기·재독)', () => {
  assert.match(SEDA_PROMPT_BLOCK, /짧게/);
  assert.match(SEDA_PROMPT_BLOCK, /쉽게/);
  // Divide은 "나누" 또는 "문단" 중 하나
  assert.ok(
    /나누|문단/.test(SEDA_PROMPT_BLOCK),
    'D: 문단 나누기 풀이 누락',
  );
  // Again은 "독자" 또는 "재독" 중 하나
  assert.ok(
    /독자|재독|다시 읽/.test(SEDA_PROMPT_BLOCK),
    'A: 독자 재독 풀이 누락',
  );
});

test('SEDA 블록 길이 합리성 (너무 길면 프롬프트 비효율)', () => {
  // 300자 이하 (4원칙 각 한 줄 수준)
  assert.ok(
    SEDA_PROMPT_BLOCK.length <= 500,
    `SEDA_PROMPT_BLOCK 길이 ${SEDA_PROMPT_BLOCK.length} > 500자, 슬림 원칙 위반`,
  );
  assert.ok(SEDA_PROMPT_BLOCK.length >= 80, '너무 짧음 (원칙 빠진 가능성)');
});

test('SEDA 블록에 \\n 사용 가이드 포함 (Divide 실제 적용)', () => {
  // "\n" 또는 "줄바꿈" 둘 중 하나는 있어야 함
  assert.ok(
    /\\\\n|줄바꿈/.test(SEDA_PROMPT_BLOCK),
    '\\n 줄바꿈 가이드 누락 — Divide 적용 불가',
  );
});
```

- [ ] **Step 1.2: Run test to verify it fails**

```bash
cd /Users/gong-eunhui/Desktop/naver-title-generator
node --test tests/unit/shared-prompts-seda.test.js
```

Expected: FAIL — `Cannot find module '.../lib/shared-prompts/seda.js'`.

- [ ] **Step 1.3: Implement seda.js**

Create `lib/shared-prompts/seda.js`:

```js
// lib/shared-prompts/seda.js
//
// SEDA 작문 법칙 — 뚝딱툴 모든 AI 콘텐츠 생성기가 공유하는 원칙.
// S: Shortly(짧게) / E: Easily(쉽게) / D: Divide(문단 나누기) / A: Again(독자 재독)
//
// 사용: `${SEDA_PROMPT_BLOCK}\n\n[도구 고유 규칙]...` 형태로 프롬프트 상단에 삽입.

export const SEDA_PROMPT_BLOCK = `[SEDA 작문 원칙 — 모든 텍스트에 적용]
- S(Shortly): 불필요한 단어 제거. 한 줄·한 문장 짧게.
- E(Easily): 쉬운 어휘. 전문용어는 괄호로 풀어쓰기. 한 번에 한 메시지.
- D(Divide): 의미 단위로 줄·문단을 나눔. 덩어리 텍스트 금지. 줄바꿈은 \\n.
- A(Again): 작성 후 독자 시선으로 다시 읽기. 오해·지루함·어색한 조사 다듬기.`;
```

- [ ] **Step 1.4: Run test to verify it passes**

```bash
node --test tests/unit/shared-prompts-seda.test.js
```

Expected: all 4 tests PASS.

- [ ] **Step 1.5: Commit**

```bash
git add lib/shared-prompts/seda.js tests/unit/shared-prompts-seda.test.js
git commit -m "feat(shared-prompts): SEDA 작문 원칙 블록

Shortly/Easily/Divide/Again 4원칙을 프롬프트 블록으로 단일 정의. 카드뉴스·스레드·
숏폼·블로그 등 모든 AI 콘텐츠 생성기가 import하여 프롬프트 상단에 삽입.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: 글자수 규칙 (`lib/shared-prompts/length-rules.js`)

**Files:**
- Create: `lib/shared-prompts/length-rules.js`
- Create: `tests/unit/shared-prompts-length-rules.test.js`

- [ ] **Step 2.1: Write failing tests**

Create `tests/unit/shared-prompts-length-rules.test.js`:

```js
// tests/unit/shared-prompts-length-rules.test.js
//
// CARD_NEWS_LIMITS 상수 값 회귀, getLimit 존재/부재 케이스, findOverflows 감지 로직.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CARD_NEWS_LIMITS,
  getLimit,
  findOverflows,
} from '../../lib/shared-prompts/length-rules.js';

test('CARD_NEWS_LIMITS — 상수 값 회귀', () => {
  assert.equal(CARD_NEWS_LIMITS['cover.title'], 20);
  assert.equal(CARD_NEWS_LIMITS['cover.subtitle'], 25);
  assert.equal(CARD_NEWS_LIMITS['summary.title'], 18);
  assert.equal(CARD_NEWS_LIMITS['summary.body'], 60);
  assert.equal(CARD_NEWS_LIMITS['content.title'], 15);
  assert.equal(CARD_NEWS_LIMITS['content.body'], 60);
  assert.equal(CARD_NEWS_LIMITS['cta.title'], 18);
  assert.equal(CARD_NEWS_LIMITS['compare.title'], 22);
  assert.equal(CARD_NEWS_LIMITS['compare.label'], 10);
  assert.equal(CARD_NEWS_LIMITS['compare.item'], 20);
  assert.equal(CARD_NEWS_LIMITS['flow.title'], 22);
  assert.equal(CARD_NEWS_LIMITS['flow.step.title'], 12);
  assert.equal(CARD_NEWS_LIMITS['flow.step.body'], 30);
});

test('CARD_NEWS_LIMITS — frozen (immutable)', () => {
  assert.throws(() => {
    CARD_NEWS_LIMITS['cover.title'] = 999;
  });
});

test('getLimit — 존재하는 키', () => {
  assert.equal(getLimit(CARD_NEWS_LIMITS, 'cover.title'), 20);
});

test('getLimit — 존재하지 않는 키 → null', () => {
  assert.equal(getLimit(CARD_NEWS_LIMITS, 'nope.foo'), null);
});

test('getLimit — limits 자체가 null/undefined → null', () => {
  assert.equal(getLimit(null, 'cover.title'), null);
  assert.equal(getLimit(undefined, 'cover.title'), null);
});

test('findOverflows — overflow 없으면 빈 배열', () => {
  const slides = [
    { type: 'cover', title: '짧은 제목', subtitle: '부제' },
    { type: 'cta', title: '팔로우' },
  ];
  const fieldMap = {
    cover: [
      { path: 'title', limitKey: 'cover.title' },
      { path: 'subtitle', limitKey: 'cover.subtitle' },
    ],
    cta: [{ path: 'title', limitKey: 'cta.title' }],
  };
  const result = findOverflows(slides, CARD_NEWS_LIMITS, fieldMap);
  assert.deepEqual(result, []);
});

test('findOverflows — 단일 overflow 감지', () => {
  const slides = [
    { type: 'cover', title: '아주아주아주아주 긴 제목입니다 정말로 길어요' }, // 25자 > 20
  ];
  const fieldMap = {
    cover: [{ path: 'title', limitKey: 'cover.title' }],
  };
  const result = findOverflows(slides, CARD_NEWS_LIMITS, fieldMap);
  assert.equal(result.length, 1);
  assert.equal(result[0].slideIndex, 0);
  assert.equal(result[0].field, 'title');
  assert.equal(result[0].limit, 20);
  assert.ok(result[0].actual > 20);
});

test('findOverflows — 복수 슬라이드 복수 필드 overflow', () => {
  const slides = [
    { type: 'cover', title: '아주아주아주아주 긴 제목입니다 정말로 길어요', subtitle: '짧음' },
    { type: 'content', title: '이것도 너무너무 긴 본문 제목 입니다요' }, // 15자 초과
  ];
  const fieldMap = {
    cover: [
      { path: 'title', limitKey: 'cover.title' },
      { path: 'subtitle', limitKey: 'cover.subtitle' },
    ],
    content: [{ path: 'title', limitKey: 'content.title' }],
  };
  const result = findOverflows(slides, CARD_NEWS_LIMITS, fieldMap);
  assert.equal(result.length, 2);
});

test('findOverflows — \\n은 길이에서 제외 (Divide 줄바꿈 보호)', () => {
  // "12345\n67890" → \n 제외 10자 (limit 20 이내)
  const slides = [{ type: 'cover', title: '12345\n67890' }];
  const fieldMap = { cover: [{ path: 'title', limitKey: 'cover.title' }] };
  const result = findOverflows(slides, CARD_NEWS_LIMITS, fieldMap);
  assert.deepEqual(result, []);
});

test('findOverflows — compare.items 배열 각 항목 체크', () => {
  const slides = [
    {
      type: 'compare',
      leftItems: ['짧음', '아주아주아주아주 긴 항목입니다 너무 김'], // 두 번째 > 20
      rightItems: ['OK1', 'OK2'],
    },
  ];
  const fieldMap = {
    compare: [
      { path: 'leftItems[]', limitKey: 'compare.item' },
      { path: 'rightItems[]', limitKey: 'compare.item' },
    ],
  };
  const result = findOverflows(slides, CARD_NEWS_LIMITS, fieldMap);
  assert.equal(result.length, 1);
  assert.match(result[0].field, /leftItems\[1\]/);
});

test('findOverflows — flow.steps 중첩 필드', () => {
  const slides = [
    {
      type: 'flow',
      steps: [
        { number: '01', title: '짧음', body: '본문' },
        { number: '02', title: '이것도 너무너무 긴 제목임', body: '본문' }, // 12 초과
      ],
    },
  ];
  const fieldMap = {
    flow: [
      { path: 'steps[].title', limitKey: 'flow.step.title' },
      { path: 'steps[].body', limitKey: 'flow.step.body' },
    ],
  };
  const result = findOverflows(slides, CARD_NEWS_LIMITS, fieldMap);
  assert.equal(result.length, 1);
  assert.match(result[0].field, /steps\[1\]\.title/);
});

test('findOverflows — throw 안 함 (soft 검증)', () => {
  const slides = [{ type: 'cover', title: null }]; // null value
  const fieldMap = { cover: [{ path: 'title', limitKey: 'cover.title' }] };
  // null 값도 throw 없이 빈 결과
  const result = findOverflows(slides, CARD_NEWS_LIMITS, fieldMap);
  assert.deepEqual(result, []);
});

test('findOverflows — fieldMap에 없는 타입은 skip', () => {
  const slides = [{ type: 'unknown', anything: 'x'.repeat(1000) }];
  const fieldMap = { cover: [{ path: 'title', limitKey: 'cover.title' }] };
  const result = findOverflows(slides, CARD_NEWS_LIMITS, fieldMap);
  assert.deepEqual(result, []);
});
```

- [ ] **Step 2.2: Run test to verify it fails**

```bash
node --test tests/unit/shared-prompts-length-rules.test.js
```

Expected: FAIL — module not found.

- [ ] **Step 2.3: Implement length-rules.js**

Create `lib/shared-prompts/length-rules.js`:

```js
// lib/shared-prompts/length-rules.js
//
// 도구별 글자수 기준 중앙 관리.
// 프롬프트에서 상세 글자수 표를 제거했으므로 이 파일이 단일 진실.
// findOverflows는 감지만, throw 없음 — 호출자가 warn 로그 또는 재요청 결정.

export const CARD_NEWS_LIMITS = Object.freeze({
  'cover.title':     20,
  'cover.subtitle':  25,
  'summary.title':   18,
  'summary.body':    60,
  'content.title':   15,
  'content.body':    60,
  'cta.title':       18,
  'compare.title':   22,
  'compare.label':   10,
  'compare.item':    20,
  'flow.title':      22,
  'flow.step.title': 12,
  'flow.step.body':  30,
});

// 향후 확장:
// export const THREADS_LIMITS = { ... };
// export const SHORTFORM_LIMITS = { 'onScreenText': 15 };

/**
 * 필드 경로로 limit 조회.
 * @param {Object|null|undefined} limits
 * @param {string} path — 예: 'cover.title'
 * @returns {number|null}
 */
export function getLimit(limits, path) {
  if (!limits || typeof limits !== 'object') return null;
  const v = limits[path];
  return typeof v === 'number' ? v : null;
}

/**
 * 슬라이드 배열에서 길이 초과 필드를 찾아 반환. throw하지 않음.
 *
 * @param {Array} slides — 검증 대상
 * @param {Object} limits — CARD_NEWS_LIMITS 등 frozen 맵
 * @param {Object} fieldMap — { [type]: [{ path, limitKey }] }
 *   path 는 dot-notation. 배열 원소는 'items[]' 또는 'steps[].title' 형태.
 * @returns {Array<{slideIndex, field, limit, actual}>}
 */
export function findOverflows(slides, limits, fieldMap) {
  if (!Array.isArray(slides)) return [];
  const overflows = [];

  slides.forEach((slide, slideIndex) => {
    if (!slide || typeof slide !== 'object') return;
    const fields = fieldMap?.[slide.type];
    if (!Array.isArray(fields)) return;

    for (const { path, limitKey } of fields) {
      const lim = getLimit(limits, limitKey);
      if (lim == null) continue;

      for (const { field, value } of readPath(slide, path)) {
        if (typeof value !== 'string' || !value) continue;
        const len = value.replace(/\n/g, '').length;
        if (len > lim) {
          overflows.push({ slideIndex, field, limit: lim, actual: len });
        }
      }
    }
  });

  return overflows;
}

/**
 * dot-notation + [] 배열 확장 읽기.
 * - 'title' → [{ field: 'title', value: slide.title }]
 * - 'leftItems[]' → [{ field: 'leftItems[0]', value: ... }, ...]
 * - 'steps[].title' → [{ field: 'steps[0].title', value: ... }, ...]
 */
function* readPath(slide, path) {
  const bracketIdx = path.indexOf('[]');
  if (bracketIdx < 0) {
    // 단순 dot 경로
    const parts = path.split('.');
    let cur = slide;
    for (const p of parts) {
      if (cur == null) return;
      cur = cur[p];
    }
    yield { field: path, value: cur };
    return;
  }

  // 배열 경로
  const before = path.slice(0, bracketIdx);        // 'leftItems' or 'steps'
  const after = path.slice(bracketIdx + 2);         // '' or '.title'
  const arr = readSimple(slide, before);
  if (!Array.isArray(arr)) return;

  arr.forEach((item, i) => {
    if (after === '') {
      yield { field: `${before}[${i}]`, value: item };
    } else {
      // after는 '.title' 같은 형태
      const subPath = after.startsWith('.') ? after.slice(1) : after;
      const subVal = readSimple(item, subPath);
      yield { field: `${before}[${i}]${after}`, value: subVal };
    }
  });
}

function readSimple(obj, path) {
  if (!path) return obj;
  const parts = path.split('.');
  let cur = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}
```

- [ ] **Step 2.4: Run test to verify it passes**

```bash
node --test tests/unit/shared-prompts-length-rules.test.js
```

Expected: all 13 tests PASS.

- [ ] **Step 2.5: Commit**

```bash
git add lib/shared-prompts/length-rules.js tests/unit/shared-prompts-length-rules.test.js
git commit -m "feat(shared-prompts): 도구별 글자수 규칙 + overflow 감지 헬퍼

CARD_NEWS_LIMITS 13개 필드 중앙 관리. findOverflows는 dot-notation 및 배열 경로
(items[], steps[].title)를 지원하고 throw하지 않음 — Satori ellipsis로 시각적 방어.
\\n은 길이에서 제외(Divide 줄바꿈 보호).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: 롤아웃 해시 헬퍼 (`lib/shared-prompts/rollout.js`)

**Files:**
- Create: `lib/shared-prompts/rollout.js`
- Create: `tests/unit/shared-prompts-rollout.test.js`

- [ ] **Step 3.1: Write failing tests**

Create `tests/unit/shared-prompts-rollout.test.js`:

```js
// tests/unit/shared-prompts-rollout.test.js
//
// simpleHash 결정성 + resolveRolloutFlag 분기 논리 검증.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  simpleHash,
  resolveRolloutFlag,
} from '../../lib/shared-prompts/rollout.js';

test('simpleHash — 결정적 (같은 입력 → 같은 해시)', () => {
  assert.equal(simpleHash('foo@bar.com'), simpleHash('foo@bar.com'));
});

test('simpleHash — 0 이상 정수', () => {
  const h = simpleHash('user@example.com');
  assert.ok(Number.isInteger(h));
  assert.ok(h >= 0);
});

test('simpleHash — 서로 다른 입력은 대체로 다른 해시', () => {
  // 충돌 가능하지만 3개 중 2개 이상 다르면 OK
  const a = simpleHash('a@x.com');
  const b = simpleHash('b@x.com');
  const c = simpleHash('c@x.com');
  const uniq = new Set([a, b, c]);
  assert.ok(uniq.size >= 2, 'too many collisions');
});

test('simpleHash — 빈 문자열도 안전', () => {
  const h = simpleHash('');
  assert.ok(Number.isInteger(h) && h >= 0);
});

test('resolveRolloutFlag — rollout=0 → false', () => {
  assert.equal(resolveRolloutFlag({ email: 'a@x.com', rollout: 0 }), false);
});

test('resolveRolloutFlag — rollout=100 → true (모든 사용자)', () => {
  assert.equal(resolveRolloutFlag({ email: 'a@x.com', rollout: 100 }), true);
  assert.equal(resolveRolloutFlag({ email: 'b@y.com', rollout: 100 }), true);
});

test('resolveRolloutFlag — rollout 음수/NaN → false (안전 fallback)', () => {
  assert.equal(resolveRolloutFlag({ email: 'a@x.com', rollout: -5 }), false);
  assert.equal(resolveRolloutFlag({ email: 'a@x.com', rollout: NaN }), false);
  assert.equal(resolveRolloutFlag({ email: 'a@x.com', rollout: 'x' }), false);
});

test('resolveRolloutFlag — 같은 email+rollout 은 항상 같은 결과 (sticky)', () => {
  const r1 = resolveRolloutFlag({ email: 'user@test.com', rollout: 10 });
  const r2 = resolveRolloutFlag({ email: 'user@test.com', rollout: 10 });
  assert.equal(r1, r2);
});

test('resolveRolloutFlag — 100명 sample 에서 rollout=10 이면 대략 10% 근처', () => {
  let hits = 0;
  for (let i = 0; i < 100; i++) {
    if (resolveRolloutFlag({ email: `user${i}@test.com`, rollout: 10 })) hits++;
  }
  // 결정적 해시라 정확한 10은 아니지만 5~20 범위면 통과 (작은 샘플 편차)
  assert.ok(hits >= 3 && hits <= 25, `hits=${hits} out of 5~25`);
});

test('resolveRolloutFlag — email 누락 시 anon 취급', () => {
  // email이 없어도 throw 안 함, 결정적 결과
  const r1 = resolveRolloutFlag({ email: null, rollout: 50 });
  const r2 = resolveRolloutFlag({ email: null, rollout: 50 });
  assert.equal(r1, r2);
  assert.equal(typeof r1, 'boolean');
});
```

- [ ] **Step 3.2: Run test to verify it fails**

```bash
node --test tests/unit/shared-prompts-rollout.test.js
```

Expected: FAIL — module not found.

- [ ] **Step 3.3: Implement rollout.js**

Create `lib/shared-prompts/rollout.js`:

```js
// lib/shared-prompts/rollout.js
//
// A/B 롤아웃 분기용 결정적 해시 + 플래그 헬퍼.
// 숏폼 SLIM(resolveSlimPromptFlag)과 동일 수학. 카드뉴스·스레드 등에서 공용.

/**
 * 결정적 간단 해시. crypto 의존 없음(edge/중첩 환경 안전).
 * @param {string} str
 * @returns {number} 0 이상 정수 (> 0 보장 안 함, 0은 가능)
 */
export function simpleHash(str) {
  const s = String(str ?? '');
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  // 0 이상 정수 (JavaScript bitwise는 32-bit signed)
  return Math.abs(h);
}

/**
 * rollout% 만큼 sticky 분기. 같은 email은 항상 같은 결과.
 *
 * @param {{ email?: string|null, rollout: number }} opts
 * @returns {boolean}
 */
export function resolveRolloutFlag({ email, rollout }) {
  const r = Number(rollout);
  if (!Number.isFinite(r) || r <= 0) return false;
  if (r >= 100) return true;
  return (simpleHash(email || 'anon') % 100) < r;
}
```

- [ ] **Step 3.4: Run test to verify it passes**

```bash
node --test tests/unit/shared-prompts-rollout.test.js
```

Expected: all 10 tests PASS.

- [ ] **Step 3.5: Commit**

```bash
git add lib/shared-prompts/rollout.js tests/unit/shared-prompts-rollout.test.js
git commit -m "feat(shared-prompts): A/B 롤아웃 해시 + 플래그 헬퍼

simpleHash + resolveRolloutFlag — sticky 분기(같은 email은 항상 같은 결과).
카드뉴스·스레드·숏폼(리팩토링 시) 공용. crypto 의존 0.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: 카드뉴스 슬림 프롬프트 + 분기 + overflow 로그 (`app/api/card-news/route.js`)

**Files:**
- Modify: `app/api/card-news/route.js`

Integration 코드. 유닛 테스트 없음 — Task 5 수동 E2E로 커버.

- [ ] **Step 4.1: Add imports at top of file**

Find the existing import block at the top of `app/api/card-news/route.js`. Add:

```js
import { SEDA_PROMPT_BLOCK } from '@/lib/shared-prompts/seda';
import { CARD_NEWS_LIMITS, findOverflows } from '@/lib/shared-prompts/length-rules';
import { resolveRolloutFlag } from '@/lib/shared-prompts/rollout';
```

- [ ] **Step 4.2: Add `SLIDE_SYSTEM_PROMPT_SLIM` constant**

Directly after the existing `SLIDE_SYSTEM_PROMPT` declaration (around line 428), add:

```js
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
    { "type": "summary", "title": "요약\\n제목", "body": "한 줄 요약" },
    { "type": "content", "number": "01", "title": "포인트", "body": "내용\\n의미 단위" },
    { "type": "compare", "title": "대비 제목", "leftLabel": "이전", "leftItems": ["항목1","항목2"], "rightLabel": "이후", "rightItems": ["항목1","항목2"] },
    { "type": "flow", "title": "흐름 제목", "steps": [{"number":"01","title":"단계","body":"설명"}] },
    { "type": "cta", "title": "CTA 문구", "buttonText": "팔로우하기", "body": "@handle\\n저장해두세요" }
  ]
}`;
```

- [ ] **Step 4.3: Add `shouldUseSlim` helper**

Right after the slim prompt constant, add:

```js
function shouldUseSlim(email) {
  const raw = process.env.CARDNEWS_SLIM_PROMPT_ROLLOUT ?? '0';
  const rollout = Number.parseInt(raw, 10);
  return resolveRolloutFlag({ email, rollout });
}
```

- [ ] **Step 4.4: Add `CARD_NEWS_FIELD_MAP` constant**

Right after `shouldUseSlim`, add:

```js
// findOverflows용 필드 매핑 — 슬라이드 타입별 검증 경로와 limit key.
const CARD_NEWS_FIELD_MAP = {
  cover: [
    { path: 'title',    limitKey: 'cover.title' },
    { path: 'subtitle', limitKey: 'cover.subtitle' },
  ],
  summary: [
    { path: 'title', limitKey: 'summary.title' },
    { path: 'body',  limitKey: 'summary.body' },
  ],
  content: [
    { path: 'title', limitKey: 'content.title' },
    { path: 'body',  limitKey: 'content.body' },
  ],
  cta: [
    { path: 'title', limitKey: 'cta.title' },
  ],
  compare: [
    { path: 'title',       limitKey: 'compare.title' },
    { path: 'leftLabel',   limitKey: 'compare.label' },
    { path: 'rightLabel',  limitKey: 'compare.label' },
    { path: 'leftItems[]', limitKey: 'compare.item' },
    { path: 'rightItems[]', limitKey: 'compare.item' },
  ],
  flow: [
    { path: 'title',             limitKey: 'flow.title' },
    { path: 'steps[].title',     limitKey: 'flow.step.title' },
    { path: 'steps[].body',      limitKey: 'flow.step.body' },
  ],
  // quote, data 는 safe area 넓어 글자수 강제 없음 (Satori ellipsis가 방어)
};
```

- [ ] **Step 4.5: Find `callSonnet` call site and add prompt branch**

Find the line (around 921 per spec) that calls `callSonnet(SLIDE_SYSTEM_PROMPT, userMessage, 4000)`. Before that call, the route already resolved `email` from session. Replace:

```js
    const raw = await callSonnet(SLIDE_SYSTEM_PROMPT, userMessage, 4000);
```

with:

```js
    const useSlim = shouldUseSlim(email);
    const promptVariant = useSlim ? 'slim' : 'full';
    const systemPrompt = useSlim ? SLIDE_SYSTEM_PROMPT_SLIM : SLIDE_SYSTEM_PROMPT;
    const raw = await callSonnet(systemPrompt, userMessage, 4000);
```

**Note:** If `email` is not in scope at this line, find where `resolveSessionEmail` is called earlier in the handler and ensure the variable is accessible. If the variable name differs (e.g., `userEmail`), adjust the arg.

- [ ] **Step 4.6: Add overflow warn after validateSlides**

Find the call to `validateSlides(parsed, requestedCount)` and inspect the return value (likely `const slides = validateSlides(...)` or the function mutates parsed). After slides are validated and before returning, add:

```js
    // SEDA 슬림 원칙: overflow는 throw 대신 warn 로그만. Satori ellipsis가 시각 방어.
    try {
      const overflows = findOverflows(slides, CARD_NEWS_LIMITS, CARD_NEWS_FIELD_MAP);
      if (overflows.length > 0) {
        console.warn(
          '[cardnews-overflow]',
          JSON.stringify({
            promptVariant,
            count: overflows.length,
            overflows: overflows.slice(0, 10), // 과다 로그 방지
          }),
        );
      }
    } catch (overflowErr) {
      console.warn('[cardnews-overflow] check failed:', overflowErr.message);
    }
```

Place this **after** the existing validateSlides logic and **before** the success response. `slides` and `promptVariant` must be in scope.

- [ ] **Step 4.7: Run full test suite — verify no regression**

```bash
cd /Users/gong-eunhui/Desktop/naver-title-generator
npm test 2>&1 | grep -E "tests|pass|fail" | tail -5
```

Expected: `tests N / pass N / fail 0` — 새로 추가한 shared-prompts 테스트까지 포함하여 모두 통과. 기존 테스트 회귀 없음.

- [ ] **Step 4.8: Run build to catch type errors**

```bash
npm run build 2>&1 | tail -5
```

Expected: `Compiled successfully` 또는 `Static ...` 로그. 새 import 경로에 컴파일 오류 없음.

- [ ] **Step 4.9: Commit**

```bash
git add app/api/card-news/route.js
git commit -m "feat(cardnews): SEDA 슬림 프롬프트 + 10% 롤아웃 + overflow warn 로그

SLIDE_SYSTEM_PROMPT_SLIM (~27줄) 추가. CARDNEWS_SLIM_PROMPT_ROLLOUT env로 10%
사용자에게 먼저 노출. validateSlides 뒤에 findOverflows → console.warn 만 —
기존 throw 없음, Satori ellipsis가 시각 방어.

기존 SLIDE_SYSTEM_PROMPT는 rollout=0 fallback으로 보존.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Pre-deploy smoke + deployment checklist

**Files:** (code changes 없음)

- [ ] **Step 5.1: 전체 테스트 suite PASS 확인**

```bash
cd /Users/gong-eunhui/Desktop/naver-title-generator
npm test 2>&1 | grep -E "tests|pass|fail" | tail -5
```

Expected: 기존 240 + 신규 ~27 (seda 4 + length-rules 13 + rollout 10) ≈ **267 tests pass / 0 fail**.

- [ ] **Step 5.2: `npm run build` clean**

```bash
npm run build 2>&1 | tail -5
```

Expected: 빌드 성공, 새 import 경로 문제 없음.

- [ ] **Step 5.3: 로컬 dev 서버로 카드뉴스 수동 smoke (rollout=100 임시)**

```bash
CARDNEWS_SLIM_PROMPT_ROLLOUT=100 npm run dev
```

브라우저에서 `/card-news` 접속 → 로그인 → 짧은 블로그 글로 카드뉴스 생성 → 결과 JSON이 slim 경로 거쳤는지 서버 로그의 `[cardnews-overflow]` (있으면) 확인 + 렌더된 이미지 품질 확인. Ctrl+C로 종료.

결과 판정:
- Slim 결과가 기존 대비 **짧고 임팩트 있음** → OK
- Slim 결과가 규칙 무너져 렌더 깨짐 → roll back 필요
- `[cardnews-overflow]` 10%+ 발생 → 프롬프트에 "짧게" 한 줄 보강 고려 (follow-up)

- [ ] **Step 5.4: Push to origin**

사용자가 직접 실행:
```
! cd /Users/gong-eunhui/Desktop/naver-title-generator && git push origin main
```

`services/` 변경 없음 → Railway rebuild 트리거 안 됨. Vercel만 자동 재배포.

- [ ] **Step 5.5: Vercel env 설정 — 배포 후**

Vercel 배포 Ready 확인 후 대시보드에서:
- `CARDNEWS_SLIM_PROMPT_ROLLOUT=10` 신규 추가 (Production)
- Redeploy (또는 env 변경 자동 반영 대기)

- [ ] **Step 5.6: Production smoke 후 관찰 (사용자 수행)**

- [ ] Vercel preview 또는 production에서 카드뉴스 5~10회 생성
- [ ] Vercel 로그(`vercel logs` 또는 대시보드)에서 `[cardnews-overflow]` 빈도 수집
- [ ] slim 결과가 full 대비 "짧고 임팩트 있는지" 체감 비교 (user hashEmail로 분기 sticky — 같은 계정은 항상 같은 변형)
- [ ] 샘플 20개+ 축적 후 overflow 발생률 판정:
  - < 5%: 10% → 50% 로 상승
  - 5~20%: 유지하며 더 관찰
  - > 20%: roll back(`ROLLOUT=0`) 후 slim 프롬프트에 글자수 힌트 보강 (follow-up PR)

- [ ] **Step 5.7: 출시 전 100% 달성 시 별도 PR로 full 프롬프트 제거**

slim이 100%에서 1주 안정 관찰되면:
- `SLIDE_SYSTEM_PROMPT` (기존 풀 버전) 상수 제거
- `shouldUseSlim` 분기 제거, slim 직접 호출
- `CARDNEWS_SLIM_PROMPT_ROLLOUT` env 정리

이건 본 plan 스코프 밖.

---

## Rollback Plan

Production 이슈 시:

**즉시 대응 (30초):**
- Vercel 대시보드 → env `CARDNEWS_SLIM_PROMPT_ROLLOUT=0` → Redeploy
- Full 프롬프트로 즉시 전환 (코드 수정 없이)

**완전 롤백:**
- `git revert <task-4-commit>` → push
- shared-prompts 디렉토리 자체는 남아도 무해 (아무도 import 안 함)

---

## Self-Review

Plan 작성 후 spec과 대조한 자가 검증:

**1. Spec coverage**
- ✅ `lib/shared-prompts/seda.js` 신설 → Task 1
- ✅ `lib/shared-prompts/length-rules.js` 신설 → Task 2
- ✅ `lib/shared-prompts/rollout.js` 신설 (spec에 암시, hashEmail 대신 simpleHash로 숏폼 일관성) → Task 3
- ✅ `SLIDE_SYSTEM_PROMPT_SLIM` ~27줄 → Task 4.2
- ✅ `CARDNEWS_SLIM_PROMPT_ROLLOUT` env 분기 → Task 4.3, 4.5
- ✅ `findOverflows` warn 로그 (throw 없음) → Task 4.6
- ✅ `CARD_NEWS_FIELD_MAP` → Task 4.4
- ✅ 기존 `SLIDE_SYSTEM_PROMPT` 보존 (rollout=0 fallback) → Task 4.5 주석
- ✅ 롤아웃 0 → 10 → 50 → 100 순차 → Task 5.5~5.7
- ✅ 10% 기준 sticky (같은 email 동일 분기) → Task 3 resolveRolloutFlag

**2. Placeholder scan**
- "TBD/TODO/implement later" 없음 ✅
- 모든 step에 실제 코드 블록 또는 정확한 명령 ✅
- "Similar to Task N" 없음 ✅

**3. Type consistency**
- `SEDA_PROMPT_BLOCK` — Task 1 정의, Task 4.2 사용 ✅
- `CARD_NEWS_LIMITS`, `findOverflows` — Task 2 정의, Task 4.1/4.6 사용 ✅
- `getLimit` — Task 2 export만, 호출은 내부 `findOverflows`에서 사용 (외부 호출 없음 — 향후 필요 시) ✅
- `simpleHash`, `resolveRolloutFlag` — Task 3 정의, Task 4.3에서 `resolveRolloutFlag` 사용 ✅
- `shouldUseSlim` — Task 4.3 정의, Task 4.5 사용 ✅
- `CARD_NEWS_FIELD_MAP` — Task 4.4 정의, Task 4.6 사용 ✅

**4. Order dependency**
- Task 1/2/3 (shared lib) → Task 4 (route.js import) ✅
- Task 4 → Task 5 (smoke) ✅

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-19-cardnews-seda-slim-plan.md`.

**두 가지 실행 옵션:**

1. **Subagent-Driven (추천)** — 각 task마다 fresh subagent, task 사이 2단계 리뷰(spec + quality), 빠른 iteration.
2. **Inline Execution** — 이 세션에서 executing-plans로 일괄 실행 + checkpoint.

어느 쪽으로?
