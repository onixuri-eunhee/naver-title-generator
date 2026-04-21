import { Receiver } from '@upstash/qstash';
import { NextResponse } from 'next/server';
import { publishProgress } from '@/lib/job-progress';
import { runScriptGeneration } from '@/lib/shortform/script-worker';

export const maxDuration = 300;
export const runtime = 'nodejs';

// Vercel 함수 300초 killtime 직전에 error 이벤트를 먼저 발행하여
// SSE 클라이언트가 무한 로딩 상태에 갇히지 않도록 한다.
const SOFT_TIMEOUT_MS = 270 * 1000;

export async function POST(request) {
  const rawBody = await request.text();

  try {
    const receiver = new Receiver({
      currentSigningKey: process.env.QSTASH_CURRENT_SIGNING_KEY,
      nextSigningKey: process.env.QSTASH_NEXT_SIGNING_KEY,
    });

    const signature = request.headers.get('upstash-signature');
    await receiver.verify({
      signature,
      body: rawBody,
    });
  } catch (error) {
    console.error('[shortform-script/worker] signature verification failed:', error);
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { jobId, email, isAdmin, ip, body } = payload || {};

  try {
    await Promise.race([
      runScriptGeneration({ jobId, email, isAdmin, ip, body }),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error('script_worker_soft_timeout')),
          SOFT_TIMEOUT_MS,
        ),
      ),
    ]);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[shortform-script/worker] unhandled error:', error);
    await publishProgress(jobId, {
      type: 'error',
      error: error?.message === 'script_worker_soft_timeout'
        ? '대본 생성이 시간 초과되어 중단되었습니다. 잠시 후 다시 시도해주세요.'
        : (error?.message || 'worker unhandled error'),
      step: 'script-generation',
    }).catch(() => {});
    return NextResponse.json(
      { ok: false, error: error?.message || 'worker unhandled error' },
      { status: 500 },
    );
  }
}
