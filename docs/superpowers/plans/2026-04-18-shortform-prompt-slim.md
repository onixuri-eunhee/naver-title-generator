# 숏폼 대본 프롬프트 슬림화 — 5대 룰 + 벤치마크 기반 자유도 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 기존 230줄 하드코딩된 숏폼 대본 시스템 프롬프트를 "5대 하드 룰 + 17종 layoutType 스키마"만 남긴 ~70~90줄 슬림 버전으로 대체하고, 사용자별 deterministic bucket 롤아웃(0%→10%→50%→100%) + post-generation validator + 메트릭 로깅을 탑재한다.

**Architecture:**
- `lib/shortform/prompt.js`에 `buildSystemPromptSlim()` 신규 export. 기존 `buildSystemPrompt()`는 fallback·A/B 대조용으로 보존.
- `lib/shortform/prompt-validator.js` 신설: layoutType enum 검증 · onScreenText 길이 · 데이터 시각화 ≥2회 · layout 분포 통계. 생성 후 서버에서 호출.
- `app/api/shortform-script/route.js`에 `SHORTFORM_SLIM_PROMPT_ROLLOUT` 환경변수 기반 bucket 라우터 추가. 이메일 해시 % 100 < rollout이면 슬림 모드.
- 메트릭: `console.log('[SHORTFORM-METRICS]', JSON.stringify({...}))` 1줄만. 향후 Vercel Logs → Grafana/Sheets로 수집.

**Tech Stack:** Next.js 14 App Router · Vitest · Anthropic SDK (Claude) · Neon PostgreSQL (기존 유지).

**Worktree 권장:** `git worktree add .worktrees/prompt-slim -b feat/prompt-slim main` — 메인 배포 흐름과 격리.

---

## File Structure

### 신규 파일
- `lib/shortform/prompt-validator.js` — post-generation 품질 검증 + 통계 수집. 순수 함수 (Remotion import 금지, env 직접 접근 금지).
- `tests/unit/prompt-slim.test.js` — 슬림 프롬프트 빌더 테스트.
- `tests/unit/prompt-validator.test.js` — validator 테스트.

### 수정 파일
- `lib/shortform/prompt.js`
  - `buildSystemPromptSlim()` 신규 export (기존 `buildSystemPrompt()` 건드리지 않음)
  - `_buildLayoutSchemaOnly()` 내부 헬퍼 — 기존 `buildLayoutTypeBlock`의 스키마 부분만 (선택 우선순위·예시 블록은 slim에 포함 안 함)
- `app/api/shortform-script/route.js`
  - `resolveSlimPromptFlag(email)` 헬퍼 + `simpleHash()` (상단 유틸 영역)
  - `runOnce`에서 플래그 확인 후 slim/full 분기
  - 생성 후 `validateScriptQuality()` 호출 + 메트릭 로그

---

## Task 1: `buildSystemPromptSlim` 빌더 + 테스트

**Files:**
- Modify: `/Users/gong-eunhui/Desktop/naver-title-generator/.worktrees/prompt-slim/lib/shortform/prompt.js`
- Create: `/Users/gong-eunhui/Desktop/naver-title-generator/.worktrees/prompt-slim/tests/unit/prompt-slim.test.js`

**Spec: 5대 하드 룰만 유지**
1. JSON 순수 출력
2. 모든 씬 layoutType(17종) + layoutProps 스키마 준수
3. scenes 개수 = targetSceneCount · onScreenText ≤8자
4. 데이터 시각화 ≥2회 (big-impact-text/counter/number-slam/progress-bar/bar-chart/pie-chart)
5. 존댓말·구어체·이모지 금지

**뺄 것:** fingr 씬별 역할, 후킹 6종 BAD/GOOD 예시, 외래어 9개 오탈자 예시, reasoning few-shot, [layoutType 선택 우선순위] 블록 110줄, First 3 Seconds 4 variants × 글자수.

- [ ] **Step 1: 테스트 파일 작성 (실패 상태)**

Create `/Users/gong-eunhui/Desktop/naver-title-generator/.worktrees/prompt-slim/tests/unit/prompt-slim.test.js`:

> **Test runner:** Node built-in `node --test` (NOT Vitest). Use `node:test` + `node:assert/strict`.

