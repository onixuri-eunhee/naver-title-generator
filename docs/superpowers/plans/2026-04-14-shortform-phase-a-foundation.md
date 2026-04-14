# Phase A — Foundation: UI 동선 + Step 1 입력

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. 12 Phase 중 Phase A. 마스터 플랜: `2026-04-14-shortform-master-plan.md`. 스펙: `2026-04-14-shortform-benchmark-pipeline-design.md`.

**Goal:** ShortformClient.js를 단계형(Step 1~7) 동선으로 재구조화하고 Step 1 입력 폼을 구현한다. 이후 모든 Phase의 베이스가 되는 작업.

**Architecture:** 기존 단일 페이지 ShortformClient.js를 step-machine 패턴으로 재구조화. 7개 Step 컴포넌트를 conditional render. StepProgress 컴포넌트로 시각화. `currentStep` state를 마스터로 관리. "전체 자동 생성" 버튼은 페이지 맨 아래로 이동.

**Tech Stack:** Next.js 15 App Router, React useState/useEffect, CSS modules

**의존성:** 없음 (1주차 즉시 시작 가능)

**예상 작업량:** 9 task, ~1주

---

## 파일 구조

### 신규 파일

```
components/StepProgress.js                    Step 1~7 시각적 진행 표시
components/StepProgress.module.css            
app/shortform/components/Step1Input.js        Step 1 입력 폼 (블로그 글, 키워드, 경험·느낌, 페르소나, 톤, 길이)
app/shortform/components/Step1Input.module.css
lib/shortform-personas.js                     화자 페르소나 5종 정의
```

### 수정 파일

```
app/shortform/ShortformClient.js              대규모 재구조화 (step-machine 패턴)
app/shortform/page.module.css                 단계형 CSS 추가
package.json                                  genkit 의존성 추가 (Phase B/D/F/I 사전 준비)
```

---

## Task A0: Genkit 의존성 설치 (Phase B/D/F/I 사전 준비)

Phase A 자체는 Genkit 무관하지만, **Phase B/D/F/I가 모두 Genkit을 사용하므로** 의존성 설치를 Phase A에서 미리 처리. 이후 Phase들이 서로 충돌 없이 진행 가능.

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Genkit 패키지 설치**

```bash
cd /Users/gong-eunhui/Desktop/naver-title-generator
npm install genkit @genkit-ai/vertexai @genkit-ai/google-cloud zod
```

Expected: `package.json` dependencies에 `genkit`, `@genkit-ai/vertexai`, `@genkit-ai/google-cloud`, `zod` 4개 추가.

**참고:** zod는 Genkit의 input/output 스키마 정의에 사용. 카드뉴스 Phase 3에서 sharp 추가했던 것과 동일 패턴.

- [ ] **Step 2: 환경 변수 자리 확인**

```bash
grep -E "GOOGLE_CLOUD_PROJECT|VERTEX_AI_LOCATION" /Users/gong-eunhui/Desktop/naver-title-generator/.env.local
```

Expected: 둘 중 하나라도 없으면 운영자에게 추가 요청 알림 (실제 값은 운영자가 설정).

- [ ] **Step 3: 빌드 체크**

```bash
npx next build 2>&1 | grep -iE "error|✓ Compiled" | head -10
```

Expected: `✓ Compiled successfully` 표시. error 0건.

- [ ] **Step 4: 커밋**

```bash
git add package.json package-lock.json
git commit -m "$(cat <<'EOF'
chore: genkit + zod 의존성 추가 (Phase B/D/F/I 사전 준비)

genkit, @genkit-ai/vertexai, @genkit-ai/google-cloud, zod 4종 설치.
숏폼 벤치마킹 파이프라인 Phase B/D/F/I가 Genkit 기반으로 작성될 예정.
Phase A 자체는 Genkit 무관이지만 의존성을 미리 추가해 후속 Phase 블로커
제거.
EOF
)"
```

---

## Task A1: 화자 페르소나 5종 정의

**Files:**
- Create: `lib/shortform-personas.js`

- [ ] **Step 1: 페르소나 데이터 작성**

