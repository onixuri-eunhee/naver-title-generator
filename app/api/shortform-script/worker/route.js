import { Receiver } from '@upstash/qstash';
import { NextResponse } from 'next/server';
import { publishProgress } from '@/lib/job-progress';
import { runScriptGeneration } from '@/lib/shortform/script-worker';

export const maxDuration = 300;
export const runtime = 'nodejs';

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
    await runScriptGeneration({ jobId, email, isAdmin, ip, body });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[shortform-script/worker] unhandled error:', error);
    await publishProgress(jobId, {
      type: 'error',
      error: error?.message || 'worker unhandled error',
      step: 'script-generation',
    }).catch(() => {});
    return NextResponse.json(
      { ok: false, error: error?.message || 'worker unhandled error' },
      { status: 500 },
    );
  }
}
