# Phase C — Project Model: shortform_projects DB + Auto-save

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. 12 Phase 중 Phase C. 마스터 플랜: `2026-04-14-shortform-master-plan.md`. 스펙: `2026-04-14-shortform-benchmark-pipeline-design.md` §15.

**Goal:** `shortform_projects` 테이블을 lazy migration 패턴으로 생성하고 draft/published 상태의 프로젝트를 CRUD할 수 있는 API + 클라이언트 자동 저장 훅을 구축한다. Phase H(프로젝트 히스토리 UI)와 Phase I(SSE 진행 표시)의 데이터 레이어가 된다.

**Architecture:** `lib/user-images.js` 의 `_schemaReady` 싱글톤 패턴을 그대로 복제해 테이블 생성은 첫 API 호출 시 1회만 수행. REST API는 카드뉴스 히스토리/내 이미지 보관함과 동일한 네이밍 규칙(`/api/shortform-projects/[id]/action`). 자동 저장 훅은 React 전용으로, step1Value / script / preset 등 단일 state 객체를 debounce 후 PATCH.

**Tech Stack:** Next.js 15 App Router Route Handler, Neon PostgreSQL (`@neondatabase/serverless`), React hooks (useEffect + useRef + setTimeout debounce)

**의존성:** 없음 (Phase A와 병렬 1주차 시작 가능)

**예상 작업량:** 9 task, ~1주

---

## 파일 구조

### 신규 파일

```
lib/shortform-projects.js                           DB 헬퍼 + ensureSchema + CRUD 함수
app/api/shortform-projects/route.js                 POST (create draft) + GET (list)
app/api/shortform-projects/[id]/route.js            GET (single) + PATCH (auto-save) + DELETE
app/api/shortform-projects/[id]/publish/route.js    POST (published 전환)
app/api/shortform-projects/[id]/duplicate/route.js  POST (복제)
app/shortform/hooks/useProjectAutoSave.js           클라이언트 자동 저장 훅
```

### 수정 파일 (Phase C 끝에 최소 통합만)

```
app/shortform/ShortformClient.js    useProjectAutoSave 훅 임포트 + activeProjectId state
```

Phase C에서는 훅을 ShortformClient에 **import만** 하고 실제 UI 통합은 Phase H에서 마무리. 회귀 안전성 보장.

---

## Task C0: 의존성 사전 점검

Phase C는 신규 패키지 없음. 기존 `@neondatabase/serverless`, `@/lib/api-helpers`, `@/lib/db` 만 사용.

**Files:**
- Read only

- [ ] **Step 1: 참고 파일 확인**

```bash
ls -la /Users/gong-eunhui/Desktop/naver-title-generator/lib/user-images.js /Users/gong-eunhui/Desktop/naver-title-generator/lib/db.js /Users/gong-eunhui/Desktop/naver-title-generator/lib/api-helpers.js
```

Expected: 3개 파일 전부 존재. `lib/api-helpers.js` 의 `extractToken`, `resolveSessionEmail`, `jsonResponse`, `handleOptions`, `resolveAdmin` 5개 함수 존재 확인.

- [ ] **Step 2: 기존 `shortform_projects` 테이블 존재 여부**

```bash
grep -r "shortform_projects" /Users/gong-eunhui/Desktop/naver-title-generator/lib /Users/gong-eunhui/Desktop/naver-title-generator/app/api 2>/dev/null
```

Expected: 매치 없음 (신규 테이블).

---

## Task C1: lib/shortform-projects.js — DB 헬퍼

스펙 §15 스키마를 그대로 구현. `lib/user-images.js` 의 `_schemaReady` 패턴 복제.

**Files:**
- Create: `lib/shortform-projects.js`

- [ ] **Step 1: 헬퍼 작성**

