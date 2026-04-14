# Phase E — Image Library: Step 5 비주얼 액센트 (사진 보관함 연결)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. 12 Phase 중 Phase E. 마스터 플랜: `2026-04-14-shortform-master-plan.md`. 스펙: `2026-04-14-shortform-benchmark-pipeline-design.md` (§4 Step 5).

**Goal:** Step 5 "비주얼 액센트" UI를 추가해 사용자가 내 사진 보관함에서 0~3장 + AI 이미지 0~2장을 선택할 수 있게 한다. 카드뉴스에서 이미 구현된 `<ImagePickerModal>` (514줄)을 **절대 다시 만들지 않고** 그대로 재사용한다.

**Architecture:**
- 카드뉴스는 카드별 이미지(배경/콘텐츠/표지 3개 모드)였으나, 숏폼은 **모드 구분 없이 액센트로만 삽입**. 따라서 `modeOptions={['content']}` (길이 1) 패턴을 써서 기존 모드 선택 UI를 자동 숨김. 추가로 explicit한 `showModeSelector` prop을 넣어 의도를 명시.
- AI 이미지 생성은 기존 `runAll()`의 `generateImages()` 로직을 Step 5에서 분리해 독립 실행 가능하도록 정리. API는 동일한 `/api/blog-image-pro` + `mode: 'direct'` 재사용.
- 선택된 이미지는 `step5Value = { userPhotos: [{image, crop}...], aiImageCount: 0|1|2, aiImages: [url...] }` 형태로 ShortformClient state에 저장되고, `scriptToProps()`의 `bodyImages` 인자로 이미 넘어가는 경로를 그대로 활용한다.

**Tech Stack:** Next.js 15 App Router, React useState/useEffect, 기존 컴포넌트 재사용 (ImagePickerModal, react-easy-crop)

**의존성:** Phase A 완료 필수 (step-machine 패턴 + StepProgress + ShortformClient 재구조화). Phase B/C/D와 병렬 진행 가능 (step1Value만 읽고 독립 동작).

**예상 작업량:** 8 task, 1 주

---

## 파일 구조

### 신규 파일

```
app/shortform/components/Step5VisualAccent.js        Step 5 메인 UI (사진 + AI 이미지 선택)
app/shortform/components/Step5VisualAccent.module.css
```

### 수정 파일

```
components/ImagePickerModal.js                       showModeSelector prop 추가 (소규모)
app/shortform/ShortformClient.js                     Step 5 섹션 conditional render + state 관리
```

### 재사용 파일 (읽기만)

```
components/ImagePickerModal.js                       514줄 공용 컴포넌트
lib/auth.js                                          getToken()
app/api/my-images/route.js                           GET/POST/DELETE 보관함 API
app/api/blog-image-pro/route.js                      mode: 'direct' 재사용
```

---

## Task E0: ImagePickerModal에 showModeSelector prop 추가

기존 `ImagePickerModal`은 `modeOptions.length > 1` 조건으로 모드 선택 UI를 gate하고 있음 (155줄). 숏폼에서는 `modeOptions={['content']}`만 넘겨도 자동 숨겨지지만, 의도를 명확히 하기 위해 `showModeSelector` 옵션을 추가해 두 조건 중 하나라도 false면 숨기도록 한다.

**Files:**
- Modify: `components/ImagePickerModal.js`

- [ ] **Step 1: prop 시그니처 확장**

`components/ImagePickerModal.js` 23~30줄 (현재 props 블록):

```javascript
export default function ImagePickerModal({
  open,
  onClose,
  onSelect,
  modeOptions = ['background', 'content', 'cover'],
  defaultMode = 'content',
  aspectRatio = 4 / 5,
  showModeSelector = true,
}) {
```

- [ ] **Step 2: gate 조건 변경**

`components/ImagePickerModal.js` 155줄 (`{modeOptions.length > 1 && (` 블록):

```javascript
{showModeSelector && modeOptions.length > 1 && (
  <div className={styles.modeRow}>
    ...
  </div>
)}
```

- [ ] **Step 3: JSDoc 주석 갱신**

14~22줄 주석 블록에 한 줄 추가:

```javascript
/**
 * Props:
 * - open: boolean
 * - onClose: () => void
 * - onSelect: ({ image, crop, mode }) => void
 * - modeOptions?: Array<'background'|'content'|'cover'>
 * - defaultMode?: string
 * - aspectRatio?: number  (예: 4/5, 9/16)
 * - showModeSelector?: boolean  (기본 true. false면 모드 선택 UI 강제 숨김)
 */
```