```javascript
// lib/shortform-personas.js
/**
 * 숏폼 대본 작성 시 사용할 화자 페르소나 5종.
 * 각 페르소나는 1인칭 시점, 톤, 자주 쓰는 표현 패턴을 정의.
 * Claude/Gemini 프롬프트에 직접 주입됨 (Phase D).
 */

export const PERSONAS = [
  {
    id: 'store-owner',
    label: '매장 사장',
    description: '카페·식당·미용실·매장 등 운영',
    firstPerson: '저희 가게에서는, 직접 만나보시면',
    voiceCues: '친근하면서 매장에 대한 자부심 표현',
    sampleOpening: '오늘 단골손님이 이런 말씀을 하셨어요',
  },
  {
    id: 'blogger',
    label: '블로거',
    description: '블로그·SNS 콘텐츠 운영',
    firstPerson: '오늘 알려드릴 정보는, 제가 직접 써보니',
    voiceCues: '정보 전달 위주, 친절한 설명',
    sampleOpening: '많이들 헷갈려 하시는 부분 정리해드릴게요',
  },
  {
    id: 'instructor',
    label: '강사',
    description: '학원·온라인 강의·코치',
    firstPerson: '수업에서 자주 받는 질문이, 제가 가르치다 보면',
    voiceCues: '교육적 톤, 단계별 설명',
    sampleOpening: '오늘 수업 들으신 분이 이런 질문을 주셨는데요',
  },
  {
    id: 'consultant',
    label: '컨설턴트',
    description: '비즈니스·마케팅·재무 컨설턴트',
    firstPerson: '많은 사장님들이, 제 클라이언트 중에',
    voiceCues: '전문가 톤, 데이터/사례 인용',
    sampleOpening: '최근 3년간 100분의 사장님을 만나뵀는데',
  },
  {
    id: 'freelancer',
    label: '프리랜서',
    description: '디자이너·작가·개발자·1인 사업자',
    firstPerson: '제가 작업하면서, 클라이언트와 일하다 보니',
    voiceCues: '경험 기반, 솔직한 톤',
    sampleOpening: '5년차 프리랜서로 일하면서 깨달은 건',
  },
];

/**
 * id로 페르소나 조회. 존재하지 않으면 null.
 */
export function getPersona(id) {
  return PERSONAS.find((p) => p.id === id) || null;
}

/**
 * 직접 입력 페르소나 생성 (사용자가 5종 외 입력한 경우)
 */
export function buildCustomPersona(label, firstPersonHint) {
  return {
    id: 'custom',
    label: label || '직접 입력',
    description: '사용자 직접 입력',
    firstPerson: firstPersonHint || '제가, 저는',
    voiceCues: '사용자 톤 그대로',
    sampleOpening: '',
  };
}

export const TONES = [
  { id: 'professional', label: '전문가', description: '신뢰감 있는 톤, 정확한 정보 전달' },
  { id: 'casual', label: '친근한 친구', description: '편안하고 따뜻한 톤, 일상 대화' },
];
```

- [ ] **Step 2: 빌드 체크**

```bash
npx next build 2>&1 | grep -iE "error|✓ Compiled" | head -5
```

Expected: 컴파일 성공.

- [ ] **Step 3: 커밋**

```bash
git add lib/shortform-personas.js
git commit -m "$(cat <<'EOF'
feat(lib): 숏폼 화자 페르소나 5종 정의

매장 사장 / 블로거 / 강사 / 컨설턴트 / 프리랜서 + 직접 입력.
각 페르소나에 firstPerson, voiceCues, sampleOpening 메타데이터.
Phase D에서 Claude/Gemini 프롬프트에 직접 주입됨.
EOF
)"
```

---

## Task A2: StepProgress 공용 컴포넌트

**Files:**
- Create: `components/StepProgress.js`
- Create: `components/StepProgress.module.css`

- [ ] **Step 1: 컴포넌트 작성**

```javascript
// components/StepProgress.js
'use client';

import styles from './StepProgress.module.css';

/**
 * 다단계 워크플로의 진행 상태를 시각적으로 표시.
 *
 * Props:
 * - steps: Array<{ id: string|number, label: string }>
 * - currentStep: number (1-indexed)
 * - completedSteps: number[] (완료된 step id 배열)
 * - onStepClick: (stepId) => void  // 클릭으로 이동 가능 (옵션, 완료된 step만)
 */
export default function StepProgress({ steps, currentStep, completedSteps = [], onStepClick }) {
  return (
    <div className={styles.root}>
      <ol className={styles.list}>
        {steps.map((step, index) => {
          const stepNum = index + 1;
          const isActive = stepNum === currentStep;
          const isCompleted = completedSteps.includes(stepNum);
          const isClickable = isCompleted && typeof onStepClick === 'function';

          return (
            <li
              key={step.id}
              className={`${styles.item} ${isActive ? styles.itemActive : ''} ${isCompleted ? styles.itemCompleted : ''}`}
            >
              <button
                type="button"
                className={styles.btn}
                disabled={!isClickable}
                onClick={() => isClickable && onStepClick(stepNum)}
                aria-current={isActive ? 'step' : undefined}
              >
                <span className={styles.circle}>
                  {isCompleted ? '✓' : stepNum}
                </span>
                <span className={styles.label}>{step.label}</span>
              </button>
              {index < steps.length - 1 && (
                <span className={`${styles.connector} ${isCompleted ? styles.connectorDone : ''}`} />
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
```

- [ ] **Step 2: CSS 작성**

