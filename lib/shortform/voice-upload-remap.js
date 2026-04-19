/**
 * Phase F — Scene 시간축 재분배
 *
 * 업로드 오디오의 실제 길이에 맞춰 각 scene의 startTime/duration을 비율 유지로 scale.
 * oldTotalDuration이 0/NaN이면 균등 분배로 fallback.
 */

export function remapScenesToAudio(scenes, oldTotalDuration, newTotalDuration) {
  if (!Array.isArray(scenes) || scenes.length === 0) return [];

  const validOld = Number(oldTotalDuration);
  const newTotal = Number(newTotalDuration);
  if (!Number.isFinite(newTotal) || newTotal <= 0) return scenes.map((s) => ({ ...s }));

  // oldTotalDuration 유효하지 않으면 균등 분배
  if (!Number.isFinite(validOld) || validOld <= 0) {
    const per = newTotal / scenes.length;
    let cursor = 0;
    return scenes.map((scene) => {
      const remapped = { ...scene, startTime: cursor, duration: per };
      cursor += per;
      return remapped;
    });
  }

  const scale = newTotal / validOld;
  let cursor = 0;
  return scenes.map((scene) => {
    const duration = (Number(scene.duration) || 0) * scale;
    const remapped = { ...scene, startTime: cursor, duration };
    cursor += duration;
    return remapped;
  });
}
