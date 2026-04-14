# Phase K — Onboarding Wizard: 샘플 4종 + 첫 영상 무료

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. 12 Phase 중 Phase K. 마스터 플랜: `2026-04-14-shortform-master-plan.md`. 스펙: `2026-04-14-shortform-benchmark-pipeline-design.md` §19.

**Goal:** 숏폼 도구 처음 접속한 사용자가 입력 막막함 없이 **60초 안에 첫 영상을 경험하도록** 한다. 4종 업종별 샘플(매장 사장 / 강사 / 컨설턴트 / 블로거) 중 하나를 선택하면 블로그 글·경험·페르소나·톤·길이가 모두 미리 채워져 바로 "다음"만 누르면 된다. 첫 1편은 무료(가입 후 7일 이내 한정).

**Architecture:** `users` 테이블에 `onboarding_completed`, `first_shortform_at` 2 컬럼을 lazy migration으로 추가. ShortformClient 마운트 시 `/api/me` 응답의 `onboardingCompleted` 값을 읽어 `false`면 `<OnboardingModal />`을 노출. 샘플 카드 클릭 시 Step1Input state를 pre-fill + 모달 닫기 + `PATCH /api/me { onboardingCompleted: true }`. 첫 영상 무료 로직은 `/api/shortform-script` 내부에서 `users.first_shortform_at`가 NULL이고 가입 후 7일 이내면 크레딧 차감 skip + `first_shortform_at` 기록.

**Tech Stack:** Next.js 15, React useState, Neon Postgres, 기존 auth/session 시스템

**의존성:** Phase A (Step1Input 컴포넌트 + 입력 state 구조) — Phase A 완료 후 1주차에 시작 가능

**예상 작업량:** 9 task, 약 1 주

---

## 파일 구조

### 신규 파일

```
lib/shortform-samples.js                      샘플 4종 데이터 (매장 사장/강사/컨설턴트/블로거)
app/shortform/components/OnboardingModal.js   첫 방문 모달
app/shortform/components/OnboardingModal.module.css
lib/onboarding-helpers.js                     users 테이블 컬럼 추가 lazy migration + 헬퍼
```

### 수정 파일

```
app/shortform/ShortformClient.js              OnboardingModal 마운트 + pre-fill 로직
app/api/auth/route.js                         /me 응답에 onboardingCompleted + firstShortformAt 포함
app/api/auth/onboarding/route.js              PATCH 엔드포인트 (신규, 아래 task K5 참조)
app/api/shortform-script/route.js             첫 영상 무료 로직 추가
```

---

## Task K1: lib/shortform-samples.js — 샘플 4종 데이터

**Files:**
- Create: `lib/shortform-samples.js`

- [ ] **Step 1: 샘플 데이터 작성**

