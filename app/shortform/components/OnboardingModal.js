'use client';

import { SAMPLES } from '@/lib/shortform-samples';
import styles from './OnboardingModal.module.css';

/**
 * 첫 방문 시 노출되는 온보딩 모달.
 *
 * Props:
 * - open: boolean
 * - onSelectSample: (sampleId) => void  // 샘플 선택 시 호출
 * - onSkip: () => void                  // "직접 입력하기" 선택 시
 */
export default function OnboardingModal({ open, onSelectSample, onSkip }) {
  if (!open) return null;

  return (
    <div className={styles.backdrop}>
      <div className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="onboard-title">
        <div className={styles.header}>
          <div id="onboard-title" className={styles.title}>처음 사용하시나요?</div>
          <div className={styles.subtitle}>
            60초 만에 첫 영상을 만들어보세요. 첫 1편은 무료에요.
          </div>
        </div>

        <div className={styles.grid}>
          {SAMPLES.map((sample) => (
            <button
              key={sample.id}
              type="button"
              className={styles.card}
              onClick={() => onSelectSample(sample.id)}
            >
              <div className={styles.cardBadge}>{sample.industry}</div>
              <div className={styles.cardTitle}>{sample.industrySub}</div>
              <div className={styles.cardDesc}>
                {sample.userExperience.length > 60
                  ? sample.userExperience.slice(0, 60) + '...'
                  : sample.userExperience}
              </div>
              <div className={styles.cardMeta}>
                {sample.durationSec}초 · {sample.tone === 'casual' ? '친근한 친구' : '전문가'}
              </div>
              <div className={styles.cardCta}>이 샘플로 시작 →</div>
            </button>
          ))}
        </div>

        <button type="button" className={styles.skipBtn} onClick={onSkip}>
          직접 입력하기 (스킵)
        </button>
      </div>
    </div>
  );
}
