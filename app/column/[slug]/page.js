import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  getColumn,
  getAllColumnSlugs,
  getAdjacentColumns,
} from '../../../lib/columns';
import styles from '../column.module.css';

export function generateStaticParams() {
  return getAllColumnSlugs().map((slug) => ({ slug }));
}

export function generateMetadata({ params }) {
  const col = getColumn(params.slug);
  if (!col) return { title: '칼럼을 찾을 수 없습니다 | 뚝딱툴' };

  const canonical = `https://ddukddaktool.co.kr/column/${col.slug}`;
  return {
    title: `${col.title} | 뚝딱툴`,
    description: col.description,
    keywords: col.keywords,
    robots: { index: true, follow: true },
    alternates: { canonical },
    openGraph: {
      type: 'article',
      title: col.ogTitle,
      description: col.ogDescription,
      url: canonical,
      siteName: '뚝딱툴',
      locale: 'ko_KR',
      images: ['https://ddukddaktool.co.kr/assets/og-default.jpg'],
    },
    twitter: {
      card: 'summary_large_image',
      title: col.ogTitle,
      description: col.ogDescription,
      images: ['https://ddukddaktool.co.kr/assets/og-default.jpg'],
    },
  };
}

export default function ColumnDetailPage({ params }) {
  const col = getColumn(params.slug);
  if (!col) notFound();

  const { prev, next } = getAdjacentColumns(params.slug);
  const canonical = `https://ddukddaktool.co.kr/column/${col.slug}`;

  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Article',
        headline: col.title,
        description: col.description,
        author: {
          '@type': 'Organization',
          name: '뚝딱툴',
          url: 'https://ddukddaktool.co.kr',
        },
        publisher: {
          '@type': 'Organization',
          name: '뚝딱툴',
          url: 'https://ddukddaktool.co.kr',
          logo: {
            '@type': 'ImageObject',
            url: 'https://ddukddaktool.co.kr/assets/og-default.jpg',
          },
        },
        datePublished: col.dateIso,
        dateModified: col.dateIso,
        mainEntityOfPage: canonical,
        image: 'https://ddukddaktool.co.kr/assets/og-default.jpg',
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          {
            '@type': 'ListItem',
            position: 1,
            name: '홈',
            item: 'https://ddukddaktool.co.kr/',
          },
          {
            '@type': 'ListItem',
            position: 2,
            name: '칼럼',
            item: 'https://ddukddaktool.co.kr/column',
          },
          {
            '@type': 'ListItem',
            position: 3,
            name: col.title,
            item: canonical,
          },
        ],
      },
    ],
  };

  return (
    <main className={styles.root}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <div className={styles.hero}>
        {col.heroBadge && (
          <div className={styles.heroBadge}>{col.heroBadge}</div>
        )}
        <h1 dangerouslySetInnerHTML={{ __html: col.heroH1 }} />
        {col.heroSubtitle && (
          <p
            className={styles.heroSubtitle}
            dangerouslySetInnerHTML={{ __html: col.heroSubtitle }}
          />
        )}
        {col.heroMeta && <div className={styles.heroMeta}>{col.heroMeta}</div>}
      </div>

      <div className={styles.container}>
        <article
          className={styles.article}
          dangerouslySetInnerHTML={{ __html: col.article }}
        />

        <div className={styles.articleNav}>
          {prev ? (
            <Link href={`/column/${prev.slug}`}>
              <div className={styles.navLabel}>← 이전 칼럼</div>
              <div className={styles.navTitle}>{prev.title}</div>
            </Link>
          ) : (
            <Link href="/column">
              <div className={styles.navLabel}>← 칼럼 목록</div>
              <div className={styles.navTitle}>전체 칼럼 보기</div>
            </Link>
          )}
          {next ? (
            <Link href={`/column/${next.slug}`}>
              <div className={styles.navLabel}>다음 칼럼 →</div>
              <div className={styles.navTitle}>{next.title}</div>
            </Link>
          ) : (
            <Link href="/column">
              <div className={styles.navLabel}>칼럼 목록 →</div>
              <div className={styles.navTitle}>전체 칼럼 보기</div>
            </Link>
          )}
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
