'use client';

import styles from './ProgressIndicator.module.css';

const STEP_LABELS = {
  'keyword-extraction': '키워드 추출',
  'youtube-search': '후보 영상 검색',
  'video-analysis': '영상 분석',
  'script-generation': '대본 생성',
  'tts-synthesis': '음성 합성',
  'video-render': '영상 렌더',
  'upload-youtube': 'YouTube 업로드',
};

function statusIcon(status) {
  if (status === 'done') return '✓';
  if (status === 'running') return '⏳';
  if (status === 'error') return '✕';
  return '○';
}

/**
 * 단계별 진행 표시 + 취소 버튼.
 *
 * Props:
 * - activeSteps: string[]  // 표시할 step 순서 (파이프라인마다 다름)
 * - progress: { [stepId]: { status, progress, subStep } }
 * - current: 현재 running step
 * - status: 'idle'|'running'|'complete'|'error'|'cancelled'
 * - error: string | null
 * - onCancel: () => void
 */
export default function ProgressIndicator({
  activeSteps = [],
  progress = {},
  current,
  status,
  error,
  onCancel,
}) {
  const isRunning = status === 'running';

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <div className={styles.title}>
          {status === 'complete' && '생성 완료'}
          {status === 'running' && '생성 중...'}
          {status === 'cancelled' && '취소되었습니다'}
          {status === 'error' && '오류가 발생했습니다'}
          {status === 'idle' && '대기 중'}
        </div>
      </div>

      <ol className={styles.list}>
        {activeSteps.map((stepId) => {
          const info = progress[stepId] || { status: 'idle' };
          const isCurrent = stepId === current;
          const label = STEP_LABELS[stepId] || stepId;
          const itemClass = [
            styles.item,
            styles[`item_${info.status || 'idle'}`],
            isCurrent ? styles.itemCurrent : '',
          ]
            .filter(Boolean)
            .join(' ');
          return (
            <li key={stepId} className={itemClass}>
              <span className={styles.icon}>{statusIcon(info.status)}</span>
              <span className={styles.label}>{label}</span>
              {info.subStep && (
                <span className={styles.subStep}>{info.subStep}</span>
              )}
              {info.status === 'running' && typeof info.progress === 'number' && (
                <div className={styles.progressBar}>
                  <div
                    className={styles.progressFill}
                    style={{
                      width: `${Math.max(0, Math.min(100, info.progress))}%`,
                    }}
                  />
                </div>
              )}
            </li>
          );
        })}
      </ol>

      {error && <div className={styles.error}>{error}</div>}

      {isRunning && onCancel && (
        <button type="button" className={styles.cancelBtn} onClick={onCancel}>
          취소
        </button>
      )}
    </div>
  );
}
