import AdminWhitelist from './AdminWhitelist';

export const metadata = {
  title: '관리자 | 뚝딱툴',
  robots: { index: false, follow: false },
};

export default function Page() {
  return <AdminWhitelist />;
}
