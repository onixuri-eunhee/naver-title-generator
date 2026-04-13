import Link from 'next/link';
import { getAllColumns } from '../../lib/columns';
import styles from './column.module.css';

export const metadata = {
  title: '블로그 마케팅 칼럼 | 뚝딱툴',
  description: '네이버 블로그·SNS 마케팅 실전 칼럼 — 제목 전략, 글쓰기 패턴, 알고리즘 분석, 실전 사례까지. 자영업자와 1인 사업가를 위한 무료 가이드.',
  keywords: '블로그 마케팅 칼럼, 네이버 블로그 팁, 블로그 글쓰기, SNS 마케팅, 자영업자 마케팅',
  robots: { index: true, follow: true },
  alternates: { canonical: 'https://ddukddaktool.co.kr/column' },
  openGraph: {
    type: 'website',
    title: '블로그 마케팅 칼럼 | 뚝딱툴',
    description: '네이버 블로그·SNS 마케팅 실전 칼럼. 자영업자와 1인 사업가를 위한 무료 가이드.',
    url: 'https://ddukddaktool.co.kr/column',
    siteName: '뚝딱툴',
    locale: 'ko_KR',
    images: ['https://ddukddaktool.co.kr/assets/og-default.jpg'],
  },
  twitter: {
    card: 'summary_large_image',
    title: '블로그 마케팅 칼럼 | 뚝딱툴',
    description: '네이버 블로그·SNS 마케팅 실전 칼럼.',
    images: ['https://ddukddaktool.co.kr/assets/og-default.jpg'],
  },
};

export default function ColumnIndexPage() {
  const columns = getAllColumns();

  const itemListJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: '블로그 마케팅 칼럼',
    url: 'https://ddukddaktool.co.kr/column',
    publisher: {
      '@type': 'Organization',
      name: '뚝딱툴',
      url: 'https://ddukddaktool.co.kr',
    },
    mainEntity: {
      '@type': 'ItemList',
      itemListElement: columns.map((c, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        url: `https://ddukddaktool.co.kr/column/${c.slug}`,
        name: c.title,
      })),
    },
  };

  return (
    <main className={styles.root}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(itemListJsonLd) }}
      />
      <div className={styles.hero}>
        <div className={styles.heroBadge}>📰 블로그 마케팅 칼럼</div>
        <h1>
          자영업자와 1인 사업가를 위한
          <br />
          <em>실전 블로그 가이드</em>
        </h1>
        <p className={styles.heroSubtitle}>
          19년 경력에서 검증한 블로그 제목 · 글쓰기 · SNS 마케팅 노하우
          <br />
          매주 새로운 칼럼이 추가됩니다
        </p>
      </div>

      <div className={styles.container}>
        <div className={styles.columnList}>
          {columns.map((c) => {
            const badgeMatch = c.heroBadge.match(/#\d+\s*·\s*(.+)/);
            const tag = badgeMatch ? badgeMatch[1].trim() : '';
            return (
              <Link
                key={c.slug}
                href={`/column/${c.slug}`}
                className={styles.columnCard}
              >
                <div>
                  <span className={styles.columnCardNum}>{c.num}</span>
                  {tag && <span className={styles.columnCardTag}>{tag}</span>}
                </div>
                <h2>{c.title}</h2>
                <p>{c.description}</p>
                <div className={styles.columnCardMeta}>
                  <span>{c.dateStr}</span>
                  {c.readTime && <span>·</span>}
                  {c.readTime && <span>{c.readTime}</span>}
                </div>
                <div className={styles.columnCardArrow}>→</div>
              </Link>
            );
          })}
        </div>

        <div className={styles.ctaBox}>
          <h3>칼럼으로 배운 노하우, 실전에 써보세요</h3>
          <p>뚝딱툴의 AI 도구로 바로 블로그 글·제목·이미지를 만들어 보세요</p>
          <Link href="/" className={styles.ctaBtn}>
            도구 사용하러 가기 →
          </Link>
        </div>
      </div>
    </main>
  );
}
