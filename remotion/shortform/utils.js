/**
 * my-video 포팅판 유틸리티
 */

// 미세한 호흡 효과 (90프레임 주기)
export const breathe = (frame) =>
  1 + 0.006 - 0.006 * Math.cos((2 * Math.PI * frame) / 90);

// 결정적 난수 (같은 seed → 같은 값)
export const seededRand = (i, salt) => {
  const v = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
  return v - Math.floor(v);
};
