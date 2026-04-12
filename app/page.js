import TitleGenerator from './TitleGenerator';

export const metadata = {
  title: '네이버 블로그 제목 생성기 | 클릭되는 제목, 뚝딱',
  description: '네이버 블로그 상위 노출을 위한 클릭율 높은 제목을 무료로 자동 생성해드립니다. 긍정형·위협형·호기심형 12가지 패턴으로 맞춤 제목을 만들어보세요.',
  keywords: '네이버 블로그 제목, 블로그 제목 생성기, 네이버 SEO, 블로그 상위노출, 클릭율 높은 제목, 블로그 제목 추천',
  alternates: { canonical: 'https://ddukddaktool.co.kr/' },
  openGraph: {
    type: 'website',
    title: '네이버 블로그 제목 생성기 | 클릭되는 제목, 뚝딱',
    description: '네이버 블로그 상위 노출을 위한 클릭율 높은 제목을 무료로 자동 생성해드립니다.',
    url: 'https://ddukddaktool.co.kr/',
    siteName: '뚝딱툴',
    locale: 'ko_KR',
    images: ['https://ddukddaktool.co.kr/assets/og-default.jpg'],
  },
  twitter: {
    card: 'summary_large_image',
    title: '네이버 블로그 제목 생성기 | 클릭되는 제목, 뚝딱',
    description: '네이버 블로그 상위 노출을 위한 클릭율 높은 제목을 무료로 자동 생성해드립니다.',
    images: ['https://ddukddaktool.co.kr/assets/og-default.jpg'],
  },
};

export default function Home() {
  return <TitleGenerator />;
}
