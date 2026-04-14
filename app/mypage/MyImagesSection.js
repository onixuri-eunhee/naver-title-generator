'use client';

import { useEffect, useState } from 'react';
import { getToken } from '@/lib/auth';
import styles from './MyImagesSection.module.css';

const ACCEPT_TYPES = ['image/jpeg', 'image/png'];
const MAX_BYTES = 5 * 1024 * 1024;

function formatBytes(bytes) {
  if (!bytes) return '0MB';
  const mb = bytes / 1024 / 1024;
  return mb >= 1 ? `${mb.toFixed(1)}MB` : `${(bytes / 1024).toFixed(0)}KB`;
}

export default function MyImagesSection() {
  const [images, setImages] = useState([]);
  const [quota, setQuota] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [uploadQueue, setUploadQueue] = useState([]);
  const [dragOver, setDragOver] = useState(false);

  async function refresh() {
    const token = getToken();
    if (!token) return;
    setLoading(true);
    try {
      const res = await fetch('/api/my-images', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || '목록을 불러오지 못했습니다.');
      } else {
        setImages(data.images || []);
        setQuota(data.quota || null);
        setError('');
      }
    } catch (_) {
      setError('네트워크 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refresh(); }, []);

  async function uploadOne(file) {
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
    return data;
  }

  async function handleFiles(fileList) {
    const files = Array.from(fileList);
    const additions = [];
    for (const f of files) {
      if (!ACCEPT_TYPES.includes(f.type)) {
        additions.push({ id: Math.random(), name: f.name, status: 'error', error: '지원하지 않는 형식' });
        continue;
      }
      if (f.size > MAX_BYTES) {
        additions.push({ id: Math.random(), name: f.name, status: 'error', error: '5MB 초과' });
        continue;
      }
      additions.push({ id: Math.random(), name: f.name, status: 'uploading', file: f });
    }
    setUploadQueue((q) => [...q, ...additions]);

    for (const item of additions) {
      if (item.status !== 'uploading') continue;
      try {
        await uploadOne(item.file);
        setUploadQueue((q) => q.map((x) => x.id === item.id ? { ...x, status: 'done', file: undefined } : x));
      } catch (err) {
        setUploadQueue((q) => q.map((x) => x.id === item.id ? { ...x, status: 'error', error: err.message, file: undefined } : x));
      }
    }
    await refresh();
    setTimeout(() => setUploadQueue((q) => q.filter((x) => x.status !== 'done')), 3000);
  }

  function onInputChange(e) {
    if (e.target.files) handleFiles(e.target.files);
    e.target.value = '';
  }

  function onDrop(e) {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer?.files) handleFiles(e.dataTransfer.files);
  }

  async function deleteImage(id) {
    if (!confirm('이 이미지를 삭제할까요?')) return;
    const token = getToken();
    const res = await fetch(`/api/my-images/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) await refresh();
    else alert('삭제에 실패했습니다.');
  }

  async function editTag(id, currentTag) {
    const next = prompt('태그를 입력하세요 (50자 이내, 빈 값이면 제거)', currentTag || '');
    if (next === null) return;
    const token = getToken();
    const res = await fetch(`/api/my-images/${id}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ tag: next }),
    });
    if (res.ok) await refresh();
    else alert('태그 수정에 실패했습니다.');
  }

  const usedPct = quota ? Math.min(100, Math.round((quota.used / quota.quota) * 100)) : 0;
  const barColor = usedPct >= 80 ? '#DC2626' : 'var(--ds-accent, #ff5f1f)';

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <div className={styles.title}>내 이미지</div>
        {quota && (
          <div className={styles.quotaText}>
            {formatBytes(quota.used)} / {formatBytes(quota.quota)}
          </div>
        )}
      </div>

      {quota && (
        <div className={styles.quotaBar}>
          <div className={styles.quotaFill} style={{ width: `${usedPct}%`, background: barColor }} />
        </div>
      )}

      <div
        className={`${styles.dropzone} ${dragOver ? styles.dropzoneOver : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
      >
        <input
          type="file"
          id="my-images-upload"
          multiple
          accept="image/jpeg,image/png"
          onChange={onInputChange}
          style={{ display: 'none' }}
        />
        <label htmlFor="my-images-upload" className={styles.uploadBtn}>
          + 사진 업로드
        </label>
        <div className={styles.dropHint}>또는 여기로 드래그 (JPG/PNG, 최대 5MB)</div>
      </div>

      {uploadQueue.length > 0 && (
        <div className={styles.queue}>
          {uploadQueue.map((item) => (
            <div key={item.id} className={`${styles.queueItem} ${styles['queue_' + item.status]}`}>
              <span className={styles.queueName}>{item.name}</span>
              <span className={styles.queueStatus}>
                {item.status === 'uploading' && '업로드 중...'}
                {item.status === 'done' && '완료'}
                {item.status === 'error' && `실패: ${item.error}`}
              </span>
            </div>
          ))}
        </div>
      )}

      {loading && <div className={styles.loadingText}>불러오는 중...</div>}
      {error && <div className={styles.errorText}>{error}</div>}

      {!loading && images.length === 0 && !error && (
        <div className={styles.emptyText}>
          아직 업로드된 이미지가 없습니다.<br />
          매장/메뉴/상품 사진을 업로드하면 카드뉴스·숏폼·블로그에서 불러 쓸 수 있어요.
        </div>
      )}

      {images.length > 0 && (
        <div className={styles.grid}>
          {images.map((img) => (
            <div key={img.id} className={styles.tile}>
              <img src={img.thumb_url} alt={img.filename} className={styles.thumb} />
              {img.tag && <div className={styles.tag}>{img.tag}</div>}
              <div className={styles.tileActions}>
                <button
                  type="button"
                  className={styles.actionBtn}
                  onClick={() => editTag(img.id, img.tag)}
                  aria-label="태그 수정"
                >✎</button>
                <button
                  type="button"
                  className={`${styles.actionBtn} ${styles.actionDelete}`}
                  onClick={() => deleteImage(img.id)}
                  aria-label="삭제"
                >×</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
