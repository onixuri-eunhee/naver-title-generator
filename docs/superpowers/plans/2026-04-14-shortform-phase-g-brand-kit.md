# Phase G — Brand Kit: 마이페이지 섹션 + 자동 적용

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. 12 Phase 중 Phase G. 마스터 플랜: `2026-04-14-shortform-master-plan.md`. 스펙: `2026-04-14-shortform-benchmark-pipeline-design.md` §14.

**Goal:** 자영업자가 브랜드 정보(가게명/슬로건/로고/컬러/시그니처 멘트/연락처)를 한 번 저장하면 모든 숏폼 영상 대본·자막·캡션에 자동 적용되도록 브랜드 킷 시스템 구축.

**Architecture:** 새로운 `brand_kits` 테이블(user_email UNIQUE, upsert 패턴) + `/api/brand-kit` 엔드포인트(GET/POST/DELETE). 마이페이지에 `BrandKitSection` 섹션 추가(내 이미지와 Threads 사이). Step 3 대본 생성 API에서 브랜드 킷 자동 로드 후 Claude 프롬프트 주입. 로고 업로드는 `/api/my-images` 재활용.

**Tech Stack:** Next.js 15 App Router, Neon PostgreSQL, `@vercel/postgres` 호환 sql helper, React useState/useEffect, CSS modules, R2(기존 재활용)

**의존성:** 없음 (1주차 즉시 시작 가능)

**예상 작업량:** 12 task, ~1주

---

## 파일 구조

### 신규 파일

```
lib/brand-kit.js                                 DB 헬퍼 + ensureSchema 자동 마이그레이션
app/api/brand-kit/route.js                       GET/POST/DELETE 엔드포인트
app/mypage/BrandKitSection.js                    입력 폼 UI (form + 로고 업로드 + 컬러피커)
app/mypage/BrandKitSection.module.css            섹션 스타일
```

### 수정 파일

```
app/mypage/MyPageClient.js                       BrandKitSection 삽입 (MyImages와 Threads 사이)
app/api/shortform-script/route.js                brand_kit 자동 로드 + 프롬프트 주입
app/shortform/ShortformClient.js                 첫 진입 시 빈 브랜드 킷 배너 + 적용 배너
```

---

## Task G1: lib/brand-kit.js — DB 헬퍼 + ensureSchema

`lib/user-images.js`의 lazy migration 패턴을 그대로 따른다. 첫 호출 시 테이블이 없으면 생성, serverless 인스턴스당 1회만 실행.

**Files:**
- Create: `lib/brand-kit.js`

- [ ] **Step 1: 파일 작성**

```javascript
// lib/brand-kit.js
/**
 * 브랜드 킷 DB 헬퍼.
 * user_email 기준 단일 row (UNIQUE). upsert 패턴.
 *
 * 자동 마이그레이션: 첫 호출 시 테이블이 없으면 생성 (user-images.js와 동일).
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
    _schemaReady = null;
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
```

- [ ] **Step 2: 빌드 체크**

```bash
cd /Users/gong-eunhui/Desktop/naver-title-generator
npx next build 2>&1 | grep -iE "error|✓ Compiled" | head -10
```

Expected: `✓ Compiled successfully`, error 0건.

- [ ] **Step 3: 커밋**

```bash
git add lib/brand-kit.js
git commit -m "$(cat <<'EOF'
feat(lib): 브랜드 킷 DB 헬퍼 + lazy 마이그레이션

brand_kits 테이블 자동 생성 (user_email UNIQUE).
sanitizeBrandKit/upsertBrandKit/getBrandKit/deleteBrandKit 제공.
buildPromptContext/buildCaptionMeta로 대본·캡션 주입 포맷 분리.
user-images.js의 lazy 마이그레이션 패턴 재사용.
EOF
)"
```

---

## Task G2: `/api/brand-kit` 엔드포인트

**Files:**
- Create: `app/api/brand-kit/route.js`

- [ ] **Step 1: 파일 작성**

```javascript
// app/api/brand-kit/route.js
import {
  extractToken,
  resolveSessionEmail,
  jsonResponse,
  handleOptions,
} from '@/lib/api-helpers';
import { getBrandKit, upsertBrandKit, deleteBrandKit } from '@/lib/brand-kit';

export const maxDuration = 30;

async function requireAuth(request) {
  const token = extractToken(request);
  if (!token) return null;
  return await resolveSessionEmail(token);
}

export async function OPTIONS(request) {
  return handleOptions(request);
}

export async function GET(request) {
  const email = await requireAuth(request);
  if (!email) {
    return jsonResponse(request, { error: '로그인이 필요합니다.' }, { status: 401 });
  }
  try {
    const kit = await getBrandKit(email);
    return jsonResponse(request, { kit });
  } catch (err) {
    console.error('[BRAND-KIT] GET failed:', err.message);
    return jsonResponse(request, { error: '브랜드 킷을 불러오지 못했습니다.' }, { status: 500 });
  }
}

export async function POST(request) {
  const email = await requireAuth(request);
  if (!email) {
    return jsonResponse(request, { error: '로그인이 필요합니다.' }, { status: 401 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse(request, { error: '잘못된 요청 형식입니다.' }, { status: 400 });
  }

  try {
    const kit = await upsertBrandKit(email, body || {});
    return jsonResponse(request, { kit }, { status: 200 });
  } catch (err) {
    console.error('[BRAND-KIT] POST failed:', err.message);
    return jsonResponse(request, { error: err.message || '저장에 실패했습니다.' }, { status: 500 });
  }
}

export async function DELETE(request) {
  const email = await requireAuth(request);
  if (!email) {
    return jsonResponse(request, { error: '로그인이 필요합니다.' }, { status: 401 });
  }
  try {
    await deleteBrandKit(email);
    return jsonResponse(request, { ok: true });
  } catch (err) {
    console.error('[BRAND-KIT] DELETE failed:', err.message);
    return jsonResponse(request, { error: '삭제에 실패했습니다.' }, { status: 500 });
  }
}
```