```js
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSystemPromptSlim } from '../../lib/shortform/prompt.js';

describe('buildSystemPromptSlim — 5대 하드 룰', () => {
  test('룰 1: JSON 순수 출력', () => {
    const p = buildSystemPromptSlim({ targetSceneCount: 7 });
    assert.match(p, /순수 JSON/);
    assert.match(p, /마크다운/);
  });

  test('룰 2: layoutType 17종 enum 강제 + 스키마', () => {
    const p = buildSystemPromptSlim({ targetSceneCount: 7 });
    const names = [
      'big-impact-text', 'counter', 'number-slam', 'progress-bar',
      'bar-chart', 'pie-chart',
      'flow-diagram', 'comparison', 'comparison-chart', 'venn-diagram', 'network',
      'bullet-list', 'emphasis-box', 'strikethrough', 'vertical-bar',
      'small-label', 'subtitle-bar',
    ];
    names.forEach((n) => {
      assert.ok(p.includes(n), `layout name missing: ${n}`);
    });
  });

  test('룰 3: scenes count + onScreenText 8자', () => {
    const p = buildSystemPromptSlim({ targetSceneCount: 10 });
    assert.match(p, /scenes 개수.*=.*10/);
    assert.match(p, /onScreenText.*8자/);
  });

  test('룰 4: 데이터 시각화 2회', () => {
    const p = buildSystemPromptSlim({ targetSceneCount: 7 });
    assert.match(p, /데이터 시각화.*2회/);
  });

  test('룰 5: 존댓말·구어체·이모지 금지', () => {
    const p = buildSystemPromptSlim({ targetSceneCount: 7 });
    assert.match(p, /존댓말/);
    assert.match(p, /이모지/);
    assert.match(p, /구어체/);
  });

  test('제거 확인: fingr 씬별 역할 지시 없음', () => {
    const p = buildSystemPromptSlim({ targetSceneCount: 7 });
    assert.doesNotMatch(p, /마음읽기 질문/);
    assert.doesNotMatch(p, /scene\[1\]/);
    assert.doesNotMatch(p, /통념 깨기/);
  });

  test('제거 확인: 외래어 9개 오탈자 예시 없음', () => {
    const p = buildSystemPromptSlim({ targetSceneCount: 7 });
    assert.doesNotMatch(p, /볼랙/);
    assert.doesNotMatch(p, /네비이/);
    assert.doesNotMatch(p, /아이보리이/);
  });

  test('제거 확인: 후킹 6종 BAD/GOOD 예시 본문 없음', () => {
    const p = buildSystemPromptSlim({ targetSceneCount: 7 });
    assert.doesNotMatch(p, /BAD \(0점\)/);
    assert.doesNotMatch(p, /블로그 하루 3시간 쓰는데 왜 방문자가/);
  });

  test('제거 확인: [layoutType 선택 우선순위] 블록 없음', () => {
    const p = buildSystemPromptSlim({ targetSceneCount: 7 });
    assert.doesNotMatch(p, /선택 우선순위/);
    assert.doesNotMatch(p, /숫자·%·금액/);
  });

  test('길이: 전체 120줄 이하 (layout schema 17종 포함)', () => {
    const p = buildSystemPromptSlim({ targetSceneCount: 7 });
    const lines = p.split('\n').length;
    assert.ok(lines <= 120, `expected <=120 lines, got ${lines}`);
  });

  test('첫 씬: hookText·hookType 필수 필드 가이드 포함', () => {
    const p = buildSystemPromptSlim({ targetSceneCount: 7 });
    assert.match(p, /hookText/);
    assert.match(p, /hookType/);
  });

  test('targetSceneCount 기본값 7', () => {
    const p = buildSystemPromptSlim();
    assert.match(p, /scenes 개수.*=.*7/);
  });
});
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

```bash
cd /Users/gong-eunhui/Desktop/naver-title-generator/.worktrees/prompt-slim && node --test tests/unit/prompt-slim.test.js
```

Expected: 12 tests FAIL with `buildSystemPromptSlim is not a function` or `undefined`.

- [ ] **Step 3: `buildSystemPromptSlim` + 헬퍼 구현**

Modify `/Users/gong-eunhui/Desktop/naver-title-generator/.worktrees/prompt-slim/lib/shortform/prompt.js` — 파일 **맨 아래**(line 540 부근, `__resetReasoningWarning` export 뒤)에 다음 추가:

```js
// ─────────────────────────────────────────────────────────────────────────────
// [SLIM MODE] buildSystemPromptSlim — 5대 하드 룰 + 17종 스키마만
// spec: docs/superpowers/plans/2026-04-18-shortform-prompt-slim.md
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 17종 layoutType 스키마만 (선택 우선순위·예시 블록은 제외).
 * buildLayoutTypeBlock의 스키마 섹션만 발췌.
 */
