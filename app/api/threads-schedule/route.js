import { Client } from '@upstash/qstash';
import {
  getRedis,
  resolveAdmin,
  extractToken,
  resolveSessionEmail,
  jsonResponse,
  handleOptions,
} from '@/lib/api-helpers';

export async function OPTIONS(request) {
  return handleOptions(request);
}

export async function POST(request) {
  const isAdmin = await resolveAdmin(request);

  let email = null;
  if (!isAdmin) {
    const token = extractToken(request);
    email = await resolveSessionEmail(token);
    if (!email) {
      return jsonResponse(request, { error: '로그인이 필요합니다.' }, { status: 401 });
    }
    const threadsData = await getRedis().get(`threads:user:${email}`);
    if (!threadsData) {
      return jsonResponse(request, { error: 'Threads 계정을 먼저 연결해주세요.' }, { status: 403 });
    }
  }

  const body = await request.json().catch(() => ({}));
  const { text, publishAt } = body;

  if (!text || !text.trim()) {
    return jsonResponse(request, { error: '발행할 텍스트가 없습니다.' }, { status: 400 });
  }

  const mainText = text.includes('[답글]') ? text.split('[답글]')[0].trim() : text.trim();
  if (mainText.length > 500) {
    return jsonResponse(request, { error: '500자를 초과하는 글은 발행할 수 없습니다.' }, { status: 400 });
  }

  if (!publishAt) {
    return jsonResponse(request, { error: '예약 시간을 지정해주세요.' }, { status: 400 });
  }

  const publishDate = new Date(publishAt);
  const now = new Date();
  const delaySec = Math.floor((publishDate.getTime() - now.getTime()) / 1000);

  if (delaySec < 60) {
    return jsonResponse(request, { error: '예약 시간은 현재로부터 최소 1분 이후여야 합니다.' }, { status: 400 });
  }

  try {
    const qstash = new Client({ token: process.env.QSTASH_TOKEN });

    const baseUrl = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : 'https://ddukddaktool.co.kr';

    const result = await qstash.publishJSON({
      url: `${baseUrl}/api/threads-callback`,
      body: { text: text.trim(), email: isAdmin ? null : email },
      delay: delaySec,
    });

    const scheduleId = result.messageId;
    await getRedis().set(
      `schedule:threads:${scheduleId}`,
      JSON.stringify({
        text: text.trim(),
        email: isAdmin ? null : email,
        publishAt,
        createdAt: now.toISOString(),
        status: 'scheduled',
      }),
      { ex: delaySec + 3600 }
    );

    return jsonResponse(request, {
      success: true,
      scheduleId,
      publishAt,
    });
  } catch (err) {
    console.error('Threads Schedule Error:', err);
    return jsonResponse(request, { error: '예약 발행 등록 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
