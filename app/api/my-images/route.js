import {
  extractToken,
  resolveSessionEmail,
  jsonResponse,
  handleOptions,
} from '@/lib/api-helpers';
import { uploadUserImage, listUserImages, registerFromUrl } from '@/lib/user-images';
import { checkQuota } from '@/lib/user-quota';

export const maxDuration = 60;

async function requireAuth(request) {
  const token = extractToken(request);
  if (!token) return null;
  return await resolveSessionEmail(token);
}

export async function OPTIONS(request) {
  return handleOptions(request);
}

export async function POST(request) {
  const email = await requireAuth(request);
  if (!email) {
    return jsonResponse(request, { error: '로그인이 필요합니다.' }, { status: 401 });
  }

  // JSON 분기: { sourceUrl, filename?, tag? } — 이미 R2/외부에 있는 이미지를 보관함에 등록.
  // blog-image-pro "보관함 저장" 버튼, shortform Step 5 AI 이미지 자동 저장에서 사용.
  const contentType = request.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    let body;
    try {
      body = await request.json();
    } catch {
      return jsonResponse(request, { error: '잘못된 JSON 형식입니다.' }, { status: 400 });
    }
    const { sourceUrl, filename, tag } = body || {};
    if (!sourceUrl || typeof sourceUrl !== 'string') {
      return jsonResponse(request, { error: 'sourceUrl이 필요합니다.' }, { status: 400 });
    }

    // 쿼터 사전 체크 — 실제 바이트는 HEAD로 확인
    let incomingBytes = 0;
    try {
      const head = await fetch(sourceUrl, { method: 'HEAD' });
      incomingBytes = Number(head.headers.get('content-length') || 0);
    } catch {}
    // HEAD 못 읽으면 평균값 400KB로 가정 — sharp 처리 후 실제 크기 기준 DB row에 반영됨
    const assumedBytes = incomingBytes || 400 * 1024;
    const quota = await checkQuota(email, assumedBytes);
    if (!quota.ok) {
      return jsonResponse(request, {
        error: '용량이 부족합니다. 기존 이미지를 삭제하거나 크레딧 결제 시 용량이 확장됩니다.',
        quota: quota.quota,
        used: quota.used,
        available: quota.available,
      }, { status: 409 });
    }

    try {
      const row = await registerFromUrl({
        email,
        sourceUrl,
        filename: filename || null,
        tag: tag ? String(tag) : null,
      });
      return jsonResponse(request, {
        image: row,
        quota: { ...quota, used: quota.used + row.file_size, available: quota.available - row.file_size },
      }, { status: 201 });
    } catch (err) {
      console.error('[MY-IMAGES] registerFromUrl failed:', err.message);
      return jsonResponse(request, { error: err.message || '저장에 실패했습니다.' }, { status: 500 });
    }
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
    return jsonResponse(request, {
      image: row,
      quota: { ...quota, used: quota.used + row.file_size, available: quota.available - row.file_size },
    }, { status: 201 });
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
