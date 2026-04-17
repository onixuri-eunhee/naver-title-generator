/**
 * LottieOverlay — layoutType에 따라 Lottie 애니메이션을 자동 오버레이.
 * public/lottie/ 폴더의 JSON 파일을 런타임에 fetch.
 */
import { useEffect, useState } from 'react';
import { AbsoluteFill } from 'remotion';
import { Lottie } from '@remotion/lottie';

const LOTTIE_MAP = {
  'counter': '/lottie/sparkle.json',
  'number-slam': '/lottie/sparkle.json',
};

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

  return (
    <AbsoluteFill
      style={{
        pointerEvents: 'none',
        zIndex: 10,
        ...style,
      }}
    >
      <Lottie animationData={animationData} />
    </AbsoluteFill>
  );
};