- [ ] **Step 4: 회귀 — 카드뉴스 기존 사용 지점 확인**

`app/card-news/CardNewsClient.js`에서 `showModeSelector`를 명시하지 않으므로 기본값 `true` + 기존 `modeOptions.length > 1` 조건이 만족되어 카드뉴스 흐름은 무변경. 브라우저 `/card-news` 접속 → 카드 클릭 시 모드 선택 3개(배경/콘텐츠/표지) 그대로 표시되는지 확인.

- [ ] **Step 5: 빌드**

```bash
cd /Users/gong-eunhui/Desktop/naver-title-generator
npx next build 2>&1 | grep -iE "error|✓ Compiled" | head -5
```

Expected: `✓ Compiled successfully`.

- [ ] **Step 6: 커밋**

```bash
git add components/ImagePickerModal.js
git commit -m "$(cat <<'EOF'
feat(ImagePickerModal): showModeSelector prop 추가 (숏폼 재사용 대비)

카드뉴스는 배경/콘텐츠/표지 3개 모드 선택이 필요하지만 숏폼 Step 5는
액센트로만 삽입되므로 모드 구분이 불필요. showModeSelector=false로
명시적으로 끌 수 있게 gate 조건을 확장.

기존 동작 무변경 (기본값 true). 카드뉴스 흐름 회귀 확인 완료.
EOF
)"
```

---

## Task E1: Step5VisualAccent 컴포넌트 신설

Step 5의 메인 UI. 사용자 사진 섹션(최대 3장) + AI 이미지 섹션(0~2장 라디오) + 다음 버튼.

**Files:**
- Create: `app/shortform/components/Step5VisualAccent.js`
- Create: `app/shortform/components/Step5VisualAccent.module.css`

- [ ] **Step 1: 컴포넌트 뼈대 작성**

