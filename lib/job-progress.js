/**
 * 숏폼 파이프라인 전 단계에서 공용으로 사용하는 진행 이벤트 버스.
 *
 * 설계 원칙:
 * - 이력(replay)용 list 키: `job:history:{jobId}` (TTL 1시간)
 * - 취소 플래그: `job:cancel:{jobId}` (TTL 1시간)
 * - Upstash Redis REST는 SUBSCRIBE 미지원 → SSE는 short-polling으로 tail 읽기
 * - publish는 그냥 rpush + expire 로 구현 (REST 최적화)
 * - 모든 이벤트는 JSON 직렬화
 */
import { getRedis } from '@/lib/api-helpers';
import { CancelledError } from '@/lib/cancelled-error';

const HISTORY_TTL_SEC = 3600;
const CANCEL_TTL_SEC = 3600;
const MAX_HISTORY = 200;

export function historyKey(jobId) {
  return `job:history:${jobId}`;
}
export function cancelKey(jobId) {
  return `job:cancel:${jobId}`;
}

/**
 * 진행 이벤트를 발행한다.
 *
 * @param {string} jobId UUID
 * @param {object} event { type: 'step'|'complete'|'error'|'cancelled', ...payload }
 */
export async function publishProgress(jobId, event) {
  if (!jobId) return;
  const redis = getRedis();
  const payload = JSON.stringify({
    ...event,
    ts: Date.now(),
  });
  try {
    await redis.rpush(historyKey(jobId), payload);
    await redis.expire(historyKey(jobId), HISTORY_TTL_SEC);
    // 히스토리 길이 제한 (안전장치)
    await redis.ltrim(historyKey(jobId), -MAX_HISTORY, -1);
  } catch (err) {
    console.error('[job-progress] publish 실패:', err?.message);
  }
}

/**
 * 히스토리 전체를 순서대로 읽어 반환한다. SSE 재연결 시 replay 용도.
 */
export async function readHistory(jobId) {
  if (!jobId) return [];
  const redis = getRedis();
  try {
    const items = await redis.lrange(historyKey(jobId), 0, -1);
    return items
      .map((s) => {
        if (s && typeof s === 'object') return s;
        try {
          return JSON.parse(s);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch (err) {
    console.error('[job-progress] readHistory 실패:', err?.message);
    return [];
  }
}

/**
 * 히스토리의 특정 offset 이후의 이벤트를 읽어 반환한다. SSE polling 용도.
 */
export async function readHistoryTail(jobId, fromIndex) {
  if (!jobId) return [];
  const redis = getRedis();
  try {
    const items = await redis.lrange(historyKey(jobId), fromIndex, -1);
    return items
      .map((s) => {
        if (s && typeof s === 'object') return s;
        try {
          return JSON.parse(s);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch (err) {
    console.error('[job-progress] readHistoryTail 실패:', err?.message);
    return [];
  }
}

/**
 * 취소 플래그 설정. 라우트 핸들러(/api/shortform-cancel)에서 호출.
 */
export async function requestCancel(jobId) {
  if (!jobId) return false;
  const redis = getRedis();
  try {
    await redis.set(cancelKey(jobId), '1', { ex: CANCEL_TTL_SEC });
    return true;
  } catch (err) {
    console.error('[job-progress] requestCancel 실패:', err?.message);
    return false;
  }
}

/**
 * 파이프라인 내부에서 체크포인트마다 호출.
 * 취소 플래그가 켜져 있으면 CancelledError를 throw.
 */
export async function checkCancelled(jobId, checkpoint) {
  if (!jobId) return;
  const redis = getRedis();
  try {
    const flag = await redis.get(cancelKey(jobId));
    if (flag) {
      throw new CancelledError(jobId, checkpoint);
    }
  } catch (err) {
    if (err instanceof CancelledError) throw err;
    console.error('[job-progress] checkCancelled 실패:', err?.message);
  }
}

/**
 * 작업 종료 시 정리 (cancel 플래그 제거 + 히스토리는 TTL 자연 소멸).
 */
export async function cleanupJob(jobId) {
  if (!jobId) return;
  const redis = getRedis();
  try {
    await redis.del(cancelKey(jobId));
  } catch {}
}

/**
 * 새 jobId 발급. 라우트에서 body.jobId가 없으면 이 함수로 생성.
 */
export function createJobId() {
  return (
    globalThis.crypto?.randomUUID?.() ||
    `job_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
  );
}
