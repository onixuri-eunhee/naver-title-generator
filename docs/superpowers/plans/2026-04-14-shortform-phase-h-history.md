# Phase H — Project History UI: 내 영상 (Drafts + Published)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. 12 Phase 중 Phase H. 마스터 플랜: `2026-04-14-shortform-master-plan.md`. 스펙: `2026-04-14-shortform-benchmark-pipeline-design.md` §15.

**Goal:** 마이페이지에 "내 영상" 섹션을 추가해 사용자가 진행 중인 Draft와 완성한 Published 프로젝트를 한눈에 보고, Draft는 "이어서 작업", Published는 "다운로드/복제"할 수 있도록 한다.

**Architecture:** Phase H는 **UI만** 담당. DB 테이블(`shortform_projects`)과 API 엔드포인트(`/api/shortform-projects/*`)는 **Phase C에서 구현됨을 전제로 한다**. 마이페이지에 `ShortformProjectsSection` 탭 컴포넌트(Drafts | Published)를 추가하고, `ShortformClient.js`를 수정해 `?projectId=X` 쿼리로 Draft 상태를 복원할 수 있게 한다.

**Tech Stack:** Next.js 15 App Router, React useState/useEffect + useSearchParams, CSS modules

**의존성:**
- **Phase C (필수 선행):** `shortform_projects` 테이블 + `/api/shortform-projects` 엔드포인트 + 자동 저장 훅. Phase C가 완료되지 않으면 Phase H는 API 404로 작동 불가.
- Phase A (권장): Step 1~7 단계형 동선이 있어야 Draft 복원 시 `currentStep`을 활용 가능.
- Phase G (권장): 마이페이지 섹션 순서 정렬(BrandKit ↔ ShortformProjects 나란히).

**예상 작업량:** 8 task, ~4일

---

## 파일 구조

### 신규 파일

```
app/mypage/ShortformProjectsSection.js           Drafts/Published 탭 UI
app/mypage/ShortformProjectsSection.module.css   섹션 스타일
```

### 수정 파일

```
app/mypage/MyPageClient.js                       ShortformProjectsSection 삽입
app/shortform/ShortformClient.js                 ?projectId 쿼리 읽기 + 상태 복원
```

### Phase C가 제공해야 하는 API (본 플랜에서 구현 ×)

```
GET    /api/shortform-projects?status=draft|published
GET    /api/shortform-projects/[id]
PATCH  /api/shortform-projects/[id]
POST   /api/shortform-projects/[id]/duplicate
DELETE /api/shortform-projects/[id]
```

각 프로젝트 row는 스펙 §15 데이터 모델의 필드를 포함한다 (id, status, current_step, title, blog_text, keywords, script_json, video_r2_key, updated_at, published_at 등).

---

## Task H1: ShortformProjectsSection — 탭 UI + 목록 로딩

Drafts와 Published 두 탭을 제공하고, 각각 API에서 목록을 가져와 카드 리스트로 렌더링.

**Files:**
- Create: `app/mypage/ShortformProjectsSection.js`

- [ ] **Step 1: 컴포넌트 작성**

```javascript
// app/mypage/ShortformProjectsSection.js
'use client';

import { useEffect, useState } from 'react';
import { getToken } from '@/lib/auth';
import styles from './ShortformProjectsSection.module.css';

const STEP_LABELS = {
  1: 'Step 1 입력',
  2: 'Step 2 벤치마킹',
  3: 'Step 3 대본',
  4: 'Step 4 음성',
  5: 'Step 5 액센트',
  6: 'Step 6 미리보기',
  7: 'Step 7 산출물',
};

function formatRelativeTime(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return '방금 전';
  if (min < 60) return `${min}분 전`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}시간 전`;
  const d = Math.floor(hr / 24);
  if (d < 30) return `${d}일 전`;
  return new Date(iso).toLocaleDateString('ko-KR');
}

function formatDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' });
}

function formatDuration(sec) {
  if (!sec) return '';
  return `${sec}초`;
}