function _buildLayoutSchemaOnly() {
  return `[layoutType 17종 — 스키마만. 선택은 대본 의미에 맞춰 자유]

[데이터 시각화]
- "big-impact-text": { text: "1.3억", highlight?: "1.3" }
- "counter": { value: 1000, suffix?: "만원", label?: "연매출", decimals?: 0 }
- "number-slam": { text: "3500+", subtitle?: "누적 상담" }
- "progress-bar": { label: "달성률", percent: 87 }
- "bar-chart": { bars: [{label,value,displayValue?,highlight?}], maxValue?: 100 }
- "pie-chart": { slices: [{label,value}], centerLabel?, centerValue? }

[관계·프로세스]
- "flow-diagram": { steps: [{label,title}], activeIndex?: 2 }
- "comparison": { leftIcon, leftTitle, leftPoints: [..], rightIcon, rightTitle, rightPoints: [..], rightHighlight?: true }
- "comparison-chart": { leftLabel, rightLabel, rows: [{feature,left,right}], highlightRight?: true }
- "venn-diagram": { circles: [{label}], intersectionLabel? }  // 2~3개만
- "network": { nodes: [{x,y}], edges: [[0,1]], width?, height? }

[텍스트 임팩트]
- "bullet-list": { items: ["a","b","c"], highlight?: true }  // 2~5개
- "emphasis-box": { text: "간이과세 가능", variant?: "check"|"warning"|"info" }
- "strikethrough": { text: "광고비 0원 달성", strikeWord: "광고비" }
- "vertical-bar": { text: "여기부터 핵심" }

[보조·레이블]
- "small-label": { text: "DATA" }  // ≤10자
- "subtitle-bar": { text: "내레이션 한 줄" }`;
}

/**
 * SLIM SYSTEM_PROMPT — 5대 하드 룰 + 17종 스키마 + JSON 출력 스키마.
 * 나머지(씬 역할, 후킹 유형, 감정, 시작화 방식)는 모델 자유.
 *
 * @param {{ targetSceneCount?: number }} params
 * @returns {string}
 */
export function buildSystemPromptSlim({ targetSceneCount = 7 } = {}) {
  const schema = _buildLayoutSchemaOnly();

  return `[뚝딱툴 숏폼 대본 생성 — 5대 하드 룰]

1. 출력은 순수 JSON 객체 하나만. 마크다운 코드블록·설명·서문·이모지 금지.
2. 모든 씬에 layoutType(17종 enum 중 하나) + layoutProps 스키마 정확히 준수. 누락 또는 오타 시 렌더 실패.
3. scenes 개수 = ${targetSceneCount}. 모든 씬에 onScreenText 필수 (한국어 8자 이하).
4. 17종 중 데이터 시각화 계열(big-impact-text/counter/number-slam/progress-bar/bar-chart/pie-chart)을 최소 2회 사용. 텍스트 계열만으로 대본 채우지 말 것.
5. 존댓말·구어체만. 문어체·이모지 금지. 외래어는 국립국어원 표기법 준수.

${schema}

[출력 JSON 스키마]
{
  "scenes": [
    {
      "script": "내레이션 문장 (한국어 1문장, 성우 낭독용)",
      "onScreenText": "화면 강조 (한국어 8자 이하)",
      "section": "hook | point | cta",
      "type": "broll",
      "visual": "영어 B-roll 설명",
      "layoutType": "17종 enum 중 하나",
      "layoutProps": "layoutType별 스키마 객체 (위 참조)",
      "hookText": "(scenes[0]만 필수) 화면 강조 8~12자",
      "hookType": "(scenes[0]만 필수) 질문형|충격형|비밀형|증거형|공감형|경고형",
      "reasoning": "30~50자 메타 설명 (왜 이 선택인지 — 구체 행동/심리 + 결과)"
    }
  ],
  "metadata": {
    "scriptType": "question | list | story (자가 판별)",
    "hookTypeChosen": "scenes[0].hookType과 동일"
  }
}

[자유도 영역 — 모델 판단]
- 씬별 시작화·감정 표현·문장 리듬: 주제와 userPrompt의 벤치마크에 맞춰 자유 배치.
- 대본 흐름: Hook → Point → CTA. 세부 씬 역할은 자유.
- 같은 말 반복 금지. 씬마다 새 정보 제공.
- 숫자는 구체화 ("많이" → "87%", "대부분" → "10명 중 8명").
- 첫 씬은 scroll-stop이 최우선 — 첫 2초에 멈출 말로 hookText·hookType 채우기.`;
}
```

- [ ] **Step 4: 테스트 실행 → 통과 확인**

```bash
cd /Users/gong-eunhui/Desktop/naver-title-generator/.worktrees/prompt-slim && node --test tests/unit/prompt-slim.test.js
```

Expected: 12/12 tests PASS.

- [ ] **Step 5: 커밋**

```bash
git add lib/shortform/prompt.js tests/unit/prompt-slim.test.js
git commit -m "$(cat <<'EOF'
feat(shortform): buildSystemPromptSlim — 5대 하드 룰만 남긴 슬림 프롬프트

