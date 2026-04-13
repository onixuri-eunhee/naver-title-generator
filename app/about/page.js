import styles from '../info.module.css';

export const metadata = {
  title: '뚝딱툴 소개 | 광고비 없이 연 매출 13억을 만든 마케팅 노하우',
  description: '19년차 웨딩 컨설턴트가 만든 AI 마케팅 도구 모음. 광고비 한 푼 없이 연 매출 13억원을 만든 유기적 콘텐츠 마케팅 노하우를 담았습니다.',
  alternates: { canonical: 'https://ddukddaktool.co.kr/about' },
};

export default function AboutPage() {
  return (
    <main className={styles.root}>
      <div className={styles.container} style={{ paddingTop: 40 }}>
        <h1 className={styles.pageTitle}>뚝딱툴 소개</h1>
        <p className={styles.pageSub}>광고비 없이 연 매출 13억을 만든 웨딩 컨설턴트가 만든 도구 모음</p>

        <section className={styles.section}>
          <h2>🙋 뚝딱툴을 만든 사람</h2>
          <p>안녕하세요. 저는 14년간 웨딩 컨설팅 업체를 운영하며 3,500쌍 이상의 고객을 직접 만난 웨딩 컨설턴트입니다.</p>
          <p>창업 초기 6백만 원으로 시작해 광고비를 한 푼도 쓰지 않고 연 매출 13억 원까지 성장시켰습니다. 그 과정에서 배운 것은 하나였어요. <strong>&quot;좋은 콘텐츠가 최고의 영업사원이다.&quot;</strong></p>
          <p>블로그 제목 하나, 인스타 문구 하나가 문의율을 3배 이상 바꿀 수 있다는 걸 몸으로 익혔습니다. 그 경험을 AI를 모르는 분들도 버튼 하나로 쓸 수 있도록 도구로 만든 것이 뚝딱툴입니다.</p>
          <div className={styles.highlight}>
            마케팅을 공부한 게 아니라, 19년간 장사하면서 직접 검증한 것들만 담았습니다.
          </div>
          <div className={styles.statRow}>
            <div className={styles.statBox}>
              <div className={styles.statNum}>19년</div>
              <div className={styles.statLabel}>웨딩 업계 경력</div>
            </div>
            <div className={styles.statBox}>
              <div className={styles.statNum}>3,500+</div>
              <div className={styles.statLabel}>상담 커플</div>
            </div>
            <div className={styles.statBox}>
              <div className={styles.statNum}>13억</div>
              <div className={styles.statLabel}>연 매출 (광고비 0원)</div>
            </div>
          </div>
        </section>

        <section className={styles.section}>
          <h2>🛠 뚝딱툴이 만드는 것</h2>
          <p>AI를 잘 몰라도, 마케팅을 배운 적 없어도, 자영업자와 소상공인이 콘텐츠 마케팅을 뚝딱 해낼 수 있도록 돕는 실용 도구를 만들고 있습니다.</p>
          <p>복잡한 설정 없이 키워드만 입력하면 바로 결과물이 나오는 것, 그게 뚝딱툴의 핵심입니다.</p>
          <div className={styles.highlight}>
            현재 제공 중인 도구: 네이버 블로그 제목 생성기<br />
            순차적으로 더 많은 도구를 추가할 예정입니다.
          </div>
        </section>

        <section className={styles.section}>
          <h2>📌 이런 분들을 위해 만들었습니다</h2>
          <p>블로그를 시작했는데 제목 짓는 게 매번 막히는 분, 광고비는 부담스럽고 콘텐츠 마케팅은 어디서부터 시작해야 할지 모르는 자영업자, 매일 글을 써야 하는데 제목만 1시간씩 고민하는 분들을 위해 만들었습니다.</p>
          <p>거창한 마케팅 전략보다 오늘 당장 쓸 수 있는 제목 하나, 문구 하나가 더 중요하다고 믿습니다.</p>
        </section>
      </div>
    </main>
  );
}
