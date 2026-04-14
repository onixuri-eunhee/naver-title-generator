'use client';

import styles from './StepProgress.module.css';

/**
 * 다단계 워크플로의 진행 상태를 시각적으로 표시.
 *
 * Props:
 * - steps: Array<{ id: string|number, label: string }>
 * - currentStep: number (1-indexed)
 * - completedSteps: number[] (완료된 step id 배열)
 * - onStepClick: (stepId) => void  // 클릭으로 이동 가능 (옵션, 완료된 step만)
 */
export default function StepProgress({ steps, currentStep, completedSteps = [], onStepClick }) {
  return (
    <div className={styles.root}>
      <ol className={styles.list}>
        {steps.map((step, index) => {
          const stepNum = index + 1;
          const isActive = stepNum === currentStep;
          const isCompleted = completedSteps.includes(stepNum);
          const isClickable = isCompleted && typeof onStepClick === 'function';

          return (
            <li
              key={step.id}
              className={`${styles.item} ${isActive ? styles.itemActive : ''} ${isCompleted ? styles.itemCompleted : ''}`}
            >
              <button
                type="button"
                className={styles.btn}
                disabled={!isClickable}
                onClick={() => isClickable && onStepClick(stepNum)}
                aria-current={isActive ? 'step' : undefined}
              >
                <span className={styles.circle}>
                  {isCompleted ? '✓' : stepNum}
                </span>
                <span className={styles.label}>{step.label}</span>
              </button>
              {index < steps.length - 1 && (
                <span className={`${styles.connector} ${isCompleted ? styles.connectorDone : ''}`} />
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
