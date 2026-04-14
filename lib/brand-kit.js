/**
 * 브랜드 킷 DB 헬퍼.
 * user_email 기준 단일 row (UNIQUE). upsert 패턴.
 *
 * 자동 마이그레이션: 첫 호출 시 테이블이 없으면 생성 (user-images.js와 동일).
 *
 * Phase D will wire this into shortform-script (buildPromptContext helper).
 */
import { getDb } from '@/lib/db';

const COLOR_RE = /^#([0-9A-Fa-f]{6})$/;
const ALLOWED_FONTS = new Set([
  'Noto Sans KR',
  'Pretendard',
  'IBM Plex Sans KR',
  'Nanum Square',
  'Gmarket Sans',
]);

// 자동 마이그레이션: 첫 호출 시 테이블 생성 (serverless 인스턴스당 1회)
let _schemaReady = null;
async function ensureSchema() {
  if (_schemaReady) return _schemaReady;
  _schemaReady = (async () => {
    const sql = getDb();
    await sql`CREATE TABLE IF NOT EXISTS brand_kits (
      id              SERIAL PRIMARY KEY,
      user_email      VARCHAR(254) UNIQUE NOT NULL,
      store_name      VARCHAR(100),
      slogan          VARCHAR(200),
      industry        VARCHAR(50),
      logo_url        TEXT,
      primary_color   VARCHAR(7),
      secondary_color VARCHAR(7),
      font_family     VARCHAR(50),
      signature_intro TEXT,
      signature_outro TEXT,
      default_cta     TEXT,
      location        VARCHAR(200),
      business_hours  VARCHAR(200),
      phone           VARCHAR(30),
      instagram       VARCHAR(50),
      created_at      TIMESTAMPTZ DEFAULT NOW(),
      updated_at      TIMESTAMPTZ DEFAULT NOW()
    )`;
    await sql`CREATE INDEX IF NOT EXISTS idx_brand_kits_email
      ON brand_kits (user_email)`;
  })().catch((err) => {
    _schemaReady = null; // 실패 시 다음 요청에서 재시도
    console.error('[BRAND-KIT] ensureSchema failed:', err.message);
    throw err;
  });
  return _schemaReady;
}

/**
 * 입력값 화이트리스트 + 길이 제한 + 색상 포맷 검증.
 * 잘못된 값은 null로 치환 (전체 요청 reject하지 않음 — 부분 저장 허용).
 */
export function sanitizeBrandKit(input = {}) {
  const str = (v, max) => {
    if (v === null || v === undefined) return null;
    const s = String(v).trim();
    if (!s) return null;
    return s.slice(0, max);
  };
  const color = (v) => {
    if (!v) return null;
    const s = String(v).trim();
    return COLOR_RE.test(s) ? s.toUpperCase() : null;
  };
  const font = (v) => {
    if (!v) return null;
    const s = String(v).trim();
    return ALLOWED_FONTS.has(s) ? s : null;
  };

  return {
    store_name:      str(input.store_name, 100),
    slogan:          str(input.slogan, 200),
    industry:        str(input.industry, 50),
    logo_url:        str(input.logo_url, 500),
    primary_color:   color(input.primary_color),
    secondary_color: color(input.secondary_color),
    font_family:     font(input.font_family),
    signature_intro: str(input.signature_intro, 500),
    signature_outro: str(input.signature_outro, 500),
    default_cta:     str(input.default_cta, 300),
    location:        str(input.location, 200),
    business_hours:  str(input.business_hours, 200),
    phone:           str(input.phone, 30),
    instagram:       str(input.instagram, 50),
  };
}

/**
 * 이메일 기준 브랜드 킷 조회. 없으면 null.
 */
export async function getBrandKit(email) {
  await ensureSchema();
  const sql = getDb();
  const rows = await sql`SELECT
    id, user_email, store_name, slogan, industry, logo_url,
    primary_color, secondary_color, font_family,
    signature_intro, signature_outro, default_cta,
    location, business_hours, phone, instagram,
    created_at, updated_at
  FROM brand_kits WHERE user_email = ${email} LIMIT 1`;
  return rows[0] || null;
}