- 기존 buildSystemPrompt (230줄) 보존, buildSystemPromptSlim (~95줄) 추가
- 제거: fingr 씬별 역할, 후킹 6종 BAD/GOOD 예시, 외래어 오탈자 9개, [선택 우선순위] 110줄
- 유지: JSON 출력 · 17종 enum+스키마 · scenes count · onScreenText ≤8자 · 데이터 시각화 ≥2회 · 존댓말
- 나머지(씬 역할·감정·시작화)는 모델 자유 + userPrompt의 벤치마크 주입이 담당

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Post-Generation Validator + 통계 수집

**Files:**
- Create: `/Users/gong-eunhui/Desktop/naver-title-generator/.worktrees/prompt-slim/lib/shortform/prompt-validator.js`
- Create: `/Users/gong-eunhui/Desktop/naver-title-generator/.worktrees/prompt-slim/tests/unit/prompt-validator.test.js`

**목적:** 슬림 프롬프트가 룰을 위반했을 때 서버에서 감지해 (a) 심각(layoutType 누락/오타)은 재시도, (b) 경미(데이터 시각화 <2회, onScreenText 초과)는 경고 로그만 — 관측은 하되 차단은 최소화.

- [ ] **Step 1: 테스트 파일 작성 (실패 상태)**

Create `/Users/gong-eunhui/Desktop/naver-title-generator/.worktrees/prompt-slim/tests/unit/prompt-validator.test.js`:

> **Test runner:** Node built-in `node --test`. Use `node:test` + `node:assert/strict`.

```js
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { validateScriptQuality } from '../../lib/shortform/prompt-validator.js';

const DATA_LAYOUT_ARR = ['big-impact-text', 'counter', 'bar-chart', 'pie-chart', 'number-slam', 'progress-bar'];

function makeScene(overrides = {}) {
  return {
    layoutType: 'emphasis-box',
    layoutProps: { text: 'x' },
    onScreenText: '핵심',
    script: '테스트',
    section: 'point',
    type: 'broll',
    visual: 'close-up',
    ...overrides,
  };
}

describe('validateScriptQuality', () => {
  test('정상 대본 — ok:true, errors 없음', () => {
    const parsed = {
      scenes: [
        makeScene({ layoutType: 'big-impact-text', onScreenText: '야근' }),
        makeScene({ layoutType: 'counter', onScreenText: '5시간' }),
        makeScene({ layoutType: 'flow-diagram', onScreenText: '3단계' }),
        makeScene({ layoutType: 'comparison', onScreenText: '비교' }),
        makeScene({ layoutType: 'emphasis-box', onScreenText: '핵심' }),
        makeScene({ layoutType: 'bullet-list', onScreenText: '3가지' }),
        makeScene({ layoutType: 'big-impact-text', onScreenText: '지금' }),
      ],
    };
    const r = validateScriptQuality(parsed);
    assert.equal(r.ok, true);
    assert.deepEqual(r.errors, []);
  });

  test('에러 — scenes 배열 아님', () => {
    assert.equal(validateScriptQuality(null).ok, false);
    assert.equal(validateScriptQuality({}).ok, false);
    assert.equal(validateScriptQuality({ scenes: 'x' }).ok, false);
  });

  test('에러 — layoutType 누락', () => {
    const parsed = {
      scenes: [
        makeScene({ layoutType: undefined }),
        makeScene({ layoutType: 'counter' }),
      ],
    };
    const r = validateScriptQuality(parsed);
    assert.equal(r.ok, false);
    assert.ok(r.errors.includes('scene_0_missing_layoutType'));
  });

  test('에러 — 유효하지 않은 layoutType (17종 밖)', () => {
    const parsed = {
      scenes: [makeScene({ layoutType: 'nonexistent-layout' })],
    };
    const r = validateScriptQuality(parsed);
    assert.equal(r.ok, false);
    assert.match(r.errors[0], /invalid_layoutType:nonexistent-layout/);
  });

  test('경고 — 데이터 시각화 2회 미만 (ok는 true 유지)', () => {
    const parsed = {
      scenes: [
        makeScene({ layoutType: 'emphasis-box' }),
        makeScene({ layoutType: 'bullet-list' }),
        makeScene({ layoutType: 'subtitle-bar' }),
      ],
    };
    const r = validateScriptQuality(parsed);
    assert.equal(r.ok, true);
    assert.ok(r.warnings.some((w) => w.includes('data_viz_count_below_threshold:0')));
  });

  test('경고 — onScreenText 9자 초과', () => {
    const parsed = {
      scenes: [makeScene({ layoutType: 'counter', onScreenText: '123456789' })],
    };
    const r = validateScriptQuality(parsed);
    assert.ok(r.warnings.some((w) => w.includes('onScreenText_too_long')));
  });

  test('경고 — onScreenText 누락', () => {
    const parsed = {
      scenes: [makeScene({ layoutType: 'counter', onScreenText: undefined })],
    };
    const r = validateScriptQuality(parsed);
    assert.ok(r.warnings.includes('scene_0_missing_onScreenText'));
  });

  test('경고 — layoutProps 누락', () => {
    const parsed = {
      scenes: [makeScene({ layoutType: 'counter', layoutProps: undefined })],
    };
    const r = validateScriptQuality(parsed);
    assert.ok(r.warnings.includes('scene_0_missing_layoutProps'));
  });

  test('stats — sceneCount · dataVizCount · layoutDistribution', () => {
    const parsed = {
      scenes: [
        makeScene({ layoutType: 'counter' }),
        makeScene({ layoutType: 'counter' }),
        makeScene({ layoutType: 'bar-chart' }),
        makeScene({ layoutType: 'emphasis-box' }),
      ],
    };
    const r = validateScriptQuality(parsed);
    assert.equal(r.stats.sceneCount, 4);
    assert.equal(r.stats.dataVizCount, 3);
    assert.deepEqual(r.stats.layoutDistribution, {
      counter: 2,
      'bar-chart': 1,
      'emphasis-box': 1,
    });
  });

  test('17종 enum — DATA_VIZ_LAYOUTS 6종 모두 인식', () => {
    DATA_LAYOUT_ARR.forEach((layout) => {
      const parsed = { scenes: [makeScene({ layoutType: layout })] };
      const r = validateScriptQuality(parsed);
      assert.equal(r.stats.dataVizCount, 1, `layout=${layout}`);
    });
  });
});
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

```bash
cd /Users/gong-eunhui/Desktop/naver-title-generator/.worktrees/prompt-slim && node --test tests/unit/prompt-validator.test.js
```

Expected: 10 tests FAIL with `Cannot find module '@/lib/shortform/prompt-validator.js'`.

- [ ] **Step 3: validator 구현**

Create `/Users/gong-eunhui/Desktop/naver-title-generator/.worktrees/prompt-slim/lib/shortform/prompt-validator.js`:

```js
// lib/shortform/prompt-validator.js
//
// SLIM 프롬프트 모드용 post-generation 검증 + 통계 수집.
// spec: docs/superpowers/plans/2026-04-18-shortform-prompt-slim.md Task 2
//
// 규칙:
// - L1: React/Remotion import 금지
// - 순수 함수. 사이드 이펙트 없음.
// - errors → 심각(재시도 대상): layoutType 누락/오타
// - warnings → 경미(로그만): 데이터 시각화 <2회, onScreenText 길이/누락

