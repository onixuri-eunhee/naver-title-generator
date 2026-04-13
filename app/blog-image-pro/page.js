import BlogImagePro from './BlogImagePro';

export const metadata = {
  title: '프리미엄 이미지 생성기 | 뚝딱툴',
  description: '내 블로그에 딱 맞는 고퀄리티 이미지를 AI가 자동 생성합니다. 사진·차트·인포그래픽·포스터 모델 자동 라우팅.',
  keywords: '블로그 이미지 생성, AI 이미지, 프리미엄 이미지, 인포그래픽 생성, 썸네일 생성',
  alternates: { canonical: 'https://ddukddaktool.co.kr/blog-image-pro' },
  openGraph: {
    type: 'website',
    title: '프리미엄 이미지 생성기 | 뚝딱툴',
    description: 'AI가 블로그 글에 맞는 이미지 8장을 자동 생성',
    url: 'https://ddukddaktool.co.kr/blog-image-pro',
    siteName: '뚝딱툴',
    locale: 'ko_KR',
    images: ['https://ddukddaktool.co.kr/assets/og-default.jpg'],
  },
};

export default function BlogImageProPage() {
  return <BlogImagePro />;
}
