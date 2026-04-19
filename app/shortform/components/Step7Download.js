'use client';

import { useState } from 'react';
import styles from './Step7Download.module.css';

/**
 * Step 7: 렌더링 + 다운로드
 *
 * Props:
 * - videoUrl: string | null — 렌더링 완료 후 R2 CDN URL
 * - captionInstagram: string — 인스타 릴스 업로드용 캡션
 * - captionYouTube: string — 유튜브 숏츠 업로드용 설명 (#Shorts 포함)
 * - onRender: () => void — 렌더링 시작 트리거
 * - renderStatus: 'idle' | 'rendering' | 'complete' | 'error'
 * - renderError: string | null
 * - onBack: () => void
 * - onReset: () => void — 새 영상 만들기
 */
export default function Step7Download({
  videoUrl,
  captionInstagram = '',
  captionYouTube = '',
  onRender,
  renderStatus = 'idle',
  renderError,
  onBack,
  onReset,
}) {
  const [copiedKey, setCopiedKey] = useState(null);

  async function copyCaption(key, text) {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 1600);
    } catch (_) {
      // 클립보드 권한 거절 등 — 조용히 무시
    }
  }
  return (
    <div className={styles.root}>
      <div className={styles.intro}>
        <h2 className={styles.title}>영상 다운로드</h2>
        <p className={styles.description}>
          고화질 영상을 렌더링하고 다운로드하세요.
        </p>
      </div>

      <div className={styles.content}>
        {/* idle: 렌더링 시작 버튼 */}
        {renderStatus === 'idle' && (
          <div className={styles.idleBox}>
            <div className={styles.iconCircle}>
              <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
                <path
                  d="M24 4L24 32M24 32L16 24M24 32L32 24"
                  stroke="var(--ds-accent, #ff5f1f)"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M8 36V40C8 41.1046 8.89543 42 10 42H38C39.1046 42 40 41.1046 40 40V36"
                  stroke="var(--ds-accent, #ff5f1f)"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            <p className={styles.idleText}>
              미리보기에서 확인한 영상을 고화질로 렌더링합니다.
            </p>
            <button type="button" className={styles.renderBtn} onClick={onRender}>
              영상 렌더링
            </button>
          </div>
        )}

        {/* rendering: 진행 중 */}
        {renderStatus === 'rendering' && (
          <div className={styles.renderingBox}>
            <div className={styles.spinnerWrap}>
              <div className={styles.spinner} />
            </div>
            <p className={styles.renderingText}>렌더링 중...</p>
            <p className={styles.renderingHint}>
              최대 5분 정도 소요될 수 있어요. 이 페이지를 닫지 마세요.
            </p>
            <div className={styles.progressTrack}>
              <div className={styles.progressBar} />
            </div>
          </div>
        )}

        {/* complete: 다운로드 */}
        {renderStatus === 'complete' && videoUrl && (
          <div className={styles.completeBox}>
            <div className={styles.videoWrap}>
              <video
                src={videoUrl}
                controls
                playsInline
                className={styles.video}
              />
            </div>
            <div className={styles.actionRow}>
              <a
                href={videoUrl}
                download="shortform.mp4"
                className={styles.downloadBtn}
              >
                다운로드
              </a>
              <button
                type="button"
                className={styles.resetBtn}
                onClick={onReset}
              >
                새 영상 만들기
              </button>
            </div>

            {(captionInstagram || captionYouTube) && (
              <div className={styles.captionSection}>
                <h3 className={styles.captionSectionTitle}>업로드용 캡션</h3>
                <p className={styles.captionSectionHint}>
                  플랫폼별로 최적화된 캡션이에요. 복사해서 그대로 붙여넣으세요.
                </p>

                {captionInstagram && (
                  <div className={styles.captionBox}>
                    <div className={styles.captionHeader}>
                      <span className={styles.captionLabel}>인스타그램 릴스</span>
                      <button
                        type="button"
                        className={styles.captionCopyBtn}
                        onClick={() => copyCaption('instagram', captionInstagram)}
                      >
                        {copiedKey === 'instagram' ? '복사됨 ✓' : '복사'}
                      </button>
                    </div>
                    <pre className={styles.captionText}>{captionInstagram}</pre>
                  </div>
                )}

                {captionYouTube && (
                  <div className={styles.captionBox}>
                    <div className={styles.captionHeader}>
                      <span className={styles.captionLabel}>유튜브 숏츠</span>
                      <button
                        type="button"
                        className={styles.captionCopyBtn}
                        onClick={() => copyCaption('youtube', captionYouTube)}
                      >
                        {copiedKey === 'youtube' ? '복사됨 ✓' : '복사'}
                      </button>
                    </div>
                    <pre className={styles.captionText}>{captionYouTube}</pre>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* error */}
        {renderStatus === 'error' && (
          <div className={styles.errorBox}>
            <p className={styles.errorText}>
              {renderError || '렌더링에 실패했습니다.'}
            </p>
            <button type="button" className={styles.retryBtn} onClick={onRender}>
              다시 시도
            </button>
          </div>
        )}
      </div>

      {/* 하단 네비게이션 */}
      <div className={styles.navRow}>
        {onBack && (
          <button type="button" className={styles.backBtn} onClick={onBack}>
            &larr; 이전
          </button>
        )}
      </div>
    </div>
  );
}
