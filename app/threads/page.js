import ThreadsClient from './ThreadsClient';

export const metadata = {
  title: '스레드 글 생성기 | 터지는 스레드 글, 뚝딱',
  description: '소재를 입력하면 터지는 스레드 글을 AI가 뚝딱 만들어드립니다. 4가지 유형 × 4가지 말투 + 즉시/예약 발행.',
  keywords: '스레드 글 생성기, Threads 마케팅, SNS 글쓰기, AI 스레드, 바이럴 스레드',
  alternates: { canonical: 'https://ddukddaktool.co.kr/threads' },
  openGraph: {
    type: 'website',
    title: '스레드 글 생성기 | 뚝딱툴',
    description: '소재 입력 → 터지는 스레드 글 3개를 AI가 뚝딱 생성합니다.',
    url: 'https://ddukddaktool.co.kr/threads',
    siteName: '뚝딱툴',
    locale: 'ko_KR',
    images: ['https://ddukddaktool.co.kr/assets/og-default.jpg'],
  },
};

export default function ThreadsPage() {
  return <ThreadsClient />;
}
