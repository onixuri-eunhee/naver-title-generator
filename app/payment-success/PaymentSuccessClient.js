'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/components/AuthProvider';
import { getToken } from '@/lib/auth';
import styles from './page.module.css';

export default function PaymentSuccessClient() {
  const searchParams = useSearchParams();
  const { refreshUser } = useAuth();
  const [state, setState] = useState({ loading: true });

  useEffect(() => {
    const paymentKey = searchParams.get('paymentKey');
    const orderId = searchParams.get('orderId');
    const amount = searchParams.get('amount');

    if (!paymentKey || !orderId || !amount) {
      setState({ error: '결제 정보가 올바르지 않습니다.' });
      return;
    }

    (async () => {
      try {
        const headers = { 'Content-Type': 'application/json' };
        const token = getToken();
        if (token) headers.Authorization = `Bearer ${token}`;

        const res = await fetch('/api/payment-confirm', {
          method: 'POST',
          headers,
          body: JSON.stringify({ paymentKey, orderId, amount: parseInt(amount, 10) }),
        });
        const data = await res.json();

        if (res.ok && data.success) {
          await refreshUser();
          setState({ success: true, credits: data.credits, totalCredits: data.totalCredits });
        } else {
          setState({ error: data.error || '결제 승인에 실패했습니다.' });
        }
      } catch (_) {
        setState({ error: '서버와 통신 중 오류가 발생했습니다.' });
      }
    })();
  }, [searchParams, refreshUser]);

  return (
    <main className={styles.root}>
      <div className={styles.card}>
        {state.loading && (
          <>
            <div className={styles.spinner} />
            <h1>결제 확인 중</h1>
            <p className={styles.desc}>잠시만 기다려주세요...</p>
          </>
        )}
        {state.success && (
          <>
            <div className={styles.icon}>🎉</div>
            <h1>결제 완료!</h1>
            <p className={styles.desc}>크레딧이 충전되었습니다</p>
            <div className={styles.creditBox}>
              <div className={styles.creditAmount}>+{state.credits} <small>크레딧</small></div>
              <div className={styles.creditTotal}>현재 잔액: {state.totalCredits} 크레딧</div>
            </div>
            <Link href="/blog-writer" className={`${styles.btn} ${styles.btnPrimary}`}>
              블로그 글 쓰러 가기
            </Link>
            <Link href="/mypage" className={`${styles.btn} ${styles.btnOutline}`}>
              마이페이지
            </Link>
          </>
        )}
        {state.error && (
          <>
            <div className={styles.icon}>😥</div>
            <h1>결제 처리 오류</h1>
            <p className={styles.error}>{state.error}</p>
            <Link href="/pricing" className={`${styles.btn} ${styles.btnPrimary}`}>
              다시 시도하기
            </Link>
            <Link href="/" className={`${styles.btn} ${styles.btnOutline}`}>
              홈으로
            </Link>
          </>
        )}
      </div>
    </main>
  );
}
