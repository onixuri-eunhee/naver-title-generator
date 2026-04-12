import { getRedis, resolveAdmin, getClientIp, jsonResponse, handleOptions } from '@/lib/api-helpers';

export async function OPTIONS(request) {
  return handleOptions(request);
}

async function requireAdmin(request) {
  const isAdmin = await resolveAdmin(request);
  if (!isAdmin) {
    return { error: jsonResponse(request, { error: '관리자 인증 실패' }, { status: 403 }) };
  }
  return { isAdmin: true, ip: getClientIp(request), key: `admin:whitelist:${getClientIp(request)}` };
}

export async function GET(request) {
  const auth = await requireAdmin(request);
  if (auth.error) return auth.error;
  const whitelisted = await getRedis().get(auth.key);
  return jsonResponse(request, { ip: auth.ip, whitelisted: !!whitelisted });
}

export async function POST(request) {
  const auth = await requireAdmin(request);
  if (auth.error) return auth.error;
  await getRedis().set(auth.key, '1', { ex: 86400 });
  return jsonResponse(request, { ip: auth.ip, whitelisted: true, message: `${auth.ip} 화이트리스트 등록 완료 (24시간)` });
}

export async function DELETE(request) {
  const auth = await requireAdmin(request);
  if (auth.error) return auth.error;
  await getRedis().del(auth.key);
  return jsonResponse(request, { ip: auth.ip, whitelisted: false, message: `${auth.ip} 화이트리스트 해제 완료` });
}