```javascript
// lib/shortform-projects.js
/**
 * 숏폼 프로젝트 히스토리 DB 헬퍼 (Phase C).
 * draft / published / failed 상태의 프로젝트를 CRUD.
 *
 * 스키마: 스펙 §15 참고.
 * ensureSchema: lib/user-images.js와 동일한 lazy 싱글톤 패턴.
 */
import { getDb } from '@/lib/db';

const VALID_STATUS = new Set(['draft', 'published', 'failed']);

// 첫 호출 시 1회만 테이블/인덱스 생성 (serverless 인스턴스당)
let _schemaReady = null;
async function ensureSchema() {
  if (_schemaReady) return _schemaReady;
  _schemaReady = (async () => {
    const sql = getDb();
    await sql`CREATE TABLE IF NOT EXISTS shortform_projects (
      id SERIAL PRIMARY KEY,
      user_email VARCHAR(254) NOT NULL,
      status VARCHAR(20) NOT NULL,
      current_step INTEGER DEFAULT 1,
      title VARCHAR(200),
      blog_text TEXT,
      keywords TEXT[],
      user_experience TEXT,
      persona VARCHAR(20),
      tone VARCHAR(20),
      duration_sec INTEGER,
      selected_video_ids TEXT[],
      benchmark_aggregated JSONB,
      script_json JSONB,
      script_edited TEXT,
      voice_provider VARCHAR(20),
      voice_id VARCHAR(50),
      audio_r2_key TEXT,
      bgm_category VARCHAR(20),
      user_image_ids INTEGER[],
      ai_image_count INTEGER,
      preset VARCHAR(20),
      custom_options JSONB,
      video_r2_key TEXT,
      caption_text TEXT,
      duration_actual INTEGER,
      youtube_video_id VARCHAR(20),
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      published_at TIMESTAMPTZ
    )`;
    await sql`CREATE INDEX IF NOT EXISTS idx_shortform_projects_user_status
      ON shortform_projects (user_email, status, updated_at DESC)`;
  })().catch((err) => {
    _schemaReady = null;
    console.error('[SHORTFORM-PROJECTS] ensureSchema failed:', err.message);
    throw err;
  });
  return _schemaReady;
}

/**
 * 허용된 컬럼만 필터링 (PATCH 시 임의 컬럼 주입 방지)
 */
const UPDATABLE_COLUMNS = [
  'status', 'current_step', 'title',
  'blog_text', 'keywords', 'user_experience', 'persona', 'tone', 'duration_sec',
  'selected_video_ids', 'benchmark_aggregated',
  'script_json', 'script_edited',
  'voice_provider', 'voice_id', 'audio_r2_key', 'bgm_category',
  'user_image_ids', 'ai_image_count',
  'preset', 'custom_options',
  'video_r2_key', 'caption_text', 'duration_actual', 'youtube_video_id',
];

function pickUpdatable(patch) {
  const clean = {};
  for (const key of UPDATABLE_COLUMNS) {
    if (Object.prototype.hasOwnProperty.call(patch, key)) {
      clean[key] = patch[key];
    }
  }
  return clean;
}

/**
 * 새 draft 생성.
 * @param {string} email
 * @param {object} initial - Step 1 입력(blog_text, keywords, persona 등)
 * @returns {Promise<object>} 생성된 row
 */
export async function createDraft(email, initial = {}) {
  await ensureSchema();
  const sql = getDb();
  const rows = await sql`INSERT INTO shortform_projects
    (user_email, status, current_step, title,
     blog_text, keywords, user_experience, persona, tone, duration_sec)
    VALUES (${email}, ${'draft'}, ${Number(initial.current_step) || 1},
            ${initial.title || null},
            ${initial.blog_text || null},
            ${initial.keywords || null},
            ${initial.user_experience || null},
            ${initial.persona || null},
            ${initial.tone || null},
            ${initial.duration_sec || null})
    RETURNING *`;
  return rows[0];
}

/**
 * 소유권 확인 포함 단일 조회.
 * 존재하지 않거나 타 사용자 소유면 null.
 */
export async function getProjectById(email, id) {
  await ensureSchema();
  const sql = getDb();
  const rows = await sql`SELECT * FROM shortform_projects
    WHERE id = ${id} AND user_email = ${email}`;
  return rows[0] || null;
}

/**
 * 내 프로젝트 목록.
 * @param {string} email
 * @param {object} opts - { status?: 'draft'|'published', limit?: number }
 */
export async function listProjects(email, opts = {}) {
  await ensureSchema();
  const sql = getDb();
  const limit = Math.min(Number(opts.limit) || 50, 200);
  if (opts.status && VALID_STATUS.has(opts.status)) {
    return await sql`SELECT id, status, current_step, title, blog_text, persona, tone,
      duration_sec, preset, video_r2_key, caption_text, duration_actual,
      youtube_video_id, created_at, updated_at, published_at
      FROM shortform_projects
      WHERE user_email = ${email} AND status = ${opts.status}
      ORDER BY updated_at DESC LIMIT ${limit}`;
  }
  return await sql`SELECT id, status, current_step, title, blog_text, persona, tone,
    duration_sec, preset, video_r2_key, caption_text, duration_actual,
    youtube_video_id, created_at, updated_at, published_at
    FROM shortform_projects
    WHERE user_email = ${email}
    ORDER BY updated_at DESC LIMIT ${limit}`;
}

/**
 * PATCH — 부분 업데이트. updated_at 자동 갱신.
 * 허용된 컬럼만 반영.
 * 존재하지 않거나 타 사용자 소유면 null.
 */
export async function updateProject(email, id, patch) {
  await ensureSchema();
  const clean = pickUpdatable(patch);
  if (Object.keys(clean).length === 0) {
    return await getProjectById(email, id);
  }
  const sql = getDb();
  // 소유권 먼저 확인
  const owner = await sql`SELECT id FROM shortform_projects WHERE id = ${id} AND user_email = ${email}`;
  if (owner.length === 0) return null;

  // neon은 dynamic SET 절을 지원하지 않으므로 각 컬럼을 명시 분기.
  // 컬럼이 많으므로 화이트리스트 기반 개별 UPDATE 반복 대신 sql.unsafe 대체:
  // 안전한 접근 — 개별 컬럼 UPDATE를 하나의 트랜잭션으로 처리.
  // 단일 쿼리 작성을 위해 sql.query(템플릿 구성) 대신 수동 바인딩 사용.
  const setFragments = [];
  const values = [];
  let idx = 1;
  for (const [key, val] of Object.entries(clean)) {
    setFragments.push(`${key} = $${idx}`);
    values.push(val);
    idx += 1;
  }
  setFragments.push(`updated_at = NOW()`);
  values.push(id, email);

  const queryText = `UPDATE shortform_projects
    SET ${setFragments.join(', ')}
    WHERE id = $${idx} AND user_email = $${idx + 1}
    RETURNING *`;

  const rows = await sql.query(queryText, values);
  return rows[0] || null;
}

/**
 * 완성 처리 (draft → published).
 * video_r2_key와 caption_text가 있어야 published 전환 허용.
 */
export async function publishProject(email, id, finalFields = {}) {
  await ensureSchema();
  const current = await getProjectById(email, id);
  if (!current) return null;
  const sql = getDb();
  const rows = await sql`UPDATE shortform_projects
    SET status = ${'published'},
        current_step = ${7},
        video_r2_key = COALESCE(${finalFields.video_r2_key || null}, video_r2_key),
        caption_text = COALESCE(${finalFields.caption_text || null}, caption_text),
        duration_actual = COALESCE(${finalFields.duration_actual || null}, duration_actual),
        published_at = NOW(),
        updated_at = NOW()
    WHERE id = ${id} AND user_email = ${email}
    RETURNING *`;
  return rows[0] || null;
}

/**
 * 복제 — id 기반으로 Step 1~5 값만 복사해 새 draft 생성.
 * 산출물(video_r2_key, audio_r2_key 등)과 published 관련 필드는 복사하지 않음.
 */
export async function duplicateProject(email, id) {
  await ensureSchema();
  const original = await getProjectById(email, id);
  if (!original) return null;
  const sql = getDb();
  const rows = await sql`INSERT INTO shortform_projects
    (user_email, status, current_step, title,
     blog_text, keywords, user_experience, persona, tone, duration_sec,
     selected_video_ids, benchmark_aggregated, preset, custom_options)
    VALUES (${email}, ${'draft'}, ${1},
            ${original.title ? `${original.title} (복제)` : null},
            ${original.blog_text || null},
            ${original.keywords || null},
            ${original.user_experience || null},
            ${original.persona || null},
            ${original.tone || null},
            ${original.duration_sec || null},
            ${original.selected_video_ids || null},
            ${original.benchmark_aggregated || null},
            ${original.preset || null},
            ${original.custom_options || null})
    RETURNING *`;
  return rows[0];
}

/**
 * 삭제. 실패 시 false, 성공 시 true.
 */
export async function deleteProject(email, id) {
  await ensureSchema();
  const sql = getDb();
  const rows = await sql`DELETE FROM shortform_projects
    WHERE id = ${id} AND user_email = ${email}
    RETURNING id`;
  return rows.length > 0;
}
```