```css
/* components/StepProgress.module.css */
.root {
  width: 100%;
  padding: 16px 0;
}

.list {
  display: flex;
  list-style: none;
  margin: 0;
  padding: 0;
  gap: 0;
  align-items: center;
  overflow-x: auto;
}

.item {
  display: flex;
  align-items: center;
  flex: 1;
  min-width: 0;
}

.btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  background: none;
  border: none;
  padding: 4px;
  cursor: not-allowed;
  font-family: inherit;
  flex-shrink: 0;
}
.btn:not(:disabled) { cursor: pointer; }

.circle {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: var(--ds-surface-2, #F3F4F6);
  color: var(--ds-muted, #77736B);
  font-size: 13px;
  font-weight: 700;
  border: 2px solid transparent;
  transition: all 0.2s ease;
}

.label {
  margin-top: 6px;
  font-size: 11px;
  color: var(--ds-muted, #77736B);
  font-weight: 600;
  white-space: nowrap;
}

.itemActive .circle {
  background: var(--ds-accent, #ff5f1f);
  color: #fff;
  border-color: var(--ds-accent, #ff5f1f);
  box-shadow: 0 0 0 4px rgba(255, 95, 31, 0.15);
}
.itemActive .label {
  color: var(--ds-text, #1F2937);
  font-weight: 700;
}

.itemCompleted .circle {
  background: #10B981;
  color: #fff;
}
.itemCompleted .label {
  color: var(--ds-text, #1F2937);
}

.connector {
  flex: 1;
  height: 2px;
  background: var(--ds-border, #E5E7EB);
  margin: 0 8px;
  margin-bottom: 22px;
  min-width: 16px;
}
.connectorDone {
  background: #10B981;
}

@media (max-width: 700px) {
  .label { font-size: 10px; }
  .circle { width: 28px; height: 28px; font-size: 12px; }
}
```

- [ ] **Step 3: 빌드 체크**

```bash
npx next build 2>&1 | grep -iE "error|✓ Compiled" | head -5
```

Expected: 컴파일 성공.

- [ ] **Step 4: 커밋**

```bash
git add components/StepProgress.js components/StepProgress.module.css
git commit -m "$(cat <<'EOF'
feat(components): StepProgress 공용 컴포넌트

다단계 워크플로 시각화. 숏폼 Step 1~7에서 사용 예정.
완료된 step은 클릭으로 되돌아갈 수 있음 (onStepClick prop).
EOF
)"
```

---

## Task A3: Step1Input 컴포넌트 (입력 폼)

**Files:**
- Create: `app/shortform/components/Step1Input.js`
- Create: `app/shortform/components/Step1Input.module.css`

- [ ] **Step 1: 컴포넌트 작성**

