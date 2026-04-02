/**
 * 토스페이먼츠 결제 승인 + 크레딧 지급
 * POST /api/payment-confirm
 * Body: { paymentKey, orderId, amount }
 */
import { getDb } from './_db.js';
import { setCorsHeaders, extractToken, resolveSessionEmail } from './_helpers.js';

const UNIT_PRICE = 9900;
const UNIT_CREDIT = 30;
const MAX_QTY = 5;

export default async function handler(req, res) {
  setCorsHeaders(res, req);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  // 1. 로그인 확인
  const token = extractToken(req);
  const email = await resolveSessionEmail(token);
  if (!email) {
    return res.status(401).json({ error: '로그인이 필요합니다.' });
  }

  const { paymentKey, orderId, amount } = req.body;

  if (!paymentKey || !orderId || !amount) {
    return res.status(400).json({ error: '결제 정보가 누락되었습니다.' });
  }

  // 2. 금액 검증 (서버사이드 — 조작 방지)
  const numAmount = parseInt(amount, 10);
  if (numAmount < UNIT_PRICE || numAmount > UNIT_PRICE * MAX_QTY || numAmount % UNIT_PRICE !== 0) {
    return res.status(400).json({ error: '유효하지 않은 결제 금액입니다.' });
  }
  const qty = numAmount / UNIT_PRICE;
  const credits = qty * UNIT_CREDIT;

  // 3. 토스페이먼츠 결제 승인 요청
  const secretKey = process.env.TOSS_SECRET_KEY;
  if (!secretKey) {
    console.error('[PAYMENT] TOSS_SECRET_KEY not configured');
    return res.status(500).json({ error: '결제 시스템 설정 오류입니다.' });
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
    return res.status(500).json({ error: '결제 승인 중 네트워크 오류가 발생했습니다.' });
  }

  const tossData = await tossRes.json();

  if (!tossRes.ok) {
    console.error('[PAYMENT] Toss API error:', tossData.code, tossData.message);
    return res.status(400).json({
      error: tossData.message || '결제 승인에 실패했습니다.',
      code: tossData.code,
    });
  }

  // 4. 결제 성공 → DB에 기록 + 크레딧 지급
  const sql = getDb();

  try {
    // 결제 기록 저장
    await sql`INSERT INTO credit_ledger (user_email, amount, type, reason)
      VALUES (${email}, ${credits}, ${'purchase'}, ${`토스페이먼츠 ${qty}세트 (${orderId})`})`;

    // 크레딧 지급
    await sql`UPDATE users SET credits = credits + ${credits}, updated_at = NOW()
      WHERE email = ${email}`;

    // 현재 잔액 조회
    const [user] = await sql`SELECT credits FROM users WHERE email = ${email}`;

    return res.status(200).json({
      success: true,
      credits: credits,
      totalCredits: user?.credits || credits,
      orderId: tossData.orderId,
      method: tossData.method,
    });
  } catch (err) {
    // 결제는 승인됐지만 DB 오류 — 심각한 상황이므로 상세 로그
    console.error('[PAYMENT] DB error after successful payment:', err.message, {
      email, orderId, paymentKey, amount: numAmount, credits,
    });
    return res.status(500).json({
      error: '결제는 완료되었으나 크레딧 지급 중 오류가 발생했습니다. 고객센터로 문의해주세요.',
      orderId: tossData.orderId,
    });
  }
}