/** 데이터 시각화 그룹 — 룰 4 기준 */
const DATA_VIZ_LAYOUTS = new Set([
  'big-impact-text',
  'counter',
  'number-slam',
  'progress-bar',
  'bar-chart',
  'pie-chart',
]);

/** 17종 enum — 룰 2 기준 */
const VALID_LAYOUTS = new Set([
  // 데이터 시각화 6
  'big-impact-text',
  'counter',
  'number-slam',
  'progress-bar',
  'bar-chart',
  'pie-chart',
  // 관계·프로세스 5
  'flow-diagram',
  'comparison',
  'comparison-chart',
  'venn-diagram',
  'network',
  // 텍스트 임팩트 4
  'bullet-list',
  'emphasis-box',
  'strikethrough',
  'vertical-bar',
  // 보조·레이블 2
  'small-label',
  'subtitle-bar',
]);

export const MAX_ONSCREEN_TEXT_LENGTH = 8;
export const MIN_DATA_VIZ_COUNT = 2;

/**
 * 슬림 프롬프트 출력 검증.
 *
 * @param {{ scenes?: Array<object> }} parsed — safeParseJson 결과
 * @returns {{
 *   ok: boolean,
 *   errors: string[],
 *   warnings: string[],
 *   stats: {
 *     sceneCount: number,
 *     dataVizCount: number,
 *     layoutDistribution: Record<string, number>,
 *   }
 * }}
 */