```javascript
// app/shortform/components/Step1Input.js
'use client';

import { useState } from 'react';
import { PERSONAS, TONES } from '@/lib/shortform-personas';
import styles from './Step1Input.module.css';

const DURATIONS = [
  { sec: 30, label: '30초' },
  { sec: 45, label: '45초' },
  { sec: 60, label: '60초' },
  { sec: 90, label: '90초' },
];

/**
 * Step 1: 사용자 입력 폼.
 *
 * Props:
 * - value: { contentMode, blogText, keywords, userExperience, persona, customPersonaLabel, tone, durationSec }
 * - onChange: (next) => void
 * - onNext: () => void  // 검증 통과 시 다음 단계로
 */
export default function Step1Input({ value, onChange, onNext }) {
  const [error, setError] = useState('');

  function update(patch) {
    onChange({ ...value, ...patch });
  }

  function validateAndNext() {
    setError('');

    if (value.contentMode === 'blog') {
      if (!value.blogText || value.blogText.trim().length < 100) {
        setError('블로그 글을 100자 이상 입력해주세요.');
        return;
      }
    } else if (value.contentMode === 'keyword') {
      if (!value.keywords || value.keywords.trim().length < 2) {
        setError('키워드를 2자 이상 입력해주세요.');
        return;
      }
    }

    if (!value.userExperience || value.userExperience.trim().length < 10) {
      setError('내 경험·느낌을 10자 이상 입력해주세요.');
      return;
    }

    if (!value.persona) {
      setError('화자 페르소나를 선택해주세요.');
      return;
    }

    if (value.persona === 'custom' && !value.customPersonaLabel) {
      setError('직접 입력 페르소나의 이름을 적어주세요.');
      return;
    }

    onNext();
  }

  return (
    <div className={styles.root}>
      <div className={styles.section}>
        <div className={styles.sectionTitle}>1. 콘텐츠 입력</div>
        <div className={styles.modeRow}>
          <button
            type="button"
            className={`${styles.modeBtn} ${value.contentMode === 'blog' ? styles.modeBtnActive : ''}`}
            onClick={() => update({ contentMode: 'blog' })}
          >블로그 글 사용 (권장)</button>
          <button
            type="button"
            className={`${styles.modeBtn} ${value.contentMode === 'keyword' ? styles.modeBtnActive : ''}`}
            onClick={() => update({ contentMode: 'keyword' })}
          >키워드만 사용</button>
        </div>

        {value.contentMode === 'blog' && (
          <textarea
            className={styles.textarea}
            placeholder="블로그 글을 붙여넣으세요 (100자 이상). /blog-writer에서 작성한 글이 자동 입력됩니다."
            value={value.blogText || ''}
            onChange={(e) => update({ blogText: e.target.value })}
            rows={6}
          />
        )}

        {value.contentMode === 'keyword' && (
          <input
            type="text"
            className={styles.input}
            placeholder="예: 신랑 정장 추천, 카페 창업 비용"
            value={value.keywords || ''}
            onChange={(e) => update({ keywords: e.target.value })}
            maxLength={100}
          />
        )}
      </div>

      <div className={styles.section}>
        <div className={styles.sectionTitle}>2. 내 경험·느낌</div>
        <textarea
          className={styles.textarea}
          placeholder="구체적으로 적을수록 좋아요. 예: 15년차 헤어 디자이너, 손님 한 분이 처음 매장 들어왔을 때 '여기 분위기 너무 좋다'고 했던 그 순간"
          value={value.userExperience || ''}
          onChange={(e) => update({ userExperience: e.target.value })}
          rows={3}
        />
      </div>

      <div className={styles.section}>
        <div className={styles.sectionTitle}>3. 내 정체성</div>
        <div className={styles.fieldGroup}>
          <label className={styles.fieldLabel}>화자</label>
          <select
            className={styles.select}
            value={value.persona || ''}
            onChange={(e) => update({ persona: e.target.value })}
          >
            <option value="">선택해주세요</option>
            {PERSONAS.map((p) => (
              <option key={p.id} value={p.id}>{p.label} — {p.description}</option>
            ))}
            <option value="custom">직접 입력...</option>
          </select>
        </div>

        {value.persona === 'custom' && (
          <div className={styles.fieldGroup}>
            <label className={styles.fieldLabel}>직접 입력 (페르소나 이름)</label>
            <input
              type="text"
              className={styles.input}
              placeholder="예: 펫시터, 퍼스널트레이너, 꽃집 주인"
              value={value.customPersonaLabel || ''}
              onChange={(e) => update({ customPersonaLabel: e.target.value })}
              maxLength={30}
            />
          </div>
        )}

        <div className={styles.fieldGroup}>
          <label className={styles.fieldLabel}>톤</label>
          <div className={styles.toneRow}>
            {TONES.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`${styles.toneBtn} ${value.tone === t.id ? styles.toneBtnActive : ''}`}
                onClick={() => update({ tone: t.id })}
              >
                <div className={styles.toneLabel}>{t.label}</div>
                <div className={styles.toneDesc}>{t.description}</div>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className={styles.section}>
        <div className={styles.sectionTitle}>4. 영상 길이</div>
        <div className={styles.durationRow}>
          {DURATIONS.map((d) => (
            <button
              key={d.sec}
              type="button"
              className={`${styles.durationBtn} ${value.durationSec === d.sec ? styles.durationBtnActive : ''}`}
              onClick={() => update({ durationSec: d.sec })}
            >
              {d.label}
            </button>
          ))}
        </div>
      </div>

      {error && <div className={styles.error}>{error}</div>}

      <button
        type="button"
        className={styles.nextBtn}
        onClick={validateAndNext}
      >
        다음: 벤치마킹 영상 찾기 →
      </button>
    </div>
  );
}
```

- [ ] **Step 2: CSS 작성**

```css
/* app/shortform/components/Step1Input.module.css */
.root {
  display: flex;
  flex-direction: column;
  gap: 28px;
}

.section {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.sectionTitle {
  font-size: 14px;
  font-weight: 700;
  color: var(--ds-text, #1F2937);
}

.modeRow {
  display: flex;
  gap: 8px;
}

.modeBtn {
  flex: 1;
  padding: 12px 16px;
  border: 1.5px solid var(--ds-border, #E5E7EB);
  background: #fff;
  border-radius: 10px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  color: var(--ds-text, #1F2937);
  font-family: inherit;
  transition: all 0.15s ease;
}
.modeBtnActive {
  background: var(--ds-accent, #ff5f1f);
  color: #fff;
  border-color: var(--ds-accent, #ff5f1f);
}

.textarea, .input, .select {
  width: 100%;
  padding: 12px 14px;
  border: 1.5px solid var(--ds-border, #E5E7EB);
  border-radius: 10px;
  font-size: 14px;
  font-family: inherit;
  background: #fff;
  color: var(--ds-text, #1F2937);
  outline: none;
}
.textarea { resize: vertical; min-height: 80px; }
.textarea:focus, .input:focus, .select:focus {
  border-color: var(--ds-accent, #ff5f1f);
}

.fieldGroup {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.fieldLabel {
  font-size: 12px;
  font-weight: 600;
  color: var(--ds-muted, #77736B);
}

.toneRow {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.toneBtn {
  padding: 14px 16px;
  border: 1.5px solid var(--ds-border, #E5E7EB);
  background: #fff;
  border-radius: 10px;
  cursor: pointer;
  font-family: inherit;
  text-align: left;
  transition: all 0.15s ease;
}
.toneBtnActive {
  border-color: var(--ds-accent, #ff5f1f);
  background: rgba(255, 95, 31, 0.04);
}
.toneLabel {
  font-size: 13px;
  font-weight: 700;
  color: var(--ds-text, #1F2937);
  margin-bottom: 4px;
}
.toneDesc {
  font-size: 11px;
  color: var(--ds-muted, #77736B);
  line-height: 1.4;
}

.durationRow {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
}
.durationBtn {
  padding: 12px 8px;
  border: 1.5px solid var(--ds-border, #E5E7EB);
  background: #fff;
  border-radius: 10px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  color: var(--ds-text, #1F2937);
  font-family: inherit;
}
.durationBtnActive {
  border-color: var(--ds-accent, #ff5f1f);
  background: var(--ds-accent, #ff5f1f);
  color: #fff;
}

.error {
  padding: 10px 14px;
  background: rgba(220, 38, 38, 0.08);
  border: 1px solid rgba(220, 38, 38, 0.3);
  border-radius: 8px;
  font-size: 13px;
  color: #DC2626;
}

.nextBtn {
  padding: 16px 24px;
  background: var(--ds-accent, #ff5f1f);
  color: #fff;
  border: none;
  border-radius: 12px;
  font-size: 15px;
  font-weight: 800;
  cursor: pointer;
  font-family: inherit;
  margin-top: 8px;
}
.nextBtn:hover { background: #E64A0F; }
```

