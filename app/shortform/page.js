import ShortformClient from './ShortformClient';

export const metadata = {
  title: '숏폼 영상 생성기 | 릴스·쇼츠, 뚝딱',
  description: '주제만 입력하면 Opus 4.6 대본 + Ken Burns 이미지 + TTS로 프리미엄 숏폼 영상을 자동 생성합니다. 5가지 디자인 프리셋.',
  keywords: '숏폼 영상, 릴스 생성, 쇼츠 생성, AI 숏폼, Remotion 숏폼',
  alternates: { canonical: 'https://ddukddaktool.co.kr/shortform' },
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

export default function ShortformPage() {
  return <ShortformClient />;
}
