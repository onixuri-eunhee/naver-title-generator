-- Phase A-bis DB 마이그레이션
-- 실행: node --env-file=.env.local scripts/init-db.js (또는 Neon console에서 직접)
--
-- 3 테이블: charge_log + refund_log + scene_timing_events
-- credit-service.js와 scene-timing.js에서 lazy CREATE IF NOT EXISTS로도 생성되지만,
-- 이 파일은 명시적 마이그레이션 기록용.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. charge_log — 크레딧 차감 이력 (idempotency)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS charge_log (
  request_id UUID PRIMARY KEY,
  user_id TEXT NOT NULL,
  amount NUMERIC(6, 2) NOT NULL,
  phase TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_charge_log_user_id ON charge_log (user_id);
CREATE INDEX IF NOT EXISTS idx_charge_log_created_at ON charge_log (created_at);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. refund_log — 크레딧 환불 이력 (idempotency)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS refund_log (
  request_id UUID PRIMARY KEY,
  user_id TEXT NOT NULL,
  amount NUMERIC(6, 2) NOT NULL,
  refund_reason TEXT NOT NULL,
  phase TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_refund_log_user_id ON refund_log (user_id);
CREATE INDEX IF NOT EXISTS idx_refund_log_refund_reason ON refund_log (refund_reason);
CREATE INDEX IF NOT EXISTS idx_refund_log_created_at ON refund_log (created_at);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. scene_timing_events — MIN guard 발동 빈도 측정
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS scene_timing_events (
  id BIGSERIAL PRIMARY KEY,
  event_type TEXT NOT NULL,
  min_guard BOOLEAN NOT NULL DEFAULT false,
  original_first_frames INTEGER NOT NULL,
  adjusted_first_frames INTEGER NOT NULL,
  scene_count INTEGER NOT NULL,
  meta JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_scene_timing_events_min_guard ON scene_timing_events (min_guard);
CREATE INDEX IF NOT EXISTS idx_scene_timing_events_created_at ON scene_timing_events (created_at);

-- ─────────────────────────────────────────────────────────────────────────────
-- 집계 뷰 (선택) — /api/internal/scene-timing-stats 의 SQL 기반
-- ─────────────────────────────────────────────────────────────────────────────

-- MIN guard 발동률 (최근 7일)
-- SELECT
--   COUNT(*) FILTER (WHERE min_guard = true) AS min_guard_count,
--   COUNT(*) AS total,
--   ROUND(COUNT(*) FILTER (WHERE min_guard = true)::numeric / NULLIF(COUNT(*), 0), 4) AS rate
-- FROM scene_timing_events
-- WHERE created_at > now() - INTERVAL '7 days';
