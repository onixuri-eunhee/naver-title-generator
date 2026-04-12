import { Noto_Sans_KR } from 'next/font/google';
import './globals.css';
import Script from 'next/script';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import AuthProvider from '@/components/AuthProvider';

const notoSansKR = Noto_Sans_KR({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700', '900'],
  display: 'swap',
  variable: '--font-noto-sans-kr',
});

export const metadata = {
  title: { default: '뚝딱툴 — AI 블로그 마케팅 도구', template: '%s | 뚝딱툴' },
  description: 'AI로 네이버 블로그 제목, 글, 이미지, 카드뉴스, 숏폼 영상을 뚝딱 만들어보세요.',
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL ?? 'https://ddukddaktool.co.kr'
  ),
  icons: { icon: '/favicon.svg' },
  openGraph: {
    siteName: '뚝딱툴',
    locale: 'ko_KR',
    type: 'website',
    images: ['/og-default.jpg'],
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="ko" className={notoSansKR.variable}>
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
        <AuthProvider>
          <Navbar />
          <main>{children}</main>
          <Footer />
        </AuthProvider>
      </body>
    </html>
  );
}
