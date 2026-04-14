# 카드뉴스 사용자 이미지 + 내 이미지 보관함 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 매장 사장님이 자기 사진을 한 번 올려두고 카드뉴스·숏폼·블로그 어디서든 재사용할 수 있는 "내 이미지 보관함"을 구축하고, 카드뉴스를 첫 번째 소비자로 통합한다.

**Architecture:** Neon DB `user_images` 테이블로 메타데이터 관리, R2에 원본+썸네일 저장. 4종 API(`POST/GET/PATCH/DELETE /api/my-images`), 마이페이지 내 "내 이미지" 섹션, 공용 `<ImagePickerModal>` 컴포넌트. 카드뉴스에서는 각 카드 우하단 📷 아이콘으로 모달 호출 → 크롭 후 Satori 렌더러가 사용자 이미지 삽입.

**Tech Stack:** Next.js 15 App Router, Neon PostgreSQL, Cloudflare R2(S3 SDK), sharp(서버 이미지 처리), react-easy-crop(클라이언트 크롭), Satori(기존 카드뉴스 렌더러)

**Spec:** `/Users/gong-eunhui/Desktop/naver-title-generator/docs/superpowers/specs/2026-04-14-cardnews-user-images-design.md`

**주의사항 (이 프로젝트의 특수 조건):**
- 테스트 프레임워크 없음 → 단위 테스트 대신 **curl 수동 검증 + 브라우저 검증** 사용
- 기존 API 패턴: `@/lib/api-helpers` (getRedis/extractToken/resolveSessionEmail/jsonResponse)
- 기존 DB 패턴: `@/lib/db` (getDb, chargeCredits, logUsage)
- 기존 R2 패턴: `@/lib/r2` (uploadToR2, cdn.ddukddaktool.co.kr 사용)
- 인증: 세션 토큰은 Redis `session:${token}` 에서 `{email}` 읽음
- DB 마이그레이션은 `app/api/admin-init-db/route.js`와 동일하게 `resolveAdmin` 보호 관리자 엔드포인트 방식

---

## 파일 구조 (생성/수정 목록)

### 신규 파일
```
app/api/my-images/route.js               POST(업로드) + GET(목록)
app/api/my-images/[id]/route.js          PATCH(태그) + DELETE(삭제)
app/api/admin-init-user-images/route.js  테이블 생성 (관리자)
components/ImagePickerModal.js            공용 이미지 선택 모달
components/ImagePickerModal.module.css    모달 스타일
lib/user-images.js                        업로드 파이프라인 (sharp + R2 + DB)
lib/user-quota.js                         용량 판정 (무료/유료)
app/mypage/MyImagesSection.js             마이페이지 "내 이미지" 섹션
app/mypage/MyImagesSection.module.css     섹션 스타일
```

### 수정 파일
```
package.json                                sharp, react-easy-crop 추가
app/mypage/MyPageClient.js                  MyImagesSection 삽입
app/card-news/CardNewsClient.js             카드별 📷 버튼 + 모달 연결 + payload 확장
app/card-news/page.module.css               카드 오버레이 버튼 스타일
app/api/card-news/route.js                  userImages[] 수용 + 소유권 검증 + renderSlides 전달
```

---

## Phase A — 보관함 백엔드

### Task A1: 의존성 추가

**Files:**
- Modify: `package.json`

- [ ] **Step 1: sharp, react-easy-crop 설치**

```bash
cd /Users/gong-eunhui/Desktop/naver-title-generator
npm install sharp react-easy-crop
```

Expected: `package.json` dependencies에 `sharp`, `react-easy-crop` 두 항목 추가. `package-lock.json` 업데이트.

- [ ] **Step 2: 커밋**

```bash
git add package.json package-lock.json
git commit -m "chore: sharp + react-easy-crop 의존성 추가

카드뉴스 사용자 이미지 업로드 기능 준비.
sharp = 서버 썸네일/EXIF 제거, react-easy-crop = 클라이언트 크롭."
```

---

### Task A2: user_images DB 테이블 생성

**Files:**
- Create: `app/api/admin-init-user-images/route.js`

- [ ] **Step 1: 관리자 마이그레이션 엔드포인트 작성**

