import { extractToken, resolveSessionEmail, jsonResponse, handleOptions } from '@/lib/api-helpers';
import { getDb } from '@/lib/db';

const UNIT_PRICE = 9900;
const UNIT_CREDIT = 30;
const MAX_QTY = 5;

// payments 테이블 lazy CREATE — 서버 인스턴스당 1회 (credit-service.ensureIdempotencyTables 패턴).
// 매 결제마다 CREATE TABLE 라운드트립을 날리지 않도록 promise를 메모이즈.
let _paymentsTableReady = null;
function ensurePaymentsTable(sql) {
  if (_paymentsTableReady) return _paymentsTableReady;
  _paymentsTableReady = sql`
    CREATE TABLE IF NOT EXISTS payments (
      order_id TEXT PRIMARY KEY,
      payment_key TEXT UNIQUE NOT NULL,
      user_email TEXT NOT NULL,
      amount INTEGER NOT NULL,
      credits INTEGER NOT NULL,
      credited BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT now()
    )
  `.then(() => {}).catch((err) => {
    _paymentsTableReady = null; // 다음 요청에서 재시도
    throw err;
  });
  return _paymentsTableReady;
}

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

  // 토스 응답 자체를 재검증 — 클라이언트가 보낸 amount를 신뢰하지 않는다.
  // 승인 상태가 DONE이 아니거나 실제 결제액이 우리가 계산한 금액과 다르면 거부.
  const tossAmount = Number(tossData.totalAmount);
  if (tossData.status !== 'DONE' || tossAmount !== numAmount) {
    console.error('[PAYMENT] amount/status mismatch', {
      email, orderId, status: tossData.status, tossAmount, numAmount,
    });
    return jsonResponse(request, { error: '결제 금액 검증에 실패했습니다.' }, { status: 400 });
  }

  const sql = getDb();

  try {
    // 멱등 처리 — 같은 orderId/paymentKey의 중복·재시도·재생(replay)을 모두 차단하되,
    // "결제 기록만 남고 크레딧 지급 직전에 실패"한 경우는 재시도로 복구되어야 한다.
    // 이를 위해 credited 플래그를 두고, 지급을 단일 원자적 SQL(CTE)로 처리한다.
    // (neon serverless는 HTTP라 분기형 트랜잭션 불가 → 단일 statement로 원자성 확보)
    await ensurePaymentsTable(sql);

    // 결제 기록 등록 (이미 있으면 무시). payment_key UNIQUE 위반은 위조 시도로 보고 차단.
    try {
      await sql`
        INSERT INTO payments (order_id, payment_key, user_email, amount, credits)
        VALUES (${orderId}, ${paymentKey}, ${email}, ${numAmount}, ${credits})
        ON CONFLICT (order_id) DO NOTHING
      `;
    } catch (dupErr) {
      console.warn('[PAYMENT] duplicate payment blocked:', dupErr.message, { email, orderId });
      return jsonResponse(request, { error: '이미 처리된 결제입니다.' }, { status: 409 });
    }

    // 원자적 지급 — credited=false인 행을 true로 바꾸며 그 행만 크레딧 적립.
    // 동시 요청 2개가 와도 UPDATE payments WHERE credited=false는 하나만 성공 → 이중적립 0.
    // 직전 시도가 지급 전 죽었으면 credited=false로 남아있어 재시도가 복구.
    const claimed = await sql`
      WITH claim AS (
        UPDATE payments SET credited = true
        WHERE order_id = ${orderId} AND credited = false
        RETURNING credits, user_email
      )
      UPDATE users
      SET credits = credits + (SELECT credits FROM claim), updated_at = NOW()
      WHERE email = (SELECT user_email FROM claim)
      RETURNING credits
    `;

    if (claimed.length === 0) {
      // 이미 지급 완료된 결제 — 재적립 없이 현재 잔액만 반환.
      console.warn('[PAYMENT] already credited, skipping', { email, orderId });
      const [u] = await sql`SELECT credits FROM users WHERE email = ${email}`;
      return jsonResponse(request, {
        success: true,
        credits: 0,
        totalCredits: u?.credits || 0,
        orderId,
        alreadyProcessed: true,
      });
    }

    // 회계 장부 기록 — 적립은 이미 확정. 장부 실패는 비치명(로그만).
    // chargeCredit 경로를 타지 않고 직접 INSERT한다(credit_ledger 이중기록 방지 +
    // 결제는 charge_log/credited 멱등을 이미 자체 처리하므로 credit-service 불필요).
    try {
      await sql`INSERT INTO credit_ledger (user_email, amount, type, reason)
        VALUES (${email}, ${credits}, ${'purchase'}, ${`토스페이먼츠 ${qty}세트 (${orderId})`})`;
    } catch (ledgerErr) {
      console.error('[PAYMENT] credit_ledger write failed (credit already granted):', ledgerErr.message, { email, orderId });
    }

    return jsonResponse(request, {
      success: true,
      credits: credits,
      totalCredits: Number(claimed[0].credits),
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