```javascript
// lib/shortform-samples.js
/**
 * 숏폼 온보딩 샘플 4종.
 *
 * 각 샘플은 Step1Input 의 value 구조와 100% 호환되어
 * OnboardingModal 이 "사용하기" 클릭 시 바로 state로 주입된다.
 *
 * 원칙:
 * - 블로그 글 200자 이상 (입력 검증 통과 + 사용자가 수정 없이 진행 가능한 품질)
 * - 경험·느낌 50자 이상 (강한 1인칭)
 * - 이모지 금지
 * - 페르소나/톤/길이 모두 확정
 */

export const SAMPLES = [
  {
    id: 'store-owner-cafe',
    industry: '매장 사장',
    industrySub: '동네 카페',
    persona: 'store-owner',
    tone: 'casual',
    durationSec: 45,
    contentMode: 'blog',
    blogText: `오늘 단골손님이 "여기 왜 이렇게 커피 맛이 한결같냐"고 물어보셨어요. 제가 드린 답은 간단했어요. "원두 배합을 바꾸지 않고, 볶는 정도를 계절마다 0.5단계씩 조정하거든요." 여름엔 쓴맛이 더 도드라지게, 겨울엔 단맛이 길게 남도록. 작은 카페라 기계 바꿀 돈도, 바리스타 교체도 어렵지만 대신 원두와 물과 기계 온도 3가지만 매일 같은 시간에 점검해요. 손님이 "여기 커피 맛이 안 변해"라고 말해주는 게 제일 좋은 리뷰라고 생각해요.`,
    userExperience: '15년차 카페 사장. 손님이 "여기 커피 맛이 한결같다"고 칭찬해줬을 때 진짜 기뻤음.',
  },
  {
    id: 'instructor-math',
    industry: '강사',
    industrySub: '학원 수학 강사',
    persona: 'instructor',
    tone: 'professional',
    durationSec: 60,
    contentMode: 'blog',
    blogText: `수업에서 자주 받는 질문이 있어요. "수학은 왜 풀이 과정을 쓰라고 해요?" 답안만 맞으면 되는 거 아닌가 싶잖아요. 근데 학원에서 10년 넘게 가르쳐 보니까, 풀이 과정을 안 쓰는 학생들 공통점이 있어요. 중학교까지는 어떻게든 점수 나오는데, 고등학교 2학년쯤 돼서 갑자기 무너져요. 문제가 복잡해지면 머릿속 암산으로 안 되거든요. 그래서 저는 첫 수업에 이런 규칙을 정해요. "문제 푼 거는 틀려도 괜찮아요. 대신 풀이는 반드시 적으세요." 시간이 지나면 이게 습관이 되고, 결국 큰 시험에서 살아남는 학생이 됩니다.`,
    userExperience: '10년차 수학 강사. 풀이 과정 안 쓰던 학생이 고2 때 무너지는 걸 반복해서 본 게 가장 확신 있는 이유.',
  },
  {
    id: 'consultant-marketing',
    industry: '컨설턴트',
    industrySub: '소상공인 마케팅 컨설턴트',
    persona: 'consultant',
    tone: 'professional',
    durationSec: 60,
    contentMode: 'blog',
    blogText: `최근 3년간 100분이 넘는 사장님을 만나뵀는데, 매출이 오르는 가게와 안 오르는 가게를 가르는 건 마케팅 예산 크기가 아니었어요. 10만원 쓰는 분과 500만원 쓰는 분 모두 실패하는 공통점이 하나 있어요. "우리 가게는 뭐가 다른가?"라는 질문에 3초 안에 답을 못 해요. 광고는 그 다음 문제예요. 타겟팅이 아무리 좋아도 차별점이 없으면 클릭률부터 안 나와요. 그래서 저는 컨설팅 들어가면 항상 첫 질문부터 이걸 묻습니다. "손님이 왜 다른 가게가 아니라 사장님 가게를 골라야 해요?"`,
    userExperience: '마케팅 컨설턴트 7년차. 100분 넘는 사장님 만나면서 "차별점 3초 안에 못 대답"이 모든 실패의 공통점이라고 확신.',
  },
  {
    id: 'blogger-travel',
    industry: '블로거',
    industrySub: '국내 여행 블로거',
    persona: 'blogger',
    tone: 'casual',
    durationSec: 45,
    contentMode: 'blog',
    blogText: `많이들 헷갈려 하시는 부분 정리해드릴게요. 제주도 2박 3일 일정 짤 때 가장 많이 하는 실수가 "하루에 3~4곳씩 넣는 거"예요. 지도로 보면 가까워 보이지만 제주는 도로가 구불구불해서 30분이 1시간으로 늘어나요. 제가 직접 50번 넘게 다녀본 결과, 하루에 "무조건 갈 곳 1곳 + 선택 1곳"만 잡으시고 나머지는 그 근처에서 자연스럽게 풀어가시는 게 가장 편해요. 이 방식으로 가면 사진도 잘 나오고, 식사도 여유롭고, 무엇보다 여행이 일처럼 안 느껴져요.`,
    userExperience: '제주도만 50번 이상 다녀본 여행 블로거. "하루 3~4곳 욕심내다가 사진만 남고 추억은 없다"는 실패 후 단순화.',
  },
];

/**
 * id로 샘플 조회.
 */
export function getSample(id) {
  return SAMPLES.find((s) => s.id === id) || null;
}

/**
 * OnboardingModal에서 "사용하기" 클릭 시 Step1Input 의 value 구조로 변환.
 */
export function sampleToStep1Value(sample) {
  if (!sample) return null;
  return {
    contentMode: sample.contentMode,
    blogText: sample.blogText,
    keywords: '',
    userExperience: sample.userExperience,
    persona: sample.persona,
    customPersonaLabel: '',
    tone: sample.tone,
    durationSec: sample.durationSec,
    // 샘플 출처 메타 (Phase L 검증·로깅용)
    _sampleId: sample.id,
  };
}
```

- [ ] **Step 2: 빌드 체크**

```bash
cd /Users/gong-eunhui/Desktop/naver-title-generator
npx next build 2>&1 | grep -iE "error|✓ Compiled" | head -10
```

Expected: 컴파일 성공.