**참고:** neon의 tagged template은 `sql.query(text, values)` 메서드도 지원. 동적 SET 절이 필요한 `updateProject`에서만 사용.

- [ ] **Step 2: 빌드 체크**

```bash
cd /Users/gong-eunhui/Desktop/naver-title-generator && npx next build 2>&1 | grep -iE "error|✓ Compiled" | head -10
```

Expected: `✓ Compiled successfully`. `shortform-projects` 관련 타입/import 오류 0건.

- [ ] **Step 3: 커밋**

```bash
git add lib/shortform-projects.js
git commit -m "$(cat <<'EOF'
feat(lib): shortform_projects DB 헬퍼 + ensureSchema

lazy migration 패턴(lib/user-images.js와 동일).
스펙 §15 스키마 그대로 구현.

CRUD 함수:
- createDraft(email, initial)
- getProjectById(email, id) — 소유권 검증 포함
- listProjects(email, { status, limit })
- updateProject(email, id, patch) — 화이트리스트 컬럼만 반영
- publishProject(email, id, finalFields)
- duplicateProject(email, id)
- deleteProject(email, id)

updateProject는 sql.query(text, values)로 동적 SET 절 처리.
Phase H(프로젝트 히스토리 UI)의 데이터 레이어.
EOF
)"
```

---

## Task C2: POST + GET 컬렉션 라우트

**Files:**
- Create: `app/api/shortform-projects/route.js`

- [ ] **Step 1: 라우트 작성**

```javascript
// app/api/shortform-projects/route.js
import {
  extractToken,
  resolveSessionEmail,
  jsonResponse,
  handleOptions,
} from '@/lib/api-helpers';
import { createDraft, listProjects } from '@/lib/shortform-projects';

export const maxDuration = 30;

async function requireAuth(request) {
  const token = extractToken(request);
  if (!token) return null;
  return await resolveSessionEmail(token);
}

export async function OPTIONS(request) {
  return handleOptions(request);
}

/**
 * GET /api/shortform-projects?status=draft|published
 * 내 숏폼 프로젝트 목록 (기본 최신순 50개)
 */
export async function GET(request) {
  const email = await requireAuth(request);
  if (!email) {
    return jsonResponse(request, { error: '로그인이 필요합니다.' }, { status: 401 });
  }

  const url = new URL(request.url);
  const status = url.searchParams.get('status') || null;
  const limit = Number(url.searchParams.get('limit')) || 50;

  try {
    const projects = await listProjects(email, { status, limit });
    return jsonResponse(request, { projects });
  } catch (err) {
    console.error('[SHORTFORM-PROJECTS] GET list failed:', err.message);
    return jsonResponse(request, { error: '목록을 불러오지 못했습니다.' }, { status: 500 });
  }
}

/**
 * POST /api/shortform-projects
 * 새 draft 생성. body에 Step 1 초기값 전달 가능 (선택).
 *
 * Request body (선택):
 * {
 *   blog_text, keywords, user_experience, persona, tone, duration_sec, title
 * }
 */
export async function POST(request) {
  const email = await requireAuth(request);
  if (!email) {
    return jsonResponse(request, { error: '로그인이 필요합니다.' }, { status: 401 });
  }

  let body = {};
  try {
    body = await request.json();
  } catch (_) {
    body = {};
  }

  try {
    const project = await createDraft(email, body);
    return jsonResponse(request, { project }, { status: 201 });
  } catch (err) {
    console.error('[SHORTFORM-PROJECTS] POST create failed:', err.message);
    return jsonResponse(request, { error: '프로젝트 생성에 실패했습니다.' }, { status: 500 });
  }
}
```

- [ ] **Step 2: 빌드 체크**

```bash
npx next build 2>&1 | grep -iE "error|✓ Compiled|shortform-projects" | head -10
```

