import BlogWriter from './BlogWriter';

export const metadata = {
  title: '블로그 글 생성기 | 상위노출 블로그 글, 뚝딱',
  description: '업종과 주제만 입력하면 네이버 홈피드·SEO·구글 SEO에 최적화된 블로그 글을 만들어드립니다. 7항목 AI 검수기 + 1회 자동 수정.',
  keywords: '블로그 글 생성기, 네이버 SEO, 구글 SEO, 홈피드 노출, AI 블로그 글쓰기, 상위노출 글',
  alternates: { canonical: 'https://ddukddaktool.co.kr/blog-writer' },
  openGraph: {
    type: 'website',
    title: '블로그 글 생성기 | 상위노출 블로그 글, 뚝딱',
    description: '업종·주제 → 네이버/구글 SEO 최적화 블로그 글',
    url: 'https://ddukddaktool.co.kr/blog-writer',
    siteName: '뚝딱툴',
    locale: 'ko_KR',
    images: ['https://ddukddaktool.co.kr/assets/og-default.jpg'],
  },
};

export default function BlogWriterPage() {
  return <BlogWriter />;
}