- [ ] **Step 3: 커밋**

```bash
git add lib/shortform-samples.js
git commit -m "$(cat <<'EOF'
feat(lib): 숏폼 온보딩 샘플 4종

매장 사장(카페) / 강사(수학) / 컨설턴트(마케팅) / 블로거(여행).
각 샘플은 200자 이상 블로그 글 + 50자 이상 경험 + 페르소나/톤/길이
확정. sampleToStep1Value 헬퍼로 Step1Input value 구조에 바로 주입.
EOF
)"
```

---

## Task K2: OnboardingModal 컴포넌트

**Files:**
- Create: `app/shortform/components/OnboardingModal.js`
- Create: `app/shortform/components/OnboardingModal.module.css`

- [ ] **Step 1: 컴포넌트 작성**

```javascript
// app/shortform/components/OnboardingModal.js
'use client';

import { SAMPLES } from '@/lib/shortform-samples';
import styles from './OnboardingModal.module.css';

/**
 * 첫 방문 시 노출되는 온보딩 모달.
 *
 * Props:
 * - open: boolean
 * - onSelectSample: (sampleId) => void  // 샘플 선택 시 호출
 * - onSkip: () => void                  // "직접 입력하기" 선택 시
 */
export default function OnboardingModal({ open, onSelectSample, onSkip }) {
  if (!open) return null;

  return (
    <div className={styles.backdrop}>
      <div className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="onboard-title">
        <div className={styles.header}>
          <div id="onboard-title" className={styles.title}>처음 사용하시나요?</div>
          <div className={styles.subtitle}>
            60초 만에 첫 영상을 만들어보세요. 첫 1편은 무료에요.
          </div>
        </div>

        <div className={styles.grid}>
          {SAMPLES.map((sample) => (
            <button
              key={sample.id}
              type="button"
              className={styles.card}
              onClick={() => onSelectSample(sample.id)}
            >
              <div className={styles.cardBadge}>{sample.industry}</div>
              <div className={styles.cardTitle}>{sample.industrySub}</div>
              <div className={styles.cardDesc}>
                {sample.userExperience.length > 60
                  ? sample.userExperience.slice(0, 60) + '...'
                  : sample.userExperience}
              </div>
              <div className={styles.cardMeta}>
                {sample.durationSec}초 · {sample.tone === 'casual' ? '친근한 친구' : '전문가'}
              </div>
              <div className={styles.cardCta}>이 샘플로 시작 →</div>
            </button>
          ))}
        </div>

        <button type="button" className={styles.skipBtn} onClick={onSkip}>
          직접 입력하기 (스킵)
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: CSS 작성**

```css
/* app/shortform/components/OnboardingModal.module.css */
.backdrop {
  position: fixed; inset: 0;
  background: rgba(15, 23, 42, 0.65);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 999;
  padding: 20px;
}
.modal {
  width: min(720px, 100%);
  max-height: 90vh;
  overflow: auto;
  background: var(--ds-surface-1, #fff);
  border-radius: 20px;
  padding: 32px 28px;
  box-shadow: 0 24px 60px rgba(0,0,0,0.25);
  display: flex;
  flex-direction: column;
  gap: 24px;
}
.header { display: flex; flex-direction: column; gap: 8px; }
.title {
  font-size: 24px;
  font-weight: 800;
  color: var(--ds-text, #1F2937);
}
.subtitle {
  font-size: 14px;
  color: var(--ds-muted, #77736B);
}
.grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
}
.card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 20px;
  background: var(--ds-surface-2, #F9FAFB);
  border: 2px solid transparent;
  border-radius: 14px;
  text-align: left;
  cursor: pointer;
  font-family: inherit;
  transition: all 0.2s ease;
}
.card:hover {
  border-color: var(--ds-accent, #ff5f1f);
  transform: translateY(-2px);
  box-shadow: 0 8px 24px rgba(255, 95, 31, 0.15);
}
.cardBadge {
  display: inline-block;
  width: fit-content;
  padding: 4px 10px;
  background: var(--ds-accent, #ff5f1f);
  color: #fff;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 700;
}
.cardTitle {
  font-size: 16px;
  font-weight: 700;
  color: var(--ds-text, #1F2937);
}
.cardDesc {
  font-size: 13px;
  color: var(--ds-text, #1F2937);
  line-height: 1.5;
}
.cardMeta {
  font-size: 12px;
  color: var(--ds-muted, #77736B);
}
.cardCta {
  margin-top: 4px;
  font-size: 13px;
  font-weight: 700;
  color: var(--ds-accent, #ff5f1f);
}
.skipBtn {
  align-self: center;
  padding: 10px 20px;
  background: none;
  border: 1px solid var(--ds-border, #E5E7EB);
  border-radius: 10px;
  color: var(--ds-muted, #77736B);
  font-weight: 600;
  font-size: 13px;
  cursor: pointer;
}
.skipBtn:hover { color: var(--ds-text, #1F2937); }

@media (max-width: 680px) {
  .grid { grid-template-columns: 1fr; }
  .modal { padding: 24px 20px; }
  .title { font-size: 20px; }
}
```

- [ ] **Step 3: 커밋**

```bash
git add app/shortform/components/OnboardingModal.js app/shortform/components/OnboardingModal.module.css
git commit -m "$(cat <<'EOF'
feat(components): OnboardingModal — 첫 방문 모달 + 샘플 4종 카드

2x2 그리드로 샘플 카드 표시. 각 카드는 업종 뱃지 + 세부 업종 + 경험 발췌
+ 톤/길이 메타 + CTA. 하단에 "직접 입력하기" 스킵 버튼.
모바일에서는 1열로 자동 전환.
EOF
)"
```

---

## Task K3: users 테이블 컬럼 추가 + onboarding-helpers

**Files:**
- Create: `lib/onboarding-helpers.js`

- [ ] **Step 1: 마이그레이션 헬퍼 작성**

```javascript
// lib/onboarding-helpers.js
/**
 * 온보딩 관련 users 테이블 컬럼 lazy migration + CRUD 헬퍼.
 *
 * 전제: users 테이블은 이미 존재. 카드뉴스 Phase 3 패턴대로 첫 호출 시
 * ALTER TABLE IF NOT EXISTS 로 컬럼만 추가한다.
 */
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL);

let columnsEnsured = false;

export async function ensureOnboardingColumns() {
  if (columnsEnsured) return;
  try {
    await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN DEFAULT FALSE`;
    await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS first_shortform_at TIMESTAMPTZ`;
    columnsEnsured = true;
  } catch (err) {
    console.error('[onboarding] ensureOnboardingColumns 실패:', err?.message);
    throw err;
  }
}

/**
 * 사용자 온보딩 상태 조회.
 */
export async function getOnboardingState(email) {
  await ensureOnboardingColumns();
  const rows = await sql`
    SELECT onboarding_completed, first_shortform_at, created_at
    FROM users
    WHERE email = ${email}
    LIMIT 1
  `;
  if (!rows || rows.length === 0) return null;
  const row = rows[0];
  return {
    onboardingCompleted: Boolean(row.onboarding_completed),
    firstShortformAt: row.first_shortform_at,
    createdAt: row.created_at,
  };
}

/**
 * 온보딩 완료 표시.
 */
export async function markOnboardingCompleted(email) {
  await ensureOnboardingColumns();
  await sql`UPDATE users SET onboarding_completed = TRUE WHERE email = ${email}`;
}

/**
 * 첫 숏폼 생성 시각 기록.
 */
export async function markFirstShortform(email) {
  await ensureOnboardingColumns();
  await sql`
    UPDATE users
    SET first_shortform_at = COALESCE(first_shortform_at, NOW())
    WHERE email = ${email}
  `;
}

/**
 * 첫 영상 무료 자격 여부 판단.
 * 기준:
 * - first_shortform_at IS NULL
 * - created_at 가 최근 7일 이내
 */
export async function isEligibleForFreeFirstShortform(email) {
  await ensureOnboardingColumns();
  const rows = await sql`
    SELECT first_shortform_at, created_at,
           (NOW() - created_at) AS age
    FROM users
    WHERE email = ${email}
    LIMIT 1
  `;
  if (!rows || rows.length === 0) return false;
  const row = rows[0];
  if (row.first_shortform_at) return false;
  if (!row.created_at) return false;

  const created = new Date(row.created_at).getTime();
  const now = Date.now();
  const sevenDaysMs = 7 * 24 * 3600 * 1000;
  return now - created <= sevenDaysMs;
}
```

- [ ] **Step 2: 커밋**

```bash
git add lib/onboarding-helpers.js
git commit -m "$(cat <<'EOF'
feat(lib): onboarding-helpers — users 컬럼 lazy migration + CRUD

ALTER TABLE IF NOT EXISTS로 onboarding_completed / first_shortform_at
컬럼 추가. getOnboardingState / markOnboardingCompleted /
markFirstShortform / isEligibleForFreeFirstShortform 4개 헬퍼.
첫 영상 무료 기준은 first_shortform_at NULL + 가입 7일 이내.
EOF
)"
```

---

## Task K4: /api/me 응답에 onboarding 필드 추가

**Files:**
- Modify: `app/api/auth/route.js` (또는 기존 /me 응답 위치)

- [ ] **Step 1: /me 핸들러 확장**

`auth/route.js` 내부 `handleMe` 함수에서 기존 응답에 `onboardingCompleted`, `firstShortformAt`, `eligibleForFreeFirstShortform` 필드를 추가.

```javascript
// app/api/auth/route.js (handleMe 발췌)
import { getOnboardingState, isEligibleForFreeFirstShortform } from '@/lib/onboarding-helpers';

async function handleMe(request) {
  const token = extractToken(request);
  const email = await resolveSessionEmail(token);
  if (!email) return jsonResponse(request, { error: '로그인이 필요합니다.' }, { status: 401 });

  // ... 기존 사용자 정보 조회 ...

  // 온보딩 상태 추가
  let onboarding = null;
  try {
    onboarding = await getOnboardingState(email);
  } catch (err) {
    console.error('[me] onboarding state 실패:', err?.message);
  }
  const eligible = onboarding?.firstShortformAt
    ? false
    : await isEligibleForFreeFirstShortform(email).catch(() => false);

  return jsonResponse(request, {
    email,
    // ... 기존 필드
    onboardingCompleted: onboarding?.onboardingCompleted ?? false,
    firstShortformAt: onboarding?.firstShortformAt ?? null,
    eligibleForFreeFirstShortform: eligible,
  });
}
```

- [ ] **Step 2: 커밋**

```bash
git add app/api/auth/route.js
git commit -m "$(cat <<'EOF'
feat(api): /api/me 응답에 onboarding 상태 + 무료 자격 추가

onboardingCompleted / firstShortformAt / eligibleForFreeFirstShortform
세 필드를 추가. 클라이언트가 ShortformClient 마운트 시 이 값을 읽어
OnboardingModal 노출 여부 및 무료 배너 표시 여부를 결정.
EOF
)"
```

---

## Task K5: PATCH /api/auth/onboarding 엔드포인트

**Files:**
- Create: `app/api/auth/onboarding/route.js`

기존 `/api/auth` 라우트에 action을 추가해도 되지만, 온보딩 전용 엔드포인트로 분리하는 편이 책임이 명확하다.

- [ ] **Step 1: 라우트 작성**

```javascript
// app/api/auth/onboarding/route.js
/**
 * 온보딩 상태 업데이트 엔드포인트.
 *
 * POST /api/auth/onboarding
 *   body: { completed: true, selectedSampleId?: string }
 *   Authorization: Bearer {token}
 */
import {
  extractToken,
  resolveSessionEmail,
  jsonResponse,
  handleOptions,
} from '@/lib/api-helpers';
import { markOnboardingCompleted } from '@/lib/onboarding-helpers';

export const runtime = 'nodejs';

export async function OPTIONS(request) {
  return handleOptions(request);
}

export async function POST(request) {
  const token = extractToken(request);
  const email = await resolveSessionEmail(token);
  if (!email) return jsonResponse(request, { error: '로그인이 필요합니다.' }, { status: 401 });

  let body = {};
  try {
    body = await request.json();
  } catch {}

  if (body.completed) {
    await markOnboardingCompleted(email);
  }

  return jsonResponse(request, { success: true });
}
```

- [ ] **Step 2: 커밋**

```bash
git add app/api/auth/onboarding/route.js
git commit -m "$(cat <<'EOF'
feat(api): POST /api/auth/onboarding — 온보딩 완료 표시

로그인 검증 + body.completed=true 시 users.onboarding_completed 를 TRUE로.
선택된 샘플 ID는 현재는 미저장 (필요 시 로깅 추가).
EOF
)"
```

---

## Task K6: ShortformClient에 OnboardingModal 통합

**Files:**
- Modify: `app/shortform/ShortformClient.js`

- [ ] **Step 1: 모달 state + 조건부 렌더**

```javascript
// ShortformClient 발췌
import OnboardingModal from './components/OnboardingModal';
import { getSample, sampleToStep1Value } from '@/lib/shortform-samples';

// ... 기존 state
const [showOnboarding, setShowOnboarding] = useState(false);
const [isFreeFirst, setIsFreeFirst] = useState(false);
const [step1Value, setStep1Value] = useState(/* 기존 초기값 */);

// 마운트 시 /me 조회
useEffect(() => {
  if (!token) return;
  fetch('/api/auth?action=me', {
    headers: { Authorization: `Bearer ${token}` },
  })
    .then((r) => r.json())
    .then((data) => {
      if (data?.onboardingCompleted === false) {
        setShowOnboarding(true);
      }
      setIsFreeFirst(Boolean(data?.eligibleForFreeFirstShortform));
    })
    .catch(() => {});
}, [token]);

function handleSelectSample(sampleId) {
  const sample = getSample(sampleId);
  if (!sample) return;
  const next = sampleToStep1Value(sample);
  setStep1Value(next);
  setShowOnboarding(false);
  // 비동기로 서버에 온보딩 완료 표시
  fetch('/api/auth/onboarding', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ completed: true, selectedSampleId: sampleId }),
  }).catch(() => {});
}

function handleSkipOnboarding() {
  setShowOnboarding(false);
  fetch('/api/auth/onboarding', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ completed: true }),
  }).catch(() => {});
}
```

- [ ] **Step 2: JSX에 모달 + 무료 배너 렌더**

```jsx
{showOnboarding && (
  <OnboardingModal
    open={showOnboarding}
    onSelectSample={handleSelectSample}
    onSkip={handleSkipOnboarding}
  />
)}

{isFreeFirst && !showOnboarding && (
  <div className={styles.freeFirstBanner}>
    ✨ 첫 영상은 무료에요. 지금 바로 만들어보세요.
  </div>
)}
```

- [ ] **Step 3: 배너 CSS 추가**

```css
/* app/shortform/page.module.css 또는 기존 CSS에 추가 */
.freeFirstBanner {
  padding: 12px 16px;
  background: linear-gradient(135deg, rgba(255, 95, 31, 0.12), rgba(255, 95, 31, 0.04));
  border: 1px solid rgba(255, 95, 31, 0.3);
  border-radius: 10px;
  color: var(--ds-accent, #ff5f1f);
  font-weight: 600;
  font-size: 14px;
  text-align: center;
  margin: 12px 0;
}
```

- [ ] **Step 4: 커밋**

```bash
git add app/shortform/ShortformClient.js app/shortform/page.module.css
git commit -m "$(cat <<'EOF'
feat(shortform): OnboardingModal + 첫 영상 무료 배너 통합

마운트 시 /api/auth?action=me 로 onboardingCompleted + eligible 조회.
false면 OnboardingModal 노출. 샘플 선택 시 sampleToStep1Value로 state
주입 + 서버에 완료 표시. eligibleForFreeFirstShortform 이 true면
Step1 상단에 무료 배너 표시.
EOF
)"
```

---

## Task K7: /api/shortform-script — 첫 영상 무료 로직

**Files:**
- Modify: `app/api/shortform-script/route.js`

- [ ] **Step 1: 크레딧 차감 전 무료 자격 확인**

```javascript
// app/api/shortform-script/route.js (발췌)
import {
  isEligibleForFreeFirstShortform,
  markFirstShortform,
} from '@/lib/onboarding-helpers';

export async function POST(request) {
  // ... 기존 인증
  const email = await resolveSessionEmail(token);
  if (!email) return jsonResponse(request, { error: '로그인이 필요합니다.' }, { status: 401 });

  // 첫 영상 무료 여부 판단
  let freeFirst = false;
  try {
    freeFirst = await isEligibleForFreeFirstShortform(email);
  } catch (err) {
    console.error('[script] freeFirst check 실패:', err?.message);
  }

  // 크레딧 차감 (기존 로직)
  if (!freeFirst) {
    // 기존 deductCredits(email, cost) 호출
    const ok = await deductCredits(email, cost);
    if (!ok) {
      return jsonResponse(request, { error: '크레딧이 부족합니다.' }, { status: 402 });
    }
  } else {
    console.log('[script] 첫 영상 무료 적용:', email);
  }

  // ... 대본 생성 성공 이후
  if (freeFirst) {
    try {
      await markFirstShortform(email);
    } catch (err) {
      console.error('[script] markFirstShortform 실패:', err?.message);
    }
  }

  return jsonResponse(request, {
    // ... 기존 응답
    freeFirstApplied: freeFirst,
  });
}
```

> **주의:** 크레딧 차감 시점은 Phase I §17에 따라 "Step 7 렌더 시작"으로 이동 중. 그 시점에서도 동일한 `isEligibleForFreeFirstShortform` 검사를 수행해야 한다. Phase I/Phase F 통합 시점에 차감 함수가 단일 지점이 되도록 정리.

- [ ] **Step 2: 응답에서 freeFirstApplied 수신 시 UI 피드백**

```javascript
// ShortformClient 발췌
if (scriptResponse.freeFirstApplied) {
  toast.success('첫 영상이 무료로 생성됐어요.');
  setIsFreeFirst(false); // 이후로는 배너 숨김
}
```

- [ ] **Step 3: 커밋**

```bash
git add app/api/shortform-script/route.js app/shortform/ShortformClient.js
git commit -m "$(cat <<'EOF'
feat(api): 첫 영상 무료 로직 — shortform-script

isEligibleForFreeFirstShortform 로 자격 확인 → 통과 시 크레딧 차감 skip
+ 성공 후 markFirstShortform 호출. 응답에 freeFirstApplied 포함.
클라이언트는 성공 시 토스트 + 배너 숨김.

크레딧 차감 시점은 Phase I/F 통합 시 Step 7로 이동하면서 동일 검사
중복 체크 가능.
EOF
)"
```

---

## Task K8: 수동 검증 — 신규 사용자 흐름

**Files:**
- 없음 (검증 전용)

- [ ] **Step 1: 신규 가입 + 첫 방문 시나리오**

1. 로컬 DB에 신규 사용자 생성 (또는 기존 사용자 온보딩 리셋)
   ```sql
   UPDATE users SET onboarding_completed = FALSE, first_shortform_at = NULL, created_at = NOW() WHERE email = 'test@example.com';
   ```
2. /shortform 접속 → OnboardingModal 자동 노출 확인
3. "매장 사장 (카페)" 카드 클릭
4. 모달 닫히고 Step1Input에 블로그 글/경험/페르소나 자동 입력 확인
5. "다음" 클릭 → Step 2 진입 (검증 통과)
6. Step 3~7 진행 → 영상 완성까지 **60초 이내** 측정
7. 첫 영상 무료 배너가 표시되고, 생성 후 `freeFirstApplied: true` 응답 확인

- [ ] **Step 2: 두 번째 영상 (크레딧 차감)**

1. 같은 사용자로 다시 숏폼 생성
2. 무료 배너 미표시 확인
3. 크레딧 차감 정상 작동 확인
4. DB: `SELECT first_shortform_at FROM users WHERE email='test@example.com'` → 첫 번째 시점만 기록

- [ ] **Step 3: 스킵 흐름**

1. 또 다른 신규 사용자로 접속
2. OnboardingModal에서 "직접 입력하기" 클릭
3. 모달 닫힘 + `onboarding_completed = TRUE` 확인
4. 다음 방문 시 모달 미노출 확인

- [ ] **Step 4: 7일 지난 사용자**

1. `UPDATE users SET created_at = NOW() - INTERVAL '8 days', first_shortform_at = NULL WHERE email='test8@example.com'`
2. /me 응답에서 `eligibleForFreeFirstShortform: false` 확인
3. 배너 미표시 + 정상 차감 확인

- [ ] **Step 5: 회귀 — 기존 사용자**

1. 이미 `onboarding_completed = TRUE` + `first_shortform_at` 있는 기존 사용자로 접속
2. 모달 미노출 + 배너 미표시 + 기존 흐름 그대로 동작 확인

- [ ] **Step 6: 검증 결과 커밋**

```bash
git commit --allow-empty -m "$(cat <<'EOF'
chore: Phase K 온보딩 수동 검증 완료