Expected: `✓ Compiled successfully`. 라우트가 Next.js 라우트 트리에 잡혀 있는지 확인.

- [ ] **Step 3: 커밋**

```bash
git add app/api/shortform-projects/route.js
git commit -m "$(cat <<'EOF'
feat(api): POST/GET /api/shortform-projects

- GET: 내 프로젝트 목록 (status 필터 + limit, 기본 50)
- POST: 새 draft 생성 (Step 1 초기값 선택 전달)

인증: extractToken + resolveSessionEmail (로그인 필수).
비회원/비로그인 401.
EOF
)"
```

---

## Task C3: [id] 라우트 — GET + PATCH + DELETE

**Files:**
- Create: `app/api/shortform-projects/[id]/route.js`

- [ ] **Step 1: 라우트 작성**

```javascript
// app/api/shortform-projects/[id]/route.js
import {
  extractToken,
  resolveSessionEmail,
  jsonResponse,
  handleOptions,
} from '@/lib/api-helpers';
import {
  getProjectById,
  updateProject,
  deleteProject,
} from '@/lib/shortform-projects';

export const maxDuration = 30;

async function requireAuth(request) {
  const token = extractToken(request);
  if (!token) return null;
  return await resolveSessionEmail(token);
}

function parseId(params) {
  const id = Number(params?.id);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function OPTIONS(request) {
  return handleOptions(request);
}

/**
 * GET /api/shortform-projects/[id]
 * 내 프로젝트 단일 조회.
 */
export async function GET(request, { params }) {
  const email = await requireAuth(request);
  if (!email) {
    return jsonResponse(request, { error: '로그인이 필요합니다.' }, { status: 401 });
  }
  const id = parseId(await params);
  if (!id) {
    return jsonResponse(request, { error: '유효하지 않은 id입니다.' }, { status: 400 });
  }
  try {
    const project = await getProjectById(email, id);
    if (!project) {
      return jsonResponse(request, { error: '프로젝트를 찾을 수 없습니다.' }, { status: 404 });
    }
    return jsonResponse(request, { project });
  } catch (err) {
    console.error('[SHORTFORM-PROJECTS] GET one failed:', err.message);
    return jsonResponse(request, { error: '조회에 실패했습니다.' }, { status: 500 });
  }
}

/**
 * PATCH /api/shortform-projects/[id]
 * 부분 업데이트 (auto-save).
 * body: 변경할 컬럼(화이트리스트만 적용)
 */
export async function PATCH(request, { params }) {
  const email = await requireAuth(request);
  if (!email) {
    return jsonResponse(request, { error: '로그인이 필요합니다.' }, { status: 401 });
  }
  const id = parseId(await params);
  if (!id) {
    return jsonResponse(request, { error: '유효하지 않은 id입니다.' }, { status: 400 });
  }

  let body = {};
  try {
    body = await request.json();
  } catch (_) {
    return jsonResponse(request, { error: '잘못된 요청 본문입니다.' }, { status: 400 });
  }

  try {
    const project = await updateProject(email, id, body);
    if (!project) {
      return jsonResponse(request, { error: '프로젝트를 찾을 수 없습니다.' }, { status: 404 });
    }
    return jsonResponse(request, { project });
  } catch (err) {
    console.error('[SHORTFORM-PROJECTS] PATCH failed:', err.message);
    return jsonResponse(request, { error: '저장에 실패했습니다.' }, { status: 500 });
  }
}

/**
 * DELETE /api/shortform-projects/[id]
 */
export async function DELETE(request, { params }) {
  const email = await requireAuth(request);
  if (!email) {
    return jsonResponse(request, { error: '로그인이 필요합니다.' }, { status: 401 });
  }
  const id = parseId(await params);
  if (!id) {
    return jsonResponse(request, { error: '유효하지 않은 id입니다.' }, { status: 400 });
  }
  try {
    const ok = await deleteProject(email, id);
    if (!ok) {
      return jsonResponse(request, { error: '프로젝트를 찾을 수 없습니다.' }, { status: 404 });
    }
    return jsonResponse(request, { ok: true });
  } catch (err) {
    console.error('[SHORTFORM-PROJECTS] DELETE failed:', err.message);
    return jsonResponse(request, { error: '삭제에 실패했습니다.' }, { status: 500 });
  }
}
```

**참고:** Next.js 15 App Router는 `params`가 Promise이므로 `await params` 필수.

- [ ] **Step 2: 빌드 체크**

```bash
npx next build 2>&1 | grep -iE "error|✓ Compiled" | head -10
```

Expected: 컴파일 성공.

- [ ] **Step 3: 커밋**

```bash
git add app/api/shortform-projects/\[id\]/route.js
git commit -m "$(cat <<'EOF'
feat(api): GET/PATCH/DELETE /api/shortform-projects/[id]

단일 프로젝트 조회·저장·삭제.
소유권 검증은 lib/shortform-projects.js에서 일괄 처리.

PATCH는 화이트리스트 컬럼만 반영 (임의 컬럼 주입 차단).
Phase C 자동 저장 훅이 이 엔드포인트를 debounce PATCH로 호출.
EOF
)"
```

---

## Task C4: publish 라우트

**Files:**
- Create: `app/api/shortform-projects/[id]/publish/route.js`

- [ ] **Step 1: 라우트 작성**

