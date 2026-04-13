import CardNewsClient from './CardNewsClient';

export const metadata = {
  title: '카드뉴스 생성기 | 인스타 카드뉴스, 뚝딱',
  description: '블로그 글을 붙여넣으면 AI가 인스타그램용 카드뉴스를 자동으로 만들어드립니다. 14종 테마 + 브랜드 컬러 지원.',
  keywords: '카드뉴스 생성기, 인스타 카드뉴스, AI 카드뉴스, 블로그 카드뉴스, 인스타그램 마케팅',
  alternates: { canonical: 'https://ddukddaktool.co.kr/card-news' },
  openGraph: {
    type: 'website',
    title: '카드뉴스 생성기 | 뚝딱툴',
    description: '블로그 글 → 인스타 카드뉴스 자동 생성. 14 테마 + 브랜드 컬러.',
    url: 'https://ddukddaktool.co.kr/card-news',
    siteName: '뚝딱툴',
    locale: 'ko_KR',
    images: ['https://ddukddaktool.co.kr/assets/og-default.jpg'],
  },
};

export default function CardNewsPage() {
  return <CardNewsClient />;
}
