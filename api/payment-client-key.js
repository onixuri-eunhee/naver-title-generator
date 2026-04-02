/** 토스 클라이언트 키 전달 (공개 키이므로 프론트엔드에서 사용 가능) */
import { setCorsHeaders } from './_helpers.js';

export default function handler(req, res) {
  setCorsHeaders(res, req);
  if (req.method === 'OPTIONS') return res.status(200).end();
  res.status(200).json({ clientKey: process.env.TOSS_CLIENT_KEY || '' });
}
