/**
 * GET    /api/shortform-projects/[id]   단일 프로젝트 조회
 * PATCH  /api/shortform-projects/[id]   부분 업데이트 (auto-save)
 * DELETE /api/shortform-projects/[id]   삭제
 *
 * Phase C — shortform_projects 단건 엔드포인트.
 */
import {
  extractToken,
  resolveSessionEmail,
  jsonResponse,
  handleOptions,
} from '@/lib/api-helpers';
import {
  getProjectById,
  updateProject,
  deleteProject,
} from '@/lib/shortform-projects';

export const maxDuration = 30;

async function requireAuth(request) {
  const token = extractToken(request);
  if (!token) return null;
  return await resolveSessionEmail(token);
}

function parseId(resolved) {
  const id = Number(resolved?.id);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function OPTIONS(request) {
  return handleOptions(request);
}

/**
 * GET /api/shortform-projects/[id]
 * 내 프로젝트 단일 조회.
 */
export async function GET(request, { params }) {
  const email = await requireAuth(request);
  if (!email) {
    return jsonResponse(request, { error: '로그인이 필요합니다.' }, { status: 401 });
  }
  const id = parseId(await params);
  if (!id) {
    return jsonResponse(request, { error: '유효하지 않은 id입니다.' }, { status: 400 });
  }
  try {
    const project = await getProjectById(email, id);
    if (!project) {
      return jsonResponse(request, { error: '프로젝트를 찾을 수 없습니다.' }, { status: 404 });
    }
    return jsonResponse(request, { project });
  } catch (err) {
    console.error('[SHORTFORM-PROJECTS] GET one failed:', err.message);
    return jsonResponse(request, { error: '조회에 실패했습니다.' }, { status: 500 });
  }
}

/**
 * PATCH /api/shortform-projects/[id]
 * 부분 업데이트 (auto-save).
 * body: 변경할 컬럼(화이트리스트만 적용)
 */
export async function PATCH(request, { params }) {
  const email = await requireAuth(request);
  if (!email) {
    return jsonResponse(request, { error: '로그인이 필요합니다.' }, { status: 401 });
  }
  const id = parseId(await params);
  if (!id) {
    return jsonResponse(request, { error: '유효하지 않은 id입니다.' }, { status: 400 });
  }

  let body = {};
  try {
    body = await request.json();
  } catch (_) {
    return jsonResponse(request, { error: '잘못된 요청 본문입니다.' }, { status: 400 });
  }

  try {
    const project = await updateProject(email, id, body);
    if (!project) {
      return jsonResponse(request, { error: '프로젝트를 찾을 수 없습니다.' }, { status: 404 });
    }
    return jsonResponse(request, { project });
  } catch (err) {
    console.error('[SHORTFORM-PROJECTS] PATCH failed:', err.message);
    return jsonResponse(request, { error: '저장에 실패했습니다.' }, { status: 500 });
  }
}

/**
 * DELETE /api/shortform-projects/[id]
 */
export async function DELETE(request, { params }) {
  const email = await requireAuth(request);
  if (!email) {
    return jsonResponse(request, { error: '로그인이 필요합니다.' }, { status: 401 });
  }
  const id = parseId(await params);
  if (!id) {
    return jsonResponse(request, { error: '유효하지 않은 id입니다.' }, { status: 400 });
  }
  try {
    const ok = await deleteProject(email, id);
    if (!ok) {
      return jsonResponse(request, { error: '프로젝트를 찾을 수 없습니다.' }, { status: 404 });
    }
    return jsonResponse(request, { ok: true });
  } catch (err) {
    console.error('[SHORTFORM-PROJECTS] DELETE failed:', err.message);
    return jsonResponse(request, { error: '삭제에 실패했습니다.' }, { status: 500 });
  }
}
