/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  outputFileTracingRoot: __dirname,
  // 기존 HTML URL 호환을 위한 리다이렉트
  async redirects() {
    return [
      { source: '/index.html', destination: '/', permanent: true },
      { source: '/blog-writer.html', destination: '/blog-writer', permanent: true },
      { source: '/blog-image-pro.html', destination: '/blog-image-pro', permanent: true },
      { source: '/blog-image.html', destination: '/blog-image-pro', permanent: true },
      { source: '/hook-generator.html', destination: '/hook-generator', permanent: true },
      { source: '/threads.html', destination: '/threads', permanent: true },
      { source: '/threads-writer.html', destination: '/threads-writer', permanent: true },
      { source: '/card-news.html', destination: '/card-news', permanent: true },
      { source: '/keyword-finder.html', destination: '/keyword-finder', permanent: true },
      { source: '/shortform.html', destination: '/shortform', permanent: true },
      { source: '/login.html', destination: '/login', permanent: true },
      { source: '/signup.html', destination: '/signup', permanent: true },
      { source: '/mypage.html', destination: '/mypage', permanent: true },
      { source: '/pricing.html', destination: '/pricing', permanent: true },
      { source: '/guide.html', destination: '/guide', permanent: true },
      { source: '/about.html', destination: '/about', permanent: true },
      { source: '/column.html', destination: '/column', permanent: true },
      { source: '/terms.html', destination: '/terms', permanent: true },
      { source: '/privacy.html', destination: '/privacy', permanent: true },
      { source: '/privacy-meta.html', destination: '/privacy-meta', permanent: true },
      { source: '/refund-policy.html', destination: '/refund-policy', permanent: true },
      { source: '/contact.html', destination: '/contact', permanent: true },
      { source: '/payment-success.html', destination: '/payment-success', permanent: true },
      { source: '/payment-fail.html', destination: '/payment-fail', permanent: true },
      { source: '/404.html', destination: '/not-found', permanent: true },
      { source: '/admin-8524.html', destination: '/admin-dashboard', permanent: true },
      { source: '/hooking-psychology.html', destination: '/hooking-psychology', permanent: true },
      { source: '/naver-blog-title-importance.html', destination: '/naver-blog-title-importance', permanent: true },
      ...Array.from({ length: 33 }, (_, i) => {
        const num = String(i + 1).padStart(3, '0');
        return { source: `/column-${num}.html`, destination: `/column/${num}`, permanent: true };
      }),
    ];
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(self), geolocation=()' },
          { key: 'X-DNS-Prefetch-Control', value: 'on' },
        ],
      },
    ];
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'cdn.ddukddaktool.co.kr' },
    ],
  },
};

module.exports = nextConfig;