- 신규 사용자: 모달 → 샘플 선택 → 60초 내 첫 영상 OK
- 첫 영상 무료 적용 확인 (freeFirstApplied=true)
- 두 번째 영상부터 정상 차감
- 스킵 흐름 OK (직접 입력)
- 7일 초과 사용자는 무료 미적용
- 기존 사용자 회귀 영향 0
EOF
)"
```

---

## Task K9: 메모리 + 마스터 플랜 업데이트

**Files:**
- Create: `~/.claude/projects/-Users-gong-eunhui-Desktop-naver-title-generator/memory/project_shortform_phase_k_complete.md`
- Modify: `~/.claude/projects/-Users-gong-eunhui-Desktop-naver-title-generator/memory/MEMORY.md`
- Modify: `docs/superpowers/plans/2026-04-14-shortform-master-plan.md`

- [ ] **Step 1: 메모리 파일 작성**

```markdown
---
name: 숏폼 Phase K 완료
description: 온보딩 위저드 + 샘플 4종 + 첫 영상 무료
type: project
---

# 숏폼 Phase K 완료

**완료일:** 2026-04-XX
**스펙:** docs/superpowers/specs/2026-04-14-shortform-benchmark-pipeline-design.md §19
**플랜:** docs/superpowers/plans/2026-04-14-shortform-phase-k-onboarding.md