export function validateScriptQuality(parsed) {
  const errors = [];
  const warnings = [];

  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.scenes)) {
    return {
      ok: false,
      errors: ['scenes_not_array'],
      warnings: [],
      stats: { sceneCount: 0, dataVizCount: 0, layoutDistribution: {} },
    };
  }

  const scenes = parsed.scenes;

  // 룰 2: 모든 씬에 유효한 layoutType
  scenes.forEach((s, i) => {
    if (!s.layoutType) {
      errors.push(`scene_${i}_missing_layoutType`);
    } else if (!VALID_LAYOUTS.has(s.layoutType)) {
      errors.push(`scene_${i}_invalid_layoutType:${s.layoutType}`);
    }
    if (!s.layoutProps) {
      warnings.push(`scene_${i}_missing_layoutProps`);
    }
  });

  // 룰 3: onScreenText ≤8자
  scenes.forEach((s, i) => {
    if (!s.onScreenText) {
      warnings.push(`scene_${i}_missing_onScreenText`);
    } else if (typeof s.onScreenText === 'string' && s.onScreenText.length > MAX_ONSCREEN_TEXT_LENGTH) {
      warnings.push(`scene_${i}_onScreenText_too_long:${s.onScreenText.length}`);
    }
  });

  // 룰 4: 데이터 시각화 ≥2회
  const dataVizCount = scenes.filter((s) => DATA_VIZ_LAYOUTS.has(s.layoutType)).length;
  if (dataVizCount < MIN_DATA_VIZ_COUNT) {
    warnings.push(`data_viz_count_below_threshold:${dataVizCount}`);
  }

  const layoutDistribution = {};
  scenes.forEach((s) => {
    const key = s.layoutType || 'missing';
    layoutDistribution[key] = (layoutDistribution[key] || 0) + 1;
  });

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    stats: {
      sceneCount: scenes.length,
      dataVizCount,
      layoutDistribution,
    },
  };
}

export { DATA_VIZ_LAYOUTS, VALID_LAYOUTS };
```

- [ ] **Step 4: 테스트 실행 → 통과 확인**

```bash
cd /Users/gong-eunhui/Desktop/naver-title-generator/.worktrees/prompt-slim && node --test tests/unit/prompt-validator.test.js
```

Expected: 10/10 tests PASS.

- [ ] **Step 5: 커밋**

```bash
git add lib/shortform/prompt-validator.js tests/unit/prompt-validator.test.js
git commit -m "$(cat <<'EOF'
feat(shortform): prompt-validator — 슬림 프롬프트 post-generation 검증

- validateScriptQuality(parsed) → { ok, errors, warnings, stats }
- errors (재시도 대상): layoutType 누락/17종 밖 오타
- warnings (로그만): 데이터 시각화 <2회, onScreenText ≤8자 위반, layoutProps 누락
- stats: sceneCount, dataVizCount, layoutDistribution — 17종 분포 모니터링용

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: API 라우트 통합 — 롤아웃 플래그 + 분기 + 메트릭

**Files:**
- Modify: `/Users/gong-eunhui/Desktop/naver-title-generator/.worktrees/prompt-slim/app/api/shortform-script/route.js`

**롤아웃 환경변수:** `SHORTFORM_SLIM_PROMPT_ROLLOUT` (0~100, 기본 `0`)
- 0 → 모두 full 모드 (현상 유지)
- 10 → 이메일 해시 버킷 10% 슬림
- 50 → 50%
- 100 → 모두 슬림

**이메일 해시:** deterministic bucket — 같은 사용자는 항상 같은 모드를 받음 (A/B 일관성).

- [ ] **Step 1: 라우트 파일 import + 헬퍼 추가**

Open `/Users/gong-eunhui/Desktop/naver-title-generator/.worktrees/prompt-slim/app/api/shortform-script/route.js`.

Line 27~29 근처 (`buildSystemPrompt as buildSystemPromptABis` import 블록) 안에 추가:

```js
import {
  buildSystemPrompt as buildSystemPromptABis,
  buildUserPrompt as buildUserPromptABis,
  buildSystemPromptSlim,
} from '@/lib/shortform/prompt.js';
import { validateScriptQuality } from '@/lib/shortform/prompt-validator.js';
```

파일 상단 유틸 영역(기존 helper들 뒤, 대략 line 60~75 근처 — 파일 읽고 정확한 위치 찾을 것)에 추가:

```js
// 롤아웃 플래그 — 이메일 해시 기반 deterministic bucket
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
```

- [ ] **Step 2: `runOnce` 함수에서 slim/full 분기**

Line 609~618 (`const systemPrompt = buildSystemPromptABis(...)`) 교체. 우선 `runOnce` 바로 위에서 플래그 결정(한 번만):

```js
const useSlimPrompt = resolveSlimPromptFlag(email);
```

(email 변수는 해당 함수 스코프 안에 이미 존재 — 없으면 `req`에서 추출하는 곳 위로 이동)

`runOnce` 안의 systemPrompt 할당 부분을 다음으로 교체:

```js
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
```

- [ ] **Step 3: 생성 성공 후 validator 호출 + 메트릭 로깅**

Line 672~677 근처 (`const parsed = await runOnce(attempt);` 바로 뒤)에 삽입:

