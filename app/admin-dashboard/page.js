import AdminDashboard from './AdminDashboard';

export const metadata = {
  title: '관리자 대시보드 - 뚝딱툴',
  robots: { index: false, follow: false },
};

export default function Page() {
  return <AdminDashboard />;
}
