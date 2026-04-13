import { Suspense } from 'react';
import PaymentFailClient from './PaymentFailClient';

export const metadata = {
  title: '결제 실패 — 뚝딱툴',
  robots: { index: false, follow: false },
};

export default function PaymentFailPage() {
  return (
    <Suspense fallback={null}>
      <PaymentFailClient />
    </Suspense>
  );
}