- [ ] **Step 2: 빌드 체크**

```bash
npx next build 2>&1 | grep -iE "error|✓ Compiled" | head -10
```

Expected: `✓ Compiled successfully`.

- [ ] **Step 3: cURL 수동 검증 (로컬 dev 서버)**

```bash
# 빈 값 조회 (null 반환)
curl -s http://localhost:3000/api/brand-kit -H "Authorization: Bearer <TOKEN>"
# 저장
curl -s -X POST http://localhost:3000/api/brand-kit \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"store_name":"테스트샵","primary_color":"#ff5f1f"}'
# 재조회
curl -s http://localhost:3000/api/brand-kit -H "Authorization: Bearer <TOKEN>"
```

Expected: 첫 GET은 `{ "kit": null }`, POST 후 GET은 store_name/primary_color가 저장된 row 반환.

- [ ] **Step 4: 커밋**

```bash
git add app/api/brand-kit/route.js
git commit -m "$(cat <<'EOF'
feat(api): /api/brand-kit — GET/POST/DELETE 엔드포인트

로그인 필수. POST는 upsert (user_email UNIQUE).
POST body는 lib/brand-kit의 sanitizeBrandKit 필터 통과.
EOF
)"
```

---

## Task G3: BrandKitSection — 입력 폼 UI

스펙 §14의 4개 그룹(가게/비주얼/멘트/연락처)을 하나의 form으로 구현. 저장 버튼은 상단 고정, 필드가 많아 섹션 내 스크롤 가능.

**Files:**
- Create: `app/mypage/BrandKitSection.js`

- [ ] **Step 1: 컴포넌트 작성 (로고/컬러 제외 — G5/G6에서 추가)**

```javascript
// app/mypage/BrandKitSection.js
'use client';

import { useEffect, useState } from 'react';
import { getToken } from '@/lib/auth';
import styles from './BrandKitSection.module.css';

const EMPTY = {
  store_name: '',
  slogan: '',
  industry: '',
  logo_url: '',
  primary_color: '',
  secondary_color: '',
  font_family: '',
  signature_intro: '',
  signature_outro: '',
  default_cta: '',
  location: '',
  business_hours: '',
  phone: '',
  instagram: '',
};

const INDUSTRIES = [
  '카페/베이커리', '식당/주점', '미용실/뷰티', '의류/잡화',
  '교육/학원', '피트니스/요가', '병원/클리닉', '웨딩/이벤트',
  '전문직/컨설팅', '프리랜서/1인사업', '기타',
];

const FONTS = [
  'Noto Sans KR',
  'Pretendard',
  'IBM Plex Sans KR',
  'Nanum Square',
  'Gmarket Sans',
];

export default function BrandKitSection() {
  const [form, setForm] = useState(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState('');
  const [error, setError] = useState('');
  const [isEmpty, setIsEmpty] = useState(true);

  async function refresh() {
    const token = getToken();
    if (!token) { setLoading(false); return; }
    setLoading(true);
    try {
      const res = await fetch('/api/brand-kit', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || '브랜드 킷을 불러오지 못했습니다.');
      } else if (data.kit) {
        setForm({ ...EMPTY, ...data.kit });
        setIsEmpty(false);
      } else {
        setIsEmpty(true);
      }
    } catch {
      setError('네트워크 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refresh(); }, []);

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function handleSave() {
    const token = getToken();
    if (!token) return;
    setSaving(true);
    setError('');
    setSavedMsg('');
    try {
      const res = await fetch('/api/brand-kit', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || '저장에 실패했습니다.');
      } else {
        setIsEmpty(false);
        setSavedMsg('저장되었습니다. 모든 영상에 자동 적용됩니다.');
        setTimeout(() => setSavedMsg(''), 3000);
      }
    } catch {
      setError('네트워크 오류가 발생했습니다.');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!confirm('브랜드 킷을 삭제할까요? 저장된 모든 정보가 사라집니다.')) return;
    const token = getToken();
    const res = await fetch('/api/brand-kit', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      setForm(EMPTY);
      setIsEmpty(true);
    } else {
      alert('삭제에 실패했습니다.');
    }
  }

  if (loading) {
    return <div className={styles.loadingText}>불러오는 중...</div>;
  }

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <div className={styles.title}>내 브랜드 킷</div>
        <div className={styles.subtitle}>
          한 번 저장하면 모든 숏폼에 자동 적용됩니다
        </div>
      </div>

      {isEmpty && (
        <div className={styles.emptyBanner}>
          1분만 투자하면 모든 영상이 더 일관성 있어져요.
          가게명/시그니처 멘트/연락처만 채워도 충분합니다.
        </div>
      )}

      {error && <div className={styles.errorText}>{error}</div>}
      {savedMsg && <div className={styles.savedText}>{savedMsg}</div>}

      {/* 그룹 1: 가게/브랜드 정보 */}
      <div className={styles.group}>
        <div className={styles.groupLabel}>가게/브랜드 정보</div>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>가게 이름</span>
          <input
            type="text"
            className={styles.input}
            value={form.store_name}
            onChange={(e) => update('store_name', e.target.value)}
            placeholder="예: 리부트 웨딩컨설팅"
            maxLength={100}
          />
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>슬로건</span>
          <input
            type="text"
            className={styles.input}
            value={form.slogan}
            onChange={(e) => update('slogan', e.target.value)}
            placeholder="예: 19년차의 경험으로, 당신의 하루를"
            maxLength={200}
          />
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>업종</span>
          <select
            className={styles.select}
            value={form.industry}
            onChange={(e) => update('industry', e.target.value)}
          >
            <option value="">선택 안 함</option>
            {INDUSTRIES.map((i) => <option key={i} value={i}>{i}</option>)}
          </select>
        </label>
      </div>

      {/* 그룹 2: 비주얼 (로고/컬러는 G5, G6에서) */}
      <div className={styles.group}>
        <div className={styles.groupLabel}>비주얼</div>
        <div className={styles.placeholderNote}>로고·컬러 필드는 G5/G6에서 추가됩니다.</div>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>추천 폰트</span>
          <select
            className={styles.select}
            value={form.font_family}
            onChange={(e) => update('font_family', e.target.value)}
          >
            <option value="">기본(Noto Sans KR)</option>
            {FONTS.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        </label>
      </div>

      {/* 그룹 3: 시그니처 멘트 */}
      <div className={styles.group}>
        <div className={styles.groupLabel}>시그니처 멘트</div>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>시그니처 인사</span>
          <input
            type="text"
            className={styles.input}
            value={form.signature_intro}
            onChange={(e) => update('signature_intro', e.target.value)}
            placeholder='예: "안녕하세요 리부트 대표 공은희입니다"'
            maxLength={500}
          />
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>시그니처 클로징</span>
          <input
            type="text"
            className={styles.input}
            value={form.signature_outro}
            onChange={(e) => update('signature_outro', e.target.value)}
            placeholder='예: "더 궁금한 건 프로필에서"'
            maxLength={500}
          />
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>단골 CTA</span>
          <input
            type="text"
            className={styles.input}
            value={form.default_cta}
            onChange={(e) => update('default_cta', e.target.value)}
            placeholder='예: "예약 문의는 DM으로 남겨주세요"'
            maxLength={300}
          />
        </label>
      </div>

      {/* 그룹 4: 연락처 */}
      <div className={styles.group}>
        <div className={styles.groupLabel}>연락처 (캡션 자동 삽입)</div>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>위치</span>
          <input
            type="text"
            className={styles.input}
            value={form.location}
            onChange={(e) => update('location', e.target.value)}
            placeholder="예: 서울 강남구 역삼동"
            maxLength={200}
          />
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>영업시간</span>
          <input
            type="text"
            className={styles.input}
            value={form.business_hours}
            onChange={(e) => update('business_hours', e.target.value)}
            placeholder="예: 평일 10~20시 / 주말 11~18시"
            maxLength={200}
          />
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>전화번호</span>
          <input
            type="tel"
            className={styles.input}
            value={form.phone}
            onChange={(e) => update('phone', e.target.value)}
            placeholder="예: 010-1234-5678"
            maxLength={30}
          />
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>인스타그램</span>
          <div className={styles.inputPrefix}>
            <span className={styles.prefixAt}>@</span>
            <input
              type="text"
              className={styles.input}
              value={form.instagram}
              onChange={(e) => update('instagram', e.target.value.replace(/^@/, ''))}
              placeholder="예: reboot_wedding"
              maxLength={50}
            />
          </div>
        </label>
      </div>

      <div className={styles.actions}>
        <button
          type="button"
          className={styles.saveBtn}
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? '저장 중...' : '브랜드 킷 저장'}
        </button>
        {!isEmpty && (
          <button
            type="button"
            className={styles.deleteBtn}
            onClick={handleDelete}
            disabled={saving}
          >
            삭제
          </button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 빌드 체크**

```bash
npx next build 2>&1 | grep -iE "error|✓ Compiled" | head -5
```

Expected: 컴파일 성공.

- [ ] **Step 3: 커밋**

```bash
git add app/mypage/BrandKitSection.js
git commit -m "$(cat <<'EOF'
feat(mypage): BrandKitSection 입력 폼 UI (로고/컬러 제외)

