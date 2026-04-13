import MyPageClient from './MyPageClient';

export const metadata = {
  title: '마이페이지 | 뚝딱툴',
  description: '뚝딱툴 마이페이지 — 내 정보, 크레딧 잔액 확인 및 크레딧 구매.',
  robots: { index: false, follow: false },
};

export default function MyPage() {
  return <MyPageClient />;
}