- [ ] **Step 3: 빌드 체크**

```bash
npx next build 2>&1 | grep -iE "error|✓ Compiled" | head -5
```

Expected: 컴파일 성공.

- [ ] **Step 4: 커밋**

```bash
git add app/shortform/components/Step1Input.js app/shortform/components/Step1Input.module.css
git commit -m "$(cat <<'EOF'
feat(shortform): Step1Input 입력 폼 컴포넌트

블로그 글 / 키워드 모드 토글 + 경험·느낌 + 화자 페르소나 5종(또는
직접 입력) + 톤 2택 + 영상 길이 4택. 검증 후 onNext() 콜백.
ShortformClient 재구조화에 사용 예정.
EOF
)"
```

---

## Task A4: ShortformClient 재구조화 — Step 1 통합

**Files:**
- Modify: `app/shortform/ShortformClient.js`

기존 ShortformClient는 단일 페이지에 모든 단계가 한꺼번에 표시됨. Step 1만 먼저 새 컴포넌트로 분리하고 나머지는 일단 그대로 유지 (Phase A에서는 Step 1만 새 디자인, Step 2~7은 Phase B 이후 단계적으로 교체).

- [ ] **Step 1: ShortformClient에 currentStep state 추가**

`app/shortform/ShortformClient.js` 상단의 import 섹션에 추가:

```javascript
import StepProgress from '@/components/StepProgress';
import Step1Input from './components/Step1Input';
```

기본 컴포넌트 함수 `export default function ShortformClient()` 내부의 state 정의 부분 (`const [topic, setTopic] = ...` 근처)에 추가:

```javascript
// === Step 1 입력 통합 state (Phase A) ===
const [currentStep, setCurrentStep] = useState(1);
const [step1Value, setStep1Value] = useState({
  contentMode: 'blog',  // 'blog' | 'keyword'
  blogText: '',
  keywords: '',
  userExperience: '',
  persona: '',
  customPersonaLabel: '',
  tone: 'casual',
  durationSec: 45,
});
const [completedSteps, setCompletedSteps] = useState([]);
```

- [ ] **Step 2: blog-writer 핸드오프를 새 state로 변경**

기존 `useEffect`에서 `blogTextForShortform` 처리 부분을 찾아 새 step1Value에 매핑:

```javascript
useEffect(() => {
  try {
    const raw = localStorage.getItem('blogTextForShortform');
    if (raw) {
      localStorage.removeItem('blogTextForShortform');
      const data = JSON.parse(raw);
      setStep1Value((prev) => ({
        ...prev,
        contentMode: 'blog',
        blogText: data.blogText || data.topic || '',
        userExperience: data.memo || '',
      }));
    }
  } catch (_) {}
}, []);
```

- [ ] **Step 3: STEP_LIST 정의**

ShortformClient 함수 외부 (파일 상단 const 영역) 또는 함수 내부 상단에:

```javascript
const STEP_LIST = [
  { id: 1, label: '입력' },
  { id: 2, label: '벤치마킹' },
  { id: 3, label: '대본' },
  { id: 4, label: '음성' },
  { id: 5, label: '비주얼' },
  { id: 6, label: '미리보기' },
  { id: 7, label: '다운로드' },
];
```

- [ ] **Step 4: handleStep1Next 콜백**

