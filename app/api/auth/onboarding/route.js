/**
 * 온보딩 상태 업데이트 엔드포인트. (Phase K)
 *
 * POST /api/auth/onboarding
 *   body: { completed: true, selectedSampleId?: string }
 *   Authorization: Bearer {token}
 *
 * 성공 시 users.onboarding_completed = TRUE.
 * selectedSampleId 는 현재 body에서 받아두지만 저장하지 않는다
 * (Phase L 에서 분석 지표로 필요할 경우 별도 로깅 테이블 추가).
 */
import { extractToken, getRedis, jsonResponse, handleOptions } from '@/lib/api-helpers';
import { markOnboardingCompleted } from '@/lib/shortform-onboarding';

export const runtime = 'nodejs';

async function resolveSessionEmail(token) {
  if (!token) return null;
  try {
    const raw = await getRedis().get(`session:${token}`);
    if (!raw) return null;
    const session = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return session?.email || null;
  } catch {
    return null;
  }
}

export async function OPTIONS(request) {
  return handleOptions(request);
}

export async function POST(request) {
  const token = extractToken(request);
  const email = await resolveSessionEmail(token);
  if (!email) {
    return jsonResponse(request, { error: '로그인이 필요합니다.' }, { status: 401 });
  }

  let body = {};
  try {
    body = await request.json();
  } catch {}

  if (body?.completed) {
    try {
      await markOnboardingCompleted(email);
    } catch (err) {
      console.error('[onboarding] markOnboardingCompleted 실패:', err?.message);
      return jsonResponse(request, { error: '온보딩 상태 저장에 실패했습니다.' }, { status: 500 });
    }
  }

  return jsonResponse(request, { success: true });
}