```javascript
// app/shortform/components/Step5VisualAccent.js
'use client';

import { useState } from 'react';
import ImagePickerModal from '@/components/ImagePickerModal';
import styles from './Step5VisualAccent.module.css';

const MAX_USER_PHOTOS = 3;

/**
 * Step 5 — 비주얼 액센트
 *
 * Props:
 * - value: { userPhotos: Array<{image, crop}>, aiImageCount: 0|1|2, aiImages: string[] }
 * - onChange: (nextValue) => void
 * - onGenerateAI: (count) => Promise<string[]>  // blog-image-pro 호출
 * - aiStatus: 'idle' | 'busy' | 'done' | 'error'
 * - onNext: () => void
 * - onBack?: () => void
 */
export default function Step5VisualAccent({
  value,
  onChange,
  onGenerateAI,
  aiStatus = 'idle',
  onNext,
  onBack,
}) {
  const [pickerOpen, setPickerOpen] = useState(false);

  const userPhotos = value?.userPhotos || [];
  const aiImageCount = value?.aiImageCount ?? 1;
  const aiImages = value?.aiImages || [];

  function addUserPhoto(payload) {
    if (userPhotos.length >= MAX_USER_PHOTOS) return;
    onChange({
      ...value,
      userPhotos: [...userPhotos, payload],
    });
  }

  function removeUserPhoto(idx) {
    const next = userPhotos.filter((_, i) => i !== idx);
    onChange({ ...value, userPhotos: next });
  }

  function setAiCount(count) {
    onChange({ ...value, aiImageCount: count });
  }

  async function handleGenerateAI() {
    if (aiImageCount === 0) return;
    try {
      const urls = await onGenerateAI(aiImageCount);
      onChange({ ...value, aiImages: urls });
    } catch (_) {
      // 에러는 부모에서 상태로 표시
    }
  }

  const photoSlotCount = MAX_USER_PHOTOS;

  return (
    <div className={styles.root}>
      <div className={styles.intro}>
        <h2 className={styles.title}>비주얼 액센트</h2>
        <p className={styles.description}>
          메인 영상은 키네틱 타이포로 자동 생성돼요.<br />
          핵심 순간에 사진/이미지를 양념으로 추가하면 더 풍성해져요.
          <br /><span className={styles.hint}>(선택 사항 — 건너뛰어도 좋아요)</span>
        </p>
      </div>

      {/* 내 사진 섹션 */}
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h3 className={styles.sectionTitle}>
            내 사진 <span className={styles.counter}>{userPhotos.length}/{MAX_USER_PHOTOS}장</span>
          </h3>
          <p className={styles.sectionHint}>
            추천: 매장 사진, 본인 사진, 메뉴/상품 사진
          </p>
        </div>

        <div className={styles.photoGrid}>
          {Array.from({ length: photoSlotCount }).map((_, i) => {
            const photo = userPhotos[i];
            if (photo) {
              return (
                <div key={i} className={styles.photoTile}>
                  <img src={photo.image.public_url} alt={photo.image.filename} />
                  <button
                    type="button"
                    className={styles.removeBtn}
                    onClick={() => removeUserPhoto(i)}
                    aria-label="삭제"
                  >×</button>
                </div>
              );
            }
            return (
              <button
                key={i}
                type="button"
                className={styles.addSlot}
                onClick={() => setPickerOpen(true)}
                disabled={userPhotos.length >= MAX_USER_PHOTOS}
              >
                <span className={styles.addIcon}>+</span>
                <span className={styles.addLabel}>사진 선택</span>
              </button>
            );
          })}
        </div>

        {userPhotos.length === 0 && (
          <div className={styles.emptyNote}>
            아직 선택한 사진이 없어요. 건너뛰면 AI 이미지만 사용돼요.
          </div>
        )}
      </section>

      {/* AI 이미지 섹션 */}
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h3 className={styles.sectionTitle}>AI 이미지 (자동 생성)</h3>
          <p className={styles.sectionHint}>
            사진이 부족할 때 주제에 맞는 이미지를 자동으로 그려드려요.
          </p>
        </div>

        <div className={styles.radioRow}>
          {[
            { value: 0, label: '사용 안 함', meta: '' },
            { value: 1, label: '1장 생성', meta: '3 크레딧' },
            { value: 2, label: '2장 생성', meta: '6 크레딧' },
          ].map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={`${styles.radioBtn} ${aiImageCount === opt.value ? styles.radioBtnActive : ''}`}
              onClick={() => setAiCount(opt.value)}
            >
              <span className={styles.radioDot} />
              <span className={styles.radioLabel}>{opt.label}</span>
              {opt.meta && <span className={styles.radioMeta}>{opt.meta}</span>}
            </button>
          ))}
        </div>

        {aiImageCount > 0 && aiImages.length === 0 && (
          <button
            type="button"
            className={styles.generateBtn}
            onClick={handleGenerateAI}
            disabled={aiStatus === 'busy'}
          >
            {aiStatus === 'busy' ? 'AI 이미지 생성 중...' : `AI 이미지 ${aiImageCount}장 생성하기`}
          </button>
        )}

        {aiImages.length > 0 && (
          <div className={styles.aiPreviewRow}>
            {aiImages.map((url, i) => (
              <div key={i} className={styles.aiPreviewTile}>
                <img src={url} alt={`AI 이미지 ${i + 1}`} />
              </div>
            ))}
            <button
              type="button"
              className={styles.regenerateBtn}
              onClick={() => onChange({ ...value, aiImages: [] })}
            >
              다시 생성
            </button>
          </div>
        )}
      </section>

      {/* 네비게이션 */}
      <div className={styles.navRow}>
        {onBack && (
          <button type="button" className={styles.backBtn} onClick={onBack}>
            ← 이전
          </button>
        )}
        <button type="button" className={styles.nextBtn} onClick={onNext}>
          다음: 미리보기 →
        </button>
      </div>

      <ImagePickerModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        modeOptions={['content']}
        showModeSelector={false}
        defaultMode="content"
        aspectRatio={9 / 16}
        onSelect={({ image, crop }) => {
          addUserPhoto({ image, crop });
        }}
      />
    </div>
  );
}
```

- [ ] **Step 2: CSS 작성**

