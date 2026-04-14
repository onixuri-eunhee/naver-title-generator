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

  // neon은 dynamic SET 절을 지원하지 않으므로 sql.query(text, values)로 수동 바인딩.
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
