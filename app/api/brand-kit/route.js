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