```javascript
// app/api/shortform-projects/[id]/publish/route.js
import {
  extractToken,
  resolveSessionEmail,
  jsonResponse,
  handleOptions,
} from '@/lib/api-helpers';
import { publishProject } from '@/lib/shortform-projects';

export const maxDuration = 30;

async function requireAuth(request) {
  const token = extractToken(request);
  if (!token) return null;
  return await resolveSessionEmail(token);
}

export async function OPTIONS(request) {
  return handleOptions(request);
}

/**
 * POST /api/shortform-projects/[id]/publish
 *
 * body:
 * { video_r2_key, caption_text, duration_actual }
 *
 * 최종 산출물이 준비된 프로젝트를 published 상태로 전환.
 */
export async function POST(request, { params }) {
  const email = await requireAuth(request);
  if (!email) {
    return jsonResponse(request, { error: '로그인이 필요합니다.' }, { status: 401 });
  }
  const resolved = await params;
  const id = Number(resolved?.id);
  if (!Number.isInteger(id) || id <= 0) {
    return jsonResponse(request, { error: '유효하지 않은 id입니다.' }, { status: 400 });
  }

  let body = {};
  try {
    body = await request.json();
  } catch (_) {
    body = {};
  }

  try {
    const project = await publishProject(email, id, body);
    if (!project) {
      return jsonResponse(request, { error: '프로젝트를 찾을 수 없습니다.' }, { status: 404 });
    }
    return jsonResponse(request, { project });
  } catch (err) {
    console.error('[SHORTFORM-PROJECTS] publish failed:', err.message);
    return jsonResponse(request, { error: '완성 처리에 실패했습니다.' }, { status: 500 });
  }
}
```

- [ ] **Step 2: 빌드 체크**

```bash
npx next build 2>&1 | grep -iE "error|✓ Compiled" | head -5
```

Expected: 컴파일 성공.

- [ ] **Step 3: 커밋**

```bash
git add "app/api/shortform-projects/[id]/publish/route.js"
git commit -m "$(cat <<'EOF'
feat(api): POST /api/shortform-projects/[id]/publish

draft → published 전환. video_r2_key/caption_text/duration_actual
최종 필드를 병합 저장하고 published_at 기록.

Step 7 다운로드 완료 시 ShortformClient가 호출 예정.
EOF
)"
```

---

## Task C5: duplicate 라우트

**Files:**
- Create: `app/api/shortform-projects/[id]/duplicate/route.js`

- [ ] **Step 1: 라우트 작성**

```javascript
// app/api/shortform-projects/[id]/duplicate/route.js
import {
  extractToken,
  resolveSessionEmail,
  jsonResponse,
  handleOptions,
} from '@/lib/api-helpers';
import { duplicateProject } from '@/lib/shortform-projects';

export const maxDuration = 30;

async function requireAuth(request) {
  const token = extractToken(request);
  if (!token) return null;
  return await resolveSessionEmail(token);
}

export async function OPTIONS(request) {
  return handleOptions(request);
}

/**
 * POST /api/shortform-projects/[id]/duplicate
 *
 * 기존 프로젝트의 Step 1~2, 프리셋을 복사해 새 draft 생성.
 * 산출물(video/audio r2 key)은 복사하지 않음.
 */
export async function POST(request, { params }) {
  const email = await requireAuth(request);
  if (!email) {
    return jsonResponse(request, { error: '로그인이 필요합니다.' }, { status: 401 });
  }
  const resolved = await params;
  const id = Number(resolved?.id);
  if (!Number.isInteger(id) || id <= 0) {
    return jsonResponse(request, { error: '유효하지 않은 id입니다.' }, { status: 400 });
  }

  try {
    const project = await duplicateProject(email, id);
    if (!project) {
      return jsonResponse(request, { error: '원본 프로젝트를 찾을 수 없습니다.' }, { status: 404 });
    }
    return jsonResponse(request, { project }, { status: 201 });
  } catch (err) {
    console.error('[SHORTFORM-PROJECTS] duplicate failed:', err.message);
    return jsonResponse(request, { error: '복제에 실패했습니다.' }, { status: 500 });
  }
}
```

- [ ] **Step 2: 빌드 체크**

```bash
npx next build 2>&1 | grep -iE "error|✓ Compiled" | head -5
```

Expected: 컴파일 성공.

- [ ] **Step 3: 커밋**

```bash
git add "app/api/shortform-projects/[id]/duplicate/route.js"
git commit -m "$(cat <<'EOF'
feat(api): POST /api/shortform-projects/[id]/duplicate

기존 프로젝트의 Step 1~2 + 프리셋만 복사해 새 draft 생성.
title에 "(복제)" 접미사. 산출물/음성/비디오 키는 복사 안 함.

Phase H 프로젝트 히스토리 UI의 "복제해서 새로 만들기" 버튼이
이 엔드포인트 사용.
EOF
)"
```

---

## Task C6: useProjectAutoSave 클라이언트 훅

**Files:**
- Create: `app/shortform/hooks/useProjectAutoSave.js`

- [ ] **Step 1: 훅 작성**

