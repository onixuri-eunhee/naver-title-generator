'use client';

import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import styles from '../payment-success/page.module.css';

export default function PaymentFailClient() {
  const searchParams = useSearchParams();
  const code = searchParams.get('code') || '';
  const message = searchParams.get('message') || '결제가 취소되었거나 오류가 발생했습니다.';

  return (
    <main className={styles.root}>
      <div className={styles.card}>
        <div className={styles.icon}>😥</div>
        <h1>결제에 실패했습니다</h1>
        <p className={styles.desc}>아래 사유를 확인하시고 다시 시도해주세요</p>
        <div className={styles.errorDetail}>
          {message}{code ? ` (${code})` : ''}
        </div>
        <Link href="/pricing" className={`${styles.btn} ${styles.btnPrimary}`}>
          다시 시도하기
        </Link>
        <Link href="/" className={`${styles.btn} ${styles.btnOutline}`}>
          홈으로
        </Link>
      </div>
    </main>
  );
}