```javascript
function handleStep1Next() {
  // step1Value를 기존 state로도 매핑 (역호환성, Phase B/C에서 점진적 제거)
  setTopic(step1Value.contentMode === 'keyword' ? step1Value.keywords : '');
  setMemo(step1Value.userExperience);
  setTone(step1Value.tone === 'casual' ? 'casual' : 'professional');
  setTotalDurationSec(step1Value.durationSec);

  setCompletedSteps((prev) => Array.from(new Set([...prev, 1])));
  setCurrentStep(2);
}

function handleStepClick(stepNum) {
  // 완료된 step만 클릭 가능 (StepProgress 내부에서 이미 검증)
  setCurrentStep(stepNum);
}
```

- [ ] **Step 5: render 분기 — Step 1 새 UI vs Step 2~7 기존 UI**

기존 `return (...)` 의 `<main>` 안에 다음 구조로 변경:

```javascript
return (
  <main className={styles.root}>
    <div className={styles.hero}>
      <div className={styles.heroBadge}>NEW · 숏폼</div>
      <h1>릴스·쇼츠를<br /><em>5분 만에 뚝딱</em></h1>
      <p>주제만 입력하면 AI 대본 + 이미지 + TTS로<br />프리미엄 숏폼 영상을 자동 생성합니다</p>
    </div>

    {/* StepProgress 표시 */}
    <div className={styles.stepProgressWrap}>
      <StepProgress
        steps={STEP_LIST}
        currentStep={currentStep}
        completedSteps={completedSteps}
        onStepClick={handleStepClick}
      />
    </div>

    {/* Step 1: 새 입력 폼 */}
    {currentStep === 1 && (
      <div className={styles.stepContainer}>
        <Step1Input
          value={step1Value}
          onChange={setStep1Value}
          onNext={handleStep1Next}
        />
      </div>
    )}

    {/* Step 2~7: 기존 UI를 임시로 그대로 표시 (Phase B/C에서 단계별 교체) */}
    {currentStep >= 2 && (
      <div className={styles.layout}>
        <div className={styles.left}>
          {/* 기존 .layout > .left 내용 그대로 유지 */}
          {/* (생략: Status, generateScript, generateImages 등 기존 카드들) */}
        </div>
        <div className={styles.right}>
          {/* 기존 .right 내용 그대로 유지 */}
        </div>
      </div>
    )}

    {/* "전체 자동 생성" 버튼 — 페이지 맨 아래로 이동 (Task A6) */}
    {/* 이 위치에는 다음 Task에서 추가 */}
  </main>
);
```

**중요:** 기존 `.layout > .left > .card` 구조는 그대로 유지하되, `currentStep >= 2`일 때만 표시. Step 1 모드에서는 안 보임.

- [ ] **Step 6: 빌드 체크**

```bash
npx next build 2>&1 | grep -iE "error|✓ Compiled|warn.*Shortform" | head -10
```

Expected: 컴파일 성공.

- [ ] **Step 7: 브라우저 수동 검증**

```bash
npm run dev
```

브라우저: http://localhost:3000/shortform

확인:
- [ ] StepProgress 7개 step 표시
- [ ] Step 1 (입력)이 활성 상태
- [ ] Step1Input 폼 표시 (블로그/키워드 토글, 경험·느낌, 페르소나, 톤, 길이)
- [ ] 입력 후 "다음" 클릭 → Step 2로 이동 → 기존 UI 표시
- [ ] StepProgress의 1번이 ✓ 표시 (완료)
- [ ] 1번 클릭하면 Step 1로 돌아감

- [ ] **Step 8: 커밋**

```bash
git add app/shortform/ShortformClient.js
git commit -m "$(cat <<'EOF'
feat(shortform): Step 1 입력 폼 통합 + StepProgress 표시

기존 단일 페이지를 단계형으로 재구조화 (1단계).
- StepProgress 7개 step 시각화
- Step 1: Step1Input 새 컴포넌트 사용
- Step 2~7: 기존 UI 그대로 (currentStep >= 2일 때만 표시)
- blog-writer 핸드오프를 새 step1Value로 매핑

Phase B 이후 Step 2~7도 점진적으로 새 UI로 교체 예정.
EOF
)"
```

---

## Task A5: page.module.css 단계형 스타일 추가

**Files:**
- Modify: `app/shortform/page.module.css`

- [ ] **Step 1: 새 클래스 추가**

`app/shortform/page.module.css` 파일 맨 아래에 추가:

```css
/* === Phase A: Step 진행 표시 === */
.stepProgressWrap {
  max-width: 900px;
  margin: 0 auto;
  padding: 0 20px;
  margin-bottom: 24px;
}

.stepContainer {
  max-width: 720px;
  margin: 0 auto;
  padding: 0 20px 80px;
}
```

- [ ] **Step 2: 빌드 체크**

```bash
npx next build 2>&1 | grep -iE "error|✓ Compiled" | head -5
```

Expected: 컴파일 성공.

- [ ] **Step 3: 커밋**

```bash
git add app/shortform/page.module.css
git commit -m "$(cat <<'EOF'
feat(shortform): 단계형 UI 컨테이너 CSS 추가

stepProgressWrap, stepContainer 클래스. Step 1 입력 폼이 중앙
정렬되도록 max-width 720px.
EOF
)"
```

