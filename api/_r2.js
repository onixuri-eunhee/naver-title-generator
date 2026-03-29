/**
 * Cloudflare R2 업로드 헬퍼
 * @aws-sdk/client-s3로 S3 호환 API 사용
 * 동적 import (Vercel Serverless 호환)
 */

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

  // R2 Public Development URL
  return `https://pub-cac85a1d3b8d486082bd1bff2fadcaed.r2.dev/${key}`;
}

/**
 * 카드뉴스 PNG 배열을 R2에 업로드
 * @param {string} userId - 사용자 식별자 (이메일 해시 등)
 * @param {Buffer[]} pngBuffers - PNG Buffer 배열
 * @returns {string[]} R2 URL 배열
 */
export async function uploadCardNewsToR2(userId, pngBuffers) {
  const date = new Date().toISOString().slice(0, 10);
  const uuid = Math.random().toString(36).substring(2, 10);
  const urls = [];

  for (let i = 0; i < pngBuffers.length; i++) {
    const key = `card-news/${userId}/${date}/${uuid}-${i + 1}.png`;
    const url = await uploadToR2(key, pngBuffers[i], 'image/png');
    urls.push(url);
  }

  return urls;
}
