/**
 * POST /api/shortform-projects/[id]/publish
 *
 * draft → published 전환. video_r2_key/caption_text/duration_actual
 * 최종 필드를 병합 저장하고 published_at 기록.
 */
import {
  extractToken,
  resolveSessionEmail,
  jsonResponse,
  handleOptions,
} from '@/lib/api-helpers';
import { publishProject } from '@/lib/shortform-projects';

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
 * POST /api/shortform-projects/[id]/publish
 *
 * body:
 * { video_r2_key, caption_text, duration_actual }
 *
 * 최종 산출물이 준비된 프로젝트를 published 상태로 전환.
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

  let body = {};
  try {
    body = await request.json();
  } catch (_) {
    body = {};
  }

  try {
    const project = await publishProject(email, id, body);
    if (!project) {
      return jsonResponse(request, { error: '프로젝트를 찾을 수 없습니다.' }, { status: 404 });
    }
    return jsonResponse(request, { project });
  } catch (err) {
    console.error('[SHORTFORM-PROJECTS] publish failed:', err.message);
    return jsonResponse(request, { error: '완성 처리에 실패했습니다.' }, { status: 500 });
  }
}