---

## Task A6: "전체 자동 생성" 버튼 위치 변경

기존 ShortformClient에 있는 "✨ 전체 자동 생성" 또는 유사한 큰 버튼을 페이지 맨 아래로 이동 + 작은 보조 버튼화.

**Files:**
- Modify: `app/shortform/ShortformClient.js`

- [ ] **Step 1: 기존 runAll 버튼 위치 확인**

```bash
grep -n "runAll\|전체.*생성" /Users/gong-eunhui/Desktop/naver-title-generator/app/shortform/ShortformClient.js
```

Expected: 기존 위치 식별.

- [ ] **Step 2: 기존 runAll 큰 버튼 제거**

기존 `<button onClick={runAll} className={styles.runAllBtn}>전체 자동 생성</button>` (또는 유사 코드)를 찾아 **삭제**.

- [ ] **Step 3: 페이지 맨 아래에 작은 버튼 추가**

`</main>` 직전에 추가:

```javascript
{currentStep < 7 && (
  <div className={styles.skipFooter}>
    <button
      type="button"
      className={styles.skipBtn}
      onClick={runAll}
    >
      한 번에 자동 생성 (벤치마킹·세부조정 없이 빠른 모드)
    </button>
    <p className={styles.skipHint}>
      바쁘시면 단계별 진행 없이 한 번에 영상을 만들 수 있어요. 다만 결과 품질은 단계 진행보다 낮습니다.
    </p>
  </div>
)}
```

- [ ] **Step 4: CSS 추가 (page.module.css 맨 아래)**

```css
/* === Phase A: skip footer === */
.skipFooter {
  max-width: 600px;
  margin: 60px auto 40px;
  padding: 0 20px;
  text-align: center;
}

.skipBtn {
  padding: 12px 24px;
  background: transparent;
  color: var(--ds-muted, #77736B);
  border: 1.5px dashed var(--ds-border, #E5E7EB);
  border-radius: 10px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  font-family: inherit;
}
.skipBtn:hover {
  border-color: var(--ds-muted, #77736B);
  color: var(--ds-text, #1F2937);
}

.skipHint {
  font-size: 11px;
  color: var(--ds-muted, #77736B);
  margin-top: 8px;
  line-height: 1.5;
}
```

- [ ] **Step 5: 빌드 체크**

```bash
npx next build 2>&1 | grep -iE "error|✓ Compiled" | head -5
```

Expected: 컴파일 성공.

- [ ] **Step 6: 브라우저 검증**

브라우저에서 /shortform 새로고침:
- [ ] 메인 영역에 더 이상 큰 "전체 생성" 버튼 없음
- [ ] 페이지 맨 아래에 작은 점선 테두리 보조 버튼 표시
- [ ] 클릭 시 기존 runAll() 동작 (스크립트/이미지/TTS 순차 생성)

- [ ] **Step 7: 커밋**

```bash
git add app/shortform/ShortformClient.js app/shortform/page.module.css
git commit -m "$(cat <<'EOF'
feat(shortform): '전체 자동 생성' 버튼 페이지 맨 아래로 이동

기존 메인 영역의 큰 주황 버튼 제거. 페이지 맨 아래에 작은 보조
버튼('한 번에 자동 생성')으로 변경. 단계형 진행이 디폴트, 자동
생성은 폴백 옵션.

자영업자 사용자 흐름:
- 디폴트: Step 1~7 진행 (벤치마킹+세부 조정으로 품질 최대)
- 빠른 모드: 보조 버튼 (벤치마킹 스킵)
EOF
)"
```

---

## Task A7: 회귀 검증 — 기존 사용자 영향 0

Phase A 작업이 기존 숏폼 사용자 흐름을 깨뜨리지 않는지 확인.

- [ ] **Step 1: 기존 흐름 수동 테스트**

브라우저 /shortform:

- [ ] 새 사용자 흐름:
  - Step 1 입력 → 다음 → Step 2 (기존 UI 표시)
  - 기존 카드 (대본 생성/이미지 생성/TTS) 정상 작동 확인
- [ ] StepProgress 클릭 이동 동작:
  - Step 1 완료 후 Step 1 클릭 → 다시 Step 1로 돌아감 (내용 보존)
- [ ] localStorage 핸드오프:
  - 다른 탭에서 `localStorage.setItem('blogTextForShortform', JSON.stringify({blogText: '테스트 100자 이상...'}))` → /shortform 접속 → blogText 자동 입력 확인
- [ ] 빠른 모드 보조 버튼:
  - 페이지 맨 아래 버튼 클릭 → runAll() 동작 → 기존과 동일 결과
- [ ] 모바일 반응형:
  - DevTools 모바일 모드 → StepProgress가 깨지지 않는지

- [ ] **Step 2: 빌드 + 린트 최종 체크**

