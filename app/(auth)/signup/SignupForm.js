'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/components/AuthProvider';
import styles from '../auth.module.css';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function SignupForm() {
  const router = useRouter();
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    const trimmedEmail = email.trim();
    const trimmedName = name.trim();
    const trimmedPhone = phone.trim();

    if (!EMAIL_RE.test(trimmedEmail)) {
      setError('올바른 이메일을 입력해주세요.');
      return;
    }
    if (password.length < 8) {
      setError('비밀번호는 8자 이상이어야 합니다.');
      return;
    }
    if (password !== passwordConfirm) {
      setError('비밀번호가 일치하지 않습니다.');
      return;
    }
    if (!agreed) {
      setError('이용약관, 개인정보처리방침, 환불규정에 동의해주세요.');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/auth?action=signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: trimmedEmail,
          password,
          name: trimmedName,
          phone: trimmedPhone,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        login(data.token, data.user);
        router.push('/');
        router.refresh();
      } else {
        setError(data.error || '회원가입에 실패했습니다.');
      }
    } catch (_) {
      setError('서버 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      {error && <div className={styles.errorBox}>{error}</div>}
      <form onSubmit={handleSubmit} autoComplete="off">
        <div className={styles.formGroup}>
          <label htmlFor="email">이메일</label>
          <input
            type="email"
            id="email"
            name="email"
            required
            placeholder="example@email.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className={styles.formGroup}>
          <label htmlFor="password">비밀번호</label>
          <input
            type="password"
            id="password"
            name="password"
            minLength={8}
            required
            placeholder="8자 이상"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <div className={styles.formGroup}>
          <label htmlFor="passwordConfirm">비밀번호 확인</label>
          <input
            type="password"
            id="passwordConfirm"
            name="passwordConfirm"
            required
            placeholder="비밀번호를 다시 입력해주세요"
            value={passwordConfirm}
            onChange={(e) => setPasswordConfirm(e.target.value)}
          />
        </div>
        <div className={styles.formGroup}>
          <label htmlFor="name">이름</label>
          <input
            type="text"
            id="name"
            name="name"
            required
            placeholder="홍길동"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className={styles.formGroup}>
          <label htmlFor="phone">전화번호</label>
          <input
            type="tel"
            id="phone"
            name="phone"
            required
            placeholder="010-0000-0000"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </div>
        <div className={styles.agreeRow}>
          <input
            type="checkbox"
            id="agreeTerms"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
          />
          <label htmlFor="agreeTerms">
            <a href="/terms" target="_blank" rel="noreferrer">이용약관</a>
            ,{' '}
            <a href="/privacy" target="_blank" rel="noreferrer">개인정보처리방침</a>
            ,{' '}
            <a href="/refund-policy" target="_blank" rel="noreferrer">환불규정</a>
            에 동의합니다.
          </label>
        </div>
        <button type="submit" className={styles.submitBtn} disabled={loading}>
          {loading ? '가입 중...' : '회원가입'}
        </button>
      </form>
      <div className={styles.authLink}>
        이미 계정이 있으신가요? <Link href="/login">로그인</Link>
      </div>
    </>
  );
}
