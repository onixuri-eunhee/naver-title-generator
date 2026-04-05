import { getRedis, extractToken, resolveSessionEmail, setCorsHeaders } from './_helpers.js';

export default async function handler(req, res) {
  setCorsHeaders(res, req);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const token = extractToken(req);
  const email = await resolveSessionEmail(token);
  if (!email) return res.status(401).json({ error: '로그인이 필요합니다.' });

  const redis = getRedis();
  const key = `presets:${email}`;

  // GET: 프리셋 조회
  if (req.method === 'GET') {
    const raw = await redis.get(key);
    const presets = Array.isArray(raw) ? raw : [];
    return res.status(200).json({ presets });
  }

  // PUT: 프리셋 저장 (전체 교체)
  if (req.method === 'PUT') {
    const presets = req.body?.presets;
    if (!Array.isArray(presets)) return res.status(400).json({ error: '올바른 형식이 아닙니다.' });
    if (presets.length > 5) return res.status(400).json({ error: '프리셋은 최대 5개까지 저장할 수 있습니다.' });
    await redis.set(key, JSON.stringify(presets));
    return res.status(200).json({ presets });
  }

  return res.status(405).json({ error: 'GET 또는 PUT만 지원합니다.' });
}