가게명/슬로건/업종/폰트/시그니처 멘트/연락처 4 그룹.
저장/삭제 버튼. 빈 상태 배너 + 저장 완료 토스트.
로고/컬러 필드는 Task G5/G6에서 추가 예정.
EOF
)"
```

---

## Task G4: BrandKitSection 스타일 (CSS module)

**Files:**
- Create: `app/mypage/BrandKitSection.module.css`

- [ ] **Step 1: CSS 작성**

```css
/* app/mypage/BrandKitSection.module.css */
.root { display: flex; flex-direction: column; gap: 14px; }

.header {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 4px;
}
.title {
  font-size: 15px;
  font-weight: 700;
  color: var(--ds-text, #1F2937);
}
.subtitle {
  font-size: 12px;
  color: var(--ds-muted, #77736B);
}

.loadingText {
  font-size: 13px;
  color: var(--ds-muted, #77736B);
  text-align: center;
  padding: 24px 12px;
}

.emptyBanner {
  padding: 14px 16px;
  background: rgba(255, 95, 31, 0.06);
  border: 1px solid rgba(255, 95, 31, 0.15);
  border-radius: 10px;
  font-size: 13px;
  color: var(--ds-text, #1F2937);
  line-height: 1.6;
}

.errorText {
  padding: 10px 14px;
  background: #FEE2E2;
  border-radius: 8px;
  font-size: 13px;
  color: #B91C1C;
}

.savedText {
  padding: 10px 14px;
  background: #D1FAE5;
  border-radius: 8px;
  font-size: 13px;
  color: #047857;
}

.group {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px;
  border: 1px solid var(--ds-border, #E5E7EB);
  border-radius: 10px;
  background: var(--ds-surface, #fff);
}
.groupLabel {
  font-size: 12px;
  font-weight: 700;
  color: var(--ds-muted, #77736B);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.placeholderNote {
  font-size: 11px;
  color: var(--ds-muted, #77736B);
  font-style: italic;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.fieldLabel {
  font-size: 12px;
  font-weight: 600;
  color: var(--ds-text, #1F2937);
}

.input, .select {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--ds-border, #E5E7EB);
  border-radius: 8px;
  font-size: 13px;
  font-family: inherit;
  color: var(--ds-text, #1F2937);
  background: #fff;
  transition: border-color 0.15s ease;
}
.input:focus, .select:focus {
  outline: none;
  border-color: var(--ds-accent, #ff5f1f);
  box-shadow: 0 0 0 3px rgba(255, 95, 31, 0.1);
}

.inputPrefix {
  display: flex;
  align-items: center;
  gap: 6px;
  padding-left: 10px;
  border: 1px solid var(--ds-border, #E5E7EB);
  border-radius: 8px;
  background: #fff;
}
.inputPrefix .input {
  border: none;
  padding-left: 0;
  box-shadow: none;
}
.inputPrefix:focus-within {
  border-color: var(--ds-accent, #ff5f1f);
  box-shadow: 0 0 0 3px rgba(255, 95, 31, 0.1);
}
.prefixAt {
  font-size: 13px;
  color: var(--ds-muted, #77736B);
  font-weight: 600;
}

.actions {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}

.saveBtn {
  flex: 1;
  padding: 12px 20px;
  background: var(--ds-accent, #ff5f1f);
  color: #fff;
  border: none;
  border-radius: 10px;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
  transition: opacity 0.15s ease;
}
.saveBtn:hover:not(:disabled) { opacity: 0.9; }
.saveBtn:disabled { opacity: 0.5; cursor: not-allowed; }

.deleteBtn {
  padding: 12px 16px;
  background: #fff;
  color: #DC2626;
  border: 1px solid #FECACA;
  border-radius: 10px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
.deleteBtn:hover:not(:disabled) { background: #FEF2F2; }

/* 로고 업로드 영역 (G5에서 활성화) */
.logoArea {
  display: flex;
  align-items: center;
  gap: 12px;
}
.logoPreview {
  width: 72px;
  height: 72px;
  border-radius: 10px;
  object-fit: cover;
  background: var(--ds-surface-2, #F3F4F6);
  border: 1px solid var(--ds-border, #E5E7EB);
}
.logoPlaceholder {
  width: 72px;
  height: 72px;
  border-radius: 10px;
  background: var(--ds-surface-2, #F3F4F6);
  border: 1px dashed var(--ds-border, #E5E7EB);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--ds-muted, #77736B);
  font-size: 11px;
  text-align: center;
}
.logoControls {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex: 1;
}
.logoBtn {
  padding: 8px 14px;
  background: var(--ds-surface-2, #F3F4F6);
  color: var(--ds-text, #1F2937);
  border: 1px solid var(--ds-border, #E5E7EB);
  border-radius: 8px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  align-self: flex-start;
}
.logoBtn:hover { background: #E5E7EB; }
.logoRemoveBtn {
  background: none;
  border: none;
  color: #DC2626;
  font-size: 11px;
  cursor: pointer;
  align-self: flex-start;
  padding: 4px 0;
}
.logoHint { font-size: 11px; color: var(--ds-muted, #77736B); }

/* 컬러 피커 (G6에서 활성화) */
.colorRow {
  display: flex;
  gap: 10px;
}
.colorField {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.colorBox {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px;
  border: 1px solid var(--ds-border, #E5E7EB);
  border-radius: 8px;
  background: #fff;
}
.colorSwatch {
  width: 32px;
  height: 32px;
  border-radius: 6px;
  border: 1px solid var(--ds-border, #E5E7EB);
  cursor: pointer;
  padding: 0;
  flex-shrink: 0;
}
.colorHex {
  flex: 1;
  border: none;
  padding: 6px;
  font-family: monospace;
  font-size: 12px;
  color: var(--ds-text, #1F2937);
  outline: none;
  text-transform: uppercase;
}
```

- [ ] **Step 2: 빌드 체크**

```bash
npx next build 2>&1 | grep -iE "error|✓ Compiled" | head -5
```

Expected: 성공.

- [ ] **Step 3: 커밋**

```bash
git add app/mypage/BrandKitSection.module.css
git commit -m "$(cat <<'EOF'
feat(mypage): BrandKitSection 스타일 (폼 + 로고/컬러 슬롯)

4 그룹 카드 레이아웃 + 기본 input/select 스타일.
로고 업로드(G5)와 컬러 피커(G6)용 클래스 미리 준비.
EOF
)"
```

---

## Task G5: 로고 업로드 (my-images API 재활용)

로고는 별도 R2 버킷을 만들지 않고 기존 `/api/my-images` 파이프라인을 사용한다. 업로드 후 `public_url`을 `brand_kits.logo_url`에 저장.

**Files:**
- Modify: `app/mypage/BrandKitSection.js`

- [ ] **Step 1: 로고 업로드 로직 추가**

`BrandKitSection.js` 상단 import 밑에 다음 헬퍼를 추가하고, 비주얼 그룹의 `placeholderNote` 부분을 로고 업로드 UI로 교체한다.

```javascript
// BrandKitSection.js — 컴포넌트 내부에 추가

const [logoUploading, setLogoUploading] = useState(false);

async function handleLogoChange(e) {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;

  if (!['image/jpeg', 'image/png'].includes(file.type)) {
    setError('로고는 JPG 또는 PNG만 가능합니다.');
    return;
  }
  if (file.size > 2 * 1024 * 1024) {
    setError('로고 파일은 2MB 이하만 가능합니다.');
    return;
  }

  const token = getToken();
  if (!token) return;

  setLogoUploading(true);
  setError('');
  try {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('tag', 'brand-logo');
    const res = await fetch('/api/my-images', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: fd,
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || '로고 업로드에 실패했습니다.');
    } else if (data.image?.public_url) {
      update('logo_url', data.image.public_url);
    }
  } catch {
    setError('네트워크 오류가 발생했습니다.');
  } finally {
    setLogoUploading(false);
  }
}

function removeLogo() {
  update('logo_url', '');
}
```

그리고 `placeholderNote` 블록을 다음으로 교체:

```jsx
<div className={styles.field}>
  <span className={styles.fieldLabel}>로고 이미지</span>
  <div className={styles.logoArea}>
    {form.logo_url ? (
      <img src={form.logo_url} alt="로고" className={styles.logoPreview} />
    ) : (
      <div className={styles.logoPlaceholder}>로고<br />없음</div>
    )}
    <div className={styles.logoControls}>
      <input
        type="file"
        id="brand-logo-upload"
        accept="image/jpeg,image/png"
        onChange={handleLogoChange}
        style={{ display: 'none' }}
      />
      <label htmlFor="brand-logo-upload" className={styles.logoBtn}>
        {logoUploading ? '업로드 중...' : (form.logo_url ? '교체' : '+ 로고 업로드')}
      </label>
      {form.logo_url && (
        <button type="button" className={styles.logoRemoveBtn} onClick={removeLogo}>
          로고 제거
        </button>
      )}
      <div className={styles.logoHint}>JPG/PNG, 최대 2MB. 정사각형 권장</div>
    </div>
  </div>
</div>
```

- [ ] **Step 2: 빌드 체크**

```bash
npx next build 2>&1 | grep -iE "error|✓ Compiled" | head -5
```

Expected: 성공.

- [ ] **Step 3: 커밋**

```bash
git add app/mypage/BrandKitSection.js
git commit -m "$(cat <<'EOF'
feat(mypage): 브랜드 킷 로고 업로드 (my-images API 재활용)

tag=brand-logo로 업로드해 public_url을 logo_url 필드에 저장.
최대 2MB, JPG/PNG. 교체/제거 버튼.
별도 R2 버킷 없이 기존 user_images 파이프라인에 얹는 방식.
EOF
)"
```

---

## Task G6: 컬러 피커 (primary/secondary)

HTML5 `<input type="color">` + hex 입력 병행. 입력값은 `#RRGGBB` 정규식으로 검증(lib/brand-kit.js의 sanitize와 동일).

**Files:**
- Modify: `app/mypage/BrandKitSection.js`

- [ ] **Step 1: 컬러 입력 UI 추가**

`BrandKitSection.js`의 비주얼 그룹에서 로고 필드 아래에 컬러 입력을 추가한다.

```jsx
<div className={styles.field}>
  <span className={styles.fieldLabel}>브랜드 컬러</span>
  <div className={styles.colorRow}>
    <div className={styles.colorField}>
      <div className={styles.colorBox}>
        <input
          type="color"
          className={styles.colorSwatch}
          value={form.primary_color || '#FF5F1F'}
          onChange={(e) => update('primary_color', e.target.value.toUpperCase())}
          aria-label="메인 컬러"
        />
        <input
          type="text"
          className={styles.colorHex}
          value={form.primary_color}
          onChange={(e) => {
            const v = e.target.value.toUpperCase();
            if (v === '' || /^#[0-9A-F]{0,6}$/.test(v)) update('primary_color', v);
          }}
          placeholder="#FF5F1F"
          maxLength={7}
        />
      </div>
      <div className={styles.logoHint}>메인 (자막·강조)</div>
    </div>
    <div className={styles.colorField}>
      <div className={styles.colorBox}>
        <input
          type="color"
          className={styles.colorSwatch}
          value={form.secondary_color || '#1F2937'}
          onChange={(e) => update('secondary_color', e.target.value.toUpperCase())}
          aria-label="서브 컬러"
        />
        <input
          type="text"
          className={styles.colorHex}
          value={form.secondary_color}
          onChange={(e) => {
            const v = e.target.value.toUpperCase();
            if (v === '' || /^#[0-9A-F]{0,6}$/.test(v)) update('secondary_color', v);
          }}
          placeholder="#1F2937"
          maxLength={7}
        />
      </div>
      <div className={styles.logoHint}>서브 (보조 그래픽)</div>
    </div>
  </div>
</div>
```

- [ ] **Step 2: 검증 메모 (저장 시 서버 sanitize가 잘못된 hex를 null로 치환)**

`lib/brand-kit.js`의 `sanitizeBrandKit`에서 이미 `/^#([0-9A-Fa-f]{6})$/`로 검증하므로 잘못된 값은 자동으로 null로 저장된다. 클라이언트 UI도 맞춰서 7자리 hex만 허용.

- [ ] **Step 3: 빌드 체크**

```bash
npx next build 2>&1 | grep -iE "error|✓ Compiled" | head -5
```

Expected: 성공.

- [ ] **Step 4: 커밋**

```bash
git add app/mypage/BrandKitSection.js
git commit -m "$(cat <<'EOF'
feat(mypage): 브랜드 컬러 피커 (primary + secondary)

HTML5 color input + hex 텍스트 입력 병행.
서버 sanitize가 #RRGGBB 정규식으로 검증, 잘못된 값 null 치환.
메인은 자막·강조, 서브는 보조 그래픽에 사용 예정 (Phase F).
EOF
)"
```

---

## Task G7: MyPageClient 통합 — 내 이미지와 Threads 사이에 삽입

**Files:**
- Modify: `app/mypage/MyPageClient.js`

- [ ] **Step 1: BrandKitSection import + 카드 추가**

`MyPageClient.js` 상단 import에 추가:

```javascript
import BrandKitSection from './BrandKitSection';
```

렌더 영역에서 `MyImagesSection` 카드 직후, `Threads 계정` 카드 직전에 다음을 삽입:

```jsx
<div className={styles.card}>
  <BrandKitSection />
</div>
```

`app/mypage/page.module.css`는 기존 `.card` 클래스를 그대로 사용 (별도 수정 불필요).

- [ ] **Step 2: 빌드 체크**

```bash
npx next build 2>&1 | grep -iE "error|✓ Compiled" | head -5
```

Expected: 성공.

- [ ] **Step 3: 커밋**

```bash
git add app/mypage/MyPageClient.js
git commit -m "$(cat <<'EOF'
feat(mypage): BrandKitSection 삽입 (내 이미지 ↔ Threads 사이)

마이페이지 섹션 순서: 사용자 정보 → 크레딧 → 내 이미지 → 브랜드 킷 → Threads → 로그아웃.
EOF
)"
```

---

## Task G8: shortform-script API 통합 — 프롬프트에 브랜드 킷 주입

Step 3 대본 생성 API에서 요청자 이메일로 브랜드 킷을 조회해, `buildPromptContext`로 포맷한 문자열을 Claude 프롬프트의 시스템/유저 메시지에 주입한다. 브랜드 킷이 없으면 주입 스킵.

**Files:**
- Modify: `app/api/shortform-script/route.js`

- [ ] **Step 1: 현황 확인**

```bash
npx next build 2>&1 | head -5
```

`app/api/shortform-script/route.js`의 Claude 호출 지점을 확인한다. 프롬프트 구성부에서 `systemPrompt` 또는 `userPrompt`가 이어지는 위치에 브랜드 킷 섹션을 끼워넣을 것.

- [ ] **Step 2: 브랜드 킷 로드 + 주입**

파일 상단 import에 추가:

```javascript
import { getBrandKit, buildPromptContext } from '@/lib/brand-kit';
```

핸들러 초입, 인증 확인(email 추출) 직후에 브랜드 킷을 조회:

```javascript
// 브랜드 킷 자동 로드 (없으면 null)
let brandContext = null;
try {
  const kit = await getBrandKit(email);
  brandContext = buildPromptContext(kit);
} catch (err) {
  console.warn('[SHORTFORM-SCRIPT] brand kit load failed:', err.message);
  // non-fatal: 브랜드 킷 로드 실패해도 대본 생성은 계속
}
```

그리고 Claude에 보내는 `userPrompt` 구성 로직에서, 페르소나/톤 다음에 다음 블록을 추가:

```javascript
const brandBlock = brandContext
  ? `\n\n## 브랜드 킷 (자동 적용)\n${brandContext}\n\n위 브랜드 킷의 시그니처 인사/클로징/CTA를 자연스럽게 녹여주세요.`
  : '';

// 기존 userPrompt에 brandBlock 추가
const userPrompt = [
  existingPromptBody,
  brandBlock,
].filter(Boolean).join('');
```

(정확한 변수명은 기존 `shortform-script/route.js` 구조에 맞춰 조정. 핵심은 `brandBlock` 문자열을 프롬프트 본문에 append.)

- [ ] **Step 3: 응답에 brandApplied 플래그 포함**

클라이언트가 "브랜드 킷이 적용되었습니다" 배너를 띄울 수 있도록 응답에 플래그 추가:

```javascript
return jsonResponse(request, {
  script: scriptJson,
  brandApplied: Boolean(brandContext),
  // ... 기존 필드
});
```

- [ ] **Step 4: 빌드 체크**

```bash
npx next build 2>&1 | grep -iE "error|✓ Compiled" | head -5
```

Expected: 성공.

- [ ] **Step 5: 수동 검증**

1. `/api/brand-kit`로 가게명/슬로건/시그니처 인사/CTA 저장
2. 숏폼 Step 3 대본 생성 실행
3. 생성된 대본에 브랜드 킷 시그니처 멘트가 반영되었는지 확인
4. 브랜드 킷 DELETE 후 재생성 → 멘트가 일반 톤으로 바뀌는지 확인

- [ ] **Step 6: 커밋**

```bash
git add app/api/shortform-script/route.js
git commit -m "$(cat <<'EOF'
feat(api): 숏폼 대본에 브랜드 킷 자동 주입

/api/shortform-script가 요청자 이메일로 브랜드 킷 조회 후
시그니처 인사/클로징/CTA를 Claude 프롬프트에 삽입.
응답에 brandApplied 플래그 포함.
브랜드 킷 로드 실패는 non-fatal (대본 생성은 계속).
EOF
)"
```

---

## Task G9: 적용 배너 — 숏폼 페이지에 "자동 적용 중" 표시

사용자가 숏폼 페이지에 진입할 때 브랜드 킷이 존재하면 상단에 "내 브랜드 킷이 모든 영상에 자동 적용됩니다" 배너를 표시. 클릭 시 마이페이지로 이동.

**Files:**
- Modify: `app/shortform/ShortformClient.js`
- Modify: `app/shortform/page.module.css`

- [ ] **Step 1: ShortformClient 상단에 배너 추가**

컴포넌트 상단에 브랜드 킷 상태를 불러오는 useEffect:

```javascript
const [brandKit, setBrandKit] = useState(null);
const [brandKitLoaded, setBrandKitLoaded] = useState(false);

useEffect(() => {
  const token = typeof window !== 'undefined' ? localStorage.getItem('ddukddak_token') : null;
  if (!token) { setBrandKitLoaded(true); return; }
  fetch('/api/brand-kit', {
    headers: { Authorization: `Bearer ${token}` },
  })
    .then((r) => r.json())
    .then((data) => {
      setBrandKit(data.kit || null);
      setBrandKitLoaded(true);
    })
    .catch(() => setBrandKitLoaded(true));
}, []);
```

StepProgress 위에 배너 삽입:

```jsx
{brandKitLoaded && brandKit && (
  <a href="/mypage" className={styles.brandAppliedBanner}>
    <span className={styles.brandAppliedIcon}>✓</span>
    <span>
      <strong>{brandKit.store_name || '내 브랜드 킷'}</strong>이
      모든 영상에 자동 적용됩니다
    </span>
    <span className={styles.brandAppliedLink}>수정 →</span>
  </a>
)}
```

- [ ] **Step 2: 스타일 추가**

`app/shortform/page.module.css`에 추가:

```css
.brandAppliedBanner {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  background: rgba(16, 185, 129, 0.08);
  border: 1px solid rgba(16, 185, 129, 0.25);
  border-radius: 10px;
  font-size: 12px;
  color: var(--ds-text, #1F2937);
  text-decoration: none;
  margin-bottom: 12px;
}
.brandAppliedBanner:hover { background: rgba(16, 185, 129, 0.12); }
.brandAppliedIcon {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: #10B981;
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 700;
  flex-shrink: 0;
}
.brandAppliedLink {
  margin-left: auto;
  color: var(--ds-accent, #ff5f1f);
  font-weight: 700;
  flex-shrink: 0;
}
```

- [ ] **Step 3: 빌드 체크**

```bash
npx next build 2>&1 | grep -iE "error|✓ Compiled" | head -5
```

Expected: 성공.

- [ ] **Step 4: 커밋**

```bash
git add app/shortform/ShortformClient.js app/shortform/page.module.css
git commit -m "$(cat <<'EOF'
feat(shortform): 브랜드 킷 자동 적용 배너

숏폼 페이지 진입 시 /api/brand-kit 로드.
브랜드 킷이 있으면 StepProgress 위에 녹색 배너 표시.
클릭 시 /mypage로 이동해 수정 가능.
EOF
)"
```

---

## Task G10: 첫 사용 UX — 빈 브랜드 킷 안내

사용자가 처음 숏폼 도구에 진입했는데 브랜드 킷이 비어있으면, 다른 톤의 배너로 "1분만 투자하면 일관성 있어져요" 안내를 표시.

**Files:**
- Modify: `app/shortform/ShortformClient.js`

- [ ] **Step 1: 빈 상태 배너 추가**

G9에서 추가한 조건부 배너 바로 아래에 else 분기 추가:

```jsx
{brandKitLoaded && !brandKit && (
  <a href="/mypage#brand-kit" className={styles.brandEmptyBanner}>
    <span className={styles.brandEmptyIcon}>💡</span>
    <span>
      <strong>1분만 투자하면</strong> 모든 영상이 더 일관성 있어져요.
      가게명/시그니처 멘트만 저장해도 충분합니다
    </span>
    <span className={styles.brandEmptyLink}>브랜드 킷 만들기 →</span>
  </a>
)}
```

- [ ] **Step 2: 스타일 추가 (`app/shortform/page.module.css`)**

```css
.brandEmptyBanner {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  background: rgba(255, 95, 31, 0.05);
  border: 1px dashed rgba(255, 95, 31, 0.35);
  border-radius: 10px;
  font-size: 12px;
  color: var(--ds-text, #1F2937);
  text-decoration: none;
  margin-bottom: 12px;
}
.brandEmptyBanner:hover { background: rgba(255, 95, 31, 0.08); }
.brandEmptyIcon {
  font-size: 16px;
  flex-shrink: 0;
}
.brandEmptyLink {
  margin-left: auto;
  color: var(--ds-accent, #ff5f1f);
  font-weight: 700;
  flex-shrink: 0;
}
```

- [ ] **Step 3: 세션 dismiss 지원 (옵션)**

사용자가 배너를 닫을 수 있도록 localStorage에 `brandKitDismissedAt` 저장:

```javascript
const [brandBannerDismissed, setBrandBannerDismissed] = useState(false);

useEffect(() => {
  if (typeof window === 'undefined') return;
  const dismissedAt = localStorage.getItem('brandKitDismissedAt');
  if (dismissedAt) {
    // 24시간 이내면 dismiss 상태 유지
    const elapsed = Date.now() - Number(dismissedAt);
    if (elapsed < 24 * 60 * 60 * 1000) setBrandBannerDismissed(true);
  }
}, []);

function dismissBrandBanner(e) {
  e.preventDefault();
  localStorage.setItem('brandKitDismissedAt', String(Date.now()));
  setBrandBannerDismissed(true);
}
```

배너 JSX에 닫기 버튼 추가 + 조건 `{brandKitLoaded && !brandKit && !brandBannerDismissed && ...}`.

- [ ] **Step 4: 빌드 체크 + 커밋**

```bash
npx next build 2>&1 | grep -iE "error|✓ Compiled" | head -5
git add app/shortform/ShortformClient.js app/shortform/page.module.css
git commit -m "$(cat <<'EOF'
feat(shortform): 브랜드 킷 빈 상태 안내 배너

브랜드 킷 없는 사용자에게 "1분만 투자하면" 유도 배너 표시.
24시간 dismiss 지원 (localStorage brandKitDismissedAt).
클릭 시 /mypage#brand-kit으로 이동.
EOF
)"
```

---

## Task G11: 수동 회귀 검증

**Files:** 없음 (수동 검증만)

- [ ] **Step 1: 전체 시나리오 수동 테스트**

로컬 dev 서버에서 순서대로 확인:

1. **마이페이지 진입**
   - [ ] BrandKitSection이 내 이미지 직후에 렌더링
   - [ ] 첫 진입 시 `isEmpty` 배너(주황색) 표시
   - [ ] 로딩 스피너 → 폼 전환 흐름

2. **브랜드 킷 저장**
   - [ ] 가게명만 입력 후 저장 → 성공 토스트
   - [ ] 새로고침 후에도 값 유지
   - [ ] 로고 업로드 → 미리보기 즉시 반영
   - [ ] 컬러 피커 변경 → hex 입력 동기화
   - [ ] 잘못된 hex(`#ZZZ`) 입력 차단

3. **브랜드 킷 삭제**
   - [ ] 삭제 확인창 → 삭제 → 폼 리셋 → 빈 상태 배너 재표시

4. **숏폼 페이지 진입**
   - [ ] 브랜드 킷 있음 → 녹색 "자동 적용" 배너
   - [ ] 브랜드 킷 없음 → 주황 "1분만 투자" 배너
   - [ ] dismiss 버튼 → 배너 사라짐, 새로고침해도 유지

5. **대본 생성 통합**
   - [ ] 브랜드 킷 있을 때 대본 생성 → 시그니처 인사/CTA가 실제 결과에 반영
   - [ ] 응답 JSON에 `brandApplied: true`
   - [ ] 브랜드 킷 삭제 후 재생성 → `brandApplied: false`

6. **권한/보안**
   - [ ] 비로그인 상태로 `/api/brand-kit` GET → 401
   - [ ] 다른 사용자 토큰으로 조회 시 자기 데이터만 반환
   - [ ] POST body에 긴 문자열(1000자 초과) → 서버에서 자동 잘림(에러 없음)

- [ ] **Step 2: 모바일 반응형**

DevTools 모바일 모드에서 BrandKitSection의 input/color/select가 깨지지 않는지 확인. 컬러 피커는 모바일에서 네이티브 피커 팝업 동작.

- [ ] **Step 3: 발견 이슈 기록**

발견한 문제가 있으면 이 단계에서 hotfix 커밋으로 수정하거나, Phase G 후속 이슈로 메모.

---

## Task G12: 메모리 + 마스터 플랜 상태 업데이트

**Files:**
- Modify: `~/.claude/projects/-Users-gong-eunhui-Desktop-naver-title-generator/memory/MEMORY.md`
- Create: `~/.claude/projects/-Users-gong-eunhui-Desktop-naver-title-generator/memory/project_shortform_phase_g_complete.md`
- Modify: `docs/superpowers/plans/2026-04-14-shortform-master-plan.md`

- [ ] **Step 1: 메모리 파일 작성**

```markdown
---
name: 숏폼 Phase G 완료
description: 브랜드 킷 (마이페이지 섹션 + 자동 적용)
type: project
---

# 숏폼 Phase G 완료

**완료일:** 2026-04-XX
**스펙:** docs/superpowers/specs/2026-04-14-shortform-benchmark-pipeline-design.md §14
**플랜:** docs/superpowers/plans/2026-04-14-shortform-phase-g-brand-kit.md

## 핵심 변경

- `brand_kits` 테이블 자동 마이그레이션 (lazy, user-images 패턴 재사용)
- `/api/brand-kit` GET/POST/DELETE 엔드포인트
- 마이페이지 BrandKitSection (내 이미지 ↔ Threads 사이)
- 로고 업로드: `/api/my-images` 재활용 (tag=brand-logo)
- 컬러 피커: HTML5 color + hex 입력 병행, 서버 sanitize
- 대본 생성 API: 브랜드 킷 자동 로드 → 시그니처 멘트 프롬프트 주입
- 숏폼 페이지 진입 시 적용/빈 상태 배너 자동 표시

## 신규 파일

- lib/brand-kit.js
- app/api/brand-kit/route.js
- app/mypage/BrandKitSection.js + .module.css

## 수정 파일

- app/mypage/MyPageClient.js
- app/api/shortform-script/route.js
- app/shortform/ShortformClient.js
- app/shortform/page.module.css

## 다음 Phase

Phase H (프로젝트 히스토리 UI) — 브랜드 킷과 나란히 "내 영상" 섹션 추가.
Phase F (자막 렌더링)에서 primary_color를 자막 색에 적용.
```

- [ ] **Step 2: MEMORY.md 최근 세션 섹션에 추가**

```markdown
- [4/XX 숏폼 Phase G 완료](project_shortform_phase_g_complete.md) — 브랜드 킷 + 자동 적용
```

- [ ] **Step 3: 마스터 플랜 Phase G 상태 마킹**

`docs/superpowers/plans/2026-04-14-shortform-master-plan.md`의 Phase G 섹션 끝에:

```markdown
**상태:** ✅ 완료 (커밋 SHA: XXXXXXX)
```

- [ ] **Step 4: 최종 커밋**

```bash
git add docs/superpowers/plans/2026-04-14-shortform-master-plan.md
git commit -m "$(cat <<'EOF'
docs: Phase G 완료 마킹 + 메모리 기록

Phase G (Brand Kit: 마이페이지 섹션 + 자동 적용) 완료.
Phase H 및 Phase F의 자막 색 적용 진입 가능.
EOF
)"
```

---

## Phase G 자기 검토

### Spec coverage

| 스펙 섹션 | 커버 task |
|---|---|
| §14 UI 위치 — 마이페이지 내 브랜드 킷 섹션 | G3, G7 |
| §14 저장 항목 — 가게/비주얼/멘트/연락처 4 그룹 | G3, G5, G6 |
| §14 데이터 모델 — `brand_kits` 테이블 | G1 |
| §14 API — GET/POST/DELETE | G2 |
| §14 통합 지점 §2 Step 3 대본 | G8 |
| §14 통합 지점 §4 Step 6 미리보기 (primary_color) | (Phase F 이관) |
| §14 통합 지점 §5 Step 7 캡션 자동 삽입 | (Phase F/J 이관) |
| §14 첫 사용 UX — 배너 안내 | G9, G10 |

### 알려진 미완 (다른 Phase)

- primary_color의 자막 실제 적용은 **Phase F**(자막 렌더링)에서 처리
- 캡션 자동 삽입(위치/영업시간/연락처)은 **Phase J**(YouTube/캡션)에서 처리
- industry → persona 자동 추론은 Phase A의 Step 1에서 옵션 제안으로 추가 가능 (Phase G에서는 프롬프트 레벨만)

### 회귀 안전성

- 브랜드 킷 로드 실패는 non-fatal (대본 생성은 계속)
- `brand_kits` 테이블은 lazy 마이그레이션 — 기존 사용자 영향 0
- 로고 업로드는 기존 `user_images` 쿼터에 포함됨 (별도 쿼터 불필요)
- 마이페이지 다른 섹션(내 이미지, Threads)은 무변경
- `/api/my-images` 엔드포인트는 `tag=brand-logo`로 업로드돼 내 이미지 리스트에도 표시됨 (사용자가 직접 삭제 가능)

### 통합 지점 (다음 Phase가 사용할 인터페이스)

- **Phase F**: `getBrandKit(email).primary_color` → 자막 색 override
- **Phase H**: 마이페이지 섹션 순서 — BrandKitSection과 ShortformProjectsSection이 나란히 위치
- **Phase I**: SSE 대본 생성 완료 이벤트 payload에 `brandApplied` 포함
- **Phase J**: `buildCaptionMeta(kit)` → YouTube 설명란 자동 삽입

---

## Phase G 완료 후 다음 단계

Phase H (프로젝트 히스토리 UI) 상세 플랜 실행. Phase H는 Phase C(shortform_projects API)에 의존하므로 Phase C가 선행되어야 함.
