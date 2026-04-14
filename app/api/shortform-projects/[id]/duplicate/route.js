/**
 * POST /api/shortform-projects/[id]/duplicate
 *
 * 기존 프로젝트의 Step 1~2, 프리셋을 복사해 새 draft 생성.
 * 산출물(video/audio r2 key)은 복사하지 않음.
 */
import {
  extractToken,
  resolveSessionEmail,
  jsonResponse,
  handleOptions,
} from '@/lib/api-helpers';
import { duplicateProject } from '@/lib/shortform-projects';

export const maxDuration = 30;

async function requireAuth(request) {
  const token = extractToken(request);
  if (!token) return null;
  return await resolveSessionEmail(token);
}

export async function OPTIONS(request) {
  return handleOptions(request);
}

/**
 * POST /api/shortform-projects/[id]/duplicate
 *
 * 기존 프로젝트의 Step 1~2, 프리셋을 복사해 새 draft 생성.
 * 산출물(video/audio r2 key)은 복사하지 않음.
 */
export async function POST(request, { params }) {
  const email = await requireAuth(request);
  if (!email) {
    return jsonResponse(request, { error: '로그인이 필요합니다.' }, { status: 401 });
  }
  const resolved = await params;
  const id = Number(resolved?.id);
  if (!Number.isInteger(id) || id <= 0) {
    return jsonResponse(request, { error: '유효하지 않은 id입니다.' }, { status: 400 });
  }

  try {
    const project = await duplicateProject(email, id);
    if (!project) {
      return jsonResponse(request, { error: '원본 프로젝트를 찾을 수 없습니다.' }, { status: 404 });
    }
    return jsonResponse(request, { project }, { status: 201 });
  } catch (err) {
    console.error('[SHORTFORM-PROJECTS] duplicate failed:', err.message);
    return jsonResponse(request, { error: '복제에 실패했습니다.' }, { status: 500 });
  }
}