```css
/* app/shortform/components/Step5VisualAccent.module.css */
.root {
  max-width: 720px;
  margin: 0 auto;
  padding: 24px 16px 80px;
  display: flex;
  flex-direction: column;
  gap: 32px;
}

.intro {
  text-align: center;
}

.title {
  font-size: 24px;
  font-weight: 700;
  color: var(--ds-text-primary, #111);
  margin: 0 0 8px;
}

.description {
  font-size: 14px;
  line-height: 1.6;
  color: var(--ds-text-secondary, #6b7280);
  margin: 0;
}

.hint {
  color: var(--ds-text-muted, #9ca3af);
  font-size: 13px;
}

.section {
  background: var(--ds-surface, #fff);
  border: 1px solid var(--ds-border, #e5e7eb);
  border-radius: 16px;
  padding: 20px;
}

.sectionHeader {
  margin-bottom: 16px;
}

.sectionTitle {
  font-size: 16px;
  font-weight: 600;
  color: var(--ds-text-primary, #111);
  margin: 0 0 4px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.counter {
  font-size: 13px;
  font-weight: 500;
  color: var(--ds-text-secondary, #6b7280);
}

.sectionHint {
  font-size: 13px;
  color: var(--ds-text-muted, #9ca3af);
  margin: 0;
}

.photoGrid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
}

.photoTile {
  position: relative;
  aspect-ratio: 9 / 16;
  border-radius: 12px;
  overflow: hidden;
  background: #f3f4f6;
}

.photoTile img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.removeBtn {
  position: absolute;
  top: 6px;
  right: 6px;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.6);
  color: #fff;
  border: none;
  font-size: 16px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}

.addSlot {
  aspect-ratio: 9 / 16;
  border: 2px dashed var(--ds-border, #d1d5db);
  border-radius: 12px;
  background: transparent;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  color: var(--ds-text-secondary, #6b7280);
  transition: border-color 0.15s, background 0.15s;
}

.addSlot:hover:not(:disabled) {
  border-color: var(--ds-accent, #ff5f1f);
  background: rgba(255, 95, 31, 0.04);
}

.addSlot:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.addIcon {
  font-size: 28px;
  font-weight: 300;
}

.addLabel {
  font-size: 12px;
}

.emptyNote {
  margin-top: 12px;
  padding: 12px 14px;
  background: #f9fafb;
  border-radius: 8px;
  font-size: 13px;
  color: var(--ds-text-secondary, #6b7280);
  text-align: center;
}

.radioRow {
  display: flex;
  gap: 8px;
  margin-bottom: 16px;
}

.radioBtn {
  flex: 1;
  padding: 12px;
  background: #fff;
  border: 1.5px solid var(--ds-border, #e5e7eb);
  border-radius: 10px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  transition: all 0.15s;
}

.radioBtnActive {
  border-color: var(--ds-accent, #ff5f1f);
  background: rgba(255, 95, 31, 0.04);
}

.radioDot {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 2px solid var(--ds-border, #d1d5db);
}

.radioBtnActive .radioDot {
  border-color: var(--ds-accent, #ff5f1f);
  background: var(--ds-accent, #ff5f1f);
  box-shadow: inset 0 0 0 3px #fff;
}

.radioLabel {
  font-size: 14px;
  font-weight: 600;
  color: var(--ds-text-primary, #111);
}

.radioMeta {
  font-size: 11px;
  color: var(--ds-text-muted, #9ca3af);
}

.generateBtn {
  width: 100%;
  padding: 14px;
  background: var(--ds-accent, #ff5f1f);
  color: #fff;
  border: none;
  border-radius: 10px;
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
}

.generateBtn:disabled {
  background: #d1d5db;
  cursor: not-allowed;
}

.aiPreviewRow {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  flex-wrap: wrap;
}

.aiPreviewTile {
  width: 120px;
  aspect-ratio: 9 / 16;
  border-radius: 10px;
  overflow: hidden;
  background: #f3f4f6;
}

.aiPreviewTile img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.regenerateBtn {
  padding: 8px 14px;
  background: #fff;
  border: 1px solid var(--ds-border, #e5e7eb);
  border-radius: 8px;
  font-size: 13px;
  color: var(--ds-text-secondary, #6b7280);
  cursor: pointer;
  align-self: center;
}

.navRow {
  display: flex;
  gap: 12px;
  margin-top: 16px;
}

.backBtn {
  flex: 0 0 auto;
  padding: 14px 24px;
  background: #fff;
  border: 1px solid var(--ds-border, #e5e7eb);
  border-radius: 10px;
  font-size: 14px;
  font-weight: 500;
  color: var(--ds-text-primary, #111);
  cursor: pointer;
}

.nextBtn {
  flex: 1;
  padding: 14px 24px;
  background: var(--ds-accent, #ff5f1f);
  color: #fff;
  border: none;
  border-radius: 10px;
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
}
```

- [ ] **Step 3: 빌드**

```bash
npx next build 2>&1 | grep -iE "error|✓ Compiled" | head -5
```

Expected: 컴파일 성공.

- [ ] **Step 4: 커밋**

```bash
git add app/shortform/components/Step5VisualAccent.js app/shortform/components/Step5VisualAccent.module.css
git commit -m "$(cat <<'EOF'
feat(shortform): Step5VisualAccent 컴포넌트 신설

내 사진 최대 3장 + AI 이미지 0~2장 선택 UI. ImagePickerModal을
showModeSelector=false로 재사용. 빈 상태 UI + 스킵 안내 메시지 포함.

다음 task에서 ShortformClient 통합.
EOF
)"
```