```js
const parsed = await runOnce(attempt);

// SLIM 모드: post-generation 검증
if (useSlimPrompt) {
  const validation = validateScriptQuality(parsed);
  console.log(
    '[SHORTFORM-METRICS]',
    JSON.stringify({
      mode: 'slim',
      attempt,
      ok: validation.ok,
      errors: validation.errors,
      warnings: validation.warnings,
      stats: validation.stats,
      emailPrefix: (email || 'anon').slice(0, 3) + '***',
      timestamp: new Date().toISOString(),
    }),
  );

  // 심각한 에러(layoutType 누락/오타) → 재시도 유도
  if (!validation.ok && attempt < MAX_RETRIES) {
    const e = new Error(`slim_validation_failed:${validation.errors.join(',')}`);
    e.code = 'slim_validation_failed';
    throw e;
  }
} else {
  // FULL 모드에서도 기본 stats 로깅 (대조군)
  const validation = validateScriptQuality(parsed);
  console.log(
    '[SHORTFORM-METRICS]',
    JSON.stringify({
      mode: 'full',
      attempt,
      ok: validation.ok,
      stats: validation.stats,
      emailPrefix: (email || 'anon').slice(0, 3) + '***',
      timestamp: new Date().toISOString(),
    }),
  );
}

const payload = buildScriptPayload(parsed, concept, targetSceneCount);
```

- [ ] **Step 4: 수동 스모크 테스트 (로컬)**

```bash
cd /Users/gong-eunhui/Desktop/naver-title-generator/.worktrees/prompt-slim && npm run dev
```

별도 터미널:

```bash
# FULL 모드 (기본)
curl -X POST http://localhost:3000/api/shortform-script \
  -H "Content-Type: application/json" \
  -H "Cookie: $(cat .env.local | grep TEST_SESSION)" \
  -d '{"topic":"웨딩플래너 블로그 마케팅","targetSceneCount":7,"targetDurationSec":30}'
# → 로그에 [SHORTFORM-METRICS] {"mode":"full",...}

# SLIM 모드 (강제 100%)
SHORTFORM_SLIM_PROMPT_ROLLOUT=100 npm run dev
# 위 curl 재실행 → 로그에 [SHORTFORM-METRICS] {"mode":"slim",...}
```

Expected: 두 호출 모두 정상 scenes 반환, 로그에 mode/stats 보임. layoutType 분포(stats.layoutDistribution)가 슬림 모드에서 더 다양하게 나오는지 육안 비교.

**주의:** 이 스텝은 실제 Anthropic API 호출 발생 → 크레딧 소비. 개인 테스트 계정으로.

- [ ] **Step 5: 커밋**

```bash
git add app/api/shortform-script/route.js
git commit -m "$(cat <<'EOF'
feat(shortform): SLIM 프롬프트 A/B 롤아웃 + 메트릭 로깅

- SHORTFORM_SLIM_PROMPT_ROLLOUT (0~100) 환경변수로 이메일 해시 bucket 롤아웃
- 슬림 모드: validateScriptQuality 후 errors면 재시도, warnings는 로그만
- full/slim 모두 [SHORTFORM-METRICS] 로그 — mode/stats/layoutDistribution
- deterministic bucket → 같은 사용자는 항상 같은 모드 (A/B 일관성)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: 전체 테스트 스위트 재검증

**Files:** 없음 (검증만)

- [ ] **Step 1: 전체 테스트 실행 — regression 없는지 확인**

```bash
cd /Users/gong-eunhui/Desktop/naver-title-generator/.worktrees/prompt-slim && npm test
```

Expected: 기존 테스트 모두 PASS + 새로 추가한 22 tests PASS.

- [ ] **Step 2: 기존 shortform-prompt 테스트 스크립트 재실행**

```bash
cd /Users/gong-eunhui/Desktop/naver-title-generator/.worktrees/prompt-slim && node scripts/test-shortform-prompt.mjs 2>&1 | head -40
```

Expected: 기존 LEGACY SYSTEM_PROMPT export 경로 정상 동작 (역호환 유지 확인).

- [ ] **Step 3: 빌드 체크**

```bash
cd /Users/gong-eunhui/Desktop/naver-title-generator/.worktrees/prompt-slim && npm run build 2>&1 | tail -20
```

Expected: 빌드 성공. 새 import 경로 정상 해석.

---

## Task 5: 롤아웃 실행 (배포 후 수동 단계)

**Files:** 없음 (환경변수 조작 + 모니터링)

이 태스크는 **Vercel 환경변수 조작** + **Vercel Logs 관찰**. 코드 변경 없음.

- [ ] **Step 1: Vercel에 환경변수 등록 — rollout 0으로 시작**

Vercel Dashboard → Project → Settings → Environment Variables:
```
Name:  SHORTFORM_SLIM_PROMPT_ROLLOUT
Value: 0
Env:   Production
```

이 상태에서 배포 → 모든 트래픽이 기존 full 모드로 계속 감. 안전.

- [ ] **Step 2: 24시간 후 — rollout 10으로 상승**

Vercel 환경변수 `10`으로 변경 → Redeploy.

Vercel Logs에서 `[SHORTFORM-METRICS]` 필터 검색 → `mode:"slim"`과 `mode:"full"` 두 종류 수집.

**관찰 지표 (최소 50회 생성):**
- `mode:"slim"` JSON 파싱 실패율 (errors에 `claude_json_parse_failed`)
- `mode:"slim"` `errors` 비율 (layoutType 누락/오타)
- `mode:"slim"` `data_viz_count_below_threshold` 경고 비율
- `layoutDistribution` 히스토그램 — 17종 중 몇 종이 실제 사용되는지
- 사용자 재생성 버튼 클릭률(기존 analytics — slim vs full 차이 유무)

- [ ] **Step 3: 성공 기준 충족 시 rollout 50**

**성공 기준:**
- slim `errors` 비율 ≤ 2% (full과 유사 수준)
- slim JSON 파싱 실패율 ≤ 1%
- slim `layoutDistribution`에서 최소 10종 이상 사용 (다양성 확보)
- slim 재생성 클릭률 ≤ full × 1.1 (품질 퇴행 없음)

rollout `50`으로 변경 → Redeploy → 추가 48시간 관찰.

- [ ] **Step 4: 최종 rollout 100 + 레거시 경로 deprecate 결정**

rollout `100`으로 변경 후 1주 안정성 확인.

이후 별도 PR로 `buildSystemPrompt` (full) 경로를 deprecate할지 결정:
- Option A — 레거시 보존 (fallback용): 코드 유지, 환경변수 `100` 고정
- Option B — full 경로 삭제: 230줄 코드 제거, `scripts/test-shortform-prompt.mjs` 업데이트

권장: Option A로 4~6주 유지 후 Option B. 롤백 가능성 확보.

- [ ] **Step 5: 결과 메모리 저장**

성공/실패 판단 후:

```bash
# 성공 시
echo "2026-04-XX SLIM 프롬프트 롤아웃 완료" → memory 파일 업데이트

