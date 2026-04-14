'use client';

import { useEffect, useState } from 'react';
import { getToken } from '@/lib/auth';
import styles from './ShortformProjectsSection.module.css';

const STEP_LABELS = {
  1: 'Step 1 입력',
  2: 'Step 2 벤치마킹',
  3: 'Step 3 대본',
  4: 'Step 4 음성',
  5: 'Step 5 액센트',
  6: 'Step 6 미리보기',
  7: 'Step 7 산출물',
};

function formatRelativeTime(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return '방금 전';
  if (min < 60) return `${min}분 전`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}시간 전`;
  const d = Math.floor(hr / 24);
  if (d < 30) return `${d}일 전`;
  return new Date(iso).toLocaleDateString('ko-KR');
}

function formatDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' });
}

function formatDuration(sec) {
  if (!sec) return '';
  return `${sec}초`;
}

function daysUntilExpire(updatedAt) {
  if (!updatedAt) return 30;
  const updated = new Date(updatedAt).getTime();
  const expire = updated + 30 * 24 * 60 * 60 * 1000;
  return Math.max(0, Math.floor((expire - Date.now()) / (24 * 60 * 60 * 1000)));
}

export default function ShortformProjectsSection() {
  const [tab, setTab] = useState('drafts'); // 'drafts' | 'published'
  const [drafts, setDrafts] = useState([]);
  const [published, setPublished] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [toast, setToast] = useState(null);

  async function refresh() {
    const token = getToken();
    if (!token) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const [draftsRes, pubRes] = await Promise.all([
        fetch('/api/shortform-projects?status=draft', {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch('/api/shortform-projects?status=published', {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ]);
      const [draftsData, pubData] = await Promise.all([
        draftsRes.json().catch(() => ({})),
        pubRes.json().catch(() => ({})),
      ]);
      if (!draftsRes.ok) {
        setError(draftsData.error || '작업 중 목록을 불러오지 못했습니다.');
      } else {
        setDrafts(draftsData.projects || []);
      }
      if (pubRes.ok) {
        setPublished(pubData.projects || []);
      }
    } catch {
      setError('네트워크 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refresh(); }, []);

  async function deleteProject(id) {
    if (!confirm('이 프로젝트를 삭제할까요?')) return;
    const token = getToken();
    const res = await fetch(`/api/shortform-projects/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) await refresh();
    else alert('삭제에 실패했습니다.');
  }

  async function duplicateProject(id) {
    const token = getToken();
    const res = await fetch(`/api/shortform-projects/${id}/duplicate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(data.error || '복제에 실패했습니다.');
      return;
    }
    if (data.project?.id) {
      setToast({
        msg: '복제되었습니다. 새 draft로 이동할까요?',
        projectId: data.project.id,
      });
      await refresh();
    }
  }

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <div className={styles.title}>내 영상</div>
        <a href="/shortform" className={styles.newBtn}>+ 새 영상 만들기</a>
      </div>

      <div className={styles.tabs} role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'drafts'}
          className={`${styles.tab} ${tab === 'drafts' ? styles.tabActive : ''}`}
          onClick={() => setTab('drafts')}
        >
          작업 중 <span className={styles.badge}>{drafts.length}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'published'}
          className={`${styles.tab} ${tab === 'published' ? styles.tabActive : ''}`}
          onClick={() => setTab('published')}
        >
          완성 <span className={styles.badge}>{published.length}</span>
        </button>
      </div>

      {error && <div className={styles.errorText}>{error}</div>}
      {loading && <div className={styles.loadingText}>불러오는 중...</div>}

      {!loading && tab === 'drafts' && (
        <DraftsList items={drafts} onDelete={deleteProject} />
      )}

      {!loading && tab === 'published' && (
        <PublishedList
          items={published}
          onDelete={deleteProject}
          onDuplicate={duplicateProject}
        />
      )}

      {toast && (
        <div className={styles.toast}>
          <span>{toast.msg}</span>
          <a
            href={`/shortform?projectId=${toast.projectId}`}
            className={styles.toastBtn}
          >
            이동
          </a>
          <button
            type="button"
            onClick={() => setToast(null)}
            className={styles.toastClose}
            aria-label="닫기"
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}

function DraftsList({ items, onDelete }) {
  if (items.length === 0) {
    return (
      <div className={styles.emptyText}>
        작업 중인 영상이 없습니다.<br />
        새 영상을 만들면 자동으로 저장됩니다.
      </div>
    );
  }
  return (
    <ul className={styles.list}>
      {items.map((p) => {
        const expireIn = daysUntilExpire(p.updated_at);
        return (
          <li key={p.id} className={styles.draftCard}>
            <div className={styles.draftBody}>
              <div className={styles.draftTitle}>
                {p.title || p.blog_text?.slice(0, 40) || '제목 없음'}
              </div>
              <div className={styles.draftMeta}>
                <span className={styles.stepPill}>
                  {STEP_LABELS[p.current_step] || `Step ${p.current_step}`}
                </span>
                <span className={styles.metaDot}>·</span>
                <span>{formatRelativeTime(p.updated_at)}</span>
                {p.duration_sec && (
                  <>
                    <span className={styles.metaDot}>·</span>
                    <span>{formatDuration(p.duration_sec)}</span>
                  </>
                )}
                {p.tone && (
                  <>
                    <span className={styles.metaDot}>·</span>
                    <span>{p.tone === 'casual' ? '친근 모드' : '전문가 모드'}</span>
                  </>
                )}
                {expireIn <= 5 && (
                  <>
                    <span className={styles.metaDot}>·</span>
                    <span className={styles.expireWarn}>{expireIn}일 후 자동 삭제</span>
                  </>
                )}
              </div>
            </div>
            <div className={styles.draftActions}>
              <a
                href={`/shortform?projectId=${p.id}`}
                className={styles.resumeBtn}
              >
                이어서 작업
              </a>
              <button
                type="button"
                className={styles.iconBtn}
                onClick={() => onDelete(p.id)}
                aria-label="삭제"
              >
                ×
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function PublishedList({ items, onDelete, onDuplicate }) {
  if (items.length === 0) {
    return (
      <div className={styles.emptyText}>
        완성한 영상이 없습니다.<br />
        Step 7까지 완료하면 여기에 저장됩니다.
      </div>
    );
  }
  return (
    <ul className={styles.grid}>
      {items.map((p) => (
        <li key={p.id} className={styles.publishedCard}>
          <div className={styles.thumbWrap}>
            {p.thumbnail_url ? (
              <img src={p.thumbnail_url} alt={p.title || ''} className={styles.thumb} />
            ) : (
              <div className={styles.thumbPlaceholder}>영상</div>
            )}
            <div className={styles.durationBadge}>
              {formatDuration(p.duration_actual || p.duration_sec)}
            </div>
          </div>
          <div className={styles.publishedBody}>
            <div className={styles.publishedTitle}>
              {p.title || p.blog_text?.slice(0, 36) || '제목 없음'}
            </div>
            <div className={styles.publishedDate}>
              {formatDate(p.published_at || p.updated_at)} 발행
            </div>
            <div className={styles.publishedActions}>
              {p.video_r2_key ? (
                <a
                  href={`/api/shortform-projects/${p.id}/download`}
                  className={styles.smallBtn}
                  download
                >
                  다운로드
                </a>
              ) : (
                <span className={`${styles.smallBtn} ${styles.smallBtnDisabled}`}>
                  처리 중
                </span>
              )}
              <button
                type="button"
                className={styles.smallBtn}
                onClick={() => onDuplicate(p.id)}
              >
                복제
              </button>
              <button
                type="button"
                className={styles.smallBtnDanger}
                onClick={() => onDelete(p.id)}
              >
                삭제
              </button>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
