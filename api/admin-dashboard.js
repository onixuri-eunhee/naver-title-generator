/**
 * 어드민 대시보드 API (관리자 전용)
 * GET /api/admin-dashboard?action=stats|users|logs
 */
import { getDb } from './_db.js';
import { resolveAdmin, setCorsHeaders } from './_helpers.js';

export default async function handler(req, res) {
  setCorsHeaders(res, req);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const isAdmin = await resolveAdmin(req);
  if (!isAdmin) return res.status(403).json({ error: '관리자 인증 실패' });

  const action = req.query.action || 'stats';
  const sql = getDb();

  try {
    if (action === 'stats') {
      // 요약 통계
      const [totalUsers] = await sql`SELECT COUNT(*) as count FROM users`;
      const [todaySignups] = await sql`SELECT COUNT(*) as count FROM users WHERE created_at >= CURRENT_DATE`;
      const [todayUsage] = await sql`SELECT COUNT(*) as count FROM usage_logs WHERE created_at >= CURRENT_DATE`;
      const [weeklyActive] = await sql`SELECT COUNT(DISTINCT user_email) as count FROM usage_logs WHERE created_at >= NOW() - INTERVAL '7 days' AND user_email IS NOT NULL`;

      // 일별 가입 추이 (30일)
      const signupTrend = await sql`
        SELECT DATE(created_at) as date, COUNT(*) as count
        FROM users
        WHERE created_at >= NOW() - INTERVAL '30 days'
        GROUP BY DATE(created_at)
        ORDER BY date`;

      // 도구별 사용량 (30일)
      const toolUsage = await sql`
        SELECT tool, COUNT(*) as count
        FROM usage_logs
        WHERE created_at >= NOW() - INTERVAL '30 days'
        GROUP BY tool
        ORDER BY count DESC`;

      // 일별 사용량 추이 (30일)
      const usageTrend = await sql`
        SELECT DATE(created_at) as date, COUNT(*) as count
        FROM usage_logs
        WHERE created_at >= NOW() - INTERVAL '30 days'
        GROUP BY DATE(created_at)
        ORDER BY date`;

      return res.status(200).json({
        summary: {
          totalUsers: Number(totalUsers.count),
          todaySignups: Number(todaySignups.count),
          todayUsage: Number(todayUsage.count),
          weeklyActive: Number(weeklyActive.count),
        },
        signupTrend,
        toolUsage,
        usageTrend,
      });
    }

    if (action === 'users') {
      const page = Math.max(1, parseInt(req.query.page) || 1);
      const limit = Math.min(50, parseInt(req.query.limit) || 20);
      const offset = (page - 1) * limit;
      const search = req.query.search || '';

      let users, total;
      if (search) {
        users = await sql`
          SELECT id, email, name,
            CASE WHEN phone IS NOT NULL THEN CONCAT(LEFT(phone, 3), '-****-', RIGHT(phone, 4)) ELSE NULL END as phone,
            credits, created_at
          FROM users
          WHERE email ILIKE ${'%' + search + '%'} OR name ILIKE ${'%' + search + '%'}
          ORDER BY created_at DESC
          LIMIT ${limit} OFFSET ${offset}`;
        [total] = await sql`SELECT COUNT(*) as count FROM users WHERE email ILIKE ${'%' + search + '%'} OR name ILIKE ${'%' + search + '%'}`;
      } else {
        users = await sql`
          SELECT id, email, name,
            CASE WHEN phone IS NOT NULL THEN CONCAT(LEFT(phone, 3), '-****-', RIGHT(phone, 4)) ELSE NULL END as phone,
            credits, created_at
          FROM users
          ORDER BY created_at DESC
          LIMIT ${limit} OFFSET ${offset}`;
        [total] = await sql`SELECT COUNT(*) as count FROM users`;
      }

      return res.status(200).json({
        users,
        pagination: { page, limit, total: Number(total.count), pages: Math.ceil(Number(total.count) / limit) },
      });
    }

    if (action === 'logs') {
      const limit = Math.min(100, parseInt(req.query.limit) || 50);
      const logs = await sql`
        SELECT id, user_email, tool, mode, ip, created_at
        FROM usage_logs
        ORDER BY created_at DESC
        LIMIT ${limit}`;

      return res.status(200).json({ logs });
    }

    return res.status(400).json({ error: 'Invalid action. Use: stats, users, logs' });
  } catch (err) {
    console.error('[ADMIN-DASHBOARD] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
