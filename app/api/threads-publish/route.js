import {
  getRedis,
  resolveAdmin,
  extractToken,
  resolveSessionEmail,
  jsonResponse,
  handleOptions,
} from '@/lib/api-helpers';
import { publishToThreads } from '@/lib/threads';

export async function OPTIONS(request) {
  return handleOptions(request);
}

export async function POST(request) {
  const body = await request.json().catch(() => ({}));
  const { text } = body;

  if (!text || !text.trim()) {
    return jsonResponse(request, { error: '발행할 텍스트가 없습니다.' }, { status: 400 });
  }

  const mainText = text.includes('[답글]') ? text.split('[답글]')[0].trim() : text.trim();
  if (mainText.length > 500) {
    return jsonResponse(request, { error: '500자를 초과하는 글은 발행할 수 없습니다.' }, { status: 400 });
  }

  // 1) 관리자: 환경변수 토큰
  const isAdmin = await resolveAdmin(request);
  if (isAdmin && process.env.THREADS_USER_ID && process.env.THREADS_ACCESS_TOKEN) {
    try {
      const threadId = await publishToThreads(
        text.trim(),
        process.env.THREADS_USER_ID,
        process.env.THREADS_ACCESS_TOKEN
      );
      return jsonResponse(request, { success: true, threadId });
    } catch (err) {
      console.error('Threads Publish Error (admin):', err);
      return jsonResponse(request, { error: 'Threads 발행 중 오류가 발생했습니다.' }, { status: 500 });
    }
  }

  // 2) 일반 회원: Redis 토큰
  const token = extractToken(request);
  const email = await resolveSessionEmail(token);
  if (!email) {
    return jsonResponse(request, { error: '로그인이 필요합니다.' }, { status: 401 });
  }

  const threadsData = await getRedis().get(`threads:user:${email}`);
  if (!threadsData) {
    return jsonResponse(request, { error: 'Threads 계정을 먼저 연결해주세요. 마이페이지에서 연결할 수 있습니다.' }, { status: 403 });
  }

  const parsed = typeof threadsData === 'string' ? JSON.parse(threadsData) : threadsData;

  try {
    const threadId = await publishToThreads(text.trim(), parsed.userId, parsed.accessToken);
    return jsonResponse(request, { success: true, threadId });
  } catch (err) {
    console.error('Threads Publish Error (user):', err);
    if (err.message && err.message.includes('Invalid OAuth')) {
      await getRedis().del(`threads:user:${email}`);
      return jsonResponse(request, { error: 'Threads 연결이 만료되었습니다. 마이페이지에서 다시 연결해주세요.' }, { status: 401 });
    }
    return jsonResponse(request, { error: 'Threads 발행 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
