/**
 * Cloudflare R2 업로드 헬퍼
 * @aws-sdk/client-s3로 S3 호환 API 사용
 * 동적 import (Vercel Serverless 호환)
 */
import { randomUUID } from 'crypto';

let _s3Client = null;

async function getS3Client() {
  if (_s3Client) return _s3Client;
  const { S3Client } = await import('@aws-sdk/client-s3');
  _s3Client = new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
  });
  return _s3Client;
}

/**
 * R2에 파일 업로드
 * @param {string} key - 파일 키 (예: 'card-news/user123/2026-03-29/abc-1.png')
 * @param {Buffer} body - 파일 데이터
 * @param {string} contentType - MIME 타입
 * @returns {string} 공개 URL
 */
export async function uploadToR2(key, body, contentType = 'image/png') {
  const { PutObjectCommand } = await import('@aws-sdk/client-s3');
  const client = await getS3Client();
  const bucket = process.env.R2_BUCKET_NAME;

  await client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: body,
    ContentType: contentType,
  }));

  // R2 Custom Domain
  return `https://cdn.ddukddaktool.co.kr/${key}`;
}

/**
 * 카드뉴스 PNG 배열을 R2에 업로드
 * @param {string} userId - 사용자 식별자 (이메일 해시 등)
 * @param {Buffer[]} pngBuffers - PNG Buffer 배열
 * @returns {string[]} R2 URL 배열
 */
/**
 * 외부 이미지 URL을 R2에 업로드 (fal.ai / OpenAI 임시 URL → 영구 R2 URL)
 * @param {string} imageUrl - 원본 이미지 URL
 * @param {string} key - R2 키
 * @returns {string|null} R2 URL (실패 시 null)
 */
export async function uploadImageUrlToR2(imageUrl, key) {
  try {
    const response = await fetch(imageUrl);
    if (!response.ok) throw new Error(`Fetch failed: ${response.status}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    const contentType = response.headers.get('content-type') || 'image/png';
    return await uploadToR2(key, buffer, contentType);
  } catch (err) {
    console.error(`[R2] URL upload failed for ${key}:`, err.message);
    return null;
  }
}

/**
 * 이미지 배열의 URL을 R2로 교체 (non-fatal: 실패 시 원본 URL 유지)
 * @param {Array<{url: string, ...}>} images - url 필드를 가진 이미지 배열
 * @param {string} prefix - R2 키 프리픽스 (예: 'images', 'images-pro')
 * @param {string} userId - 사용자 식별자
 * @returns {Array} r2Url이 추가된 이미지 배열
 */
export async function replaceUrlsWithR2(images, prefix, userId) {
  const date = new Date().toISOString().slice(0, 10);
  const uuid = randomUUID();

  const results = await Promise.all(
    images.map(async (img, i) => {
      if (!img.url) return img;
      const ext = img.url.includes('.webp') ? 'webp' : img.url.includes('.jpg') || img.url.includes('.jpeg') ? 'jpg' : 'png';
      const key = `${prefix}/${userId}/${date}/${uuid}-${i + 1}.${ext}`;
      const r2Url = await uploadImageUrlToR2(img.url, key);
      return { ...img, r2Url: r2Url || null };
    })
  );

  const uploaded = results.filter(r => r.r2Url).length;
  if (uploaded > 0) console.log(`[R2] ${prefix}: ${uploaded}/${images.length} uploaded`);
  return results;
}

export async function uploadCardNewsToR2(userId, pngBuffers) {
  const date = new Date().toISOString().slice(0, 10);
  const uuid = randomUUID();
  const urls = [];

  for (let i = 0; i < pngBuffers.length; i++) {
    const key = `card-news/${userId}/${date}/${uuid}-${i + 1}.png`;
    const url = await uploadToR2(key, pngBuffers[i], 'image/png');
    urls.push(url);
  }

  return urls;
}
