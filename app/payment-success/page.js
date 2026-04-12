import { Suspense } from 'react';
import PaymentSuccessClient from './PaymentSuccessClient';

export const metadata = {
  title: '결제 완료 — 뚝딱툴',
  robots: { index: false, follow: false },
};

export default function PaymentSuccessPage() {
  return (
    <Suspense fallback={null}>
      <PaymentSuccessClient />
    </Suspense>
  );
}