```javascript
// app/api/admin-init-user-images/route.js
import { resolveAdmin, jsonResponse, handleOptions } from '@/lib/api-helpers';
import { getDb } from '@/lib/db';

export async function OPTIONS(request) {
  return handleOptions(request);
}

export async function POST(request) {
  const isAdmin = await resolveAdmin(request);
  if (!isAdmin) return jsonResponse(request, { error: '관리자 인증 실패' }, { status: 403 });

  try {
    const sql = getDb();

    await sql`CREATE TABLE IF NOT EXISTS user_images (
      id SERIAL PRIMARY KEY,
      user_email VARCHAR(254) NOT NULL,
      r2_key TEXT NOT NULL,
      public_url TEXT NOT NULL,
      thumb_url TEXT NOT NULL,
      filename VARCHAR(255) NOT NULL,
      mime_type VARCHAR(50) NOT NULL,
      file_size INTEGER NOT NULL,
      width INTEGER,
      height INTEGER,
      tag VARCHAR(50),
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`;

    await sql`CREATE INDEX IF NOT EXISTS idx_user_images_email_created
      ON user_images (user_email, created_at DESC)`;

    return jsonResponse(request, { success: true, message: 'user_images 테이블 + 인덱스 생성 완료' });
  } catch (err) {
    console.error('[INIT-USER-IMAGES] Error:', err.message);
    return jsonResponse(request, { error: err.message }, { status: 500 });
  }
}
```

- [ ] **Step 2: 로컬 개발서버에서 실행 (수동 검증)**

```bash
# 터미널 1: dev 서버
cd /Users/gong-eunhui/Desktop/naver-title-generator
npm run dev

# 터미널 2: 관리자 토큰으로 호출
# 먼저 ADMIN_EMAILS 환경변수에 로그인한 이메일이 있어야 함
TOKEN="<관리자 로그인 후 localStorage에서 복사한 ddukddak_token>"
curl -X POST http://localhost:3000/api/admin-init-user-images \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json"
```

Expected: `{"success":true,"message":"user_images 테이블 + 인덱스 생성 완료"}`

- [ ] **Step 3: Neon 콘솔에서 테이블 확인**

Neon 콘솔(SQL Editor) 실행:
```sql
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'user_images' ORDER BY ordinal_position;
```

Expected: id/user_email/r2_key/public_url/thumb_url/filename/mime_type/file_size/width/height/tag/created_at 컬럼이 모두 존재.

- [ ] **Step 4: 커밋**

```bash
git add app/api/admin-init-user-images/route.js
git commit -m "feat(api): user_images 테이블 마이그레이션 엔드포인트

관리자 전용 init 엔드포인트. admin-init-db 패턴과 동일.
email + created_at DESC 인덱스로 마이페이지 목록 조회 최적화."
```

---

### Task A3: user-quota 헬퍼 (무료/유료 판정)

**Files:**
- Create: `lib/user-quota.js`

- [ ] **Step 1: 용량 판정 헬퍼 작성**

```javascript
// lib/user-quota.js
/**
 * 사용자 이미지 보관함 용량 판정
 * - 무료: 크레딧 구매 이력 없음 → 50MB
 * - 유료: credit_ledger에 type='purchase' 레코드 존재 → 500MB
 */
import { getDb } from '@/lib/db';

export const QUOTA_FREE_BYTES = 50 * 1024 * 1024;    // 50MB
export const QUOTA_PAID_BYTES = 500 * 1024 * 1024;   // 500MB

/**
 * 유저의 총 용량 한도(bytes) 조회
 */
export async function getUserQuota(email) {
  try {
    const sql = getDb();
    const rows = await sql`SELECT 1 FROM credit_ledger
      WHERE user_email = ${email} AND type = 'purchase' LIMIT 1`;
    return rows.length > 0 ? QUOTA_PAID_BYTES : QUOTA_FREE_BYTES;
  } catch (err) {
    console.error('[QUOTA] getUserQuota failed:', err.message);
    return QUOTA_FREE_BYTES;
  }
}

/**
 * 유저가 현재 사용 중인 용량(bytes)
 */
export async function getUserUsage(email) {
  try {
    const sql = getDb();
    const rows = await sql`SELECT COALESCE(SUM(file_size), 0) AS used
      FROM user_images WHERE user_email = ${email}`;
    return Number(rows[0]?.used || 0);
  } catch (err) {
    console.error('[QUOTA] getUserUsage failed:', err.message);
    return 0;
  }
}

/**
 * 업로드 가능 여부 체크
 * @returns {{ ok: boolean, quota: number, used: number, available: number }}
 */
export async function checkQuota(email, incomingBytes) {
  const [quota, used] = await Promise.all([getUserQuota(email), getUserUsage(email)]);
  const available = quota - used;
  return {
    ok: incomingBytes <= available,
    quota,
    used,
    available,
  };
}
```

- [ ] **Step 2: 커밋**

```bash
git add lib/user-quota.js
git commit -m "feat(lib): user-quota 헬퍼 (무료 50MB / 유료 500MB)

credit_ledger에 purchase 이력 있으면 유료로 판정. 구독제가 아닌
크레딧 구매형이라 누적 이력 기준이 가장 합리적."
```

---

### Task A4: user-images 파이프라인 (sharp + R2 + DB)

**Files:**
- Create: `lib/user-images.js`

- [ ] **Step 1: 업로드 파이프라인 작성**

```javascript
// lib/user-images.js
/**
 * 사용자 이미지 업로드 파이프라인
 * 1) 원본 버퍼 → sharp로 EXIF 제거 + rotate() 정규화
 * 2) 썸네일 400x400 생성
 * 3) R2에 원본 + 썸네일 업로드 (email_hash 경로)
 * 4) DB insert
 */
import crypto from 'crypto';
import { uploadToR2 } from '@/lib/r2';
import { getDb } from '@/lib/db';

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png']);
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

export function hashEmail(email) {
  return crypto.createHash('sha256').update(email.toLowerCase()).digest('hex').slice(0, 16);
}

/**
 * 원본 Buffer → 정규화(EXIF 제거) + 썸네일 생성
 * @returns {{ normalized: Buffer, thumb: Buffer, width: number, height: number }}
 */
export async function processImage(buffer, mimeType) {
  const sharp = (await import('sharp')).default;

  // 원본: EXIF 제거 + auto-rotate, 최대 2000px long-edge 리사이즈 (저장 공간 절약)
  const pipeline = sharp(buffer, { failOnError: false })
    .rotate()              // EXIF orientation 적용 후 메타 제거
    .withMetadata({});     // 모든 메타데이터(특히 GPS) 제거

  const { width, height } = await sharp(buffer).metadata();

  const normalized = await pipeline
    .resize({ width: 2000, height: 2000, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 88, mozjpeg: true })
    .toBuffer();

  const thumb = await sharp(buffer, { failOnError: false })
    .rotate()
    .withMetadata({})
    .resize({ width: 400, height: 400, fit: 'cover' })
    .jpeg({ quality: 80 })
    .toBuffer();

  return { normalized, thumb, width: width || 0, height: height || 0 };
}

/**
 * 업로드 전체 플로우
 * @param {string} email
 * @param {Buffer} buffer - 원본
 * @param {string} filename
 * @param {string} mimeType
 * @param {string} [tag]
 * @returns {Promise<object>} DB row
 */
export async function uploadUserImage({ email, buffer, filename, mimeType, tag }) {
  if (!ALLOWED_MIME.has(mimeType)) {
    throw new Error('지원하지 않는 파일 형식입니다. JPG 또는 PNG만 가능합니다.');
  }
  if (buffer.length > MAX_FILE_SIZE) {
    throw new Error('파일 크기가 5MB를 초과합니다.');
  }

  const { normalized, thumb, width, height } = await processImage(buffer, mimeType);

  const emailHash = hashEmail(email);
  const ts = Date.now();
  const rand = crypto.randomBytes(4).toString('hex');
  const baseKey = `user-images/${emailHash}/${ts}_${rand}`;
  const originalKey = `${baseKey}.jpg`;
  const thumbKey = `${baseKey}_thumb.jpg`;

  const publicUrl = await uploadToR2(originalKey, normalized, 'image/jpeg');
  const thumbUrl = await uploadToR2(thumbKey, thumb, 'image/jpeg');

  const safeTag = tag ? String(tag).trim().slice(0, 50) : null;
  const safeFilename = String(filename || 'upload.jpg').slice(0, 255);

  const sql = getDb();
  const rows = await sql`INSERT INTO user_images
    (user_email, r2_key, public_url, thumb_url, filename, mime_type, file_size, width, height, tag)
    VALUES (${email}, ${originalKey}, ${publicUrl}, ${thumbUrl}, ${safeFilename},
            ${'image/jpeg'}, ${normalized.length}, ${width}, ${height}, ${safeTag})
    RETURNING id, public_url, thumb_url, filename, mime_type, file_size, width, height, tag, created_at`;

  return rows[0];
}

/**
 * 이미지 삭제 (R2 + DB)
 */
export async function deleteUserImage(email, id) {
  const sql = getDb();
  const rows = await sql`SELECT r2_key FROM user_images WHERE id = ${id} AND user_email = ${email}`;
  if (rows.length === 0) return { ok: false, reason: 'not-found' };

  const r2Key = rows[0].r2_key;
  const thumbKey = r2Key.replace(/\.jpg$/, '_thumb.jpg');

  try {
    const { S3Client, DeleteObjectCommand } = await import('@aws-sdk/client-s3');
    const client = new S3Client({
      region: 'auto',
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
      },
    });
    const bucket = process.env.R2_BUCKET_NAME;
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: r2Key }));
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: thumbKey }));
  } catch (err) {
    console.error('[USER-IMAGES] R2 delete failed (non-fatal):', err.message);
  }

  await sql`DELETE FROM user_images WHERE id = ${id} AND user_email = ${email}`;
  return { ok: true };
}

/**
 * 사용자 이미지 목록
 */
export async function listUserImages(email, tag) {
  const sql = getDb();
  if (tag) {
    return await sql`SELECT id, public_url, thumb_url, filename, file_size, width, height, tag, created_at
      FROM user_images WHERE user_email = ${email} AND tag = ${tag}
      ORDER BY created_at DESC LIMIT 200`;
  }
  return await sql`SELECT id, public_url, thumb_url, filename, file_size, width, height, tag, created_at
    FROM user_images WHERE user_email = ${email}
    ORDER BY created_at DESC LIMIT 200`;
}

/**
 * id로 소유권 확인
 */
export async function assertOwnership(email, id) {
  const sql = getDb();
  const rows = await sql`SELECT id FROM user_images WHERE id = ${id} AND user_email = ${email}`;
  return rows.length > 0;
}

/**
 * URL 배열이 전부 요청자 소유인지 확인 (카드뉴스 렌더링 시 사용)
 */
export async function verifyOwnershipByUrls(email, urls) {
  if (!urls || urls.length === 0) return true;
  const sql = getDb();
  const rows = await sql`SELECT public_url FROM user_images
    WHERE user_email = ${email} AND public_url = ANY(${urls})`;
  return rows.length === urls.length;
}
```

- [ ] **Step 2: 커밋**

```bash
git add lib/user-images.js
git commit -m "feat(lib): user-images 파이프라인

sharp로 EXIF 제거 + auto-rotate + 썸네일(400x400). R2에 원본/썸네일
각각 업로드 후 DB insert. email_hash 경로로 URL 추측 방지.
processImage/uploadUserImage/deleteUserImage/listUserImages/
assertOwnership/verifyOwnershipByUrls 공개."
```

---

### Task A5: POST /api/my-images + GET /api/my-images

**Files:**
- Create: `app/api/my-images/route.js`

- [ ] **Step 1: route handler 작성**

```javascript
// app/api/my-images/route.js
import {
  getRedis,
  extractToken,
  resolveSessionEmail,
  jsonResponse,
  handleOptions,
} from '@/lib/api-helpers';
import { uploadUserImage, listUserImages } from '@/lib/user-images';
import { checkQuota } from '@/lib/user-quota';

export const maxDuration = 60;

async function requireAuth(request) {
  const token = extractToken(request);
  if (!token) return null;
  const email = await resolveSessionEmail(token);
  return email;
}

export async function OPTIONS(request) {
  return handleOptions(request);
}

export async function POST(request) {
  const email = await requireAuth(request);
  if (!email) {
    return jsonResponse(request, { error: '로그인이 필요합니다.' }, { status: 401 });
  }

  let formData;
  try {
    formData = await request.formData();
  } catch (err) {
    return jsonResponse(request, { error: '잘못된 요청 형식입니다.' }, { status: 400 });
  }

  const file = formData.get('file');
  const tag = formData.get('tag');

  if (!file || typeof file === 'string') {
    return jsonResponse(request, { error: '파일이 없습니다.' }, { status: 400 });
  }

  if (file.size > 5 * 1024 * 1024) {
    return jsonResponse(request, { error: '파일 크기는 5MB 이하만 가능합니다.' }, { status: 400 });
  }

  const quota = await checkQuota(email, file.size);
  if (!quota.ok) {
    return jsonResponse(request, {
      error: '용량이 부족합니다. 기존 이미지를 삭제하거나 크레딧 결제 시 용량이 확장됩니다.',
      quota: quota.quota,
      used: quota.used,
      available: quota.available,
    }, { status: 409 });
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const row = await uploadUserImage({
      email,
      buffer,
      filename: file.name,
      mimeType: file.type,
      tag: tag ? String(tag) : null,
    });
    return jsonResponse(request, { image: row, quota: { ...quota, used: quota.used + row.file_size } }, { status: 201 });
  } catch (err) {
    console.error('[MY-IMAGES] Upload failed:', err.message);
    return jsonResponse(request, { error: err.message || '업로드에 실패했습니다.' }, { status: 500 });
  }
}

export async function GET(request) {
  const email = await requireAuth(request);
  if (!email) {
    return jsonResponse(request, { error: '로그인이 필요합니다.' }, { status: 401 });
  }

  const url = new URL(request.url);
  const tag = url.searchParams.get('tag') || null;

  try {
    const [images, quota] = await Promise.all([
      listUserImages(email, tag),
      checkQuota(email, 0),
    ]);
    return jsonResponse(request, { images, quota });
  } catch (err) {
    console.error('[MY-IMAGES] List failed:', err.message);
    return jsonResponse(request, { error: '목록을 불러오지 못했습니다.' }, { status: 500 });
  }
}
```

- [ ] **Step 2: 로컬 업로드 수동 검증**

```bash
# dev 서버 실행 중 상태에서
TOKEN="<로그인 후 토큰>"

# 작은 JPG 파일 하나 준비
curl -X POST http://localhost:3000/api/my-images \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@/tmp/test.jpg" \
  -F "tag=매장내부"
```

Expected:
- status 201
- body: `{"image":{"id":1,"public_url":"https://cdn.ddukddaktool.co.kr/user-images/...","thumb_url":"...","tag":"매장내부",...},"quota":{"ok":true,"quota":52428800,"used":...,"available":...}}`

- [ ] **Step 3: 목록 조회 검증**

```bash
curl http://localhost:3000/api/my-images \
  -H "Authorization: Bearer $TOKEN"
```

Expected: `{"images":[{...업로드한 이미지}],"quota":{...}}`

- [ ] **Step 4: EXIF 제거 검증 (GPS 좌표가 있는 사진 준비 권장)**

브라우저에서 응답의 `public_url`을 다운로드 후:
```bash
exiftool ~/Downloads/downloaded.jpg | grep -i gps
```

Expected: GPS 관련 라인이 전혀 없어야 함.

- [ ] **Step 5: 미인증 요청 차단 검증**

```bash
curl -X POST http://localhost:3000/api/my-images -F "file=@/tmp/test.jpg"
```

Expected: status 401, `{"error":"로그인이 필요합니다."}`

- [ ] **Step 6: 커밋**

```bash
git add app/api/my-images/route.js
git commit -m "feat(api): POST/GET /api/my-images

- POST: multipart 업로드, 5MB 제한, 용량 체크(409)
- GET: 목록 조회 + 태그 필터 (max 200 rows)
- 인증은 세션 토큰 Bearer 방식"
```

---

### Task A6: PATCH + DELETE /api/my-images/[id]

**Files:**
- Create: `app/api/my-images/[id]/route.js`

- [ ] **Step 1: 동적 route handler 작성**

```javascript
// app/api/my-images/[id]/route.js
import {
  extractToken,
  resolveSessionEmail,
  jsonResponse,
  handleOptions,
} from '@/lib/api-helpers';
import { getDb } from '@/lib/db';
import { deleteUserImage, assertOwnership } from '@/lib/user-images';

async function requireAuth(request) {
  const token = extractToken(request);
  if (!token) return null;
  return await resolveSessionEmail(token);
}

export async function OPTIONS(request) {
  return handleOptions(request);
}

export async function PATCH(request, { params }) {
  const email = await requireAuth(request);
  if (!email) {
    return jsonResponse(request, { error: '로그인이 필요합니다.' }, { status: 401 });
  }

  const { id: idParam } = await params;
  const id = Number(idParam);
  if (!Number.isInteger(id) || id <= 0) {
    return jsonResponse(request, { error: '잘못된 id 입니다.' }, { status: 400 });
  }

  const body = await request.json().catch(() => ({}));
  const tag = body.tag == null ? null : String(body.tag).trim().slice(0, 50);

  const owned = await assertOwnership(email, id);
  if (!owned) {
    return jsonResponse(request, { error: '권한이 없습니다.' }, { status: 403 });
  }

  const sql = getDb();
  const rows = await sql`UPDATE user_images SET tag = ${tag || null}
    WHERE id = ${id} AND user_email = ${email}
    RETURNING id, public_url, thumb_url, filename, file_size, width, height, tag, created_at`;

  return jsonResponse(request, { image: rows[0] });
}

export async function DELETE(request, { params }) {
  const email = await requireAuth(request);
  if (!email) {
    return jsonResponse(request, { error: '로그인이 필요합니다.' }, { status: 401 });
  }

  const { id: idParam } = await params;
  const id = Number(idParam);
  if (!Number.isInteger(id) || id <= 0) {
    return jsonResponse(request, { error: '잘못된 id 입니다.' }, { status: 400 });
  }

  const result = await deleteUserImage(email, id);
  if (!result.ok) {
    return jsonResponse(request, { error: '이미지를 찾을 수 없습니다.' }, { status: 404 });
  }
  return jsonResponse(request, { success: true });
}
```

- [ ] **Step 2: PATCH 수동 검증**

```bash
TOKEN="<토큰>"
# A5에서 업로드한 이미지 id가 1이라고 가정
curl -X PATCH http://localhost:3000/api/my-images/1 \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"tag":"메뉴"}'
```

Expected: `{"image":{...,"tag":"메뉴"}}`

- [ ] **Step 3: 타인 이미지 PATCH 차단 검증**

다른 계정 토큰으로 같은 id 호출:
```bash
OTHER_TOKEN="<다른 계정 토큰>"
curl -X PATCH http://localhost:3000/api/my-images/1 \
  -H "Authorization: Bearer $OTHER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"tag":"해킹"}'
```

Expected: status 403, `{"error":"권한이 없습니다."}`

- [ ] **Step 4: DELETE 검증**

```bash
curl -X DELETE http://localhost:3000/api/my-images/1 \
  -H "Authorization: Bearer $TOKEN"
```

Expected: `{"success":true}`. GET 목록 재호출하면 해당 이미지 없음.

- [ ] **Step 5: 커밋**

```bash
git add app/api/my-images/\[id\]/route.js
git commit -m "feat(api): PATCH/DELETE /api/my-images/[id]

- PATCH: 태그만 수정 (50자 제한)
- DELETE: R2 원본+썸네일 + DB 레코드 제거
- 소유권 검증(assertOwnership)으로 타인 접근 차단"
```

---

## Phase B — 마이페이지 UI

### Task B1: MyImagesSection 컴포넌트 (스켈레톤)

**Files:**
- Create: `app/mypage/MyImagesSection.js`
- Create: `app/mypage/MyImagesSection.module.css`

- [ ] **Step 1: 섹션 스켈레톤 작성 (목록 조회 + 용량 표시)**

```javascript
// app/mypage/MyImagesSection.js
'use client';

import { useEffect, useState } from 'react';
import { getToken } from '@/lib/auth';
import styles from './MyImagesSection.module.css';

function formatBytes(bytes) {
  if (!bytes) return '0MB';
  const mb = bytes / 1024 / 1024;
  return mb >= 1 ? `${mb.toFixed(1)}MB` : `${(bytes / 1024).toFixed(0)}KB`;
}

export default function MyImagesSection() {
  const [images, setImages] = useState([]);
  const [quota, setQuota] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function refresh() {
    const token = getToken();
    if (!token) return;
    setLoading(true);
    try {
      const res = await fetch('/api/my-images', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || '목록을 불러오지 못했습니다.');
      } else {
        setImages(data.images || []);
        setQuota(data.quota || null);
        setError('');
      }
    } catch (_) {
      setError('네트워크 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refresh(); }, []);

  const usedPct = quota ? Math.min(100, Math.round((quota.used / quota.quota) * 100)) : 0;
  const barColor = usedPct >= 80 ? '#DC2626' : 'var(--ds-accent)';

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <div className={styles.title}>내 이미지</div>
        {quota && (
          <div className={styles.quotaText}>
            {formatBytes(quota.used)} / {formatBytes(quota.quota)}
          </div>
        )}
      </div>

      {quota && (
        <div className={styles.quotaBar}>
          <div className={styles.quotaFill} style={{ width: `${usedPct}%`, background: barColor }} />
        </div>
      )}

      {loading && <div className={styles.loadingText}>불러오는 중...</div>}
      {error && <div className={styles.errorText}>{error}</div>}

      {!loading && images.length === 0 && !error && (
        <div className={styles.emptyText}>
          아직 업로드된 이미지가 없습니다.<br />
          매장/메뉴/상품 사진을 업로드하면 카드뉴스·숏폼·블로그에서 불러 쓸 수 있어요.
        </div>
      )}

      {images.length > 0 && (
        <div className={styles.grid}>
          {images.map((img) => (
            <div key={img.id} className={styles.tile}>
              <img src={img.thumb_url} alt={img.filename} className={styles.thumb} />
              {img.tag && <div className={styles.tag}>{img.tag}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: CSS 작성**

```css
/* app/mypage/MyImagesSection.module.css */
.root { display: flex; flex-direction: column; gap: 12px; }

.header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
}
.title {
  font-size: 15px;
  font-weight: 700;
  color: var(--ds-text, #1F2937);
}
.quotaText {
  font-size: 12px;
  color: var(--ds-muted, #77736B);
  font-variant-numeric: tabular-nums;
}

.quotaBar {
  height: 6px;
  background: var(--ds-surface-2, #F3F4F6);
  border-radius: 999px;
  overflow: hidden;
}
.quotaFill {
  height: 100%;
  transition: width 0.3s ease, background 0.3s ease;
}

.loadingText, .emptyText, .errorText {
  font-size: 13px;
  color: var(--ds-muted, #77736B);
  text-align: center;
  padding: 24px 12px;
  line-height: 1.6;
}
.errorText { color: #DC2626; }

.grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
}
@media (max-width: 600px) {
  .grid { grid-template-columns: repeat(3, 1fr); }
}

.tile {
  position: relative;
  aspect-ratio: 1;
  border-radius: 8px;
  overflow: hidden;
  background: #F3F4F6;
}
.thumb {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.tag {
  position: absolute;
  left: 6px;
  bottom: 6px;
  background: rgba(0, 0, 0, 0.65);
  color: #fff;
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 4px;
  max-width: calc(100% - 12px);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
```

- [ ] **Step 3: 커밋**

```bash
git add app/mypage/MyImagesSection.js app/mypage/MyImagesSection.module.css
git commit -m "feat(mypage): MyImagesSection 스켈레톤 (목록 + 용량 바)

GET /api/my-images 연동. 썸네일 그리드 4열(모바일 3열),
용량 바 80% 넘으면 빨강."
```

---

### Task B2: 업로드 dropzone + 진행 표시

**Files:**
- Modify: `app/mypage/MyImagesSection.js`
- Modify: `app/mypage/MyImagesSection.module.css`

- [ ] **Step 1: 업로드 핸들러 + 드래그 앤 드롭 추가**

`MyImagesSection.js` 맨 위 import 아래에 새 상태 추가하고, 컴포넌트 상단에 드롭존 렌더링 추가:

```javascript
// 파일 상단에 추가
const ACCEPT_TYPES = ['image/jpeg', 'image/png'];
const MAX_BYTES = 5 * 1024 * 1024;
```

```javascript
// 컴포넌트 내부 상태 (loading/error 아래에 추가)
const [uploadQueue, setUploadQueue] = useState([]); // [{name, status, error}]
const [dragOver, setDragOver] = useState(false);

async function uploadOne(file) {
  const token = getToken();
  const fd = new FormData();
  fd.append('file', file);
  const res = await fetch('/api/my-images', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: fd,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || '업로드 실패');
  return data;
}

async function handleFiles(fileList) {
  const files = Array.from(fileList);
  const valid = [];
  const invalid = [];
  for (const f of files) {
    if (!ACCEPT_TYPES.includes(f.type)) {
      invalid.push({ name: f.name, status: 'error', error: '지원하지 않는 형식' });
      continue;
    }
    if (f.size > MAX_BYTES) {
      invalid.push({ name: f.name, status: 'error', error: '5MB 초과' });
      continue;
    }
    valid.push(f);
  }
  if (invalid.length > 0) {
    setUploadQueue((q) => [...q, ...invalid]);
  }
  for (const f of valid) {
    const item = { name: f.name, status: 'uploading' };
    setUploadQueue((q) => [...q, item]);
    try {
      await uploadOne(f);
      setUploadQueue((q) => q.map((x) => x === item ? { ...x, status: 'done' } : x));
    } catch (err) {
      setUploadQueue((q) => q.map((x) => x === item ? { ...x, status: 'error', error: err.message } : x));
    }
  }
  await refresh();
  // 3초 후 성공 항목 제거
  setTimeout(() => setUploadQueue((q) => q.filter((x) => x.status !== 'done')), 3000);
}

function onInputChange(e) {
  if (e.target.files) handleFiles(e.target.files);
  e.target.value = '';
}
function onDrop(e) {
  e.preventDefault();
  setDragOver(false);
  if (e.dataTransfer?.files) handleFiles(e.dataTransfer.files);
}
```

JSX 렌더링에서 `header` 다음, `quotaBar` 이전에 드롭존 삽입:

```javascript
<div
  className={`${styles.dropzone} ${dragOver ? styles.dropzoneOver : ''}`}
  onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
  onDragLeave={() => setDragOver(false)}
  onDrop={onDrop}
>
  <input
    type="file"
    id="my-images-upload"
    multiple
    accept="image/jpeg,image/png"
    onChange={onInputChange}
    style={{ display: 'none' }}
  />
  <label htmlFor="my-images-upload" className={styles.uploadBtn}>
    + 사진 업로드
  </label>
  <div className={styles.dropHint}>또는 여기로 드래그 (JPG/PNG, 최대 5MB)</div>
</div>

{uploadQueue.length > 0 && (
  <div className={styles.queue}>
    {uploadQueue.map((item, i) => (
      <div key={i} className={`${styles.queueItem} ${styles['queue_' + item.status]}`}>
        <span className={styles.queueName}>{item.name}</span>
        <span className={styles.queueStatus}>
          {item.status === 'uploading' && '업로드 중...'}
          {item.status === 'done' && '완료'}
          {item.status === 'error' && `실패: ${item.error}`}
        </span>
      </div>
    ))}
  </div>
)}
```

- [ ] **Step 2: CSS 추가**

```css
/* MyImagesSection.module.css 하단에 추가 */
.dropzone {
  border: 2px dashed var(--ds-border, #E5E7EB);
  border-radius: 10px;
  padding: 18px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  transition: all 0.2s ease;
}
.dropzoneOver {
  border-color: var(--ds-accent, #ff5f1f);
  background: rgba(255, 95, 31, 0.04);
}
.uploadBtn {
  display: inline-block;
  padding: 10px 20px;
  background: var(--ds-accent, #ff5f1f);
  color: #fff;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  user-select: none;
}
.dropHint {
  font-size: 11px;
  color: var(--ds-muted, #77736B);
}

.queue {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px;
  background: var(--ds-surface-2, #F9FAFB);
  border-radius: 6px;
}
.queueItem {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  padding: 4px 6px;
}
.queueName { color: var(--ds-text, #1F2937); }
.queueStatus { color: var(--ds-muted, #77736B); }
.queue_uploading .queueStatus { color: var(--ds-accent, #ff5f1f); }
.queue_done .queueStatus { color: #059669; }
.queue_error .queueStatus { color: #DC2626; }
```

- [ ] **Step 3: 수동 검증 (MyPageClient 통합 전이라 임시 삽입 필요)**

`app/mypage/MyPageClient.js` 하단에 임시로 추가 (B4에서 제대로 이동할 예정):
```javascript
// import MyImagesSection from './MyImagesSection';   ← 추가
// ...
// return 내부 container 안에 삽입
<div className={styles.card}>
  <MyImagesSection />
</div>
```

브라우저에서 /mypage 접속 → JPG 파일 드래그 → 업로드 완료 후 그리드에 썸네일 표시 확인.

**임시 삽입은 B4에서 제거하고 정식 통합함.**

- [ ] **Step 4: 커밋 (임시 삽입은 제외)**

```bash
git add app/mypage/MyImagesSection.js app/mypage/MyImagesSection.module.css
git commit -m "feat(mypage): MyImagesSection 업로드 드롭존 + 진행 표시

드래그 앤 드롭 + 파일 선택. 클라이언트 선제 검증(타입/크기).
진행 큐로 업로드 상태 표시, 완료 3초 후 자동 제거."
```

---

### Task B3: 삭제 / 태그 수정 호버 액션

**Files:**
- Modify: `app/mypage/MyImagesSection.js`
- Modify: `app/mypage/MyImagesSection.module.css`

- [ ] **Step 1: 타일에 호버 오버레이 추가**

컴포넌트 상단에 헬퍼 함수 추가:

```javascript
async function deleteImage(id) {
  if (!confirm('이 이미지를 삭제할까요?')) return;
  const token = getToken();
  const res = await fetch(`/api/my-images/${id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.ok) await refresh();
  else alert('삭제에 실패했습니다.');
}

async function editTag(id, currentTag) {
  const next = prompt('태그를 입력하세요 (50자 이내, 빈 값이면 제거)', currentTag || '');
  if (next === null) return;
  const token = getToken();
  const res = await fetch(`/api/my-images/${id}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ tag: next }),
  });
  if (res.ok) await refresh();
  else alert('태그 수정에 실패했습니다.');
}
```

타일 JSX를 아래와 같이 교체:

```javascript
{images.map((img) => (
  <div key={img.id} className={styles.tile}>
    <img src={img.thumb_url} alt={img.filename} className={styles.thumb} />
    {img.tag && <div className={styles.tag}>{img.tag}</div>}
    <div className={styles.tileActions}>
      <button
        type="button"
        className={styles.actionBtn}
        onClick={() => editTag(img.id, img.tag)}
        aria-label="태그 수정"
      >✎</button>
      <button
        type="button"
        className={`${styles.actionBtn} ${styles.actionDelete}`}
        onClick={() => deleteImage(img.id)}
        aria-label="삭제"
      >×</button>
    </div>
  </div>
))}
```

- [ ] **Step 2: CSS 추가**

```css
/* MyImagesSection.module.css 하단에 추가 */
.tileActions {
  position: absolute;
  top: 6px;
  right: 6px;
  display: flex;
  gap: 4px;
  opacity: 0;
  transition: opacity 0.15s ease;
}
.tile:hover .tileActions { opacity: 1; }

.actionBtn {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  border: none;
  background: rgba(0, 0, 0, 0.65);
  color: #fff;
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}
.actionBtn:hover { background: rgba(0, 0, 0, 0.85); }
.actionDelete:hover { background: #DC2626; }
```

- [ ] **Step 3: 수동 검증**

브라우저 /mypage에서 업로드된 타일 호버 → ✎/× 버튼 노출 → 각각 동작 확인.

- [ ] **Step 4: 커밋**

```bash
git add app/mypage/MyImagesSection.js app/mypage/MyImagesSection.module.css
git commit -m "feat(mypage): 내 이미지 호버 액션 (태그 수정/삭제)

prompt/confirm로 단순 UX. Phase C의 ImagePickerModal과는
다르게 마이페이지는 가벼운 관리 용도."
```

---

### Task B4: 마이페이지에 정식 통합

**Files:**
- Modify: `app/mypage/MyPageClient.js`

- [ ] **Step 1: MyImagesSection import + 섹션 삽입**

`app/mypage/MyPageClient.js` 상단 import 섹션에 추가:

```javascript
import MyImagesSection from './MyImagesSection';
```

크레딧 잔액 카드(`{/* 크레딧 잔액 카드 ... */}`) 블록과 `<div className={styles.card}><div className={styles.cardTitle}>Threads 계정</div>` 사이에 새 카드 삽입:

```javascript
<div className={styles.card}>
  <MyImagesSection />
</div>
```

(B2에서 임시로 삽입했던 코드가 있다면 제거)

- [ ] **Step 2: 브라우저 검증**

/mypage 접속 → 섹션 3개(사용자 정보 / 크레딧 잔액 / 내 이미지 / Threads / 로그아웃) 순서 확인. 업로드/삭제/태그 수정 전체 동작 확인.

- [ ] **Step 3: 커밋**

```bash
git add app/mypage/MyPageClient.js
git commit -m "feat(mypage): 내 이미지 섹션 정식 통합

크레딧 잔액과 Threads 계정 사이에 배치."
```

---

## Phase C — 공용 이미지 선택 모달

### Task C1: ImagePickerModal 기본 구조

**Files:**
- Create: `components/ImagePickerModal.js`
- Create: `components/ImagePickerModal.module.css`

- [ ] **Step 1: 모달 컴포넌트 스켈레톤**

```javascript
// components/ImagePickerModal.js
'use client';

import { useEffect, useState } from 'react';
import { getToken } from '@/lib/auth';
import styles from './ImagePickerModal.module.css';

const MODE_LABELS = {
  background: '배경',
  content: '콘텐츠',
  cover: '표지',
};

/**
 * Props:
 * - open: boolean
 * - onClose: () => void
 * - onSelect: (payload: { image, crop, mode }) => void
 * - modeOptions: Array<'background'|'content'|'cover'>
 * - defaultMode: string
 * - aspectRatio: number  (예: 4/5)
 */
export default function ImagePickerModal({
  open,
  onClose,
  onSelect,
  modeOptions = ['background', 'content', 'cover'],
  defaultMode = 'content',
  aspectRatio = 4 / 5,
}) {
  const [tab, setTab] = useState('library'); // 'library' | 'upload'
  const [images, setImages] = useState([]);
  const [quota, setQuota] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [mode, setMode] = useState(defaultMode);
  const [pickedImage, setPickedImage] = useState(null); // 크롭 대기 상태

  useEffect(() => {
    if (!open) return;
    setTab('library');
    setPickedImage(null);
    setError('');
    setMode(defaultMode);
    fetchLibrary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e) { if (e.key === 'Escape') onClose?.(); }
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  async function fetchLibrary() {
    const token = getToken();
    if (!token) return;
    setLoading(true);
    try {
      const res = await fetch('/api/my-images', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (res.ok) {
        setImages(data.images || []);
        setQuota(data.quota || null);
      } else {
        setError(data.error || '목록을 불러오지 못했습니다.');
      }
    } catch (_) {
      setError('네트워크 오류');
    } finally {
      setLoading(false);
    }
  }

  async function uploadFile(file) {
    const token = getToken();
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch('/api/my-images', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: fd,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '업로드 실패');
    return data.image;
  }

  async function onUploadInput(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setLoading(true);
      const img = await uploadFile(file);
      await fetchLibrary();
      setTab('library');
      setPickedImage(img);  // 바로 크롭 단계로
    } catch (err) {
      alert(err.message);
    } finally {
      setLoading(false);
      e.target.value = '';
    }
  }

  if (!open) return null;

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <div className={styles.title}>이미지 선택</div>
          <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="닫기">×</button>
        </div>

        {/* 모드 선택 */}
        {modeOptions.length > 1 && (
          <div className={styles.modeRow}>
            <span className={styles.modeLabel}>사용 방식</span>
            {modeOptions.map((m) => (
              <button
                key={m}
                type="button"
                className={`${styles.modeBtn} ${mode === m ? styles.modeBtnActive : ''}`}
                onClick={() => setMode(m)}
              >
                {MODE_LABELS[m] || m}
              </button>
            ))}
          </div>
        )}

        {/* 탭 */}
        <div className={styles.tabs}>
          <button
            type="button"
            className={`${styles.tab} ${tab === 'library' ? styles.tabActive : ''}`}
            onClick={() => setTab('library')}
          >내 이미지</button>
          <button
            type="button"
            className={`${styles.tab} ${tab === 'upload' ? styles.tabActive : ''}`}
            onClick={() => setTab('upload')}
          >새로 업로드</button>
        </div>

        <div className={styles.body}>
          {tab === 'library' && (
            <>
              {loading && <div className={styles.loadingText}>불러오는 중...</div>}
              {error && <div className={styles.errorText}>{error}</div>}
              {!loading && images.length === 0 && (
                <div className={styles.emptyText}>
                  아직 업로드된 이미지가 없어요.<br />
                  "새로 업로드" 탭에서 먼저 올려주세요.
                </div>
              )}
              {images.length > 0 && (
                <div className={styles.grid}>
                  {images.map((img) => (
                    <button
                      key={img.id}
                      type="button"
                      className={styles.tile}
                      onClick={() => setPickedImage(img)}
                    >
                      <img src={img.thumb_url} alt={img.filename} />
                      {img.tag && <div className={styles.tag}>{img.tag}</div>}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}

          {tab === 'upload' && (
            <div className={styles.uploadPane}>
              <input
                type="file"
                id="picker-upload"
                accept="image/jpeg,image/png"
                onChange={onUploadInput}
                style={{ display: 'none' }}
              />
              <label htmlFor="picker-upload" className={styles.uploadBtn}>
                + 파일 선택
              </label>
              <div className={styles.uploadHint}>JPG/PNG, 최대 5MB<br />업로드한 이미지는 내 이미지 보관함에도 저장돼요.</div>
            </div>
          )}
        </div>

        {/* 크롭 단계는 다음 Task C2에서 추가 */}
        {pickedImage && (
          <div className={styles.cropPlaceholder}>
            선택됨: {pickedImage.filename} (크롭 단계는 다음 태스크에서 구현)
            <button
              type="button"
              className={styles.applyBtn}
              onClick={() => {
                onSelect?.({ image: pickedImage, crop: null, mode });
                onClose?.();
              }}
            >임시 적용 (크롭 없이)</button>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: CSS**

```css
/* components/ImagePickerModal.module.css */
.backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9000;
  padding: 20px;
}
.modal {
  background: #fff;
  border-radius: 14px;
  width: 100%;
  max-width: 720px;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.25);
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  border-bottom: 1px solid var(--ds-border, #E5E7EB);
}
.title {
  font-size: 16px;
  font-weight: 700;
  color: var(--ds-text, #1F2937);
}
.closeBtn {
  background: none;
  border: none;
  font-size: 24px;
  line-height: 1;
  cursor: pointer;
  color: var(--ds-muted, #77736B);
}

.modeRow {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 20px;
  border-bottom: 1px solid var(--ds-border, #E5E7EB);
  flex-wrap: wrap;
}
.modeLabel {
  font-size: 12px;
  color: var(--ds-muted, #77736B);
}
.modeBtn {
  padding: 6px 14px;
  border-radius: 6px;
  border: 1px solid var(--ds-border, #E5E7EB);
  background: #fff;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  color: var(--ds-text, #1F2937);
}
.modeBtnActive {
  background: var(--ds-accent, #ff5f1f);
  color: #fff;
  border-color: var(--ds-accent, #ff5f1f);
}

.tabs {
  display: flex;
  border-bottom: 1px solid var(--ds-border, #E5E7EB);
}
.tab {
  flex: 1;
  padding: 12px 0;
  background: none;
  border: none;
  font-size: 13px;
  font-weight: 600;
  color: var(--ds-muted, #77736B);
  cursor: pointer;
  border-bottom: 2px solid transparent;
}
.tabActive {
  color: var(--ds-accent, #ff5f1f);
  border-bottom-color: var(--ds-accent, #ff5f1f);
}

.body {
  flex: 1;
  overflow: auto;
  padding: 16px 20px;
  min-height: 240px;
}

.loadingText, .emptyText, .errorText {
  text-align: center;
  padding: 32px 12px;
  font-size: 13px;
  color: var(--ds-muted, #77736B);
  line-height: 1.6;
}
.errorText { color: #DC2626; }

.grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
}
@media (max-width: 600px) {
  .grid { grid-template-columns: repeat(3, 1fr); }
}

.tile {
  position: relative;
  aspect-ratio: 1;
  border: none;
  padding: 0;
  border-radius: 8px;
  overflow: hidden;
  cursor: pointer;
  background: #F3F4F6;
}
.tile:hover { box-shadow: 0 0 0 2px var(--ds-accent, #ff5f1f); }
.tile img { width: 100%; height: 100%; object-fit: cover; display: block; }
.tag {
  position: absolute;
  left: 6px;
  bottom: 6px;
  background: rgba(0, 0, 0, 0.65);
  color: #fff;
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 4px;
}

.uploadPane {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 40px 12px;
}
.uploadBtn {
  padding: 12px 24px;
  background: var(--ds-accent, #ff5f1f);
  color: #fff;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
}
.uploadHint {
  font-size: 12px;
  color: var(--ds-muted, #77736B);
  text-align: center;
  line-height: 1.6;
}

.cropPlaceholder {
  padding: 12px 20px;
  background: #FEF3C7;
  font-size: 12px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}
.applyBtn {
  padding: 6px 14px;
  background: var(--ds-accent, #ff5f1f);
  color: #fff;
  border: none;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}
```

- [ ] **Step 3: 커밋**

```bash
git add components/ImagePickerModal.js components/ImagePickerModal.module.css
git commit -m "feat(components): ImagePickerModal 기본 구조

탭(내 이미지/새로 업로드) + 모드 드롭다운 + 라이브러리 그리드 +
업로드 → 크롭 자리표시자. 크롭 에디터는 C2에서 추가."
```

---

### Task C2: 크롭 에디터(react-easy-crop) 통합

**Files:**
- Modify: `components/ImagePickerModal.js`
- Modify: `components/ImagePickerModal.module.css`

- [ ] **Step 1: Cropper 통합**

`ImagePickerModal.js` 상단 import 추가:
```javascript
import Cropper from 'react-easy-crop';
```

컴포넌트 내부에 크롭 상태 추가:
```javascript
const [cropPos, setCropPos] = useState({ x: 0, y: 0 });
const [zoom, setZoom] = useState(1);
const [cropArea, setCropArea] = useState(null); // {x,y,width,height} in image pixels

function onCropComplete(_croppedArea, croppedAreaPixels) {
  setCropArea(croppedAreaPixels);
}
```

`pickedImage` 블록을 크롭 UI로 교체:
```javascript
{pickedImage && (
  <div className={styles.cropOverlay}>
    <div className={styles.cropCanvas}>
      <Cropper
        image={pickedImage.public_url}
        crop={cropPos}
        zoom={zoom}
        aspect={aspectRatio}
        onCropChange={setCropPos}
        onZoomChange={setZoom}
        onCropComplete={onCropComplete}
        objectFit="contain"
      />
    </div>
    <div className={styles.cropControls}>
      <label className={styles.zoomLabel}>
        확대
        <input
          type="range"
          min="1"
          max="3"
          step="0.05"
          value={zoom}
          onChange={(e) => setZoom(Number(e.target.value))}
        />
      </label>
      <div className={styles.cropActions}>
        <button
          type="button"
          className={styles.cancelBtn}
          onClick={() => { setPickedImage(null); setCropArea(null); setZoom(1); setCropPos({ x: 0, y: 0 }); }}
        >뒤로</button>
        <button
          type="button"
          className={styles.applyBtn}
          onClick={() => {
            onSelect?.({
              image: pickedImage,
              crop: cropArea, // { x, y, width, height } in source pixels
              mode,
            });
            onClose?.();
          }}
        >적용</button>
      </div>
    </div>
  </div>
)}
```

- [ ] **Step 2: CSS 추가 (cropPlaceholder 관련 스타일은 제거, 새 스타일 추가)**

```css
/* cropPlaceholder, applyBtn 기존 정의 교체/삭제하고 아래 추가 */

.cropOverlay {
  position: absolute;
  inset: 0;
  background: #fff;
  display: flex;
  flex-direction: column;
  z-index: 10;
}
.cropCanvas {
  position: relative;
  flex: 1;
  background: #111;
  min-height: 320px;
}
.cropControls {
  padding: 12px 20px;
  border-top: 1px solid var(--ds-border, #E5E7EB);
  display: flex;
  flex-direction: column;
  gap: 10px;
  background: #fff;
}
.zoomLabel {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 12px;
  color: var(--ds-muted, #77736B);
}
.zoomLabel input[type="range"] {
  flex: 1;
}
.cropActions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}
.cancelBtn {
  padding: 10px 18px;
  background: var(--ds-surface-2, #F3F4F6);
  color: var(--ds-text, #1F2937);
  border: none;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
.applyBtn {
  padding: 10px 18px;
  background: var(--ds-accent, #ff5f1f);
  color: #fff;
  border: none;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
}
```

추가로 `.modal`에 `position: relative;` 추가(absolute 오버레이가 모달 안에서 뜨도록).

- [ ] **Step 3: 커밋**

```bash
git add components/ImagePickerModal.js components/ImagePickerModal.module.css
git commit -m "feat(components): ImagePickerModal 크롭 에디터

react-easy-crop 통합. aspectRatio props(기본 4/5), zoom 슬라이더,
onSelect payload에 crop(source pixels) + mode 포함."
```

---

## Phase D — 카드뉴스 통합

### Task D1: 카드뉴스 UI — 카드별 📷 아이콘 + 모달 연결

**Files:**
- Modify: `app/card-news/CardNewsClient.js`
- Modify: `app/card-news/page.module.css`

- [ ] **Step 1: 모달 + 상태 추가**

`CardNewsClient.js` 상단 import 추가:
```javascript
import ImagePickerModal from '@/components/ImagePickerModal';
```

컴포넌트 상태 추가(`variantInfo` 근처):
```javascript
const [pickerOpen, setPickerOpen] = useState(false);
const [pickerCardIdx, setPickerCardIdx] = useState(null);
// userImages = [{ cardIndex, mode, url, crop }]
const [userImages, setUserImages] = useState([]);
```

카드 그리드 렌더링에서(각 카드 `<img src={images[i]}>`의 부모 div 에) 오버레이 버튼 추가. 기존 그리드 코드를 찾아 각 카드에:

```javascript
<div className={styles.card} onClick={() => setModalIdx(i)}>
  <img src={...} alt="..." />
  <button
    type="button"
    className={styles.cardImageBtn}
    onClick={(e) => {
      e.stopPropagation();
      setPickerCardIdx(i);
      setPickerOpen(true);
    }}
    aria-label="사진 넣기"
  >📷</button>
  {/* 이미 사용자 이미지가 적용된 카드는 표시 */}
  {userImages.some((u) => u.cardIndex === i) && (
    <div className={styles.cardImageBadge}>내 사진</div>
  )}
</div>
```

컴포넌트 JSX 맨 마지막(return의 닫는 태그 직전)에 모달 렌더링:

```javascript
<ImagePickerModal
  open={pickerOpen}
  onClose={() => setPickerOpen(false)}
  modeOptions={['background', 'content', 'cover']}
  defaultMode="content"
  aspectRatio={4 / 5}
  onSelect={({ image, crop, mode }) => {
    setUserImages((prev) => {
      const filtered = prev.filter((u) => u.cardIndex !== pickerCardIdx);
      return [
        ...filtered,
        { cardIndex: pickerCardIdx, mode, url: image.public_url, crop },
      ];
    });
  }}
/>
```

- [ ] **Step 2: CSS 추가**

`app/card-news/page.module.css`:

```css
.cardImageBtn {
  position: absolute;
  right: 10px;
  bottom: 10px;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  border: none;
  background: rgba(255, 255, 255, 0.92);
  color: #1F2937;
  font-size: 18px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
  z-index: 2;
}
.cardImageBtn:hover { background: #fff; transform: scale(1.05); }

.cardImageBadge {
  position: absolute;
  left: 10px;
  top: 10px;
  background: var(--ds-accent, #ff5f1f);
  color: #fff;
  font-size: 10px;
  font-weight: 700;
  padding: 4px 8px;
  border-radius: 4px;
  z-index: 2;
}
```

기존 `.card` 셀렉터에 `position: relative;`가 이미 있는지 확인. 없으면 추가.

- [ ] **Step 3: 브라우저 검증**

카드뉴스 페이지에서 생성 → 각 카드 우하단 📷 버튼 → 클릭 시 모달 오픈 → 내 이미지 선택 → 크롭 → 적용 → 좌상단 "내 사진" 뱃지 표시 확인.

- [ ] **Step 4: 커밋**

```bash
git add app/card-news/CardNewsClient.js app/card-news/page.module.css
git commit -m "feat(card-news): 카드별 사진 선택 UI

각 카드에 📷 버튼 + ImagePickerModal 연결. 선택 시 userImages
state에 { cardIndex, mode, url, crop } 저장, 좌상단 뱃지 표시."
```

---

### Task D2: 생성 payload에 userImages 포함

**Files:**
- Modify: `app/card-news/CardNewsClient.js`

- [ ] **Step 1: generate() 함수 수정**

기존 `generate()` 함수 안의 `fetch('/api/card-news', ...)` 호출 body에 `userImages`를 추가:

```javascript
body: JSON.stringify({
  text: textInput,
  title: '', // 기존대로
  slideCount,
  theme: selectedTheme,
  brandPrimary: useBrand ? brandPrimary : '',
  brandSecondary: useBrand ? brandSecondary : '',
  snsHandle,
  typeScale: typeScale === 'auto' ? undefined : typeScale,
  accentPlacement: accentPlacement === 'auto' ? undefined : accentPlacement,
  numberStyle: numberStyle === 'auto' ? undefined : numberStyle,
  userImages, // 추가
}),
```

(기존 코드의 필드명을 정확히 유지하면서 `userImages` 한 줄만 추가)

- [ ] **Step 2: 재생성 시에도 userImages 유지**

"다시 생성" 플로우가 있으면 동일한 userImages를 재사용. 새 텍스트 생성 시 기존 카드 인덱스 범위를 벗어나는 userImages는 자동 필터:

```javascript
// generate 함수 맨 위에 추가 (기존 userImages 정리)
setUserImages((prev) => prev.filter((u) => u.cardIndex < slideCount));
```

- [ ] **Step 3: 커밋**

```bash
git add app/card-news/CardNewsClient.js
git commit -m "feat(card-news): 생성 payload에 userImages 포함

슬라이드 수 변경 시 범위 넘어가는 userImages 자동 정리."
```

---

### Task D3: api/card-news가 userImages 수용 + 소유권 검증

**Files:**
- Modify: `app/api/card-news/route.js`

- [ ] **Step 1: payload 파싱 + 소유권 검증 추가**

`route.js` 상단 import 추가:
```javascript
import { verifyOwnershipByUrls } from '@/lib/user-images';
```

`POST` 함수 안, `variant` 구성 직후(대략 641번째 라인 아래)에 추가:

```javascript
// 사용자 이미지 검증
const rawUserImages = Array.isArray(body.userImages) ? body.userImages : [];
const VALID_MODES = new Set(['background', 'content', 'cover']);
const sanitizedUserImages = [];
for (const u of rawUserImages) {
  if (!u || typeof u !== 'object') continue;
  const cardIndex = Number(u.cardIndex);
  if (!Number.isInteger(cardIndex) || cardIndex < 0 || cardIndex >= count) continue;
  if (!VALID_MODES.has(u.mode)) continue;
  if (typeof u.url !== 'string' || !u.url.startsWith('https://cdn.ddukddaktool.co.kr/user-images/')) continue;
  const crop = (u.crop && typeof u.crop === 'object') ? {
    x: Number(u.crop.x) || 0,
    y: Number(u.crop.y) || 0,
    width: Number(u.crop.width) || 0,
    height: Number(u.crop.height) || 0,
  } : null;
  sanitizedUserImages.push({ cardIndex, mode: u.mode, url: u.url, crop });
}

if (sanitizedUserImages.length > 0) {
  if (!sessionEmail) {
    return jsonResponse(request, { error: '사용자 이미지를 사용하려면 로그인이 필요합니다.' }, { status: 401 });
  }
  const urls = sanitizedUserImages.map((u) => u.url);
  const owned = await verifyOwnershipByUrls(sessionEmail, urls);
  if (!owned) {
    return jsonResponse(request, { error: '권한이 없는 이미지가 포함돼 있습니다.' }, { status: 403 });
  }
}
```

그 다음 `renderSlides(validated, theme, variant)` 호출을 다음으로 교체:

```javascript
const pngs = await renderSlides(validated, theme, variant, sanitizedUserImages);
```

- [ ] **Step 2: renderSlides 시그니처 확장**

동일 파일 내 `renderSlides` 함수 정의를 찾아 파라미터에 `userImages = []`를 추가하고, 각 슬라이드 렌더링 시 해당 카드에 매칭되는 user image를 찾아 템플릿에 전달:

```javascript
async function renderSlides(validated, theme, variant, userImages = []) {
  // 기존 로직 유지하면서 각 슬라이드 루프 내에서:
  //   const ui = userImages.find((u) => u.cardIndex === slideIndex);
  //   ui를 슬라이드 렌더링 함수에 전달
}
```

구체적 코드는 기존 renderSlides 구조에 따라 다름. 각 슬라이드 렌더링 시점에서:
```javascript
const userImage = userImages.find((u) => u.cardIndex === i) || null;
// 슬라이드 렌더 함수 호출 시 userImage 전달
const svgNode = renderSlideNode({ slide, theme, variant, idx: i, total, userImage });
```

- [ ] **Step 3: 서버 로깅 추가**

```javascript
if (sanitizedUserImages.length > 0) {
  console.log(`[CARD-NEWS] userImages: ${sanitizedUserImages.length}장 적용`);
}
```

- [ ] **Step 4: 로컬 검증 (크롭 없이 먼저)**

브라우저에서 카드뉴스 생성 → 카드 1개에 내 이미지 적용(mode=content) → 생성 버튼 → 서버 로그에 `[CARD-NEWS] userImages: 1장 적용` 표시 확인. 렌더링은 D4에서 구현되므로 아직 이미지가 카드에 안 보여도 OK.

- [ ] **Step 5: 소유권 검증 네거티브 테스트**

Network 탭에서 요청 가로채서 `userImages[0].url`을 다른 사용자 URL로 바꿔 전송 → 서버가 403 반환 확인.

- [ ] **Step 6: 커밋**

```bash
git add app/api/card-news/route.js
git commit -m "feat(api): card-news userImages 수용 + 소유권 검증

payload sanitize → cdn.ddukddaktool.co.kr/user-images/ prefix
체크 → DB 소유권 확인(verifyOwnershipByUrls). renderSlides에
userImages 전달(실제 렌더링은 다음 태스크)."
```

---

### Task D4: Satori 렌더러에 사용자 이미지 모드 적용

**Files:**
- Modify: `app/api/card-news/route.js` (renderSlides 내부)

- [ ] **Step 1: Satori node 헬퍼 — 사용자 이미지 삽입**

`app/api/card-news/route.js` 내부에 새 함수 추가 (renderSlides 정의 바로 위):

```javascript
/**
 * 사용자 이미지를 Satori node로 변환
 * @param {object} userImage - { mode, url, crop }
 * @returns {{ background?: any, cover?: any, content?: any }}
 */
async function fetchUserImageDataUrl(url) {
  // Satori는 외부 URL 대신 data URL을 선호(Vercel에서 안정)
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`fetch ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const mime = res.headers.get('content-type') || 'image/jpeg';
    return `data:${mime};base64,${buf.toString('base64')}`;
  } catch (err) {
    console.error('[CARD-NEWS] user image fetch failed:', err.message);
    return null;
  }
}

function buildBackgroundImageNode(dataUrl) {
  // 최하단 배경 레이어 + 반투명 오버레이
  return h('div', {
    style: {
      position: 'absolute', top: 0, left: 0,
      width: CANVAS_W, height: CANVAS_H,
      display: 'flex',
    },
  },
    h('img', {
      src: dataUrl,
      width: CANVAS_W,
      height: CANVAS_H,
      style: { objectFit: 'cover' },
    }),
    h('div', {
      style: {
        position: 'absolute', top: 0, left: 0,
        width: CANVAS_W, height: CANVAS_H,
        background: 'rgba(0, 0, 0, 0.42)',
        display: 'flex',
      },
    }),
  );
}

function buildCoverImageNode(dataUrl) {
  // 카드 전체를 사용자 사진으로 교체(텍스트 오버레이는 상위에서 추가)
  return h('div', {
    style: {
      position: 'absolute', top: 0, left: 0,
      width: CANVAS_W, height: CANVAS_H,
      display: 'flex',
    },
  },
    h('img', {
      src: dataUrl,
      width: CANVAS_W,
      height: CANVAS_H,
      style: { objectFit: 'cover' },
    }),
    h('div', {
      style: {
        position: 'absolute', top: 0, left: 0,
        width: CANVAS_W, height: CANVAS_H,
        background: 'linear-gradient(180deg, rgba(0,0,0,0.1) 0%, rgba(0,0,0,0.7) 100%)',
        display: 'flex',
      },
    }),
  );
}
```

**주의:** 크롭 좌표를 Satori의 object-position으로 완벽 반영하기는 제약이 있음. 이번 태스크에서는 **cover 모드로 중앙 기준 맞춤**만 구현하고, 크롭 좌표 정밀 반영은 Phase E+로 미룬다. 스펙 섹션 12(리스크) 완화책(샘플 수동 검수)에 해당.

크롭 정보가 있으면 로그로만 기록:
```javascript
if (userImage.crop) {
  console.log(`[CARD-NEWS] card ${userImage.cardIndex} crop: ${JSON.stringify(userImage.crop)} (object-fit cover 적용)`);
}
```

- [ ] **Step 2: 슬라이드 렌더 루프에 사용자 이미지 합성**

`renderSlides` 루프 내부, 기존 슬라이드 SVG 생성 전에 다음 로직 추가:

```javascript
const ui = userImages.find((u) => u.cardIndex === i);
let userImageDataUrl = null;
if (ui) {
  userImageDataUrl = await fetchUserImageDataUrl(ui.url);
}
```

**각 모드별 적용 방식:**

**background 모드**: 기존 슬라이드 노드의 최상위 컨테이너 바로 안쪽에 `buildBackgroundImageNode(userImageDataUrl)`를 첫 번째 자식으로 삽입. 기존 텍스트 노드들은 `z-index` 없이 그 위에 자연스럽게 렌더링되도록 최상위 컨테이너에 `position: relative`를 넣고 children을 Array로 펼친다.

**cover 모드**: 기존 슬라이드 전체를 `buildCoverImageNode(userImageDataUrl)` + 텍스트 오버레이만으로 대체. 텍스트는 카드 제목(slide.title 또는 slide.body 첫 줄)만 중앙 배치:

```javascript
function buildCoverSlide(slide, theme, dataUrl) {
  return h('div', {
    style: {
      width: CANVAS_W, height: CANVAS_H,
      display: 'flex', flexDirection: 'column',
      position: 'relative',
      background: theme.bgDark,
    },
  },
    buildCoverImageNode(dataUrl),
    h('div', {
      style: {
        position: 'absolute',
        left: 0, right: 0, bottom: 120,
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', padding: '0 80px',
      },
    },
      h('div', {
        style: {
          fontFamily: _F, fontWeight: 800, fontSize: 72, color: '#fff',
          textAlign: 'center', lineHeight: 1.15,
          display: 'flex',
        },
      }, slide.title || slide.body || ''),
    ),
  );
}
```

**content 모드**: 기존 콘텐츠 슬라이드 레이아웃 내부의 특정 영역(제목 위쪽 큰 이미지 슬롯)에 사용자 이미지를 삽입. 현재 카드뉴스가 이미지 슬롯을 가진 레이아웃이 아니므로, **카드 상단 40% 영역을 사용자 이미지로, 하단 60%를 기존 텍스트 레이아웃으로** 분할한다.

```javascript
// 기존 슬라이드 노드(기존 renderSlideNode 결과)를 hero로 감싸기
function wrapWithTopImage(originalNode, dataUrl) {
  const imageH = Math.round(CANVAS_H * 0.40);
  const textH = CANVAS_H - imageH;
  return h('div', {
    style: {
      width: CANVAS_W, height: CANVAS_H,
      display: 'flex', flexDirection: 'column',
      background: '#fff',
    },
  },
    h('div', {
      style: { width: CANVAS_W, height: imageH, display: 'flex' },
    },
      h('img', {
        src: dataUrl,
        width: CANVAS_W,
        height: imageH,
        style: { objectFit: 'cover' },
      }),
    ),
    // 원본 노드를 축소된 높이로 렌더(원본이 1080x1350 기준이라 직접 감싸면 넘칠 수 있음)
    // 안전하게 별도 레이아웃으로 content 텍스트만 다시 그림
    h('div', {
      style: {
        width: CANVAS_W, height: textH,
        display: 'flex', flexDirection: 'column',
        padding: '40px 80px',
        background: '#fff',
      },
    },
      // originalNode를 직접 넣지 않음(크기 충돌 회피)
      // 슬라이드 title/body를 단순 renderer로 다시 그림
      // → 아래 Step 3 참고
    ),
  );
}
```

**Step 3에서 content 모드의 텍스트 렌더링을 구현한다.**

- [ ] **Step 3: content 모드 텍스트 렌더러**

```javascript
function buildContentModeSlide(slide, theme, variant, dataUrl, idx) {
  const imageH = Math.round(CANVAS_H * 0.40);
  const textH = CANVAS_H - imageH;
  return h('div', {
    style: {
      width: CANVAS_W, height: CANVAS_H,
      display: 'flex', flexDirection: 'column',
      background: theme.bg,
    },
  },
    h('div', { style: { width: CANVAS_W, height: imageH, display: 'flex' } },
      h('img', { src: dataUrl, width: CANVAS_W, height: imageH, style: { objectFit: 'cover' } }),
    ),
    h('div', {
      style: {
        width: CANVAS_W, height: textH,
        display: 'flex', flexDirection: 'column', justifyContent: 'center',
        padding: '48px 80px',
      },
    },
      h('div', {
        style: {
          fontFamily: _F, fontWeight: 800, fontSize: 56, color: theme.text,
          lineHeight: 1.2, marginBottom: 24, display: 'flex',
        },
      }, slide.title || ''),
      h('div', {
        style: {
          fontFamily: _F, fontWeight: 500, fontSize: 32, color: theme.textLight,
          lineHeight: 1.5, display: 'flex', flexDirection: 'column',
        },
      }, ...lines(slide.body || '', 32)),
    ),
  );
}
```

- [ ] **Step 4: 슬라이드 루프에서 분기**

기존 `renderSlides` 함수의 슬라이드 루프를 아래와 같이 수정:

```javascript
// 기존:
// const svgNode = renderSlideNode({ slide, theme, variant, idx: i, total });
// const svg = await satori(svgNode, ...);

// 수정:
const ui = userImages.find((u) => u.cardIndex === i);
let svgNode;

if (ui && userImageDataUrl) {
  if (ui.mode === 'cover') {
    svgNode = buildCoverSlide(validated.slides[i], theme, userImageDataUrl);
  } else if (ui.mode === 'content') {
    svgNode = buildContentModeSlide(validated.slides[i], theme, variant, userImageDataUrl, i);
  } else {
    // background: 기존 노드 + 배경 이미지 래핑
    const originalNode = renderSlideNode({ slide: validated.slides[i], theme, variant, idx: i, total });
    svgNode = h('div', {
      style: {
        width: CANVAS_W, height: CANVAS_H,
        display: 'flex', position: 'relative',
      },
    },
      buildBackgroundImageNode(userImageDataUrl),
      h('div', {
        style: {
          position: 'absolute', top: 0, left: 0,
          width: CANVAS_W, height: CANVAS_H, display: 'flex',
        },
      }, originalNode),
    );
  }
} else {
  svgNode = renderSlideNode({ slide: validated.slides[i], theme, variant, idx: i, total });
}
```

(정확한 변수명과 기존 함수명은 Phase D 시작 전 `renderSlides` 내부 구조를 다시 읽어 일치시킬 것 — 이 플랜은 논리적 흐름을 제시하는 것이며 실제 구현 시 기존 코드의 renderSlideNode 시그니처에 맞게 조정이 필요하다.)

- [ ] **Step 5: 풀 플로우 브라우저 검증**

1. 로그인 → 마이페이지 → 사진 3장 업로드(매장/메뉴/상품 태그)
2. 카드뉴스 페이지 → 텍스트 붙여넣기 → 생성
3. 카드 1번: 📷 → 내 이미지 → 매장 사진 → mode=cover → 크롭 → 적용
4. 카드 2번: 📷 → 메뉴 사진 → mode=content → 크롭 → 적용
5. 카드 3번: 📷 → 상품 사진 → mode=background → 크롭 → 적용
6. 다시 생성 버튼 → 결과에서 카드 1/2/3에 각 모드별로 내 사진이 적용되었는지 확인
7. 다운로드 → PNG 10장 확인

- [ ] **Step 6: 시각 품질 체크리스트 (스펙 섹션 12 리스크 완화)**

각 모드 최소 3장씩 샘플 생성하고 수동 확인:
- [ ] cover 모드: 사진이 꽉 차고 텍스트가 가독성 있음 (그라디언트 오버레이 확인)
- [ ] content 모드: 상단 40% 이미지 + 하단 60% 텍스트, 잘림 없음
- [ ] background 모드: 원본 레이아웃 위에 반투명 이미지 배경, 텍스트 여전히 읽힘
- [ ] EXIF GPS가 있는 사진으로 업로드해도 결과 이미지에 누출 없음

- [ ] **Step 7: 커밋**

```bash
git add app/api/card-news/route.js
git commit -m "feat(card-news): 사용자 이미지 3모드 렌더링

- cover: 카드 전체 사진 + 그라디언트 오버레이 + 텍스트
- content: 상단 40% 이미지 + 하단 60% 텍스트 재렌더
- background: 기존 레이아웃 + 반투명 배경 사진
크롭 좌표는 로그로만 기록(object-fit cover 고정). 정밀 크롭
반영은 후속 스프린트."
```

---

### Task D5: 통합 회귀 테스트 + MEMORY.md 업데이트

**Files:**
- Modify: `/Users/gong-eunhui/.claude/projects/-Users-gong-eunhui-Desktop-naver-title-generator/memory/MEMORY.md`
- Create: `/Users/gong-eunhui/.claude/projects/-Users-gong-eunhui-Desktop-naver-title-generator/memory/project_user_images_library.md`

- [ ] **Step 1: 회귀 시나리오 수동 확인**

- [ ] 사용자 이미지 없이 기존 카드뉴스 생성 → 기존과 동일하게 동작
- [ ] 로그아웃 상태 → /api/my-images POST → 401
- [ ] 로그인 상태 + 5MB 초과 파일 → 400
- [ ] 50MB 초과 시도(무료 계정) → 409
- [ ] 타인 id로 PATCH/DELETE → 403
- [ ] 카드뉴스 생성 후 슬라이드 수 변경 → 범위 넘어가는 userImages 자동 정리
- [ ] 생성 실패 시 기존 카드뉴스 500 에러 처리 유지

- [ ] **Step 2: 메모리 문서 작성**

`~/.claude/projects/-Users-gong-eunhui-Desktop-naver-title-generator/memory/project_user_images_library.md`:

```markdown
---
name: 내 이미지 보관함
description: 매장 사장님 타겟 사용자 이미지 라이브러리 - 카드뉴스·숏폼·블로그에서 재사용
type: project
---

# 내 이미지 보관함 (Phase 3 일부)

구현일: 2026-04-14
관련 스펙: docs/superpowers/specs/2026-04-14-cardnews-user-images-design.md
구현 계획: docs/superpowers/plans/2026-04-14-cardnews-user-images.md

## 핵심 구조
- DB 테이블: `user_images` (email/r2_key/public_url/thumb_url/tag/...)
- R2 경로: `user-images/{email_hash(sha256 16자)}/{ts}_{rand}.jpg` + `_thumb.jpg`
- API: POST/GET /api/my-images, PATCH/DELETE /api/my-images/[id]
- 용량: 무료 50MB / 유료 500MB (credit_ledger.type='purchase' 기준)
- 제한: 장당 5MB, JPG/PNG만
- EXIF 완전 제거 (sharp .rotate().withMetadata({}))

## 카드뉴스 통합 모드 3종
- cover: 카드 전체 사진 + 그라디언트 오버레이 + 텍스트
- content: 상단 40% 이미지 + 하단 60% 텍스트 (재렌더 방식)
- background: 기존 레이아웃 + 반투명 배경 사진

## 미해결 / 차기
- 크롭 좌표 정밀 반영(현재는 object-fit cover 고정)
- 숏폼 통합 (같은 ImagePickerModal 재사용 예정)
- 블로그 글 본문 이미지 통합
- 용량 초과 자동 정리 기능 없음(사용자 수동 삭제)
- email_hash 충돌 가능성 극히 낮으나 sha256 16자 기준

## 조심할 것
- renderSlides에 userImages 파라미터 추가되어 있으므로 숏폼/블로그 연동 시 시그니처 확인
- Satori는 외부 URL 직접 사용 시 불안정 → fetchUserImageDataUrl로 data URL 변환 후 주입
- Vercel 서버리스 body 크기 제한 이슈 발생 시 5MB → 4MB로 낮추기 검토
```

`MEMORY.md` 목록에 한 줄 추가:

```markdown
- [내 이미지 보관함](project_user_images_library.md) — 매장 사장님 타겟 이미지 라이브러리 (4/14 구현)
```

- [ ] **Step 3: 최종 커밋**

```bash
git add app/api/card-news/route.js  # 혹시 남은 변경
git status  # 클린 확인
```

(메모리 파일은 Claude 내부 경로라 프로젝트 git에 포함되지 않으므로 별도 커밋 없음.)

---

## 자기 검토 (Spec Coverage)

스펙 섹션별 커버리지:

| 스펙 섹션 | 커버 태스크 |
|----------|-------------|
| §2 핵심 사용자 플로우 | D1~D4 (풀 플로우) |
| §3 아키텍처 컴포넌트 3개 | A/B/C/D 전체 |
| §4.1 DB 테이블 | A2 |
| §4.2 R2 경로(email_hash) | A4 `hashEmail` |
| §4.3 용량 제한 무료/유료 | A3 user-quota |
| §5.1 API 4종 | A5 + A6 |
| §5.2 업로드 플로우 상세 | A4 processImage + uploadUserImage |
| §5.3 직접 업로드 vs API 경유 결정 | A5 (API 경유 확정) |
| §5.4 보안 | A5/A6 (requireAuth + assertOwnership), A4 (hashEmail + EXIF 제거) |
| §6.1 마이페이지 섹션 | B1~B4 |
| §6.2 카드뉴스 통합 | D1~D4 |
| §6.3 ImagePickerModal props | C1~C2 |
| §7 크롭 에디터 | C2 (react-easy-crop) |
| §8 카드뉴스 서버 통합 | D3 (payload 확장 + 소유권) |
| §8.3 소유권 검증 | D3 `verifyOwnershipByUrls` |
| §9 Phase 순서 | A/B/C/D 그대로 |
| §11 YAGNI 제외 | 전 태스크에서 명시적으로 구현 안 함 |
| §12 리스크 완화 | A1 sharp 설치, D4 Step 6 수동 검수 |
| §13 성공 기준 | D5 회귀 시나리오 |

**알려진 범위 축소:**
- 스펙 §7.2(크롭 좌표를 CSS object-position으로 반영)는 Satori 제약으로 **object-fit cover 고정**으로 간소화. 크롭 좌표는 payload에 포함시켜 DB/로그에 남기되, 실제 렌더링 반영은 차기 작업. 이 결정은 D4 Step 1에 명시됨.
- 스펙 §4.3(용량 초과 시 삭제 권고 UI)는 B2에서 업로드 시 에러 메시지로만 표시. 전용 UI는 미포함.

## 알려진 코드 확인 필요 지점 (구현 시 반드시 재확인)

- `app/api/card-news/route.js`의 `renderSlides` 함수와 `renderSlideNode` 실제 시그니처 (D3/D4 작업 전 필독, 라인 120~500 구간 추정)
- `app/card-news/page.module.css`의 `.card` 셀렉터가 `position: relative`인지 확인 (D1 Step 2)
- `app/mypage/page.module.css`의 `.card` 스타일 — MyImagesSection.module.css의 `--ds-*` 변수명과 실제 globals.css의 변수명 일치 여부 확인 (B1~B4)

이 지점들은 실제 구현 에이전트가 구현 직전 해당 파일을 읽어 확정해야 함.
