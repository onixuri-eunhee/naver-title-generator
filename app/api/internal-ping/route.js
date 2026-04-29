/**
 * 내부 비서팀 인증 검증용 임시 라우트 (2026-04-30 도입)
 * X-Internal-Key 헤더로 호출 시 인증 결과 echo.
 *
 * 사용:
 *   curl -H "X-Internal-Key: sk_internal_xxx" https://ddukddaktool.co.kr/api/internal-ping
 *
 * Phase 2 검증 통과 후 삭제 또는 유지 (헬스체크 용도).
 */
import { resolveAuthIdentity, jsonResponse, handleOptions } from '@/lib/api-helpers';

export async function OPTIONS(request) {
  return handleOptions(request);
}

export async function GET(request) {
  const auth = await resolveAuthIdentity(request);
  if (!auth) {
    return jsonResponse(
      request,
      { ok: false, error: 'unauthorized', hint: 'Bearer token 또는 X-Internal-Key 헤더 필요' },
      { status: 401 }
    );
  }
  return jsonResponse(request, {
    ok: true,
    email: auth.email,
    isInternal: auth.isInternal,
    isAdmin: auth.isAdmin,
    timestamp: new Date().toISOString(),
  });
}
