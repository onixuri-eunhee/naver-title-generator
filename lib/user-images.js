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

// 자동 마이그레이션: 첫 호출 시 테이블 생성 (serverless 인스턴스당 1회)
let _schemaReady = null;
async function ensureSchema() {
  if (_schemaReady) return _schemaReady;
  _schemaReady = (async () => {
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
  })().catch((err) => {
    _schemaReady = null; // 실패 시 다음 요청에서 재시도
    console.error('[USER-IMAGES] ensureSchema failed:', err.message);
    throw err;
  });
  return _schemaReady;
}

export function hashEmail(email) {
  return crypto.createHash('sha256').update(email.toLowerCase()).digest('hex').slice(0, 16);
}

/**
 * 원본 Buffer → 정규화(EXIF 제거) + 썸네일 생성
 */
export async function processImage(buffer) {
  const sharp = (await import('sharp')).default;

  const { width, height } = await sharp(buffer).metadata();

  const normalized = await sharp(buffer, { failOnError: false })
    .rotate()
    .withMetadata({})
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
 */
export async function uploadUserImage({ email, buffer, filename, mimeType, tag }) {
  if (!ALLOWED_MIME.has(mimeType)) {
    throw new Error('지원하지 않는 파일 형식입니다. JPG 또는 PNG만 가능합니다.');
  }
  if (buffer.length > MAX_FILE_SIZE) {
    throw new Error('파일 크기가 5MB를 초과합니다.');
  }

  await ensureSchema();

  const { normalized, thumb, width, height } = await processImage(buffer);

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
            ${'image/jpeg'}, ${normalized.length}, ${width}, ${height}, ${safeTag || null})
    RETURNING id, public_url, thumb_url, filename, mime_type, file_size, width, height, tag, created_at`;

  return rows[0];
}

/**
 * 이미지 삭제 (R2 + DB)
 */
export async function deleteUserImage(email, id) {
  await ensureSchema();
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
  await ensureSchema();
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
  await ensureSchema();
  const sql = getDb();
  const rows = await sql`SELECT id FROM user_images WHERE id = ${id} AND user_email = ${email}`;
  return rows.length > 0;
}

/**
 * URL 배열이 전부 요청자 소유인지 확인 (카드뉴스 렌더링 시 사용)
 */
export async function verifyOwnershipByUrls(email, urls) {
  if (!urls || urls.length === 0) return true;
  await ensureSchema();
  const sql = getDb();
  const rows = await sql`SELECT public_url FROM user_images
    WHERE user_email = ${email} AND public_url = ANY(${urls})`;
  const ownedSet = new Set(rows.map((r) => r.public_url));
  return urls.every((u) => ownedSet.has(u));
}