# 실패 시
echo "2026-04-XX SLIM 프롬프트 롤백 이유: ..." → DEAD_ENDS 기록
```

---

## Self-Review 체크리스트

- [x] **스펙 커버리지**: 5대 하드 룰 전부 Task 1에 반영. Post-generation validator는 Task 2가 담당. 롤아웃은 Task 3~5.
- [x] **플레이스홀더 스캔**: 모든 코드 블록 완전. 인자 이름 일관성 OK (`buildSystemPromptSlim({ targetSceneCount })` · `validateScriptQuality(parsed)` 로 Task 1~3에서 동일).
- [x] **타입 일관성**: `validation.ok` / `validation.errors` / `validation.warnings` / `validation.stats.layoutDistribution` 필드명 Task 2 정의 = Task 3 소비 일치.
- [x] **역호환**: 기존 `buildSystemPrompt` (full) 경로 보존. `SHORTFORM_SLIM_PROMPT_ROLLOUT=0`이면 현상 유지.

## 가정 및 리스크

- **가정 1:** `email` 변수가 `/api/shortform-script` 라우트 핸들러 스코프에 존재. Step 1에서 확인 못하면 req에서 추출하는 라인 위로 `resolveSlimPromptFlag` 호출 이동.
- **가정 2:** Vitest 설정이 `@/lib` path alias 지원. 기존 테스트가 이 패턴 쓰고 있으면 OK (`tests/unit/prompt.test.js` 확인).
- **리스크 1:** benchmark fallback (`benchmark.fallback: true`) 시 slim 모드가 freewheel — 첫 10% 롤아웃에서 `benchmark_fallback:true` 샘플 특별 관찰 필요. 이 케이스 품질 나쁘면 slim 빌더에 `benchmark=null`일 때 최소 구조 가이드 2줄 추가 (후속 PR).
- **리스크 2:** Claude가 `layoutType`을 17종 정확한 문자열이 아닌 유사 표현(`"big-impact"` 등)으로 낼 수 있음 — validator의 `invalid_layoutType:<value>` errors로 감지되므로 재시도 처리됨. 재시도율 >5%면 프롬프트에 enum 강조 추가.

---

## Execution Handoff

Plan complete and saved to `/Users/gong-eunhui/Desktop/naver-title-generator/docs/superpowers/plans/2026-04-18-shortform-prompt-slim.md`. Two execution options:

**1. Subagent-Driven (recommended)** — 각 Task마다 fresh subagent 파견 + two-stage review. Task 1~4 구현 후 Task 5(롤아웃)는 운영자 수동 결정.

**2. Inline Execution** — 이 세션에서 바로 Task 1~4 실행, 각 Task 끝에서 체크포인트. Task 5는 배포 후 별도 진행.

**Which approach?**
