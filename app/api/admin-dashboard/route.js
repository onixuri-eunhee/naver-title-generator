import { resolveAdmin, jsonResponse, handleOptions } from '@/lib/api-helpers';
import { getDb } from '@/lib/db';

function getQuery(request, key) {
  return new URL(request.url).searchParams.get(key);
}

async function requireAdmin(request) {
  const isAdmin = await resolveAdmin(request);
  if (!isAdmin) {
    return { error: jsonResponse(request, { error: '관리자 인증 실패' }, { status: 403 }) };
  }
  return { isAdmin: true };
}

async function runAction(request, action, body) {
  const sql = getDb();

  if (action === 'stats') {
    const [totalUsers] = await sql`SELECT COUNT(*) as count FROM users`;
    const [todaySignups] = await sql`SELECT COUNT(*) as count FROM users WHERE created_at >= CURRENT_DATE`;
    const [todayUsage] = await sql`SELECT COUNT(*) as count FROM usage_logs WHERE created_at >= CURRENT_DATE`;
    const [weeklyActive] = await sql`SELECT COUNT(DISTINCT user_email) as count FROM usage_logs WHERE created_at >= NOW() - INTERVAL '7 days' AND user_email IS NOT NULL`;

    const signupTrend = await sql`
      SELECT DATE(created_at) as date, COUNT(*) as count
      FROM users
      WHERE created_at >= NOW() - INTERVAL '30 days'
      GROUP BY DATE(created_at)
      ORDER BY date`;

    const toolUsage = await sql`
      SELECT tool, COUNT(*) as count
      FROM usage_logs
      WHERE created_at >= NOW() - INTERVAL '30 days'
      GROUP BY tool
      ORDER BY count DESC`;

    const usageTrend = await sql`
      SELECT DATE(created_at) as date, COUNT(*) as count
      FROM usage_logs
      WHERE created_at >= NOW() - INTERVAL '30 days'
      GROUP BY DATE(created_at)
      ORDER BY date`;

    return jsonResponse(request, {
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
    const page = Math.max(1, parseInt(getQuery(request, 'page')) || 1);
    const limit = Math.min(50, parseInt(getQuery(request, 'limit')) || 20);
    const offset = (page - 1) * limit;
    const search = getQuery(request, 'search') || '';

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

    return jsonResponse(request, {
      users,
      pagination: { page, limit, total: Number(total.count), pages: Math.ceil(Number(total.count) / limit) },
    });
  }

  if (action === 'credit') {
    const { email, delta } = body || {};
    if (!email || typeof delta !== 'number' || delta === 0) {
      return jsonResponse(request, { error: 'email과 delta(숫자)가 필요합니다.' }, { status: 400 });
    }
    if (Math.abs(delta) > 9999) {
      return jsonResponse(request, { error: '한 번에 최대 9999 크레딧까지 조정 가능합니다.' }, { status: 400 });
    }
    const [user] = await sql`SELECT credits FROM users WHERE email = ${email}`;
    if (!user) return jsonResponse(request, { error: '해당 사용자를 찾을 수 없습니다.' }, { status: 404 });
    const newCredits = Math.max(0, Number(user.credits) + delta);
    await sql`UPDATE users SET credits = ${newCredits} WHERE email = ${email}`;
    return jsonResponse(request, { email, delta, newCredits });
  }

  if (action === 'logs') {
    const limit = Math.min(100, parseInt(getQuery(request, 'limit')) || 50);
    const logs = await sql`
      SELECT id, user_email, tool, mode, ip, created_at
      FROM usage_logs
      ORDER BY created_at DESC
      LIMIT ${limit}`;

    return jsonResponse(request, { logs });
  }

  return jsonResponse(request, { error: 'Invalid action. Use: stats, users, logs' }, { status: 400 });
}

export async function OPTIONS(request) {
  return handleOptions(request);
}

export async function GET(request) {
  const auth = await requireAdmin(request);
  if (auth.error) return auth.error;
  const action = getQuery(request, 'action') || 'stats';
  try {
    return await runAction(request, action, null);
  } catch (err) {
    console.error('[ADMIN-DASHBOARD] Error:', err.message);
    return jsonResponse(request, { error: '서버 오류가 발생했습니다.' }, { status: 500 });
  }
}

export async function POST(request) {
  const auth = await requireAdmin(request);
  if (auth.error) return auth.error;
  const action = getQuery(request, 'action') || 'stats';
  const body = await request.json().catch(() => ({}));
  try {
    return await runAction(request, action, body);
  } catch (err) {
    console.error('[ADMIN-DASHBOARD] Error:', err.message);
    return jsonResponse(request, { error: '서버 오류가 발생했습니다.' }, { status: 500 });
  }
}
