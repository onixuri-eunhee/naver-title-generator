// lib/shortform/inactivity-detector.js
//
// useJobProgress 훅이 호출하는 순수 inactivity 판정 함수.
// 3분간 step/complete/error 이벤트 없으면 렌더 서버 무응답으로 간주.

export const INACTIVITY_THRESHOLD_MS = 3 * 60 * 1000;

export function isInactive({ status, lastEventTs, now }) {
  if (status !== 'running') return false;
  if (lastEventTs == null) return false;
  return now - lastEventTs > INACTIVITY_THRESHOLD_MS;
}
