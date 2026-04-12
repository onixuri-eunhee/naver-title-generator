export const metadata = {
  title: '뚝딱툴',
  description: '네이버 블로그 마케팅 도구',
};

export default function RootLayout({ children }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
