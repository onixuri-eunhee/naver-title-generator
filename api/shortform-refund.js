import { setCorsHeaders, extractToken, resolveSessionEmail, getClientIp } from './_helpers.js';
import { refundCredits } from './_db.js';

export const config = { maxDuration: 10 };

const SHORTFORM_CREDIT_COSTS = { 30: 7, 45: 10, 60: 14, 90: 18 };

export default async function handler(req, res) {
  setCorsHeaders(res, req);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const token = extractToken(req);
  const email = await resolveSessionEmail(token);
  if (!email) return res.status(401).json({ error: '로그인이 필요합니다.' });

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
  const targetDurationSec = Number(body.targetDurationSec) || 30;
  const reason = typeof body.reason === 'string' ? body.reason.slice(0, 100) : 'shortform-broll-failure';
  const creditCost = SHORTFORM_CREDIT_COSTS[targetDurationSec] || SHORTFORM_CREDIT_COSTS[30];

  try {
    await refundCredits(email, creditCost, reason);
    return res.status(200).json({ refunded: true, refundedCredits: creditCost });
  } catch (error) {
    console.error('[SHORTFORM-REFUND] error:', error.message);
    return res.status(500).json({ error: '환불 처리 중 오류가 발생했습니다.', refunded: false });
  }
}