---

## Task E2: ShortformClient에 step5Value state + 렌더 통합

Phase A에서 만든 step-machine에 Step 5를 끼워 넣는다. state 이름은 Phase A 규칙에 따라 `step5Value`로 일관.

**Files:**
- Modify: `app/shortform/ShortformClient.js`

- [ ] **Step 1: state 추가**

ShortformClient 컴포넌트 본문 (기존 state 선언부, Phase A에서 `currentStep`, `step1Value` 등이 추가된 지점) 바로 아래:

```javascript
// Step 5 — 비주얼 액센트
const [step5Value, setStep5Value] = useState({
  userPhotos: [],    // [{image, crop}]
  aiImageCount: 1,   // 0 | 1 | 2
  aiImages: [],      // [url]
});
const [aiImageGenStatus, setAiImageGenStatus] = useState('idle');
```

- [ ] **Step 2: AI 이미지 생성 핸들러 정리**

기존 `generateImages()` 함수(205줄 근처)를 Step5 전용으로 분리된 핸들러로 리팩토링. 기존 함수는 보조 모드(`runAll`)에서 계속 호출되므로 남겨두되, Step5는 별도 경로로.

```javascript
/**
 * Step 5 — AI 이미지 생성 핸들러
 * 기존 generateImages()와 달리 count 지정 가능 + Promise<string[]> 반환
 */
async function generateAiImagesForStep5(count) {
  setAiImageGenStatus('busy');
  try {
    const token = getToken();
    if (!token) {
      alert('로그인이 필요합니다.');
      router.push('/login');
      setAiImageGenStatus('error');
      return [];
    }
    const topic = step1Value?.topic || topic || '';
    const res = await fetch('/api/blog-image-pro', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        mode: 'direct',
        topic,
        mood: 'emotional',
        count,  // 서버가 count 지원 시 사용. 미지원이면 slice로 자른다.
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '이미지 생성 실패');
    const urls = (data.images || [])
      .slice(0, count)
      .map((img) => img.r2Url || img.url)
      .filter(Boolean);
    setAiImageGenStatus('done');
    return urls;
  } catch (err) {
    setError(err.message || '이미지 생성 중 오류');
    setAiImageGenStatus('error');
    return [];
  }
}
```

- [ ] **Step 3: Step 5 conditional render 추가**

ShortformClient의 step-machine render 블록에 케이스 추가 (Phase A의 `currentStep === 1` 패턴 따라):

```javascript
{currentStep === 5 && (
  <Step5VisualAccent
    value={step5Value}
    onChange={setStep5Value}
    onGenerateAI={generateAiImagesForStep5}
    aiStatus={aiImageGenStatus}
    onBack={() => setCurrentStep(4)}
    onNext={() => setCurrentStep(6)}
  />
)}
```

- [ ] **Step 4: import 추가**

파일 상단에:

```javascript
import Step5VisualAccent from './components/Step5VisualAccent';
```

- [ ] **Step 5: 빌드**

```bash
npx next build 2>&1 | grep -iE "error|✓ Compiled" | head -10
```

Expected: 컴파일 성공. unused import warning 0건.

- [ ] **Step 6: 커밋**

```bash
git add app/shortform/ShortformClient.js
git commit -m "$(cat <<'EOF'
feat(shortform): Step 5 step-machine 통합 + AI 이미지 핸들러 분리

- step5Value state 추가 (userPhotos / aiImageCount / aiImages)
- generateAiImagesForStep5: count 지정 가능 + Promise 반환
- currentStep === 5 케이스 render
- 기존 generateImages() 유지 (runAll 보조 모드용)
EOF
)"
```

---

## Task E3: scriptToProps가 사용자 사진을 우선 사용하도록 확장

현재 `scriptToProps()`는 `bodyImages` 배열만 보고 `[0]`, `[1]`을 사용. 사용자 사진이 있으면 그것부터 쓰고, 부족하면 AI 이미지로 메우는 우선순위 로직을 추가.

**Files:**
- Modify: `app/shortform/ShortformClient.js` (scriptToProps + 호출부)

- [ ] **Step 1: 이미지 병합 헬퍼 작성**

scriptToProps 바로 위에 추가:

