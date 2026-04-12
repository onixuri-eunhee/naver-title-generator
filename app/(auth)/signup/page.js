import SignupForm from './SignupForm';
import styles from '../auth.module.css';

export const metadata = {
  title: '회원가입 | 뚝딱툴',
  description: '뚝딱툴 회원가입 — 가입 즉시 제목·글·이미지·카드뉴스 생성 도구 무료 체험',
  alternates: { canonical: 'https://ddukddaktool.co.kr/signup' },
};

export default function SignupPage() {
  return (
    <main className={styles.root}>
      <div className={styles.hero}>
        <h1>뚝딱툴 <em>회원가입</em></h1>
        <p>가입하고 뚝딱툴의 모든 도구를 이용해보세요</p>
      </div>
      <div className={styles.container}>
        <div className={styles.card}>
          <SignupForm />
        </div>
      </div>
    </main>
  );
}
