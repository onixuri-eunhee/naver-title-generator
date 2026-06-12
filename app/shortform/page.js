import Link from 'next/link';
import ShortformClient from './ShortformClient';
import { SHORTFORM_PAGE_ENABLED } from '@/lib/feature-flags';

export const metadata = {
  title: '숏폼 영상 생성기 | 릴스·쇼츠, 뚝딱',
  description: '주제만 입력하면 Opus 4.6 대본 + Ken Burns 이미지 + TTS로 프리미엄 숏폼 영상을 자동 생성합니다. 5가지 디자인 프리셋.',
  keywords: '숏폼 영상, 릴스 생성, 쇼츠 생성, AI 숏폼, Remotion 숏폼',
  alternates: { canonical: 'https://ddukddaktool.co.kr/shortform' },
  robots: SHORTFORM_PAGE_ENABLED ? undefined : { index: false, follow: false },
  openGraph: {
    type: 'website',
    title: '숏폼 영상 생성기 | 뚝딱툴',
    description: '주제 입력 → AI 대본 + 이미지 + TTS + 프리미엄 Remotion 영상',
    url: 'https://ddukddaktool.co.kr/shortform',
    siteName: '뚝딱툴',
    locale: 'ko_KR',
    images: ['https://ddukddaktool.co.kr/assets/og-default.jpg'],
  },
};

const MAINTENANCE_STYLES = {
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

export default function ShortformPage() {
  if (!SHORTFORM_PAGE_ENABLED) {
    return (
      <main style={MAINTENANCE_STYLES.main}>
        <h1 style={MAINTENANCE_STYLES.title}>숏폼 영상 생성기 점검 중</h1>
        <p style={MAINTENANCE_STYLES.body}>
          더 안정적인 영상 생성을 위해 잠시 정비하고 있어요.
          <br />
          점검이 끝나면 다시 열립니다.
        </p>
        <Link href="/" style={MAINTENANCE_STYLES.homeLink}>
          홈으로 돌아가기
        </Link>
      </main>
    );
  }
  return <ShortformClient />;
}