/**
 * upsert (insert OR update). user_email이 UNIQUE이므로 ON CONFLICT.
 */
export async function upsertBrandKit(email, payload) {
  await ensureSchema();
  const clean = sanitizeBrandKit(payload);
  const sql = getDb();

  const rows = await sql`INSERT INTO brand_kits (
    user_email, store_name, slogan, industry, logo_url,
    primary_color, secondary_color, font_family,
    signature_intro, signature_outro, default_cta,
    location, business_hours, phone, instagram, updated_at
  ) VALUES (
    ${email}, ${clean.store_name}, ${clean.slogan}, ${clean.industry}, ${clean.logo_url},
    ${clean.primary_color}, ${clean.secondary_color}, ${clean.font_family},
    ${clean.signature_intro}, ${clean.signature_outro}, ${clean.default_cta},
    ${clean.location}, ${clean.business_hours}, ${clean.phone}, ${clean.instagram}, NOW()
  )
  ON CONFLICT (user_email) DO UPDATE SET
    store_name      = EXCLUDED.store_name,
    slogan          = EXCLUDED.slogan,
    industry        = EXCLUDED.industry,
    logo_url        = EXCLUDED.logo_url,
    primary_color   = EXCLUDED.primary_color,
    secondary_color = EXCLUDED.secondary_color,
    font_family     = EXCLUDED.font_family,
    signature_intro = EXCLUDED.signature_intro,
    signature_outro = EXCLUDED.signature_outro,
    default_cta     = EXCLUDED.default_cta,
    location        = EXCLUDED.location,
    business_hours  = EXCLUDED.business_hours,
    phone           = EXCLUDED.phone,
    instagram       = EXCLUDED.instagram,
    updated_at      = NOW()
  RETURNING *`;

  return rows[0];
}

/**
 * 삭제.
 */
export async function deleteBrandKit(email) {
  await ensureSchema();
  const sql = getDb();
  await sql`DELETE FROM brand_kits WHERE user_email = ${email}`;
  return { ok: true };
}

/**
 * Claude 프롬프트에 주입할 문자열 포맷팅.
 * 비어있는 필드는 제외. 전부 비어있으면 null 반환.
 *
 * Phase D will wire this into shortform-script (이메일→getBrandKit→buildPromptContext).
 */
export function buildPromptContext(kit) {
  if (!kit) return null;
  const lines = [];
  if (kit.store_name) lines.push(`가게명: ${kit.store_name}`);
  if (kit.slogan) lines.push(`슬로건: ${kit.slogan}`);
  if (kit.industry) lines.push(`업종: ${kit.industry}`);
  if (kit.signature_intro) lines.push(`시그니처 인사(가능하면 Hook 뒤에 자연스럽게): ${kit.signature_intro}`);
  if (kit.signature_outro) lines.push(`시그니처 클로징(마지막 씬 바로 앞): ${kit.signature_outro}`);
  if (kit.default_cta) lines.push(`기본 CTA(마지막 1 씬에 사용): ${kit.default_cta}`);
  if (lines.length === 0) return null;
  return lines.join('\n');
}

/**
 * 이메일로 바로 프롬프트 컨텍스트 생성 (편의 함수).
 * Phase D에서 shortform-script/route.js가 한 줄로 호출할 수 있게 준비.
 */
export async function buildPromptContextForEmail(email) {
  try {
    const kit = await getBrandKit(email);
    return buildPromptContext(kit);
  } catch (err) {
    console.warn('[BRAND-KIT] buildPromptContextForEmail failed:', err.message);
    return null;
  }
}

/**
 * 캡션 자동 삽입용 메타 라인 (Phase F/J에서 사용 예정).
 */
export function buildCaptionMeta(kit) {
  if (!kit) return '';
  const parts = [];
  if (kit.location) parts.push(`📍 ${kit.location}`);
  if (kit.business_hours) parts.push(`⏰ ${kit.business_hours}`);
  if (kit.phone) parts.push(`☎ ${kit.phone}`);
  if (kit.instagram) parts.push(`📷 @${kit.instagram.replace(/^@/, '')}`);
  return parts.join(' / ');
}