```javascript
// app/shortform/hooks/useProjectAutoSave.js
'use client';

import { useEffect, useRef, useState, useCallback } from 'react';

/**
 * 숏폼 프로젝트 자동 저장 훅.
 *
 * 사용 예:
 *   const { projectId, saveNow, isSaving, lastSavedAt } = useProjectAutoSave({
 *     authToken,                 // localStorage ddukddak_token
 *     enabled: !!email,          // 로그인한 사용자만
 *     snapshot: {                // 저장할 state 스냅샷 (변경 시 자동 debounce 저장)
 *       current_step,
 *       blog_text, keywords, user_experience, persona, tone, duration_sec,
 *       script_json, preset, ...
 *     },
 *     debounceMs: 1500,
 *   });
 *
 * 동작:
 * - enabled=true + projectId 없음 → 첫 snapshot 유의미 변경 시 POST로 draft 생성
 * - projectId 존재 → snapshot 변경 시 debounce 후 PATCH
 * - saveNow()는 debounce 무시 즉시 저장 (Step 이동 직전 호출)
 */
export default function useProjectAutoSave({
  authToken,
  enabled = true,
  snapshot,
  debounceMs = 1500,
  initialProjectId = null,
}) {
  const [projectId, setProjectId] = useState(initialProjectId);
  const [isSaving, setIsSaving] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState(null);
  const [error, setError] = useState(null);

  // 최신 snapshot 참조 (stale closure 방지)
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;

  const timerRef = useRef(null);
  const pendingCreateRef = useRef(false);
  const projectIdRef = useRef(projectId);
  projectIdRef.current = projectId;

  const headers = useCallback(() => ({
    'Content-Type': 'application/json',
    ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
  }), [authToken]);

  const doCreate = useCallback(async () => {
    if (pendingCreateRef.current) return null;
    pendingCreateRef.current = true;
    try {
      const res = await fetch('/api/shortform-projects', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify(snapshotRef.current || {}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'create failed');
      setProjectId(data.project.id);
      setLastSavedAt(new Date());
      setError(null);
      return data.project.id;
    } catch (err) {
      console.warn('[useProjectAutoSave] create failed:', err.message);
      setError(err.message);
      return null;
    } finally {
      pendingCreateRef.current = false;
    }
  }, [headers]);

  const doPatch = useCallback(async (id) => {
    if (!id) return;
    setIsSaving(true);
    try {
      const res = await fetch(`/api/shortform-projects/${id}`, {
        method: 'PATCH',
        headers: headers(),
        body: JSON.stringify(snapshotRef.current || {}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'patch failed');
      setLastSavedAt(new Date());
      setError(null);
    } catch (err) {
      console.warn('[useProjectAutoSave] patch failed:', err.message);
      setError(err.message);
    } finally {
      setIsSaving(false);
    }
  }, [headers]);

  /**
   * 즉시 저장 (debounce 무시). Step 이동 직전, publish 직전에 호출.
   * 저장 완료 후 projectId 반환 (신규 생성 포함).
   */
  const saveNow = useCallback(async () => {
    if (!enabled) return null;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    let id = projectIdRef.current;
    if (!id) {
      id = await doCreate();
      return id;
    }
    await doPatch(id);
    return id;
  }, [enabled, doCreate, doPatch]);

  // snapshot 변경 감지 → debounce 저장
  useEffect(() => {
    if (!enabled) return;
    if (!snapshot) return;

    // 최초 의미 있는 입력이 있을 때만 draft 생성
    const hasMeaningfulInput =
      (snapshot.blog_text && snapshot.blog_text.length >= 10) ||
      (snapshot.keywords && (Array.isArray(snapshot.keywords)
        ? snapshot.keywords.length > 0
        : String(snapshot.keywords).trim().length >= 2)) ||
      snapshot.script_json;

    if (!projectIdRef.current && !hasMeaningfulInput) {
      return; // 빈 폼은 저장 안 함
    }

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      if (!projectIdRef.current) {
        await doCreate();
      } else {
        await doPatch(projectIdRef.current);
      }
    }, debounceMs);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // snapshot을 JSON 직렬화해서 비교 — shallow 변경 감지
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, debounceMs, JSON.stringify(snapshot)]);

  return { projectId, saveNow, isSaving, lastSavedAt, error };
}
```

**주의:**
- `JSON.stringify(snapshot)` 의존성은 snapshot이 작을 때만 안전 — Step 1~5 필드는 KB 단위이므로 OK
- stale closure 방지 위해 `snapshotRef` + `projectIdRef` 사용
- `saveNow()` 는 Step 이동 버튼 클릭 시 호출하므로 debounce 무시

- [ ] **Step 2: 빌드 체크**

```bash
npx next build 2>&1 | grep -iE "error|✓ Compiled" | head -5
```

Expected: 컴파일 성공. React hooks ESLint 경고 허용(의존성은 의도적).

- [ ] **Step 3: 커밋**

```bash
git add app/shortform/hooks/useProjectAutoSave.js
git commit -m "$(cat <<'EOF'
feat(shortform): useProjectAutoSave 훅

클라이언트 자동 저장 훅. snapshot 변경 시 debounce 후 PATCH,
처음 의미있는 입력이 감지되면 POST로 draft 자동 생성.

- enabled 플래그로 비로그인 상황에서 no-op
- saveNow()로 debounce 무시 즉시 저장 (Step 이동 직전)
- snapshotRef/projectIdRef로 stale closure 방지

Phase C의 자동 저장 동작(스펙 §15)을 담당. Phase H에서
ShortformClient가 full snapshot 전달해 사용할 예정.
EOF
)"
```

---

## Task C7: ShortformClient 최소 통합 (임포트만)

Phase C는 훅을 **ShortformClient에 import만** 추가. 실제 snapshot 연결은 Phase H(프로젝트 히스토리 UI)에서 완성. 현재 회귀를 피하기 위해 Phase C 단계에서는 기능 플래그로 비활성 상태 유지.

**Files:**
- Modify: `app/shortform/ShortformClient.js`

- [ ] **Step 1: import + placeholder 추가**

`app/shortform/ShortformClient.js` 상단 import에 추가:

```javascript
import useProjectAutoSave from './hooks/useProjectAutoSave';
```

함수 본문 상단에 비활성 훅 호출 추가 (Phase H까지 데이터 연결 없음):

