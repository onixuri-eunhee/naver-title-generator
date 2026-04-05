import { getRedis, extractToken, resolveSessionEmail, setCorsHeaders } from './_helpers.js';

export default async function handler(req, res) {
  setCorsHeaders(res, req);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const token = extractToken(req);
  const email = await resolveSessionEmail(token);
  if (!email) return res.status(401).json({ error: '로그인이 필요합니다.' });

  const redis = getRedis();
  const key = `presets:${email}`;

  try {
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
      const sanitized = presets.slice(0, 5).map(p => ({
        industry: String(p.industry || '').slice(0, 200),
        target: String(p.target || '').slice(0, 200),
        location: String(p.location || '').slice(0, 200),
      }));
      await redis.set(key, sanitized, { ex: 365 * 24 * 60 * 60 });
      return res.status(200).json({ presets: sanitized });
    }
  } catch (e) {
    console.error('[PRESETS] Redis error:', e.message);
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }

  return res.status(405).json({ error: 'GET 또는 PUT만 지원합니다.' });
}
