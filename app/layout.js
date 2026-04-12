import './globals.css';
import Script from 'next/script';

export const metadata = {
  title: { default: '뚝딱툴 — AI 블로그 마케팅 도구', template: '%s | 뚝딱툴' },
  description: 'AI로 네이버 블로그 제목, 글, 이미지, 카드뉴스, 숏폼 영상을 뚝딱 만들어보세요.',
  metadataBase: new URL('https://ddukddaktool.co.kr'),
  openGraph: {
    siteName: '뚝딱툴',
    locale: 'ko_KR',
    type: 'website',
    images: ['/og-default.jpg'],
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="ko">
      <head>
        <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
      </head>
      <body>
        {/* Google Analytics */}
        <Script
          src="https://www.googletagmanager.com/gtag/js?id=G-C61VWMGQ8R"
          strategy="afterInteractive"
        />
        <Script id="ga-init" strategy="afterInteractive">
          {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('js',new Date());gtag('config','G-C61VWMGQ8R');`}
        </Script>
        {/* Google AdSense */}
        <Script
          src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-4973804132466200"
          crossOrigin="anonymous"
          strategy="afterInteractive"
        />
        {children}
      </body>
    </html>
  );
}