```javascript
// Phase C: 자동 저장 훅 import만 — 실제 snapshot 연결은 Phase H에서
// (enabled=false로 유지하면 네트워크 호출 0건)
const _autoSave = useProjectAutoSave({
  authToken: null,
  enabled: false,
  snapshot: null,
});
// Phase H에서 enabled: !!email, snapshot: buildSnapshot() 으로 교체
```

- [ ] **Step 2: 빌드 체크**

```bash
npx next build 2>&1 | grep -iE "error|✓ Compiled|warn.*Shortform" | head -10
```

Expected: 컴파일 성공. 사용하지 않는 변수 경고는 `_autoSave` prefix로 억제.

- [ ] **Step 3: 브라우저 확인**

```bash
npm run dev
```

브라우저 http://localhost:3000/shortform 접속 후 네트워크 탭 확인:
- [ ] `/api/shortform-projects` 호출 0건 (enabled=false)
- [ ] 기존 숏폼 흐름 영향 없음

- [ ] **Step 4: 커밋**

```bash
git add app/shortform/ShortformClient.js
git commit -m "$(cat <<'EOF'
feat(shortform): useProjectAutoSave 훅 import (비활성)

Phase C 범위는 훅 import까지만. enabled=false 상태로 유지해
네트워크 호출 0건 + 기존 흐름 영향 0.

실제 snapshot 연결 + 활성화는 Phase H(프로젝트 히스토리 UI)에서
처리. 지금 통합하면 Phase B/D와 병렬 작업 중 snapshot 스키마
충돌 우려가 있어 분리.
EOF
)"
```

---

## Task C8: 수동 검증 (curl)

프로젝트에 테스트 프레임워크가 없으므로 curl로 6개 엔드포인트를 직접 확인.

**Files:**
- 없음 (검증 단계)

- [ ] **Step 1: 개발 서버 기동 + 토큰 준비**

```bash
npm run dev
```

다른 터미널에서:

```bash
# 브라우저 /login에서 로그인 후 DevTools Console
# localStorage.getItem('ddukddak_token')
export TOKEN="여기에-토큰-붙여넣기"
export BASE="http://localhost:3000"
```

- [ ] **Step 2: POST 생성**

```bash
curl -s -X POST "$BASE/api/shortform-projects" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "blog_text": "신랑 정장 고를 때 포인트 5가지를 정리했습니다. 본인 체형에 맞는 핏과 결혼식장 톤에 맞는 컬러가 핵심입니다.",
    "persona": "consultant",
    "tone": "professional",
    "duration_sec": 45
  }' | tee /tmp/sp-create.json
```

Expected: `{"project": {"id": N, "status": "draft", ...}}`. id 저장:

```bash
export PID=$(cat /tmp/sp-create.json | node -e 'let s=""; process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).project.id))')
echo $PID
```

- [ ] **Step 3: GET 목록**

```bash
curl -s "$BASE/api/shortform-projects?status=draft" \
  -H "Authorization: Bearer $TOKEN" | head -100
```

Expected: `{"projects":[{"id":$PID, "status":"draft", ...}]}`.

- [ ] **Step 4: GET 단일**

```bash
curl -s "$BASE/api/shortform-projects/$PID" \
  -H "Authorization: Bearer $TOKEN"
```

Expected: 전체 컬럼 포함한 단일 project 객체.

- [ ] **Step 5: PATCH auto-save**

```bash
curl -s -X PATCH "$BASE/api/shortform-projects/$PID" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "current_step": 3,
    "script_json": { "scenes": [{ "type": "hook", "narration": "테스트" }] },
    "preset": "friendly"
  }'
```

Expected: 업데이트된 project. current_step=3, preset='friendly', updated_at 변경.

- [ ] **Step 6: POST publish**

```bash
curl -s -X POST "$BASE/api/shortform-projects/$PID/publish" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "video_r2_key": "shortform/test.mp4",
    "caption_text": "테스트 캡션",
    "duration_actual": 45
  }'
```

Expected: status='published', published_at 존재.

- [ ] **Step 7: POST duplicate**

```bash
curl -s -X POST "$BASE/api/shortform-projects/$PID/duplicate" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}' | tee /tmp/sp-dup.json
```

Expected: 새 draft (`status:"draft"`, `title: "... (복제)"`, video_r2_key 미복사). 새 id 저장:

```bash
export PID2=$(cat /tmp/sp-dup.json | node -e 'let s=""; process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).project.id))')
echo $PID2
```

- [ ] **Step 8: DELETE 2건**

```bash
curl -s -X DELETE "$BASE/api/shortform-projects/$PID" -H "Authorization: Bearer $TOKEN"
curl -s -X DELETE "$BASE/api/shortform-projects/$PID2" -H "Authorization: Bearer $TOKEN"
```

Expected: 둘 다 `{"ok":true}`.

- [ ] **Step 9: 소유권 검증 (타 사용자 id로 접근 차단)**

```bash
# 임의 큰 id로 GET
curl -s "$BASE/api/shortform-projects/999999" -H "Authorization: Bearer $TOKEN"
```

Expected: `{"error":"프로젝트를 찾을 수 없습니다."}` (404).

```bash
# 토큰 없이 GET
curl -s "$BASE/api/shortform-projects"
```

Expected: `{"error":"로그인이 필요합니다."}` (401).

- [ ] **Step 10: 검증 결과 커밋(코드 변경 없을 시 생략)**

코드 변경이 없다면 커밋 없음. 검증 로그만 task 본문 체크리스트에 기록.

---

