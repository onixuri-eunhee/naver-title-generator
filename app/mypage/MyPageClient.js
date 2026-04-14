'use client';

import { useEffect, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';
import { getToken } from '@/lib/auth';
import MyImagesSection from './MyImagesSection';
import styles from './page.module.css';

function ThreadsSection() {
  const [status, setStatus] = useState({ loading: true });
  const [token, setToken] = useState(null);

  useEffect(() => {
    const t = getToken();
    setToken(t);
    if (!t) return;
    fetch('/api/threads-auth?action=status', {
      headers: { Authorization: `Bearer ${t}` },
    })
      .then((r) => r.json())
      .then((data) => setStatus({ loading: false, data }))
      .catch(() => setStatus({ loading: false, error: true }));
  }, []);

  async function refresh() {
    if (!token) return;
    setStatus({ loading: true });
    try {
      const r = await fetch('/api/threads-auth?action=status', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await r.json();
      setStatus({ loading: false, data });
    } catch {
      setStatus({ loading: false, error: true });
    }
  }

  async function disconnect() {
    if (!token) return;
    if (!confirm('Threads 계정 연결을 해제할까요?')) return;
    try {
      const r = await fetch('/api/threads-auth?action=disconnect', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (r.ok) refresh();
    } catch {
      alert('연결 해제 중 오류가 발생했습니다. 다시 시도해주세요.');
    }
  }

  if (status.loading) {
    return <div className={styles.loadingText} style={{ fontSize: '13px' }}>연결 상태 확인 중...</div>;
  }
  if (status.error) {
    return <p className={styles.threadsDesc} style={{ color: '#DC2626' }}>연결 상태를 확인할 수 없습니다.</p>;
  }

  const data = status.data;
  if (data?.connected) {
    const dateStr = new Date(data.connectedAt).toLocaleDateString('ko-KR');
    return (
      <div className={styles.threadsStatus}>
        <div className={styles.threadsIcon}>@</div>
        <div className={styles.threadsInfo}>
          <div className={styles.threadsUsername}>@{data.username}</div>
          <div className={styles.threadsDate}>{dateStr} 연결됨</div>
        </div>
        <button type="button" className={styles.threadsDisconnectBtn} onClick={disconnect}>
          연결 해제
        </button>
      </div>
    );
  }

  return (
    <>
      <p className={styles.threadsDesc}>
        Threads 계정을 연결하면 스레드 도구에서 생성한 글을 바로 발행할 수 있습니다.
      </p>
      <a
        className={styles.threadsConnectBtn}
        href={`/api/threads-auth?action=authorize&token=${encodeURIComponent(token || '')}`}
      >
        Threads 계정 연결
      </a>
    </>
  );
}

function ThreadsToast() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [toast, setToast] = useState(null);

  useEffect(() => {
    const threadsResult = searchParams.get('threads');
    if (!threadsResult) return;

    router.replace('/mypage');

    const t = setTimeout(() => {
      const msg =
        threadsResult === 'connected' ? 'Threads 계정이 연결되었습니다!'
        : threadsResult === 'denied' ? 'Threads 연결이 취소되었습니다.'
        : 'Threads 연결 중 오류가 발생했습니다.';
      setToast({ msg, success: threadsResult === 'connected' });
      setTimeout(() => setToast(null), 3000);
    }, 500);

    return () => clearTimeout(t);
  }, [searchParams, router]);

  if (!toast) return null;
  return (
    <div className={`${styles.toast} ${toast.success ? styles.toastSuccess : styles.toastError}`}>
      {toast.msg}
    </div>
  );
}

export default function MyPageClient() {
  const router = useRouter();
  const { user, loading, logout } = useAuth();

  useEffect(() => {
    if (!loading && !user) {
      router.replace('/login');
    }
  }, [loading, user, router]);

  if (loading || !user) {
    return (
      <main className={styles.root}>
        <div className={styles.hero}>
          <h1>마이페이지</h1>
        </div>
        <div className={styles.container}>
          <div className={styles.loadingState}>
            <div className={styles.loadingSpinner} />
            <div className={styles.loadingText}>정보를 불러오는 중...</div>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className={styles.root}>
      <Suspense fallback={null}>
        <ThreadsToast />
      </Suspense>
      <div className={styles.hero}>
        <h1>{user.name}님의 <em>마이페이지</em></h1>
        <p>내 정보와 크레딧을 관리하세요</p>
      </div>
      <div className={styles.container}>
        <div className={styles.card}>
          <div className={styles.cardTitle}>사용자 정보</div>
          <div className={styles.infoRow}>
            <span className={styles.infoLabel}>이름</span>
            <span className={styles.infoValue}>{user.name || ''}</span>
          </div>
          <div className={styles.infoRow}>
            <span className={styles.infoLabel}>이메일</span>
            <span className={styles.infoValue}>{user.email || ''}</span>
          </div>
          <div className={styles.infoRow}>
            <span className={styles.infoLabel}>전화번호</span>
            <span className={styles.infoValue}>{user.phone || '-'}</span>
          </div>
        </div>

        {/* 크레딧 잔액 카드 — 토스 결제경로 심사 "결제 후 사용처" 캡처용 */}
        <div className={styles.card}>
          <div className={styles.cardTitle}>크레딧 잔액</div>
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            <div style={{ fontSize: 40, marginBottom: 8 }}>💎</div>
            <div style={{ fontSize: 48, fontWeight: 900, color: 'var(--ds-accent)', lineHeight: 1.2, fontVariantNumeric: 'tabular-nums' }}>
              {user.credits ?? 0}
            </div>
            <div style={{ fontSize: 14, color: 'var(--ds-muted)', marginTop: 4 }}>보유 크레딧</div>
          </div>
          <div style={{ textAlign: 'center', marginTop: 16 }}>
            <a
              href="/pricing"
              style={{
                display: 'inline-block',
                padding: '12px 28px',
                background: 'var(--ds-accent)',
                color: '#fff',
                borderRadius: 10,
                fontSize: 14,
                fontWeight: 700,
                textDecoration: 'none',
              }}
            >
              크레딧 충전하기
            </a>
          </div>
          <div style={{ textAlign: 'center', marginTop: 12, fontSize: 12, color: 'var(--ds-muted)' }}>
            ※ 크레딧은 충전일로부터 1년간 유효하며, 블로그 글·이미지·카드뉴스·숏폼 등 PRO 도구 이용 시 차감됩니다.
          </div>
        </div>

        <div className={styles.card}>
          <MyImagesSection />
        </div>

        <div className={styles.card}>
          <div className={styles.cardTitle}>Threads 계정</div>
          <ThreadsSection />
        </div>

        <div className={styles.card}>
          <button type="button" className={styles.logoutBtn} onClick={logout}>
            로그아웃
          </button>
        </div>
      </div>
    </main>
  );
}
