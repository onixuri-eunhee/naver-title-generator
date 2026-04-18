/**
 * LottieOverlay — layoutType에 따라 Lottie 애니메이션을 자동 오버레이.
 * public/lottie/ 폴더의 JSON 파일을 런타임에 fetch.
 */
import { useEffect, useState } from 'react';
import { AbsoluteFill } from 'remotion';
import { Lottie } from '@remotion/lottie';

// Phase 2 (2026-04-18): counter/number-slam의 sparkle.json 제거.
// SparkleOverlay(작은 다이아 파티클)와 중복이었고, Lottie가 전체 프레임을
// 덮어 숫자를 가리는 문제 발생. SparkleOverlay가 같은 역할을 더 깔끔하게 수행.
const LOTTIE_MAP = {};

const CTA_LOTTIE = '/lottie/confetti.json';

export const LottieOverlay = ({ layoutType, section, style }) => {
  const [animationData, setAnimationData] = useState(null);

  const url = section === 'cta'
    ? CTA_LOTTIE
    : LOTTIE_MAP[layoutType] || null;

  useEffect(() => {
    if (!url) return;
    fetch(url)
      .then((r) => r.json())
      .then(setAnimationData)
      .catch(() => {});
  }, [url]);

  if (!animationData) return null;

  // Phase 2 (2026-04-18): sparkle은 숫자 뒤 배경 장식으로만. 전면 덮기 금지.
  // counter/number-slam일 땐 투명도 낮추고 콘텐츠 뒤로(z-index: 0).
  // confetti는 CTA 축하용이라 기존대로 z-index 10 유지.
  const isSparkle = layoutType === 'counter' || layoutType === 'number-slam';
  const overlayStyle = isSparkle
    ? { pointerEvents: 'none', zIndex: 0, opacity: 0.35, ...style }
    : { pointerEvents: 'none', zIndex: 10, ...style };

  return (
    <AbsoluteFill style={overlayStyle}>
      <Lottie animationData={animationData} />
    </AbsoluteFill>
  );
};