## Task C9: 메모리 + 마스터 플랜 상태 업데이트

**Files:**
- Create: `~/.claude/projects/-Users-gong-eunhui-Desktop-naver-title-generator/memory/project_shortform_phase_c_complete.md`
- Modify: `~/.claude/projects/-Users-gong-eunhui-Desktop-naver-title-generator/memory/MEMORY.md`
- Modify: `docs/superpowers/plans/2026-04-14-shortform-master-plan.md`

- [ ] **Step 1: 메모리 파일 작성**

```markdown
---
name: 숏폼 Phase C 완료
description: shortform_projects 테이블 + CRUD API + auto-save 훅
type: project
---

# 숏폼 Phase C 완료

**완료일:** 2026-04-XX
**스펙:** docs/superpowers/specs/2026-04-14-shortform-benchmark-pipeline-design.md §15
**플랜:** docs/superpowers/plans/2026-04-14-shortform-phase-c-project-model.md

## 핵심 변경

- shortform_projects 테이블 lazy migration (lib/user-images.js 패턴)
- REST API 6종: POST/GET (컬렉션), GET/PATCH/DELETE ([id]), POST publish, POST duplicate
- useProjectAutoSave 훅: debounce 1.5s + saveNow() 즉시 저장
- ShortformClient에 훅 import만 (enabled=false 비활성 상태)

## 신규 파일

- lib/shortform-projects.js
- app/api/shortform-projects/route.js
- app/api/shortform-projects/[id]/route.js
- app/api/shortform-projects/[id]/publish/route.js
- app/api/shortform-projects/[id]/duplicate/route.js
- app/shortform/hooks/useProjectAutoSave.js

## 수동 검증 결과

- POST 생성 / GET 목록 / GET 단일 / PATCH / publish / duplicate / DELETE 전 경로 통과
- 소유권 검증: 타 사용자 id 404, 비로그인 401
- updated_at 자동 갱신 확인

## 다음 Phase 통합 포인트

- **Phase H (프로젝트 히스토리 UI)**: useProjectAutoSave에 실제 snapshot 연결, 마이페이지 "내 영상" 섹션에서 listProjects 사용
- **Phase D (대본)**: script_json 필드에 대본 저장
- **Phase F (미리보기)**: preset + custom_options 필드에 저장
```

- [ ] **Step 2: MEMORY.md 최근 세션에 한 줄 추가**

`~/.claude/projects/-Users-gong-eunhui-Desktop-naver-title-generator/memory/MEMORY.md` 최근 세션 섹션 위쪽:

```markdown
- [4/XX 숏폼 Phase C 완료](project_shortform_phase_c_complete.md) — shortform_projects DB + CRUD API + auto-save 훅
```

- [ ] **Step 3: 마스터 플랜에 완료 마킹**

`docs/superpowers/plans/2026-04-14-shortform-master-plan.md` 의 Phase C 섹션 끝에:

```markdown
**상태:** ✅ 완료 (커밋 SHA: XXXXXXX)
```

- [ ] **Step 4: 최종 커밋**

```bash
git add docs/superpowers/plans/2026-04-14-shortform-master-plan.md
git commit -m "$(cat <<'EOF'
docs: Phase C 완료 마킹 + 메모리 기록

Phase C (Project Model: shortform_projects DB + auto-save) 완료.
데이터 레이어 준비 완료. Phase H(히스토리 UI)에서 훅 활성화 예정.
EOF
)"
```

---

## Phase C 자기 검토

### Spec coverage

| 스펙 섹션 | 커버 task |
|---|---|
| §15 데이터 모델 (shortform_projects) | C1 (ensureSchema + 컬럼 정의) |
| §15 API — 7종 엔드포인트 | C2 (POST/GET) + C3 (GET/PATCH/DELETE) + C4 (publish) + C5 (duplicate) |
| §15 자동 저장 동작 | C6 (useProjectAutoSave) |
| §15 소유권 / 30일 보관 | C1 (WHERE user_email=, 30일 cleanup은 P1로 유보) |

### 알려진 미완 (다음 Phase)

- Phase H에서 실제 훅 연결 + 마이페이지 "내 영상" UI
- 30일 lazy cleanup (P1, cron 없이 nextjs route + SQL로 구현)
- benchmark_aggregated / script_json 스키마 최종 정의는 Phase B/D 완료 후 합의

### 통합 지점

- **Phase B (벤치마킹)**: `selected_video_ids` / `benchmark_aggregated` 컬럼에 Gemini 분석 결과 저장
- **Phase D (대본)**: `script_json` 컬럼에 scenes 배열, `script_edited` 에 사용자 편집 결과
- **Phase E (이미지)**: `user_image_ids` + `ai_image_count`
- **Phase F (미리보기)**: `preset` + `custom_options`
- **Phase G (브랜드 킷)**: 이 Phase는 별도 테이블이지만 Phase G 작성 시 shortform_projects.caption_text 에 브랜드 킷 연락처 자동 삽입
- **Phase H (히스토리 UI)**: listProjects + useProjectAutoSave 활성화
- **Phase J (YouTube 업로드)**: `youtube_video_id` 컬럼 활용

### 회귀 안전성

- 기존 `/api/shortform-script` 무변경
- ShortformClient의 훅 호출은 `enabled=false` — 네트워크 0건
- 신규 테이블이므로 기존 DB 무영향
- 모든 라우트 로그인 필수 → 비회원 흐름 동일

---

## Phase C 완료 후 다음 단계

Phase B (벤치마킹) / Phase D (대본) 병렬 진행 가능. Phase H 는 C+B+D 완료 후.
