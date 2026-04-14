/**
 * POST /api/shortform-projects         새 draft 생성
 * GET  /api/shortform-projects         내 프로젝트 목록 (status 필터 + limit)
 *
 * Phase C — shortform_projects 컬렉션 엔드포인트.
 */
import {
  extractToken,
  resolveSessionEmail,
  jsonResponse,
  handleOptions,
} from '@/lib/api-helpers';
import { createDraft, listProjects } from '@/lib/shortform-projects';

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
 * GET /api/shortform-projects?status=draft|published&limit=50
 * 내 숏폼 프로젝트 목록 (기본 최신순 50개)
 */
export async function GET(request) {
  const email = await requireAuth(request);
  if (!email) {
    return jsonResponse(request, { error: '로그인이 필요합니다.' }, { status: 401 });
  }

  const url = new URL(request.url);
  const status = url.searchParams.get('status') || null;
  const limit = Number(url.searchParams.get('limit')) || 50;

  try {
    const projects = await listProjects(email, { status, limit });
    return jsonResponse(request, { projects });
  } catch (err) {
    console.error('[SHORTFORM-PROJECTS] GET list failed:', err.message);
    return jsonResponse(request, { error: '목록을 불러오지 못했습니다.' }, { status: 500 });
  }
}

/**
 * POST /api/shortform-projects
 * 새 draft 생성. body에 Step 1 초기값 전달 가능 (선택).
 *
 * Request body (선택):
 * {
 *   blog_text, keywords, user_experience, persona, tone, duration_sec, title
 * }
 */
export async function POST(request) {
  const email = await requireAuth(request);
  if (!email) {
    return jsonResponse(request, { error: '로그인이 필요합니다.' }, { status: 401 });
  }

  let body = {};
  try {
    body = await request.json();
  } catch (_) {
    body = {};
  }

  try {
    const project = await createDraft(email, body);
    return jsonResponse(request, { project }, { status: 201 });
  } catch (err) {
    console.error('[SHORTFORM-PROJECTS] POST create failed:', err.message);
    return jsonResponse(request, { error: '프로젝트 생성에 실패했습니다.' }, { status: 500 });
  }
}
