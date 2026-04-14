import {
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