## 핵심 변경

- lib/shortform-samples.js: 샘플 4종 (매장 사장/강사/컨설턴트/블로거)
- OnboardingModal 컴포넌트 + CSS (2x2 그리드, 모바일 1열)
- lib/onboarding-helpers.js: users 컬럼 lazy migration + CRUD
- /api/me 에 onboardingCompleted / firstShortformAt / eligibleForFreeFirstShortform
- /api/auth/onboarding POST 엔드포인트
- ShortformClient에 모달 통합 + 무료 배너
- /api/shortform-script 에 첫 영상 무료 로직

## DB 변경

- users 테이블에 onboarding_completed BOOLEAN DEFAULT FALSE 컬럼 추가
- users 테이블에 first_shortform_at TIMESTAMPTZ 컬럼 추가
- lazy migration (ensureOnboardingColumns)

## 첫 영상 무료 기준

- first_shortform_at IS NULL
- created_at 가 최근 7일 이내
- 두 조건 모두 만족 시 크레딧 차감 skip + 생성 성공 후 first_shortform_at 기록

## 다음 Phase

Phase L (검증) — 모든 Phase 통합 후 회귀 + 도그푸드
```

- [ ] **Step 2: MEMORY.md 업데이트**

```markdown
- [4/XX 숏폼 Phase K 완료](project_shortform_phase_k_complete.md) — 온보딩 샘플 4종 + 첫 영상 무료
```

- [ ] **Step 3: 마스터 플랜 상태 마킹**

```markdown
**상태:** ✅ 완료 (커밋 SHA: XXXXXXX)
```

- [ ] **Step 4: 최종 커밋**

```bash
git add docs/superpowers/plans/2026-04-14-shortform-master-plan.md
git commit -m "$(cat <<'EOF'
docs: Phase K 완료 마킹 + 메모리 기록

