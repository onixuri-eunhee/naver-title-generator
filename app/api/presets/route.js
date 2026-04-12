import { getRedis, extractToken, resolveSessionEmail, jsonResponse, handleOptions } from '@/lib/api-helpers';

export async function OPTIONS(request) {
  return handleOptions(request);
}

async function resolveUser(request) {
  const token = extractToken(request);
  return await resolveSessionEmail(token);
}

export async function GET(request) {
  const email = await resolveUser(request);
  if (!email) return jsonResponse(request, { error: '로그인이 필요합니다.' }, { status: 401 });

  try {
    const raw = await getRedis().get(`presets:${email}`);
    const presets = Array.isArray(raw) ? raw : [];
    return jsonResponse(request, { presets });
  } catch (e) {
    console.error('[PRESETS] Redis error:', e.message);
    return jsonResponse(request, { error: '서버 오류가 발생했습니다.' }, { status: 500 });
  }
}

export async function PUT(request) {
  const email = await resolveUser(request);
  if (!email) return jsonResponse(request, { error: '로그인이 필요합니다.' }, { status: 401 });

  try {
    const body = await request.json().catch(() => ({}));
    const presets = body?.presets;
    if (!Array.isArray(presets)) return jsonResponse(request, { error: '올바른 형식이 아닙니다.' }, { status: 400 });
    if (presets.length > 5) return jsonResponse(request, { error: '프리셋은 최대 5개까지 저장할 수 있습니다.' }, { status: 400 });

    const sanitized = presets.slice(0, 5).map((p) => ({
      industry: String(p.industry || '').slice(0, 200),
      target: String(p.target || '').slice(0, 200),
      location: String(p.location || '').slice(0, 200),
    }));
    await getRedis().set(`presets:${email}`, sanitized, { ex: 365 * 24 * 60 * 60 });
    return jsonResponse(request, { presets: sanitized });
  } catch (e) {
    console.error('[PRESETS] Redis error:', e.message);
    return jsonResponse(request, { error: '서버 오류가 발생했습니다.' }, { status: 500 });
  }
}