export default function ShortformProjectsSection() {
  const [tab, setTab] = useState('drafts'); // 'drafts' | 'published'
  const [drafts, setDrafts] = useState([]);
  const [published, setPublished] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function refresh() {
    const token = getToken();
    if (!token) { setLoading(false); return; }
    setLoading(true);
    setError('');
    try {
      const [draftsRes, pubRes] = await Promise.all([
        fetch('/api/shortform-projects?status=draft', {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch('/api/shortform-projects?status=published', {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ]);
      const [draftsData, pubData] = await Promise.all([draftsRes.json(), pubRes.json()]);
      if (!draftsRes.ok) {
        setError(draftsData.error || '작업 중 목록을 불러오지 못했습니다.');
      } else {
        setDrafts(draftsData.projects || []);
      }
      if (pubRes.ok) {
        setPublished(pubData.projects || []);
      }
    } catch {
      setError('네트워크 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refresh(); }, []);

  async function deleteProject(id) {
    if (!confirm('이 프로젝트를 삭제할까요?')) return;
    const token = getToken();
    const res = await fetch(`/api/shortform-projects/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) await refresh();
    else alert('삭제에 실패했습니다.');
  }

  async function duplicateProject(id) {
    const token = getToken();
    const res = await fetch(`/api/shortform-projects/${id}/duplicate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (!res.ok) {
      alert(data.error || '복제에 실패했습니다.');
      return;
    }
    // 복제된 새 draft로 이동
    if (data.project?.id) {
      window.location.href = `/shortform?projectId=${data.project.id}`;
    }
  }

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <div className={styles.title}>내 영상</div>
        <a href="/shortform" className={styles.newBtn}>+ 새 영상 만들기</a>
      </div>

      <div className={styles.tabs} role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'drafts'}
          className={`${styles.tab} ${tab === 'drafts' ? styles.tabActive : ''}`}
          onClick={() => setTab('drafts')}
        >
          작업 중 <span className={styles.badge}>{drafts.length}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'published'}
          className={`${styles.tab} ${tab === 'published' ? styles.tabActive : ''}`}
          onClick={() => setTab('published')}
        >
          완성 <span className={styles.badge}>{published.length}</span>
        </button>
      </div>

      {error && <div className={styles.errorText}>{error}</div>}
      {loading && <div className={styles.loadingText}>불러오는 중...</div>}

      {!loading && tab === 'drafts' && (
        <DraftsList
          items={drafts}
          onDelete={deleteProject}
        />
      )}

      {!loading && tab === 'published' && (
        <PublishedList
          items={published}
          onDelete={deleteProject}
          onDuplicate={duplicateProject}
        />
      )}
    </div>
  );
}

function DraftsList({ items, onDelete }) {
  if (items.length === 0) {
    return (
      <div className={styles.emptyText}>
        작업 중인 영상이 없습니다.<br />
        새 영상을 만들면 자동으로 저장됩니다.
      </div>
    );
  }
  return (
    <ul className={styles.list}>
      {items.map((p) => (
        <li key={p.id} className={styles.draftCard}>
          <div className={styles.draftBody}>
            <div className={styles.draftTitle}>
              {p.title || p.blog_text?.slice(0, 40) || '제목 없음'}
            </div>
            <div className={styles.draftMeta}>
              <span className={styles.stepPill}>
                {STEP_LABELS[p.current_step] || `Step ${p.current_step}`}
              </span>
              <span className={styles.metaDot}>·</span>
              <span>{formatRelativeTime(p.updated_at)}</span>
              {p.duration_sec && (
                <>
                  <span className={styles.metaDot}>·</span>
                  <span>{formatDuration(p.duration_sec)}</span>
                </>
              )}
              {p.tone && (
                <>
                  <span className={styles.metaDot}>·</span>
                  <span>{p.tone === 'casual' ? '친근 모드' : '전문가 모드'}</span>
                </>
              )}
            </div>
          </div>
          <div className={styles.draftActions}>
            <a
              href={`/shortform?projectId=${p.id}`}
              className={styles.resumeBtn}
            >
              이어서 작업
            </a>
            <button
              type="button"
              className={styles.iconBtn}
              onClick={() => onDelete(p.id)}
              aria-label="삭제"
            >×</button>
          </div>
        </li>
      ))}
    </ul>
  );
}

function PublishedList({ items, onDelete, onDuplicate }) {
  if (items.length === 0) {
    return (
      <div className={styles.emptyText}>
        완성한 영상이 없습니다.<br />
        Step 7까지 완료하면 여기에 저장됩니다.
      </div>
    );
  }
  return (
    <ul className={styles.grid}>
      {items.map((p) => (
        <li key={p.id} className={styles.publishedCard}>
          <div className={styles.thumbWrap}>
            {p.thumbnail_url ? (
              <img src={p.thumbnail_url} alt={p.title || ''} className={styles.thumb} />
            ) : (
              <div className={styles.thumbPlaceholder}>영상</div>
            )}
            <div className={styles.durationBadge}>
              {formatDuration(p.duration_actual || p.duration_sec)}
            </div>
          </div>
          <div className={styles.publishedBody}>
            <div className={styles.publishedTitle}>
              {p.title || p.blog_text?.slice(0, 36) || '제목 없음'}
            </div>
            <div className={styles.publishedDate}>
              {formatDate(p.published_at || p.updated_at)} 발행
            </div>
            <div className={styles.publishedActions}>
              {p.video_r2_key && (
                <a
                  href={`/api/shortform-projects/${p.id}/download`}
                  className={styles.smallBtn}
                  download
                >
                  다운로드
                </a>
              )}
              <button
                type="button"
                className={styles.smallBtn}
                onClick={() => onDuplicate(p.id)}
              >
                복제
              </button>
              <button
                type="button"
                className={styles.smallBtnDanger}
                onClick={() => onDelete(p.id)}
              >
                삭제
              </button>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 2: 빌드 체크**

```bash
cd /Users/gong-eunhui/Desktop/naver-title-generator
npx next build 2>&1 | grep -iE "error|✓ Compiled" | head -10
```

Expected: `✓ Compiled successfully`. Phase C API가 아직 없더라도 컴포넌트 자체는 빌드 성공 (런타임 fetch만 404로 받고 에러 메시지 표시).

- [ ] **Step 3: 커밋**

```bash
git add app/mypage/ShortformProjectsSection.js
git commit -m "$(cat <<'EOF'
feat(mypage): ShortformProjectsSection — Drafts/Published 탭 UI

Drafts 탭: currentStep / 상대시간 / 이어서 작업 버튼
Published 탭: 썸네일 그리드 / 다운로드·복제·삭제
Phase C의 /api/shortform-projects 엔드포인트 사용.
EOF
)"
```

---

## Task H2: ShortformProjectsSection 스타일

**Files:**
- Create: `app/mypage/ShortformProjectsSection.module.css`

- [ ] **Step 1: CSS 작성**

```css
/* app/mypage/ShortformProjectsSection.module.css */
.root { display: flex; flex-direction: column; gap: 14px; }

.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.title {
  font-size: 15px;
  font-weight: 700;
  color: var(--ds-text, #1F2937);
}

.newBtn {
  padding: 8px 14px;
  background: var(--ds-accent, #ff5f1f);
  color: #fff;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 700;
  text-decoration: none;
}
.newBtn:hover { opacity: 0.9; }

.tabs {
  display: flex;
  gap: 4px;
  border-bottom: 1px solid var(--ds-border, #E5E7EB);
}

.tab {
  padding: 10px 16px;
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  font-size: 13px;
  font-weight: 600;
  color: var(--ds-muted, #77736B);
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 6px;
  transition: all 0.15s ease;
}
.tab:hover { color: var(--ds-text, #1F2937); }

.tabActive {
  color: var(--ds-accent, #ff5f1f);
  border-bottom-color: var(--ds-accent, #ff5f1f);
}

.badge {
  display: inline-block;
  min-width: 20px;
  height: 18px;
  padding: 0 6px;
  background: var(--ds-surface-2, #F3F4F6);
  color: var(--ds-muted, #77736B);
  border-radius: 9px;
  font-size: 11px;
  font-weight: 700;
  line-height: 18px;
  text-align: center;
  font-variant-numeric: tabular-nums;
}
.tabActive .badge {
  background: rgba(255, 95, 31, 0.12);
  color: var(--ds-accent, #ff5f1f);
}

.loadingText, .emptyText, .errorText {
  font-size: 13px;
  color: var(--ds-muted, #77736B);
  text-align: center;
  padding: 28px 12px;
  line-height: 1.6;
}
.errorText { color: #DC2626; }

/* Drafts list */
.list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.draftCard {
  display: flex;
  gap: 12px;
  padding: 12px 14px;
  background: var(--ds-surface, #fff);
  border: 1px solid var(--ds-border, #E5E7EB);
  border-radius: 10px;
  transition: border-color 0.15s ease;
}
.draftCard:hover {
  border-color: var(--ds-accent, #ff5f1f);
}

.draftBody {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.draftTitle {
  font-size: 13px;
  font-weight: 700;
  color: var(--ds-text, #1F2937);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.draftMeta {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  align-items: center;
  font-size: 11px;
  color: var(--ds-muted, #77736B);
}
.metaDot { color: var(--ds-border, #E5E7EB); }

.stepPill {
  padding: 2px 8px;
  background: rgba(255, 95, 31, 0.1);
  color: var(--ds-accent, #ff5f1f);
  border-radius: 999px;
  font-size: 10px;
  font-weight: 700;
}

.draftActions {
  display: flex;
  gap: 6px;
  align-items: center;
  flex-shrink: 0;
}

.resumeBtn {
  padding: 8px 14px;
  background: var(--ds-accent, #ff5f1f);
  color: #fff;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 700;
  text-decoration: none;
  white-space: nowrap;
}
.resumeBtn:hover { opacity: 0.9; }

.iconBtn {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: 1px solid var(--ds-border, #E5E7EB);
  background: #fff;
  color: var(--ds-muted, #77736B);
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}
.iconBtn:hover {
  background: #FEF2F2;
  color: #DC2626;
  border-color: #FECACA;
}

/* Published grid */
.grid {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
}
@media (max-width: 700px) {
  .grid { grid-template-columns: repeat(2, 1fr); }
}

.publishedCard {
  display: flex;
  flex-direction: column;
  background: var(--ds-surface, #fff);
  border: 1px solid var(--ds-border, #E5E7EB);
  border-radius: 10px;
  overflow: hidden;
  transition: box-shadow 0.15s ease;
}
.publishedCard:hover {
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
}

.thumbWrap {
  position: relative;
  aspect-ratio: 9 / 16;
  background: #000;
}
.thumb {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.thumbPlaceholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #9CA3AF;
  font-size: 12px;
  background: linear-gradient(135deg, #1F2937, #0F172A);
}
.durationBadge {
  position: absolute;
  right: 6px;
  bottom: 6px;
  padding: 2px 8px;
  background: rgba(0, 0, 0, 0.72);
  color: #fff;
  border-radius: 4px;
  font-size: 10px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.publishedBody {
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.publishedTitle {
  font-size: 12px;
  font-weight: 700;
  color: var(--ds-text, #1F2937);
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  line-height: 1.35;
  min-height: 32px;
}
.publishedDate {
  font-size: 10px;
  color: var(--ds-muted, #77736B);
}
.publishedActions {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 4px;
}

.smallBtn {
  padding: 5px 9px;
  background: var(--ds-surface-2, #F3F4F6);
  color: var(--ds-text, #1F2937);
  border: none;
  border-radius: 6px;
  font-size: 10px;
  font-weight: 600;
  cursor: pointer;
  text-decoration: none;
}
.smallBtn:hover { background: #E5E7EB; }

.smallBtnDanger {
  padding: 5px 9px;
  background: #fff;
  color: #DC2626;
  border: 1px solid #FECACA;
  border-radius: 6px;
  font-size: 10px;
  font-weight: 600;
  cursor: pointer;
}
.smallBtnDanger:hover { background: #FEF2F2; }
```

- [ ] **Step 2: 빌드 체크**

```bash
npx next build 2>&1 | grep -iE "error|✓ Compiled" | head -5
```

Expected: 성공.

- [ ] **Step 3: 커밋**

```bash
git add app/mypage/ShortformProjectsSection.module.css
git commit -m "$(cat <<'EOF'
feat(mypage): ShortformProjectsSection 스타일

탭 + Draft 세로 리스트 + Published 9:16 썸네일 그리드.
모바일 반응형 (2-column).
EOF
)"
```

---

## Task H3: Drafts 목록 — 세부 인터랙션

H1에서 기본 Drafts 리스트를 만들었지만, 이 task에서 세부 UX를 다듬는다. (빈 상태 배너, 자동 정렬, 만료 경고 등)

**Files:**
- Modify: `app/mypage/ShortformProjectsSection.js`

- [ ] **Step 1: 30일 만료 경고 표시**

`DraftsList`의 각 카드에서, `updated_at`이 25일 이상 지난 경우 "N일 후 삭제" 경고 라벨을 추가.

```javascript
function daysUntilExpire(updatedAt) {
  const updated = new Date(updatedAt).getTime();
  const expire = updated + 30 * 24 * 60 * 60 * 1000;
  return Math.max(0, Math.floor((expire - Date.now()) / (24 * 60 * 60 * 1000)));
}
```

카드 meta 줄에 조건부 표시:

```jsx
{(() => {
  const d = daysUntilExpire(p.updated_at);
  if (d <= 5) {
    return (
      <>
        <span className={styles.metaDot}>·</span>
        <span className={styles.expireWarn}>{d}일 후 자동 삭제</span>
      </>
    );
  }
  return null;
})()}
```

- [ ] **Step 2: CSS 경고 스타일 추가 (`ShortformProjectsSection.module.css`)**

```css
.expireWarn {
  color: #DC2626;
  font-weight: 700;
}
```

- [ ] **Step 3: 빌드 + 커밋**

```bash
npx next build 2>&1 | grep -iE "error|✓ Compiled" | head -5
git add app/mypage/ShortformProjectsSection.js app/mypage/ShortformProjectsSection.module.css
git commit -m "$(cat <<'EOF'
feat(mypage): Draft 30일 만료 경고 라벨

updated_at 기준 5일 이하 남은 경우 빨간색 "N일 후 자동 삭제" 표시.
Phase C의 30일 보관 정책과 동기화.
EOF
)"
```

---

## Task H4: Published 목록 — 다운로드/복제 버튼

H1에서 기본 Published 그리드를 만들었고, H4에서 다운로드/복제 동작을 확정한다.

**Files:**
- Modify: `app/mypage/ShortformProjectsSection.js`

- [ ] **Step 1: 다운로드 안전장치**

다운로드 링크는 `/api/shortform-projects/[id]/download` 가 있을 때만 활성화. 만약 `video_r2_key`가 null이면 버튼 비활성:

```jsx
{p.video_r2_key ? (
  <a
    href={`/api/shortform-projects/${p.id}/download`}
    className={styles.smallBtn}
    download
  >
    다운로드
  </a>
) : (
  <span className={`${styles.smallBtn} ${styles.smallBtnDisabled}`}>
    처리 중
  </span>
)}
```

- [ ] **Step 2: 복제 후 Toast**

복제 성공 시 바로 shortform으로 이동하지 않고, 토스트로 알린 뒤 "이어서 작업" 링크 제공. (사용자가 현재 목록 상태를 유지하고 싶을 수도 있음)

```javascript
const [toast, setToast] = useState(null);

async function duplicateProject(id) {
  const token = getToken();
  const res = await fetch(`/api/shortform-projects/${id}/duplicate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json();
  if (!res.ok) {
    alert(data.error || '복제에 실패했습니다.');
    return;
  }
  if (data.project?.id) {
    setToast({
      msg: '복제되었습니다. 새 draft로 이동할까요?',
      projectId: data.project.id,
    });
    await refresh();
  }
}
```

토스트 JSX:

```jsx
{toast && (
  <div className={styles.toast}>
    <span>{toast.msg}</span>
    <a
      href={`/shortform?projectId=${toast.projectId}`}
      className={styles.toastBtn}
    >
      이동
    </a>
    <button
      type="button"
      onClick={() => setToast(null)}
      className={styles.toastClose}
    >×</button>
  </div>
)}
```

- [ ] **Step 3: CSS 토스트 스타일 추가**

```css
.smallBtnDisabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.toast {
  position: fixed;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 18px;
  background: #1F2937;
  color: #fff;
  border-radius: 10px;
  font-size: 13px;
  z-index: 1000;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
}
.toastBtn {
  padding: 6px 12px;
  background: var(--ds-accent, #ff5f1f);
  color: #fff;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 700;
  text-decoration: none;
}
.toastClose {
  background: none;
  border: none;
  color: #9CA3AF;
  font-size: 18px;
  cursor: pointer;
  padding: 0 4px;
}
```

- [ ] **Step 4: 빌드 + 커밋**

```bash
npx next build 2>&1 | grep -iE "error|✓ Compiled" | head -5
git add app/mypage/ShortformProjectsSection.js app/mypage/ShortformProjectsSection.module.css
git commit -m "$(cat <<'EOF'
feat(mypage): Published 다운로드 안전장치 + 복제 토스트

video_r2_key가 없으면 다운로드 버튼 비활성("처리 중").
복제 성공 시 토스트 + 이동 링크로 현재 목록 상태 유지.
EOF
)"
```

---

## Task H5: MyPageClient 통합

**Files:**
- Modify: `app/mypage/MyPageClient.js`

- [ ] **Step 1: 카드 삽입**

`MyPageClient.js` 상단 import에 추가:

```javascript
import ShortformProjectsSection from './ShortformProjectsSection';
```

렌더 영역에서 `BrandKitSection` 카드 직후, `Threads 계정` 카드 직전에 삽입:

```jsx
<div className={styles.card}>
  <ShortformProjectsSection />
</div>
```

최종 마이페이지 카드 순서:

1. 사용자 정보
2. 크레딧 잔액
3. 내 이미지
4. 내 브랜드 킷 (Phase G)
5. **내 영상 (Phase H)** ← 신규
6. Threads 계정
7. 로그아웃

- [ ] **Step 2: 빌드 체크**

```bash
npx next build 2>&1 | grep -iE "error|✓ Compiled" | head -5
```

Expected: 성공.

- [ ] **Step 3: 커밋**

```bash
git add app/mypage/MyPageClient.js
git commit -m "$(cat <<'EOF'
feat(mypage): ShortformProjectsSection 삽입 (브랜드 킷 ↔ Threads 사이)

마이페이지 순서: 사용자 정보 → 크레딧 → 내 이미지 → 브랜드 킷 → 내 영상 → Threads → 로그아웃.
EOF
)"
```

---

## Task H6: ShortformClient — `?projectId` 쿼리로 Draft 복원

**핵심 기능.** 사용자가 마이페이지의 "이어서 작업" 버튼을 누르면 `/shortform?projectId=123` 으로 이동. ShortformClient가 쿼리를 읽어 `GET /api/shortform-projects/123`을 호출해 저장된 모든 상태를 복원.

**Files:**
- Modify: `app/shortform/ShortformClient.js`

- [ ] **Step 1: useSearchParams 훅 추가 + Suspense로 감싸기**

`ShortformClient.js` 상단에 import:

```javascript
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
```

Next.js 15에서 `useSearchParams`는 Suspense 경계 내부여야 하므로, 기존 export를 래퍼로 분리:

```javascript
function ShortformClientInner() {
  const searchParams = useSearchParams();
  const projectId = searchParams.get('projectId');
  // ... 기존 ShortformClient 본문
}

export default function ShortformClient() {
  return (
    <Suspense fallback={<div>불러오는 중...</div>}>
      <ShortformClientInner />
    </Suspense>
  );
}
```

- [ ] **Step 2: Draft 복원 useEffect**

컴포넌트 초입에 `projectId`가 있으면 API 호출해 상태 복원:

```javascript
const [restoredProjectId, setRestoredProjectId] = useState(null);
const [restoring, setRestoring] = useState(false);
const [restoreError, setRestoreError] = useState('');

useEffect(() => {
  if (!projectId) return;
  if (restoredProjectId === projectId) return;

  const token = typeof window !== 'undefined'
    ? localStorage.getItem('ddukddak_token')
    : null;
  if (!token) return;

  setRestoring(true);
  fetch(`/api/shortform-projects/${projectId}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
    .then((r) => r.json())
    .then((data) => {
      if (!data.project) {
        setRestoreError('프로젝트를 찾을 수 없습니다.');
        return;
      }
      const p = data.project;

      // Step 1 입력 복원
      if (p.blog_text) setBlogText(p.blog_text);
      if (p.keywords) setKeywords(p.keywords);
      if (p.user_experience) setUserExperience(p.user_experience);
      if (p.persona) setPersona(p.persona);
      if (p.tone) setTone(p.tone);
      if (p.duration_sec) setTotalDurationSec(p.duration_sec);

      // Step 2 벤치마크 복원
      if (p.selected_video_ids) setSelectedVideoIds(p.selected_video_ids);
      if (p.benchmark_aggregated) setBenchmarkData(p.benchmark_aggregated);

      // Step 3 대본 복원
      if (p.script_json) setScript(p.script_json);

      // Step 4 음성 복원
      if (p.voice_provider) setVoiceProvider(p.voice_provider);
      if (p.voice_id) setVoiceId(p.voice_id);
      if (p.audio_r2_key) setAudioKey(p.audio_r2_key);

      // Step 5 액센트 복원
      if (p.user_image_ids) setUserImageIds(p.user_image_ids);

      // Step 6 미리보기 복원
      if (p.preset) setPreset(p.preset);
      if (p.custom_options) setCustomOptions(p.custom_options);

      // 복원 완료 후 마지막 step으로 이동
      if (p.current_step) setCurrentStep(p.current_step);

      setRestoredProjectId(projectId);
      setRestoreError('');
    })
    .catch((err) => {
      setRestoreError(err.message || '복원에 실패했습니다.');
    })
    .finally(() => {
      setRestoring(false);
    });
}, [projectId, restoredProjectId]);
```

**중요:** 위 코드의 `setBlogText`, `setKeywords` 등 setter 이름은 Phase A~F에서 만들어진 실제 state 이름과 정확히 일치해야 한다. 각 Phase가 완료된 후 ShortformClient의 state 형태에 맞춰 조정할 것. 없는 필드는 스킵.

- [ ] **Step 3: 복원 배너 표시**

StepProgress 위에 복원 상태 배너:

```jsx
{restoring && (
  <div className={styles.restoreBanner}>
    작업 중이던 프로젝트를 불러오는 중...
  </div>
)}
{restoreError && (
  <div className={styles.restoreBannerError}>
    {restoreError}
    <a href="/shortform" className={styles.restoreBannerLink}>
      새로 시작
    </a>
  </div>
)}
{restoredProjectId && !restoring && !restoreError && (
  <div className={styles.restoreBannerSuccess}>
    작업 중이던 프로젝트를 이어서 작업합니다 (Step {currentStep})
  </div>
)}
```

CSS 추가 (`app/shortform/page.module.css`):

```css
.restoreBanner {
  padding: 10px 14px;
  background: rgba(59, 130, 246, 0.08);
  border: 1px solid rgba(59, 130, 246, 0.2);
  border-radius: 10px;
  font-size: 12px;
  color: #1E40AF;
  margin-bottom: 12px;
}
.restoreBannerSuccess {
  padding: 10px 14px;
  background: rgba(16, 185, 129, 0.08);
  border: 1px solid rgba(16, 185, 129, 0.25);
  border-radius: 10px;
  font-size: 12px;
  color: #065F46;
  margin-bottom: 12px;
}
.restoreBannerError {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 14px;
  background: #FEE2E2;
  border: 1px solid #FECACA;
  border-radius: 10px;
  font-size: 12px;
  color: #B91C1C;
  margin-bottom: 12px;
}
.restoreBannerLink {
  color: var(--ds-accent, #ff5f1f);
  font-weight: 700;
  text-decoration: none;
}
```

- [ ] **Step 4: 빌드 체크**

```bash
npx next build 2>&1 | grep -iE "error|✓ Compiled" | head -10
```

Expected: 성공. `useSearchParams`가 Suspense 밖에 있으면 빌드 경고가 발생하므로 Suspense 감싸기 확인.

- [ ] **Step 5: 커밋**

```bash
git add app/shortform/ShortformClient.js app/shortform/page.module.css
git commit -m "$(cat <<'EOF'
feat(shortform): ?projectId 쿼리로 Draft 복원

useSearchParams로 projectId 읽고 GET /api/shortform-projects/[id] 호출.
Step 1~6 state + currentStep 복원.
Suspense 경계 필수 (Next.js 15).
복원 중/성공/실패 배너 각각 표시.
EOF
)"
```

---

## Task H7: 수동 회귀 검증

**Files:** 없음 (수동 검증만)

- [ ] **Step 1: 전체 시나리오**

로컬 dev 서버에서 Phase C API가 먼저 배포된 상태를 가정하고 순차 확인:

1. **마이페이지 진입**
   - [ ] ShortformProjectsSection이 BrandKitSection 직후에 렌더링
   - [ ] Drafts 탭 기본 선택, 빈 상태 메시지 표시
   - [ ] 탭 전환 동작

2. **Drafts 목록**
   - [ ] 새 프로젝트 생성 후 Drafts 탭에 즉시 표시
   - [ ] currentStep 라벨 정확
   - [ ] 상대시간 정확 (방금 전 / N분 전)
   - [ ] 만료 경고 (updated_at을 25일 전으로 강제 수정 후 확인)
   - [ ] "이어서 작업" 클릭 → `/shortform?projectId=X`
   - [ ] 삭제 버튼 → confirm → 목록에서 제거

3. **Draft 복원**
   - [ ] 복원 배너 "불러오는 중..." 표시
   - [ ] 복원 완료 후 Step 1~6 state가 정확히 들어감
   - [ ] currentStep이 마지막 작업 단계로 이동
   - [ ] 없는 프로젝트 ID로 접근 시 에러 배너 + "새로 시작" 링크
   - [ ] 다른 사용자 프로젝트 ID로 접근 시 404/403

4. **Published 목록**
   - [ ] 완성 영상이 Published 탭에 표시
   - [ ] 썸네일 9:16 비율 정확
   - [ ] duration 배지 표시
   - [ ] 다운로드 버튼 → 파일 다운로드
   - [ ] video_r2_key 없을 때 "처리 중" 비활성 상태
   - [ ] 복제 버튼 → 토스트 → 이동 링크로 새 draft 진입
   - [ ] 삭제 버튼 → confirm → 목록에서 제거

5. **모바일 반응형**
   - [ ] Drafts 카드 레이아웃 깨지지 않음
   - [ ] Published 그리드 2-column 전환
   - [ ] 탭 버튼 터치 가능

6. **Suspense 경계**
   - [ ] /shortform 직접 진입 (projectId 없음) → 기존 동작 유지
   - [ ] /shortform?projectId=X 진입 → 복원 동작

- [ ] **Step 2: 발견 이슈 hotfix**

이슈 발견 시 수정 후 별도 커밋.

---

## Task H8: 메모리 + 마스터 플랜 상태 업데이트

**Files:**
- Modify: `~/.claude/projects/-Users-gong-eunhui-Desktop-naver-title-generator/memory/MEMORY.md`
- Create: `~/.claude/projects/-Users-gong-eunhui-Desktop-naver-title-generator/memory/project_shortform_phase_h_complete.md`
- Modify: `docs/superpowers/plans/2026-04-14-shortform-master-plan.md`

- [ ] **Step 1: 메모리 파일 작성**

```markdown
---
name: 숏폼 Phase H 완료
description: 프로젝트 히스토리 UI (Drafts + Published)
type: project
---

# 숏폼 Phase H 완료

**완료일:** 2026-04-XX
**스펙:** docs/superpowers/specs/2026-04-14-shortform-benchmark-pipeline-design.md §15
**플랜:** docs/superpowers/plans/2026-04-14-shortform-phase-h-history.md

## 핵심 변경

- 마이페이지 ShortformProjectsSection (탭: Drafts / Published)
- Drafts: currentStep + 상대시간 + 만료 경고 + "이어서 작업"
- Published: 9:16 썸네일 그리드 + 다운로드/복제/삭제
- ShortformClient `?projectId` 쿼리 복원 기능
- Suspense 경계 추가 (Next.js 15 useSearchParams 요구사항)

## 신규 파일

- app/mypage/ShortformProjectsSection.js + .module.css

## 수정 파일

- app/mypage/MyPageClient.js
- app/shortform/ShortformClient.js
- app/shortform/page.module.css

## Phase C 의존성

본 Phase는 Phase C가 제공하는 다음 API를 그대로 사용:
- GET /api/shortform-projects?status=draft|published
- GET /api/shortform-projects/[id]
- POST /api/shortform-projects/[id]/duplicate
- DELETE /api/shortform-projects/[id]
- GET /api/shortform-projects/[id]/download

## 다음 Phase

Phase I (SSE Progress) — 실시간 진행 표시로 Draft 자동 저장 훅 보강.
Phase J (YouTube Upload) — Published 카드에 YouTube 직접 업로드 버튼 추가.
```

- [ ] **Step 2: MEMORY.md 최근 세션 섹션에 추가**

```markdown
- [4/XX 숏폼 Phase H 완료](project_shortform_phase_h_complete.md) — 프로젝트 히스토리 UI + ?projectId 복원
```

- [ ] **Step 3: 마스터 플랜 Phase H 상태 마킹**

`docs/superpowers/plans/2026-04-14-shortform-master-plan.md`의 Phase H 섹션 끝에:

```markdown
**상태:** ✅ 완료 (커밋 SHA: XXXXXXX)
```

- [ ] **Step 4: 최종 커밋**

```bash
git add docs/superpowers/plans/2026-04-14-shortform-master-plan.md
git commit -m "$(cat <<'EOF'
docs: Phase H 완료 마킹 + 메모리 기록

Phase H (Project History UI) 완료. Draft 재편집 + Published 재다운로드/복제 흐름 완성.
Phase I (SSE) 및 Phase J (YouTube) 진입 가능.
EOF
)"
```

---

## Phase H 자기 검토

### Spec coverage

| 스펙 섹션 | 커버 task |
|---|---|
| §15 UI 위치 — 마이페이지 내 영상 섹션 | H1, H5 |
| §15 Drafts 목록 (currentStep, 이어서 작업) | H1, H3 |
| §15 Published 목록 (썸네일, 다운로드, 복제) | H1, H4 |
| §15 자동 저장 | (Phase C 담당) |
| §15 30일 보관 | H3 (만료 경고 표시) |
| ?projectId 복원 | H6 |

### 알려진 미완 (다른 Phase)

- 자동 저장(Step별 PATCH 호출)은 **Phase C**에서 구현됨. Phase H는 "이어서 작업" 복원만 담당.
- Published 카드의 YouTube 직접 업로드 버튼은 **Phase J**에서 추가.
- Draft 복원 후 중간 수정 → 저장 흐름은 **Phase C**의 자동 저장 훅이 처리.

### 회귀 안전성

- ShortformClient에 `?projectId` 없이 진입 시 기존 동작과 100% 동일
- Phase C API가 없으면 fetch가 404/500을 받고 에러 배너 표시만 됨 (크래시 없음)
- 마이페이지의 기존 섹션(사용자 정보/크레딧/내 이미지/브랜드 킷/Threads)은 무변경
- `useSearchParams`는 Suspense 경계로 감싸 빌드 경고 방지

### 통합 지점 (다른 Phase가 사용할 인터페이스)

- **Phase C**: 본 Phase가 호출하는 API 5종을 정확한 스키마로 구현해야 함
- **Phase I**: Draft 자동 저장 진행률을 SSE로 스트리밍 시, 본 Phase의 "이어서 작업" 흐름과 충돌 없도록 `restoredProjectId` state 참조
- **Phase J**: Published 카드의 `publishedActions`에 YouTube 버튼 추가 가능

### Phase C 의존성 주의

Phase H를 실행하기 전 반드시 확인:

1. `shortform_projects` 테이블이 마이그레이션 되었는가?
2. `/api/shortform-projects` GET/POST/PATCH/DELETE 전부 동작하는가?
3. `/api/shortform-projects/[id]/duplicate` POST가 새 draft row를 반환하는가?
4. `/api/shortform-projects/[id]/download` GET이 R2 presigned URL 또는 스트림을 반환하는가?

Phase C가 불완전하면 H7 수동 검증 단계에서 fail함. Phase C 완료 후 진행할 것.

---

## Phase H 완료 후 다음 단계

Phase I (SSE Progress + Cancel) 상세 플랜 실행. SSE는 벤치마킹(Phase B) 및 대본 생성(Phase D)의 진행 상태 발행 지점이 필요하므로, 그 Phase들이 완료된 후 진행하는 것이 자연스럽다.
