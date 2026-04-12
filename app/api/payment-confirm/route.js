import { extractToken, resolveSessionEmail, jsonResponse, handleOptions } from '@/lib/api-helpers';
import { getDb } from '@/lib/db';

const UNIT_PRICE = 9900;
const UNIT_CREDIT = 30;
const MAX_QTY = 5;

export async function OPTIONS(request) {
  return handleOptions(request);
}

export async function POST(request) {
  const token = extractToken(request);
  const email = await resolveSessionEmail(token);
  if (!email) {
    return jsonResponse(request, { error: '로그인이 필요합니다.' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const { paymentKey, orderId, amount } = body;

  if (!paymentKey || !orderId || !amount) {
    return jsonResponse(request, { error: '결제 정보가 누락되었습니다.' }, { status: 400 });
  }

  const numAmount = parseInt(amount, 10);
  if (numAmount < UNIT_PRICE || numAmount > UNIT_PRICE * MAX_QTY || numAmount % UNIT_PRICE !== 0) {
    return jsonResponse(request, { error: '유효하지 않은 결제 금액입니다.' }, { status: 400 });
  }
  const qty = numAmount / UNIT_PRICE;
  const credits = qty * UNIT_CREDIT;

  const secretKey = process.env.TOSS_SECRET_KEY;
  if (!secretKey) {
    console.error('[PAYMENT] TOSS_SECRET_KEY not configured');
    return jsonResponse(request, { error: '결제 시스템 설정 오류입니다.' }, { status: 500 });
  }

  const authHeader = 'Basic ' + Buffer.from(secretKey + ':').toString('base64');

  let tossRes;
  try {
    tossRes = await fetch('https://api.tosspayments.com/v1/payments/confirm', {
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ paymentKey, orderId, amount: numAmount }),
    });
  } catch (err) {
    console.error('[PAYMENT] Toss API network error:', err.message);
    return jsonResponse(request, { error: '결제 승인 중 네트워크 오류가 발생했습니다.' }, { status: 500 });
  }

  const tossData = await tossRes.json();

  if (!tossRes.ok) {
    console.error('[PAYMENT] Toss API error:', tossData.code, tossData.message);
    return jsonResponse(request, {
      error: tossData.message || '결제 승인에 실패했습니다.',
      code: tossData.code,
    }, { status: 400 });
  }

  const sql = getDb();

  try {
    await sql`INSERT INTO credit_ledger (user_email, amount, type, reason)
      VALUES (${email}, ${credits}, ${'purchase'}, ${`토스페이먼츠 ${qty}세트 (${orderId})`})`;

    await sql`UPDATE users SET credits = credits + ${credits}, updated_at = NOW()
      WHERE email = ${email}`;

    const [user] = await sql`SELECT credits FROM users WHERE email = ${email}`;

    return jsonResponse(request, {
      success: true,
      credits: credits,
      totalCredits: user?.credits || credits,
      orderId: tossData.orderId,
      method: tossData.method,
    });
  } catch (err) {
    console.error('[PAYMENT] DB error after successful payment:', err.message, {
      email, orderId, paymentKey, amount: numAmount, credits,
    });
    return jsonResponse(request, {
      error: '결제는 완료되었으나 크레딧 지급 중 오류가 발생했습니다. 고객센터로 문의해주세요.',
      orderId: tossData.orderId,
    }, { status: 500 });
  }
}