```javascript
/**
 * Step 5 값 → 이미지 URL 배열로 병합
 * 우선순위: 사용자 사진 → AI 이미지
 * 최종 길이는 훅 1장 + 바디 1장 = 2장 이내에서 사용됨.
 */
function mergeShortformImages(step5) {
  if (!step5) return [];
  const userUrls = (step5.userPhotos || [])
    .map((p) => p.image?.public_url)
    .filter(Boolean);
  const aiUrls = step5.aiImages || [];
  return [...userUrls, ...aiUrls];
}
```

- [ ] **Step 2: playerProps 계산부 수정**

기존:
```javascript
const playerProps = useMemo(() => {
  if (!script) return null;
  return scriptToProps(script, presetKey, totalDurationSec, images);
}, [script, presetKey, totalDurationSec, images]);
```

변경:
```javascript
const mergedImages = useMemo(
  () => mergeShortformImages(step5Value),
  [step5Value],
);

const playerProps = useMemo(() => {
  if (!script) return null;
  // Step 5에서 사용자가 선택한 이미지가 있으면 우선. 빈 배열이면 기존 images(runAll 경로) 폴백.
  const bodyImages = mergedImages.length > 0 ? mergedImages : images;
  return scriptToProps(script, presetKey, totalDurationSec, bodyImages);
}, [script, presetKey, totalDurationSec, images, mergedImages]);
```

- [ ] **Step 3: 빌드**

```bash
npx next build 2>&1 | grep -iE "error|✓ Compiled" | head -5
```

Expected: 컴파일 성공.

- [ ] **Step 4: 커밋**

```bash
git add app/shortform/ShortformClient.js
git commit -m "$(cat <<'EOF'
feat(shortform): Step 5 사진 → Remotion props 전달 경로

mergeShortformImages(): 사용자 사진 우선, AI 이미지 후순위.
playerProps.body/hook.imageUrl에 자동 반영되어 미리보기에 즉시 표시.
기존 runAll() 경로는 step5 값이 비어있을 때만 image state 사용.
EOF
)"
```

---

## Task E4: Step 5 ↔ Step 1 연동 (navigation)

Phase A에서 만든 `handleStep1Next()`는 Step 2로 넘어가는 흐름. Phase B/C/D가 아직 없는 시점에서는 Step 5로 바로 점프해 독립 테스트 가능하게 한다.

**Files:**
- Modify: `app/shortform/ShortformClient.js`

- [ ] **Step 1: 임시 점프 경로 — Phase A 시점 호환**

Phase A가 Step 2~7은 기존 UI를 유지한다고 했으므로, Step 5 전용 "바로 가기" 버튼을 Step 1 하단에 임시로 배치. Phase D 완료 시 제거 대상.

`Step1Input` 완료 후 `setCurrentStep(2)`로 가는 기존 흐름은 유지하되, 개발/테스트 편의용으로 ShortformClient 페이지 맨 아래 (기존 "빠른 모드 보조 버튼" 옆) 추가:

```javascript
{currentStep !== 5 && script && (
  <button
    type="button"
    className={styles.skipToStep5Btn}
    onClick={() => setCurrentStep(5)}
  >
    Step 5 (사진 액센트)로 바로 가기 →
  </button>
)}
```

`.skipToStep5Btn` 스타일은 기존 보조 버튼과 동일한 톤 (회색 텍스트, 작은 폰트).

- [ ] **Step 2: page.module.css 보조 버튼 스타일 추가**

```css
/* app/shortform/page.module.css */
.skipToStep5Btn {
  display: block;
  margin: 16px auto 0;
  padding: 8px 14px;
  background: transparent;
  border: 1px dashed #d1d5db;
  border-radius: 8px;
  font-size: 12px;
  color: #6b7280;
  cursor: pointer;
}

.skipToStep5Btn:hover {
  color: var(--ds-accent, #ff5f1f);
  border-color: var(--ds-accent, #ff5f1f);
}
```

- [ ] **Step 3: 빌드**

```bash
npx next build 2>&1 | grep -iE "error|✓ Compiled" | head -5
```

- [ ] **Step 4: 커밋**

```bash
git add app/shortform/ShortformClient.js app/shortform/page.module.css
git commit -m "$(cat <<'EOF'
feat(shortform): Step 5 임시 점프 버튼 (Phase D 완료 전 독립 테스트용)

Phase D가 아직 없어 Step 2~4가 비어 있는 상태. 대본 생성 완료 후
Step 5로 바로 이동할 수 있는 보조 버튼 추가. Phase D 머지 시
이 task의 diff는 제거 예정.
EOF
)"
```

---

## Task E5: 빈 상태 처리 + 사용자 안내 카피 다듬기

