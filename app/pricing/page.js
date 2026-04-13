import PricingClient from './PricingClient';

export const metadata = {
  title: '크레딧 충전 | 뚝딱툴',
  description: '뚝딱툴 크레딧을 충전하고 블로그 글, 이미지, 카드뉴스 등 PRO 도구를 자유롭게 사용하세요. 30크레딧 9,900원부터.',
  keywords: '크레딧 충전, 뚝딱툴 결제, 블로그 글 생성 요금, AI 마케팅 도구 가격',
  alternates: { canonical: 'https://ddukddaktool.co.kr/pricing' },
  openGraph: {
    type: 'website',
    title: '크레딧 충전 | 뚝딱툴',
    description: '뚝딱툴 크레딧을 충전하고 PRO 도구를 자유롭게 사용하세요.',
    url: 'https://ddukddaktool.co.kr/pricing',
    siteName: '뚝딱툴',
    locale: 'ko_KR',
    images: ['https://ddukddaktool.co.kr/assets/og-default.jpg'],
  },
  twitter: {
    card: 'summary_large_image',
    title: '크레딧 충전 | 뚝딱툴',
    description: '뚝딱툴 크레딧을 충전하고 PRO 도구를 자유롭게 사용하세요. 30크레딧 9,900원부터.',
    images: ['https://ddukddaktool.co.kr/assets/og-default.jpg'],
  },
};

const jsonLd = {
  '@context': 'https://schema.org',
  '@type': 'Product',
  name: '뚝딱툴 크레딧 팩',
  description: 'AI 블로그 글, 이미지, 카드뉴스 등 PRO 도구를 사용할 수 있는 크레딧 충전 상품',
  url: 'https://ddukddaktool.co.kr/pricing',
  brand: { '@type': 'Organization', name: '뚝딱툴' },
  offers: {
    '@type': 'Offer',
    price: '9900',
    priceCurrency: 'KRW',
    availability: 'https://schema.org/InStock',
    priceValidUntil: '2027-12-31',
  },
};

export default function PricingPage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <PricingClient />
    </>
  );
}
