import KeywordFinder from './KeywordFinder';

export const metadata = {
  title: '황금키워드 찾기 | 뚝딱툴',
  description: '검색량은 높고 경쟁은 낮은 블루오션 키워드를 AI + 네이버 데이터로 분석합니다. 분야·역할·타겟만 입력하면 끝.',
  keywords: '황금키워드, 블로그 키워드 분석, 네이버 키워드, SEO 키워드, 블루오션 키워드, 키워드 발굴',
  alternates: { canonical: 'https://ddukddaktool.co.kr/keyword-finder' },
  openGraph: {
    type: 'website',
    title: '황금키워드 찾기 | 뚝딱툴',
    description: '검색량 높고 경쟁 낮은 블루오션 키워드를 AI + 네이버 데이터로 발굴합니다.',
    url: 'https://ddukddaktool.co.kr/keyword-finder',
    siteName: '뚝딱툴',
    locale: 'ko_KR',
    images: ['https://ddukddaktool.co.kr/assets/og-default.jpg'],
  },
};

export default function KeywordFinderPage() {
  return <KeywordFinder />;
}