스펙이 강조하는 원칙: **사진은 20% 이내 액센트, 강요하지 않는다**. 따라서 빈 상태에서도 "반드시 채워야" 하는 인상을 주지 않도록 카피를 점검.

**Files:**
- Modify: `app/shortform/components/Step5VisualAccent.js` (카피 문구만)

- [ ] **Step 1: 카피 최종안 확정**

`intro.description` 최종:
```
메인 영상은 키네틱 타이포로 만들어져요.
핵심 순간에만 사진 1~2장을 얹으면 결과물이 한 단계 올라갑니다.
(없어도 괜찮아요 — 그냥 다음으로 넘어가셔도 돼요)
```

`emptyNote` 최종:
```
사진이 없어도 괜찮아요. AI 이미지만으로도 충분히 영상이 만들어져요.
```

AI 섹션 `sectionHint` 최종:
```
사진이 없거나 부족할 때 주제에 맞는 이미지를 자동으로 그려드려요.
기본값 1장 권장.
```

- [ ] **Step 2: 빌드 + 수동 확인**

```bash
npx next build 2>&1 | grep -iE "error|✓ Compiled" | head -5
```

브라우저 `/shortform` → 보조 점프 버튼으로 Step 5 진입 → 빈 상태 카피가 "다음으로 넘어가도 괜찮음"을 명확히 전달하는지 확인.

- [ ] **Step 3: 커밋**

```bash
git add app/shortform/components/Step5VisualAccent.js
git commit -m "$(cat <<'EOF'
copy(shortform): Step 5 카피 다듬기 — 사진 강요하지 않기

스펙 원칙: 사진은 20% 이내 액센트. 빈 상태 카피를 "없어도 괜찮아요"
톤으로 정리. AI 이미지 섹션도 "권장" 표현만 유지.
EOF
)"
```

---

## Task E6: 회귀 검증 — 카드뉴스 + 숏폼 독립 동작

**Files:** (수동 검증만)

- [ ] **Step 1: 카드뉴스 회귀**

브라우저 `/card-news`:
- [ ] 로그인 후 카드뉴스 생성 → 각 카드의 📷 버튼 클릭 → ImagePickerModal 열림
- [ ] 모드 선택(배경/콘텐츠/표지) 3개 버튼 그대로 표시
- [ ] 이미지 선택 + 크롭 + 적용 → 카드에 반영되는지

- [ ] **Step 2: 숏폼 Step 5 동작**

브라우저 `/shortform`:
- [ ] Step 1 입력 → 보조 버튼으로 Step 5 이동
- [ ] 사진 슬롯 클릭 → ImagePickerModal 열림 (모드 선택 UI **없음**)
- [ ] `aspectRatio={9/16}` 적용 확인 (크롭 영역이 세로 9:16 비율)
- [ ] 1~3장 선택 → 슬롯에 thumbnail 표시, × 버튼으로 제거 동작
- [ ] AI 이미지 라디오 0/1/2 토글
- [ ] "AI 이미지 N장 생성" 클릭 → busy → done 상태 전환, 미리보기 tile 표시
- [ ] Step 5에서 다음 클릭 → Step 6으로 이동 (Step 6 미구현이면 에러 없이 빈 화면)

- [ ] **Step 3: 미리보기 이미지 반영 확인**

Phase D 완료 전이므로 script는 runAll() 경로에서 생성. 스크립트 생성 후 Step 5로 점프 → 사진 선택 → Step 6 또는 기존 미리보기에서 hook/body 씬 이미지가 사용자 사진으로 바뀌는지 확인.

- [ ] **Step 4: 콘솔 에러 0건 확인**

DevTools Console에 에러 없음, Network 탭에 4xx/5xx 없음.

- [ ] **Step 5: 회귀 결과 메모**

발견한 이슈가 있으면 기록. 없으면 다음 task.

---

## Task E7: Phase E 자기 검토 + 알려진 제약

### Spec coverage

| 스펙 섹션 | 커버 task |
|---|---|
| §4 Step 5 — 비주얼 액센트 UI | E1 |
| §4 Step 5 — 0~3장 사진 + 0~2장 AI 이미지 | E1 |
| §4 Step 5 — ImagePickerModal 재사용 | E0, E1 |
| §4 Step 5 — FLUX Schnell / blog-image-pro 재사용 | E2 |
| §4 Step 5 — 이미지 URL을 Remotion에 전달 | E3 |

### 알려진 미완 (다음 Phase에서 처리)

