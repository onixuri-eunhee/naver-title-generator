// lib/shortform/tail-padding.js
//
// 마지막 씬 padding 프레임 수를 계산.
// 실 audio duration과 charAlignment 기반 발화 종료 시간의 차이(=MP3 silent tail)를
// 측정해서 padding을 그 값에 맞춤. 측정값이 없으면 보수적 고정값 반환.
//
// 배경: ElevenLabs는 발화 끝 후에도 MP3 파일에 ~1~2초 quiet buffer를 남김.
// charAlignment.ends[last]는 발화 끝 시점이라 실 mp3 duration보다 짧음.
// 고정 90f 패딩은 30초 영상에서 12% 드리프트처럼 보임 — 실측 기반으로 전환.

export const FALLBACK_TAIL_PADDING_FRAMES = 90; // 기존 고정값, 측정 실패 시 안전망
export const MIN_TAIL_PADDING_FRAMES = 9;       // 약 0.3s @ 30fps
export const SAFETY_BUFFER_SEC = 0.3;

/**
 * @param {{ audioRealDurationSec?: number|null, charEndSec?: number|null, fps: number }} opts
 * @returns {number} 마지막 씬에 추가할 프레임 수
 */
export function computeTailPadding({ audioRealDurationSec, charEndSec, fps }) {
  if (!fps || typeof fps !== 'number') {
    throw new Error('[tail-padding] fps is required');
  }
  if (Number.isFinite(audioRealDurationSec) && audioRealDurationSec > 0) {
    // scene timing이 audioRealDurationSec 까지 포함하므로 safety margin만 추가.
    const frames = Math.ceil(SAFETY_BUFFER_SEC * fps);
    return Math.max(frames, MIN_TAIL_PADDING_FRAMES);
  }
  // audioRealDurationSec 없으면 scene timing은 charEnd까지만 계산됨 → 보수적 FALLBACK.
  return FALLBACK_TAIL_PADDING_FRAMES;
}
