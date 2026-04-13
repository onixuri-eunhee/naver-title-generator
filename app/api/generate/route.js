import {
  getRedis,
  resolveAdmin,
  extractToken,
  resolveSessionEmail,
  getClientIp,
  isCreditsActive,
  jsonResponse,
  handleOptions,
} from '@/lib/api-helpers';
import { logUsage, chargeCredits, refundCredits, getUserCredits } from '@/lib/db';

const MEMBER_DAILY_LIMIT = 5;
const BLOG_CREDIT_COST = 1;

function getKSTDate() {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

function getTodayKeyByEmail(email) {
  return `ratelimit:generate:${email}:${getKSTDate()}`;
}

function getTTLUntilMidnightKST() {
  const now = new Date();
  const kstOffset = 9 * 60 * 60 * 1000;
  const kstNow = new Date(now.getTime() + kstOffset);
  const nextMidnight = new Date(kstNow);
  nextMidnight.setUTCHours(0, 0, 0, 0);
  nextMidnight.setUTCDate(nextMidnight.getUTCDate() + 1);
  const seconds = Math.ceil((nextMidnight.getTime() - kstNow.getTime()) / 1000);
  return Math.max(seconds, 60);
}

export async function OPTIONS(request) {
  return handleOptions(request);
}

export async function GET(request) {
  try {
    const whitelisted = await resolveAdmin(request);
    if (whitelisted) {
      return jsonResponse(request, { remaining: 999, limit: MEMBER_DAILY_LIMIT, admin: true, creditsActive: isCreditsActive() });
    }

    const token = extractToken(request);
    const email = await resolveSessionEmail(token);
    if (!email) {
      return jsonResponse(request, { remaining: 0, limit: MEMBER_DAILY_LIMIT, loginRequired: true, creditsActive: isCreditsActive() });
    }

    if (isCreditsActive()) {
      const credits = await getUserCredits(email);
      return jsonResponse(request, { remaining: credits, creditCost: BLOG_CREDIT_COST, creditsActive: true });
    }

    const key = getTodayKeyByEmail(email);
    const count = (await getRedis().get(key)) || 0;
    const remaining = Math.max(MEMBER_DAILY_LIMIT - count, 0);
    return jsonResponse(request, { remaining, limit: MEMBER_DAILY_LIMIT, creditsActive: false });
  } catch {
    return jsonResponse(request, { remaining: 0, limit: MEMBER_DAILY_LIMIT, creditsActive: isCreditsActive() });
  }
}

export async function POST(request) {
  let rateLimitKey = null;
  let creditCharged = false;
  let email = null;

  try {
    const body = await request.json().catch(() => ({}));
    const { prompt, system, messages, model, max_tokens, isAutoCorrect } = body;

    const apiMessages = messages || (prompt ? [{ role: 'user', content: prompt }] : null);

    if (!apiMessages) {
      return jsonResponse(request, { error: 'prompt 또는 messages가 필요합니다.' }, { status: 400 });
    }

    if (system && system.length > 10000) {
      return jsonResponse(request, { error: '시스템 프롬프트가 너무 깁니다.' }, { status: 400 });
    }

    const totalLen = JSON.stringify(apiMessages).length + (system ? system.length : 0);
    if (totalLen > 50000) {
      return jsonResponse(request, { error: '입력이 너무 깁니다.' }, { status: 400 });
    }

    const ALLOWED_MODELS = ['claude-sonnet-4-20250514', 'claude-haiku-4-5-20251001'];
    const safeModel = ALLOWED_MODELS.includes(model) ? model : 'claude-sonnet-4-20250514';

    const MAX_TOKENS_LIMIT = 8192;
    const safeMaxTokens = Math.min(Math.max(parseInt(max_tokens, 10) || 2000, 1), MAX_TOKENS_LIMIT);

    const whitelisted = await resolveAdmin(request);
    const token = extractToken(request);
    email = await resolveSessionEmail(token);

    if (!whitelisted && !email) {
      return jsonResponse(request, { error: '로그인이 필요합니다.' }, { status: 401 });
    }

    const dailyLimit = MEMBER_DAILY_LIMIT;
    let remaining = whitelisted ? 999 : dailyLimit;

    if (isCreditsActive() && !whitelisted) {
      if (!isAutoCorrect) {
        const result = await chargeCredits(email, BLOG_CREDIT_COST, 'blog-generate');
        if (!result) {
          return jsonResponse(request, {
            error: '크레딧이 부족합니다. 충전 후 이용해주세요.',
            required: BLOG_CREDIT_COST,
            code: 'INSUFFICIENT_CREDITS',
          }, { status: 402 });
        }
        creditCharged = true;
        remaining = result.remaining;
      } else {
        const acKey = `autocorrect:${email}:${getKSTDate()}`;
        const used = await getRedis().get(acKey);
        if (!used) {
          await getRedis().set(acKey, '1', { ex: getTTLUntilMidnightKST() });
        } else {
          const result = await chargeCredits(email, BLOG_CREDIT_COST, 'blog-auto-correct');
          if (!result) {
            return jsonResponse(request, {
              error: '크레딧이 부족합니다. 충전 후 이용해주세요.',
              required: BLOG_CREDIT_COST,
              code: 'INSUFFICIENT_CREDITS',
            }, { status: 402 });
          }
          creditCharged = true;
          remaining = result.remaining;
        }
      }
    } else if (!whitelisted) {
      let skipRateLimit = false;
      if (isAutoCorrect) {
        const acKey = `autocorrect:${email}:${getKSTDate()}`;
        const used = await getRedis().get(acKey);
        if (!used) {
          await getRedis().set(acKey, '1', { ex: getTTLUntilMidnightKST() });
          skipRateLimit = true;
        }
      }

      if (!skipRateLimit) {
        rateLimitKey = getTodayKeyByEmail(email);
        const newCount = await getRedis().incr(rateLimitKey);
        await getRedis().expire(rateLimitKey, getTTLUntilMidnightKST());

        if (newCount > dailyLimit) {
          await getRedis().decr(rateLimitKey);
          return jsonResponse(request, {
            error: `일일 무료 사용 한도(${dailyLimit}회)를 초과했습니다. 내일 다시 이용해주세요.`,
            remaining: 0,
          }, { status: 429 });
        }
        remaining = dailyLimit - newCount;
      } else {
        const key = getTodayKeyByEmail(email);
        const count = (await getRedis().get(key)) || 0;
        remaining = Math.max(dailyLimit - count, 0);
      }
    }

    const apiBody = {
      model: safeModel,
      max_tokens: safeMaxTokens,
      temperature: 0.5,
      messages: apiMessages,
    };
    if (system) apiBody.system = system;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(apiBody),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Claude API Error:', data?.error?.type || response.status);
      if (rateLimitKey) {
        try { await getRedis().decr(rateLimitKey); } catch (_) {}
      }
      if (creditCharged && email) {
        await refundCredits(email, BLOG_CREDIT_COST, 'blog-generate-error-refund');
      }
      return jsonResponse(request, { error: '글 생성 중 오류가 발생했습니다.' }, { status: 500 });
    }

    await logUsage(email, 'blog', isAutoCorrect ? 'auto_correct' : null, getClientIp(request));
    return jsonResponse(request, { ...data, remaining, limit: dailyLimit });
  } catch (error) {
    console.error('API Error:', error?.message || 'unknown');
    if (rateLimitKey) {
      try { await getRedis().decr(rateLimitKey); } catch (_) {}
    }
    if (creditCharged && email) {
      await refundCredits(email, BLOG_CREDIT_COST, 'blog-generate-exception-refund');
    }
    return jsonResponse(request, { error: '서버 오류가 발생했습니다.' }, { status: 500 });
  }
}
