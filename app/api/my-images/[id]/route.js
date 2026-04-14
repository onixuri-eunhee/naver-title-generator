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
