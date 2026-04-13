import Link from 'next/link';

export const metadata = {
  title: '페이지를 찾을 수 없습니다 | 뚝딱툴',
  robots: { index: false, follow: false },
};

export default function NotFound() {
  return (
    <main
      style={{
        minHeight: '70vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '80px 20px',
        background: '#F8F9FD',
        fontFamily: "'Noto Sans KR', sans-serif",
      }}
    >
      <div style={{ textAlign: 'center', maxWidth: 480 }}>
        <div
          style={{
            fontSize: 80,
            fontWeight: 900,
            color: '#00C73C',
            lineHeight: 1,
            marginBottom: 16,
          }}
        >
          404
        </div>
        <h1
          style={{
            fontSize: 22,
            fontWeight: 800,
            color: '#1A1A2E',
            marginBottom: 12,
          }}
        >
          페이지를 찾을 수 없습니다
        </h1>
        <p
          style={{
            fontSize: 14,
            color: '#6B7280',
            lineHeight: 1.7,
            marginBottom: 32,
          }}
        >
          요청하신 페이지가 삭제되었거나 주소가 변경되었을 수 있습니다.
        </p>
        <Link
          href="/"
          style={{
            display: 'inline-block',
            background: '#00C73C',
            color: '#fff',
            padding: '14px 32px',
            borderRadius: 12,
            fontWeight: 700,
            fontSize: 15,
            textDecoration: 'none',
          }}
        >
          홈으로 돌아가기 →
        </Link>
      </div>
    </main>
  );
}