온보딩 위저드 + 샘플 4종 + 첫 영상 무료 완료.
Phase L (검증) 이 마지막.
EOF
)"
```

---

## Phase K 자기 검토

### Spec coverage

| 스펙 섹션 | 커버 task |
|---|---|
| §19 첫 방문 모달 | K2, K6 |
| §19 샘플 4종 | K1 |
| §19 첫 영상 무료 | K3, K7 |
| §19 데이터 모델 | K3 |

### 알려진 미완 / 한계

- 선택된 샘플 id 로깅은 미구현 (`selectedSampleId` 는 body로 받지만 저장 안 함) — Phase L 에서 분석 지표로 필요하면 추가
- 7일 기준은 하드코드 → 환경 변수화 원하면 `FREE_FIRST_WINDOW_DAYS` 로 전환
- 샘플 4종은 정적 파일 — 관리자가 실시간 편집하려면 별도 CMS 필요 (v1.1 후보)

### 통합 지점

- **Phase I (SSE)**: 첫 영상 생성 흐름도 같은 진행 표시 사용
- **Phase F (Preview)**: 샘플 값으로도 Step 6 미리보기가 동일하게 동작해야 함 (durationSec/persona/tone 모두 표준 필드)
- **Phase L (검증)**: 도그푸드 시 신규 사용자 시뮬 + 샘플 4종 모두 끝까지 진행 테스트

### 회귀 안전성

- onboarding 컬럼이 없는 구 버전 DB에서도 ensureOnboardingColumns가 자동 추가
- /me 에서 onboarding 조회 실패 시 null 반환 → 모달 미노출 (기본 skip)
- 무료 자격 판정 실패 시 `false` 반환 → 기존 크레딧 차감 정상 작동
- 기존 사용자는 onboarding_completed 가 NULL → ALTER TABLE 의 DEFAULT FALSE 로 채워짐 → 모달이 한 번 노출되지만 "스킵" 버튼 한 번이면 이후 미노출

---

## Phase K 완료 후 다음 단계

Phase L (검증) 시작. 모든 Phase가 통합된 상태에서 회귀 시나리오 + 도그푸드. 샘플 4종을 모두 운영자가 직접 실행해 60초 완주 확인.
