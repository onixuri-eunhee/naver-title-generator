/**
 * GET /api/internal/scene-timing-stats — MIN guard 빈도 측정.
 *
 * Phase A-bis Worker #3. Spec §4.8 / §7.11.
 *
 * 매주 수요일 본인이 수동 호출하는 관리자 전용 엔드포인트. Phase F 진입 시
 * 슬랙/이메일 자동화로 진화할 수 있으나 현재는 단순 GET 한 번으로 충분.
 *
 * 합격 기준: min_guard_rate ≤ 0.10.
 * 초과 시 조치: SYSTEM_PROMPT "1.0초 이상 발화" 강화 또는
 *               SUBTITLE_LEAD_FRAMES 4f로 축소.
 */

import { getDb } from '@/lib/db';
import {
  resolveAdmin,
  jsonResponse,
  handleOptions,
} from '@/lib/api-helpers';

const DEFAULT_DAYS = 7;
const MIN_DAYS = 1;
const MAX_DAYS = 90;
const THRESHOLD = 0.10;

export async function OPTIONS(request) {
  return handleOptions(request);
}

export async function GET(request) {
  const isAdmin = await resolveAdmin(request);
  if (!isAdmin) {
    return jsonResponse(request, { error: '관리자 인증 실패' }, { status: 403 });
  }

  const url = new URL(request.url);
  const daysParam = Number(url.searchParams.get('days') || DEFAULT_DAYS);
  const days = Number.isFinite(daysParam)
    ? Math.min(Math.max(Math.round(daysParam), MIN_DAYS), MAX_DAYS)
    : DEFAULT_DAYS;

  try {
    const sql = getDb();

    // scene_timing_events는 Worker #3의 lib/shortform/scene-timing.js가 lazy CREATE한다.
    // 테이블이 아직 없을 수 있으니 존재 여부부터 확인.
    const [exists] = await sql`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'scene_timing_events'
      ) AS ok
    `;

    if (!exists?.ok) {
      return jsonResponse(request, {
        total_scripts: 0,
        min_guard_engaged_count: 0,
        min_guard_rate: 0,
        threshold: THRESHOLD,
        alert: false,
        suggested_action: null,
        note: 'scene_timing_events table not yet created — no data',
        days,
      });
    }

    const [row] = await sql`
      SELECT
        COUNT(*)::int AS total_scripts,
        COUNT(*) FILTER (WHERE min_guard = true)::int AS min_guard_engaged_count
      FROM scene_timing_events
      WHERE event_type = 'scene_timing'
        AND created_at > now() - (${days} || ' days')::interval
    `;

    const total = Number(row?.total_scripts || 0);
    const engaged = Number(row?.min_guard_engaged_count || 0);
    const rate = total > 0 ? engaged / total : 0;
    const alert = rate > THRESHOLD;

    return jsonResponse(request, {
      total_scripts: total,
      min_guard_engaged_count: engaged,
      min_guard_rate: Number(rate.toFixed(4)),
      threshold: THRESHOLD,
      alert,
      suggested_action: alert
        ? 'Reduce SUBTITLE_LEAD_FRAMES to 4f or strengthen 1.0초 guidance in SYSTEM_PROMPT'
        : null,
      days,
    });
  } catch (err) {
    console.error('[scene-timing-stats] query failed:', err?.message);
    return jsonResponse(
      request,
      { error: '통계 조회에 실패했습니다.', details: err?.message || 'unknown' },
      { status: 500 },
    );
  }
}
