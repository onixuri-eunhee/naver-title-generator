import ThreadsWriterClient from './ThreadsWriterClient';

export const metadata = {
  title: '스레드 글 생성기 (라이트) | 뚝딱툴',
  description: '소재만 입력하면 스레드 글 3개를 뚝딱 만들어드립니다. /api/generate 기반의 가벼운 버전.',
  robots: { index: false, follow: false },
};

export default function ThreadsWriterPage() {
  return <ThreadsWriterClient />;
}
