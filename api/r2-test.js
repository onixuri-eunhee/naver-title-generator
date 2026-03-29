// R2 연결 테스트 — 환경변수 확인 + 실제 업로드 테스트
export default async function handler(req, res) {
  const results = {};

  // 1. 환경변수 확인
  results.envCheck = {
    R2_ACCOUNT_ID: process.env.R2_ACCOUNT_ID ? process.env.R2_ACCOUNT_ID.substring(0, 8) + '...' : 'MISSING',
    R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID ? process.env.R2_ACCESS_KEY_ID.substring(0, 8) + '...' : 'MISSING',
    R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY ? 'SET (' + process.env.R2_SECRET_ACCESS_KEY.length + ' chars)' : 'MISSING',
    R2_BUCKET_NAME: process.env.R2_BUCKET_NAME || 'MISSING',
  };

  // 2. S3 SDK 로딩
  try {
    const { S3Client, PutObjectCommand, ListObjectsV2Command } = await import('@aws-sdk/client-s3');
    results.s3sdk = 'OK';

    // 3. 클라이언트 생성
    const client = new S3Client({
      region: 'auto',
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
      },
    });
    results.client = 'OK';

    // 4. 테스트 파일 업로드
    const testKey = `test/r2-test-${Date.now()}.txt`;
    await client.send(new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: testKey,
      Body: Buffer.from('R2 upload test ' + new Date().toISOString()),
      ContentType: 'text/plain',
    }));
    results.upload = 'OK - ' + testKey;

    // 5. 파일 목록 확인
    const list = await client.send(new ListObjectsV2Command({
      Bucket: process.env.R2_BUCKET_NAME,
      MaxKeys: 5,
    }));
    results.fileCount = list.Contents ? list.Contents.length : 0;

  } catch (e) {
    results.error = e.message;
    results.stack = e.stack?.split('\n').slice(0, 3).join(' | ');
  }

  return res.status(200).json(results);
}
