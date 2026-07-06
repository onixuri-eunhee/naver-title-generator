import Link from 'next/link';

/**
 * 도구 페이지 "점검 중" 안내 화면.
 * feature-flag가 꺼진(=닫힌) 도구 페이지에서 렌더한다. (shortform/page.js와 동일 톤)
 * @param {{title:string}} props title 도구명(예: '블로그 글 생성기')
 */
const STYLES = {
  main: {
    minHeight: '60vh',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    padding: '48px 24px',
    textAlign: 'center',
  },
  title: { fontSize: 24, fontWeight: 700, margin: 0 },
  body: { fontSize: 15, lineHeight: 1.7, color: '#6B6B6B', margin: 0 },
  homeLink: {
    marginTop: 8,
    padding: '12px 24px',
    borderRadius: 50,
    background: '#1A1A1A',
    color: '#fff',
    fontSize: 14,
    fontWeight: 600,
    textDecoration: 'none',
  },
};

export default function MaintenancePage({ title }) {
  return (
    <main style={STYLES.main}>
      <h1 style={STYLES.title}>{title} 점검 중</h1>
      <p style={STYLES.body}>
        더 나은 서비스를 준비하느라 잠시 정비하고 있어요.
        <br />
        점검이 끝나면 다시 열립니다.
      </p>
      <Link href="/" style={STYLES.homeLink}>
        홈으로 돌아가기
      </Link>
    </main>
  );
}