```bash
npx next build 2>&1 | tail -30
```

Expected: `✓ Compiled successfully` + 모든 페이지 정적/동적 생성 정상.

- [ ] **Step 3: 회귀 결과 메모**

회귀 시나리오에서 발견한 이슈가 있다면 commit message에 명시. 없으면 다음 task 진행.

---

## Task A8: 메모리 + 마스터 플랜 업데이트

**Files:**
- Modify: `~/.claude/projects/-Users-gong-eunhui-Desktop-naver-title-generator/memory/MEMORY.md`
- Create: `~/.claude/projects/-Users-gong-eunhui-Desktop-naver-title-generator/memory/project_shortform_phase_a_complete.md`

- [ ] **Step 1: 메모리 파일 작성**

```markdown
---
name: 숏폼 Phase A 완료
description: UI 동선 + Step 1 입력 폼 (단계형 동선 베이스)
type: project
---

# 숏폼 Phase A 완료

**완료일:** 2026-04-XX
**브랜치:** feat/shortform-v2 (또는 별도 브랜치)
**스펙:** docs/superpowers/specs/2026-04-14-shortform-benchmark-pipeline-design.md
**플랜:** docs/superpowers/plans/2026-04-14-shortform-phase-a-foundation.md

## 핵심 변경

- ShortformClient.js 단계형 재구조화 (Step 1만 새 UI, Step 2~7은 기존 UI 임시 유지)
- StepProgress 공용 컴포넌트 신설
- Step1Input 입력 폼 (블로그 글/키워드 토글 + 경험·느낌 + 페르소나 5종 + 톤 2택 + 길이 4택)
- "전체 자동 생성" 버튼 → 페이지 맨 아래 작은 보조 버튼으로 이동
- shortform-personas.js 페르소나 5종 정의

## 신규 파일

- components/StepProgress.js + .module.css
- app/shortform/components/Step1Input.js + .module.css
- lib/shortform-personas.js

## 의존성 추가

- genkit, @genkit-ai/vertexai, @genkit-ai/google-cloud, zod (Phase B/D/F/I 사전 준비)

## 다음 Phase

Phase B (벤치마킹) — Genkit 도입, 5쿼리 병렬 검색, Gemini 2.5 Pro 영상 분석
```

- [ ] **Step 2: MEMORY.md에 한 줄 추가**

`~/.claude/projects/-Users-gong-eunhui-Desktop-naver-title-generator/memory/MEMORY.md` 의 "최근 세션" 섹션 위쪽에 추가:

```markdown
- [4/XX 숏폼 Phase A 완료](project_shortform_phase_a_complete.md) — 단계형 동선 + Step 1 입력 폼
```

- [ ] **Step 3: 마스터 플랜에서 Phase A 상태 업데이트**

`docs/superpowers/plans/2026-04-14-shortform-master-plan.md`의 Phase A 섹션 끝에 표시:

```markdown
**상태:** ✅ 완료 (커밋 SHA: XXXXXXX)
```

- [ ] **Step 4: 최종 커밋**

```bash
git add docs/superpowers/plans/2026-04-14-shortform-master-plan.md
git commit -m "$(cat <<'EOF'
docs: Phase A 완료 마킹 + 메모리 기록

Phase A (Foundation: UI 동선 + Step 1 입력) 완료.
Phase B 진입 가능.
EOF
)"
```

---

## Phase A 자기 검토

### Spec coverage

| 스펙 섹션 | 커버 task |
|---|---|
| §4 Step 1 — 입력 (한 화면) | A3 (Step1Input 컴포넌트) |
| §4 — 페르소나 5종 | A1 (lib/shortform-personas.js) |
| §13 UI 동선 — "전체 자동 생성" 위치 | A6 |
| Genkit 사전 준비 | A0 |

### 알려진 미완 (다음 Phase)

- Step 2~7 새 UI는 Phase B/C/D 이후 단계적 교체
- 기존 ShortformClient의 모든 카드(대본/이미지/TTS)는 임시로 유지
- 자동 저장 (Phase C)
- 진행률 표시 (Phase I)

### 통합 지점

다음 Phase가 사용할 인터페이스:
- **Phase B**: `step1Value.blogText`, `step1Value.keywords`, `step1Value.contentMode` 사용해 키워드 추출
- **Phase C**: `step1Value` 전체를 draft로 자동 저장
- **Phase D**: `step1Value.persona`, `step1Value.tone`, `step1Value.userExperience` 사용해 대본 작성

### 회귀 안전성

- 기존 ShortformClient state (topic/memo/tone/totalDurationSec)는 그대로 유지
- handleStep1Next에서 step1Value → 기존 state로 매핑 (역호환)
- runAll() 등 기존 함수 무변경
- 빠른 모드 보조 버튼으로 기존 사용자 흐름 보존

---

## Phase A 완료 후 다음 단계

이 Phase 완료 시 마스터 플랜의 Phase B (Benchmarking + Genkit) 상세 플랜 작성으로 진행.
