import LoginForm from './LoginForm';
import styles from '../auth.module.css';

export const metadata = {
  title: '로그인 | 뚝딱툴',
  description: '뚝딱툴 로그인 — 네이버 블로그 제목·글·이미지·카드뉴스 생성기',
  alternates: { canonical: 'https://ddukddaktool.co.kr/login' },
};

export default function LoginPage() {
  return (
    <main className={styles.root}>
      <div className={styles.hero}>
        <h1>뚝딱툴 <em>로그인</em></h1>
        <p>다시 만나서 반가워요</p>
      </div>
      <div className={styles.container}>
        <div className={styles.card}>
          <LoginForm />
        </div>
      </div>
    </main>
  );
}