- **액센트 위치 조정 (드래그)**: Step 6 Preview의 범위. Phase F에서 "액센트 위치 조정 — 사진을 어느 씬에 배치할지" task로 처리.
- **DB 저장 (`shortform_projects.user_image_ids`)**: Phase C (자동 저장)의 범위. Step 5 값은 현재 local state에만 존재.
- **`app/api/shortform-script/route.js` userImageIds 수신**: Phase D의 범위. Step 5는 Remotion props 경로만 책임.
- **Phase D 머지 후 "보조 점프 버튼" 제거**: Task E4 참조.

### 통합 지점

다음 Phase가 사용할 인터페이스:
- **Phase C**: `step5Value` 전체를 draft JSON에 포함 (자동 저장)
- **Phase F**: `step5Value.userPhotos[].image` + `aiImages`를 Step 6 Preview의 씬별 이미지 배치 드래그에 사용
- **Phase G**: 브랜드 킷 로고를 CTA 씬에 자동 삽입 (Step 5 사진과는 별개 경로)

### 회귀 안전성

- ImagePickerModal의 `showModeSelector` 기본값이 `true`이므로 카드뉴스는 무변경
- 기존 `generateImages()` + `images` state는 유지. `runAll()` 보조 모드는 영향 없음
- Step 5 진입 전이면 `step5Value`는 빈 상태 → `mergedImages.length === 0` → 기존 `images` 폴백
- 기존 Remotion 컴포넌트 (`ShortformComposition.jsx`)는 Phase E에서 건드리지 않음

---

## Task E8: 메모리 + 마스터 플랜 상태 업데이트

**Files:**
- Modify: `~/.claude/projects/-Users-gong-eunhui-Desktop-naver-title-generator/memory/MEMORY.md`
- Create: `~/.claude/projects/-Users-gong-eunhui-Desktop-naver-title-generator/memory/project_shortform_phase_e_complete.md`
- Modify: `docs/superpowers/plans/2026-04-14-shortform-master-plan.md`

- [ ] **Step 1: 메모리 파일 작성**

```markdown
---
name: 숏폼 Phase E 완료
description: Step 5 비주얼 액센트 — 카드뉴스 ImagePickerModal 재사용
type: project
---

# 숏폼 Phase E 완료

**완료일:** 2026-04-XX
**브랜치:** feat/shortform-v2
**스펙:** docs/superpowers/specs/2026-04-14-shortform-benchmark-pipeline-design.md §4 Step 5
**플랜:** docs/superpowers/plans/2026-04-14-shortform-phase-e-image-library.md

## 핵심 변경

- Step 5 — 비주얼 액센트 UI 신설
- 내 사진 최대 3장 + AI 이미지 0~2장
- 카드뉴스의 ImagePickerModal (514줄) 그대로 재사용
- showModeSelector prop 추가 (숏폼은 모드 구분 없음)
- scriptToProps가 사용자 사진 우선 사용

## 신규 파일

- app/shortform/components/Step5VisualAccent.js
- app/shortform/components/Step5VisualAccent.module.css

## 수정 파일

- components/ImagePickerModal.js (showModeSelector prop)
- app/shortform/ShortformClient.js (step5Value state + 통합)

## 다음 Phase

Phase F (Step 6 미리보기 + 프리셋 + 자막 커스터마이징)
```

- [ ] **Step 2: MEMORY.md에 한 줄 추가**

"최근 세션" 섹션 위쪽:

```markdown
- [4/XX 숏폼 Phase E 완료](project_shortform_phase_e_complete.md) — Step 5 사진 액센트 + ImagePickerModal 재사용
```

- [ ] **Step 3: 마스터 플랜 상태 업데이트**

`docs/superpowers/plans/2026-04-14-shortform-master-plan.md` Phase E 섹션 끝에:

```markdown
**상태:** ✅ 완료 (커밋 SHA: XXXXXXX)
```

- [ ] **Step 4: 최종 커밋**

```bash
git add docs/superpowers/plans/2026-04-14-shortform-master-plan.md
git commit -m "$(cat <<'EOF'
docs: Phase E 완료 마킹 + 메모리 기록

Phase E (Step 5 비주얼 액센트) 완료. ImagePickerModal 재사용 성공.
Phase F 진입 가능.
EOF
)"
```

---

## Phase E 완료 후 다음 단계

Phase F (Step 6 미리보기 + 프리셋 6종 + 자막 커스터마이징) 상세 플랜으로 진행. Phase F는 Phase D (대본) + Phase E (이미지) 둘 다 완료된 후 진입하는 것이 이상적이지만, Phase E만 먼저 완료돼도 runAll 경로로 독립 시연 가능.
