'use client';

import { useEffect, useState } from 'react';
import Cropper from 'react-easy-crop';
import { getToken } from '@/lib/auth';
import styles from './ImagePickerModal.module.css';

const MODE_LABELS = {
  background: '배경',
  content: '콘텐츠',
  cover: '표지',
};

/**
 * Props:
 * - open: boolean
 * - onClose: () => void
 * - onSelect: ({ image, crop, mode }) => void
 * - modeOptions?: Array<'background'|'content'|'cover'>
 * - defaultMode?: string
 * - aspectRatio?: number  (예: 4/5, 9/16)
 * - showModeSelector?: boolean  (기본 true. false면 모드 선택 UI 강제 숨김)
 */
export default function ImagePickerModal({
  open,
  onClose,
  onSelect,
  modeOptions = ['background', 'content', 'cover'],
  defaultMode = 'content',
  aspectRatio = 4 / 5,
  showModeSelector = true,
}) {
  const [tab, setTab] = useState('library');
  const [images, setImages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [mode, setMode] = useState(defaultMode);
  const [pickedImage, setPickedImage] = useState(null);
  const [cropPos, setCropPos] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [cropArea, setCropArea] = useState(null);

  useEffect(() => {
    if (!open) return;
    setTab('library');
    setPickedImage(null);
    setCropArea(null);
    setCropPos({ x: 0, y: 0 });
    setZoom(1);
    setError('');
    setMode(defaultMode);
    fetchLibrary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e) {
      if (e.key === 'Escape') {
        if (pickedImage) {
          setPickedImage(null);
          setCropArea(null);
          setZoom(1);
          setCropPos({ x: 0, y: 0 });
        } else {
          onClose?.();
        }
      }
    }
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose, pickedImage]);

  async function fetchLibrary() {
    const token = getToken();
    if (!token) {
      setError('로그인이 필요합니다.');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/my-images', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (res.ok) {
        setImages(data.images || []);
      } else {
        setError(data.error || '목록을 불러오지 못했습니다.');
      }
    } catch (_) {
      setError('네트워크 오류');
    } finally {
      setLoading(false);
    }
  }

  async function uploadFile(file) {
    const token = getToken();
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch('/api/my-images', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: fd,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '업로드 실패');
    return data.image;
  }

  async function onUploadInput(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!['image/jpeg', 'image/png'].includes(file.type)) {
      alert('JPG 또는 PNG만 업로드 가능합니다.');
      e.target.value = '';
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      alert('파일 크기는 5MB 이하만 가능합니다.');
      e.target.value = '';
      return;
    }
    try {
      setLoading(true);
      const img = await uploadFile(file);
      await fetchLibrary();
      setTab('library');
      setPickedImage(img);
    } catch (err) {
      alert(err.message);
    } finally {
      setLoading(false);
      e.target.value = '';
    }
  }

  function onCropComplete(_croppedArea, croppedAreaPixels) {
    setCropArea(croppedAreaPixels);
  }

  if (!open) return null;

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <div className={styles.title}>이미지 선택</div>
          <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="닫기">×</button>
        </div>

        {showModeSelector && modeOptions.length > 1 && (
          <div className={styles.modeRow}>
            <span className={styles.modeLabel}>사용 방식</span>
            {modeOptions.map((m) => (
              <button
                key={m}
                type="button"
                className={`${styles.modeBtn} ${mode === m ? styles.modeBtnActive : ''}`}
                onClick={() => setMode(m)}
              >
                {MODE_LABELS[m] || m}
              </button>
            ))}
          </div>
        )}

        <div className={styles.tabs}>
          <button
            type="button"
            className={`${styles.tab} ${tab === 'library' ? styles.tabActive : ''}`}
            onClick={() => setTab('library')}
          >내 이미지</button>
          <button
            type="button"
            className={`${styles.tab} ${tab === 'upload' ? styles.tabActive : ''}`}
            onClick={() => setTab('upload')}
          >새로 업로드</button>
        </div>

        <div className={styles.body}>
          {tab === 'library' && (
            <>
              {loading && <div className={styles.loadingText}>불러오는 중...</div>}
              {error && <div className={styles.errorText}>{error}</div>}
              {!loading && images.length === 0 && !error && (
                <div className={styles.emptyText}>
                  아직 업로드된 이미지가 없어요.<br />
                  "새로 업로드" 탭에서 먼저 올려주세요.
                </div>
              )}
              {images.length > 0 && (
                <div className={styles.grid}>
                  {images.map((img) => (
                    <button
                      key={img.id}
                      type="button"
                      className={styles.tile}
                      onClick={() => setPickedImage(img)}
                    >
                      <img src={img.thumb_url} alt={img.filename} />
                      {img.tag && <div className={styles.tag}>{img.tag}</div>}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}

          {tab === 'upload' && (
            <div className={styles.uploadPane}>
              <input
                type="file"
                id="picker-upload"
                accept="image/jpeg,image/png"
                onChange={onUploadInput}
                style={{ display: 'none' }}
              />
              <label htmlFor="picker-upload" className={styles.uploadBtn}>
                + 파일 선택
              </label>
              <div className={styles.uploadHint}>
                JPG/PNG, 최대 5MB<br />
                업로드한 이미지는 내 이미지 보관함에도 저장돼요.
              </div>
            </div>
          )}
        </div>

        {pickedImage && (
          <div className={styles.cropOverlay}>
            <div className={styles.cropCanvas}>
              <Cropper
                image={pickedImage.public_url}
                crop={cropPos}
                zoom={zoom}
                aspect={aspectRatio}
                onCropChange={setCropPos}
                onZoomChange={setZoom}
                onCropComplete={onCropComplete}
                objectFit="contain"
              />
            </div>
            <div className={styles.cropControls}>
              <label className={styles.zoomLabel}>
                확대
                <input
                  type="range"
                  min="1"
                  max="3"
                  step="0.05"
                  value={zoom}
                  onChange={(e) => setZoom(Number(e.target.value))}
                />
              </label>
              <div className={styles.cropActions}>
                <button
                  type="button"
                  className={styles.cancelBtn}
                  onClick={() => {
                    setPickedImage(null);
                    setCropArea(null);
                    setZoom(1);
                    setCropPos({ x: 0, y: 0 });
                  }}
                >뒤로</button>
                <button
                  type="button"
                  className={styles.applyBtn}
                  onClick={() => {
                    onSelect?.({
                      image: pickedImage,
                      crop: cropArea,
                      mode,
                    });
                    onClose?.();
                  }}
                >적용</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
