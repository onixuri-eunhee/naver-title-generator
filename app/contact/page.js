import styles from '../info.module.css';

export const metadata = {
  title: '연락처 | 뚝딱툴',
  description: '뚝딱툴 문의·오류 제보·제안 사항 이메일: lboss.reboot@gmail.com',
  alternates: { canonical: 'https://ddukddaktool.co.kr/contact' },
};

export default function ContactPage() {
  return (
    <main className={styles.root}>
      <div className={styles.container} style={{ paddingTop: 40 }}>
        <h1 className={styles.pageTitle}>연락처</h1>
        <p className={styles.pageSub}>문의, 오류 제보, 제안 사항을 보내주세요</p>

        <div className={styles.card}>
          <h2>📧 이메일 문의</h2>
          <p>도구 사용 중 불편한 점, 오류, 개선 아이디어가 있으시면 언제든 이메일로 연락해 주세요. 확인 후 빠르게 답변드리겠습니다.</p>
          <div className={styles.emailBox}>
            <span className={styles.emailIcon}>✉️</span>
            <span className={styles.emailAddr}>lboss.reboot@gmail.com</span>
          </div>
          <a href="mailto:lboss.reboot@gmail.com" className={styles.emailLink}>✉️ 이메일 보내기</a>
          <div className={styles.notice}>
            평일 기준 1~3일 내로 답변드리고 있습니다. 스팸 필터로 인해 답변이 늦어질 수 있으니, 회신이 없을 경우 한 번 더 보내주세요.
          </div>
        </div>

        <div className={styles.card}>
          <h2>💬 이런 내용을 보내주세요</h2>
          <p>
            · 도구가 작동하지 않거나 결과가 이상한 경우<br />
            · 추가됐으면 하는 기능이나 도구 아이디어<br />
            · 제목 패턴에 대한 의견이나 피드백<br />
            · 그 외 뚝딱툴과 관련된 모든 문의
          </p>
        </div>
      </div>
    </main>
  );
}
