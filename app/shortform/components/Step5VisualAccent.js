'use client';

import { useState } from 'react';
import ImagePickerModal from '@/components/ImagePickerModal';
import styles from './Step5VisualAccent.module.css';

const MAX_USER_PHOTOS = 3;

/**
 * Step 5 — 비주얼 액센트
 *
 * 메인 영상은 키네틱 타이포로 자동 생성되고, 사용자는 액센트로
 * 내 사진 0~3장 + AI 이미지 0~2장을 얹을 수 있다.
 *
 * Props:
 * - value: { userPhotos: Array<{image, crop}>, aiImageCount: 0|1|2, aiImages: string[] }
 * - onChange: (nextValue) => void
 * - onGenerateAI: (count) => Promise<string[]>  // blog-image-pro 호출
 * - aiStatus: 'idle' | 'busy' | 'done' | 'error'
 * - onNext: () => void
 * - onBack?: () => void
 */
export default function Step5VisualAccent({
  value,
  onChange,
  onGenerateAI,
  aiStatus = 'idle',
  onNext,
  onBack,
}) {
  const [pickerOpen, setPickerOpen] = useState(false);

  const userPhotos = value?.userPhotos || [];
  const aiImageCount = value?.aiImageCount ?? 1;
  const aiImages = value?.aiImages || [];

  function addUserPhoto(payload) {
    if (userPhotos.length >= MAX_USER_PHOTOS) return;
    onChange({
      ...value,
      userPhotos: [...userPhotos, payload],
    });
  }

  function removeUserPhoto(idx) {
    const next = userPhotos.filter((_, i) => i !== idx);
    onChange({ ...value, userPhotos: next });
  }

  function setAiCount(count) {
    onChange({ ...value, aiImageCount: count });
  }

  async function handleGenerateAI() {
    if (aiImageCount === 0) return;
    try {
      const urls = await onGenerateAI(aiImageCount);
      if (Array.isArray(urls) && urls.length > 0) {
        onChange({ ...value, aiImages: urls });
      }
    } catch (_) {
      // 에러는 부모에서 상태로 표시
    }
  }

  const photoSlotCount = MAX_USER_PHOTOS;

  return (
    <div className={styles.root}>
      <div className={styles.intro}>
        <h2 className={styles.title}>비주얼 액센트</h2>
        <p className={styles.description}>
          메인 영상은 키네틱 타이포로 만들어져요.<br />
          핵심 순간에만 사진 1~2장을 얹으면 결과물이 한 단계 올라갑니다.
          <br /><span className={styles.hint}>(없어도 괜찮아요 — 그냥 다음으로 넘어가셔도 돼요)</span>
        </p>
      </div>

      {/* 내 사진 섹션 */}
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h3 className={styles.sectionTitle}>
            내 사진 <span className={styles.counter}>{userPhotos.length}/{MAX_USER_PHOTOS}장</span>
          </h3>
          <p className={styles.sectionHint}>
            추천: 매장 사진, 본인 사진, 메뉴/상품 사진
          </p>
        </div>

        <div className={styles.photoGrid}>
          {Array.from({ length: photoSlotCount }).map((_, i) => {
            const photo = userPhotos[i];
            if (photo) {
              return (
                <div key={i} className={styles.photoTile}>
                  <img src={photo.image?.public_url} alt={photo.image?.filename || ''} />
                  <button
                    type="button"
                    className={styles.removeBtn}
                    onClick={() => removeUserPhoto(i)}
                    aria-label="삭제"
                  >×</button>
                </div>
              );
            }
            return (
              <button
                key={i}
                type="button"
                className={styles.addSlot}
                onClick={() => setPickerOpen(true)}
                disabled={userPhotos.length >= MAX_USER_PHOTOS}
              >
                <span className={styles.addIcon}>+</span>
                <span className={styles.addLabel}>사진 선택</span>
              </button>
            );
          })}
        </div>

        {userPhotos.length === 0 && (
          <div className={styles.emptyNote}>
            사진이 없어도 괜찮아요. AI 이미지만으로도 충분히 영상이 만들어져요.
          </div>
        )}
      </section>

      {/* AI 이미지 섹션 */}
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h3 className={styles.sectionTitle}>AI 이미지 (자동 생성)</h3>
          <p className={styles.sectionHint}>
            사진이 없거나 부족할 때 주제에 맞는 이미지를 자동으로 그려드려요. 기본값 1장 권장.
          </p>
        </div>

        <div className={styles.radioRow}>
          {[
            { value: 0, label: '사용 안 함', meta: '' },
            { value: 1, label: '1장 생성', meta: '3 크레딧' },
            { value: 2, label: '2장 생성', meta: '6 크레딧' },
          ].map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={`${styles.radioBtn} ${aiImageCount === opt.value ? styles.radioBtnActive : ''}`}
              onClick={() => setAiCount(opt.value)}
            >
              <span className={styles.radioDot} />
              <span className={styles.radioLabel}>{opt.label}</span>
              {opt.meta && <span className={styles.radioMeta}>{opt.meta}</span>}
            </button>
          ))}
        </div>

        {aiImageCount > 0 && aiImages.length === 0 && (
          <button
            type="button"
            className={styles.generateBtn}
            onClick={handleGenerateAI}
            disabled={aiStatus === 'busy'}
          >
            {aiStatus === 'busy' ? 'AI 이미지 생성 중...' : `AI 이미지 ${aiImageCount}장 생성하기`}
          </button>
        )}

        {aiImages.length > 0 && (
          <div className={styles.aiPreviewRow}>
            {aiImages.map((url, i) => (
              <div key={i} className={styles.aiPreviewTile}>
                <img src={url} alt={`AI 이미지 ${i + 1}`} />
              </div>
            ))}
            <button
              type="button"
              className={styles.regenerateBtn}
              onClick={() => onChange({ ...value, aiImages: [] })}
            >
              다시 생성
            </button>
          </div>
        )}
      </section>

      {/* 네비게이션 */}
      <div className={styles.navRow}>
        {onBack && (
          <button type="button" className={styles.backBtn} onClick={onBack}>
            ← 이전
          </button>
        )}
        <button type="button" className={styles.nextBtn} onClick={onNext}>
          다음: 미리보기 →
        </button>
      </div>

      <ImagePickerModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        modeOptions={['content']}
        showModeSelector={false}
        defaultMode="content"
        aspectRatio={9 / 16}
        onSelect={({ image, crop }) => {
          addUserPhoto({ image, crop });
          setPickerOpen(false);
        }}
      />
    </div>
  );
}
