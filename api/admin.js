import { Redis } from '@upstash/redis';
import { resolveAdmin, getClientIp, setCorsHeaders } from './_helpers.js';

let redis;
function getRedis() {
  if (!redis) {
    redis = new Redis({
      url: process.env.KV_REST_API_URL,
      token: process.env.KV_REST_API_TOKEN,
    });
  }
  return redis;
}

export default async function handler(req, res) {
  setCorsHeaders(res, req);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const isAdmin = await resolveAdmin(req);
  if (!isAdmin) {
    return res.status(403).json({ error: '관리자 인증 실패' });
  }

  const ip = getClientIp(req);
  const key = `admin:whitelist:${ip}`;

  // GET: 현재 상태 확인
  if (req.method === 'GET') {
    const whitelisted = await getRedis().get(key);
    return res.status(200).json({ ip, whitelisted: !!whitelisted });
  }

  // POST: 화이트리스트 등록
  if (req.method === 'POST') {
    await getRedis().set(key, '1');
    return res.status(200).json({ ip, whitelisted: true, message: `${ip} 화이트리스트 등록 완료` });
  }

  // DELETE: 화이트리스트 해제
  if (req.method === 'DELETE') {
    await getRedis().del(key);
    return res.status(200).json({ ip, whitelisted: false, message: `${ip} 화이트리스트 해제 완료` });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
