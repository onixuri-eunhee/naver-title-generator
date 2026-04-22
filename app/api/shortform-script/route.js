import { Client as QStashClient } from '@upstash/qstash';
import {
  getRedis,
  resolveAdmin,
  extractToken,
  resolveSessionEmail,
  getClientIp,
  jsonResponse,
  handleOptions,
} from '@/lib/api-helpers';
import { getDb } from '@/lib/db';
import { publishProgress, createJobId } from '@/lib/job-progress';
import { CancelledError } from '@/lib/cancelled-error';
import { runScriptGeneration } from '@/lib/shortform/script-worker.js';
import {
  SHORTFORM_CREDIT_COSTS,
  LONGFORM_CREDIT_COSTS,
} from '@/lib/shortform/script-payload.js';

export const runtime = 'nodejs';
export const maxDuration = 30;

const USE_ASYNC_WORKER = process.env.SHORTFORM_ASYNC_WORKER !== 'false';

function toSentence(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function resolveWorkerBaseUrl(request) {
  const requestOrigin = request?.nextUrl?.origin;
  if (requestOrigin) return requestOrigin;

  return process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : (process.env.NEXT_PUBLIC_SITE_URL || 'https://ddukddaktool.co.kr');
}

export async function OPTIONS(request) {
  return handleOptions(request);
}

export async function GET(request) {
  try {
    const isAdmin = await resolveAdmin(request);
    if (isAdmin) {
      return jsonResponse(request, {
        remaining: 999,
        admin: true,
        creditCosts: SHORTFORM_CREDIT_COSTS,
        shortformCreditCosts: SHORTFORM_CREDIT_COSTS,
        longformCreditCosts: LONGFORM_CREDIT_COSTS,
      });
    }

    const email = await resolveSessionEmail(extractToken(request));
    if (!email) {
      return jsonResponse(request, {
        remaining: 0,
        loginRequired: true,
        creditCosts: SHORTFORM_CREDIT_COSTS,
        shortformCreditCosts: SHORTFORM_CREDIT_COSTS,
        longformCreditCosts: LONGFORM_CREDIT_COSTS,
      });
    }

    const freeUsed = await getRedis().get(`shortform-free:${email}`);
    const sql = getDb();
    const [user] = await sql`SELECT credits FROM users WHERE email = ${email}`;

    return jsonResponse(request, {
      freeAvailable: !freeUsed,
      credits: user?.credits || 0,
      creditCosts: SHORTFORM_CREDIT_COSTS,
      shortformCreditCosts: SHORTFORM_CREDIT_COSTS,
      longformCreditCosts: LONGFORM_CREDIT_COSTS,
    });
  } catch {
    return jsonResponse(request, {
      remaining: 0,
      creditCosts: SHORTFORM_CREDIT_COSTS,
      shortformCreditCosts: SHORTFORM_CREDIT_COSTS,
      longformCreditCosts: LONGFORM_CREDIT_COSTS,
    });
  }
}

export async function chargeShortformCredits(_params) {
  return { charged: 0, reason: 'pre-render: charging deferred to Step 7' };
}

export async function POST(request) {
  const body = await request.json().catch(() => ({}));
  const jobId = body.jobId || createJobId();

  try {
    const topic = toSentence(body.topic);
    const blogText = String(body.blogText || '').trim();
    const keywords = String(body.keywords || '').trim();

    if (!topic && !blogText && !keywords) {
      return jsonResponse(
        request,
        { error: 'topic/blogText/keywords 중 하나는 필요합니다.' },
        { status: 400 },
      );
    }

    const isAdmin = await resolveAdmin(request);
    const email = await resolveSessionEmail(extractToken(request));
    if (!isAdmin && !email) {
      return jsonResponse(request, { error: '로그인이 필요합니다.' }, { status: 401 });
    }

    const ip = getClientIp(request);

    if (USE_ASYNC_WORKER) {
      const baseUrl = resolveWorkerBaseUrl(request);

      try {
        const qstash = new QStashClient({ token: process.env.QSTASH_TOKEN });
        await qstash.publishJSON({
          url: `${baseUrl}/api/shortform-script/worker`,
          body: { jobId, email, isAdmin, ip, body },
          retries: 0,
        });
      } catch (error) {
        console.error('[shortform-script] QStash publish failed:', error);
        return jsonResponse(
          request,
          { error: '작업 큐잉에 실패했습니다. 잠시 후 다시 시도해주세요.' },
          { status: 503 },
        );
      }

      await publishProgress(jobId, {
        type: 'step',
        step: 'script-generation',
        status: 'running',
        progress: 0,
        subStep: 'queued',
      });

      return jsonResponse(
        request,
        { jobId, accepted: true, async: true },
        { status: 202 },
      );
    }

    const responsePayload = await runScriptGeneration({
      jobId,
      email,
      isAdmin,
      ip,
      body,
    });

    return jsonResponse(request, responsePayload);
  } catch (error) {
    if (error instanceof CancelledError) {
      return jsonResponse(
        request,
        { cancelled: true, checkpoint: error.checkpoint, jobId },
        { status: 499 },
      );
    }

    console.error('[shortform-script] API error:', error);
    return jsonResponse(
      request,
      { error: '숏폼 대본 생성 중 오류가 발생했습니다.' },
      { status: 500 },
    );
  }
}
