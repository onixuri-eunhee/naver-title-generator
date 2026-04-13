import HookGenerator from './HookGenerator';

export const metadata = {
  title: 'SNS 후킹문구 생성기 | 스크롤 멈추는 첫 줄, 뚝딱',
  description: '업종과 키워드만 입력하면 심리학 기반 후킹문구 15개를 즉시 생성합니다. 패턴 인터럽트, 손실회피, 호기심폭발 등 14가지 공식.',
  keywords: 'SNS 후킹문구, 릴스 첫 줄, 인스타 후킹, 쇼츠 첫 문장, 스레드 후킹, 심리 카피라이팅',
  alternates: { canonical: 'https://ddukddaktool.co.kr/hook-generator' },
  openGraph: {
    type: 'website',
    title: 'SNS 후킹문구 생성기 | 스크롤 멈추는 첫 줄, 뚝딱',
    description: '업종과 키워드만 입력하면 심리학 기반 후킹문구 15개를 즉시 생성합니다.',
    url: 'https://ddukddaktool.co.kr/hook-generator',
    siteName: '뚝딱툴',
    locale: 'ko_KR',
    images: ['https://ddukddaktool.co.kr/assets/og-default.jpg'],
  },
};

export default function HookGeneratorPage() {
  return <HookGenerator />;
}
