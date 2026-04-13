'use client';

import { useState } from 'react';
import styles from './admin.module.css';

function authHeaders() {
  const h = { 'Content-Type': 'application/json' };
  if (typeof window !== 'undefined') {
    const tk = localStorage.getItem('ddukddak_token');
    if (tk) h.Authorization = `Bearer ${tk}`;
  }
  return h;
}

export default function AdminWhitelist() {
  const [ip, setIp] = useState('IP 확인 중...');
  const [status, setStatus] = useState(null);

  async function call(method) {
    try {
      const res = await fetch('/api/admin', { method, headers: authHeaders() });
      const data = await res.json();
      if (!res.ok) {
        setStatus({ msg: data.error || '오류', type: 'err' });
        return;
      }
      if (data.ip) setIp(`내 IP: ${data.ip}`);
      if (method === 'GET') {
        setStatus({
          msg: data.whitelisted ? '✅ 화이트리스트 등록됨 (제한 없음)' : '⛔ 일반 사용자 (제한 적용 중)',
          type: data.whitelisted ? 'ok' : 'info',
        });
      } else {
        setStatus({ msg: data.message, type: data.whitelisted ? 'ok' : 'info' });
      }
    } catch {
      setStatus({ msg: '서버 오류', type: 'err' });
    }
  }

  return (
    <main className={styles.root}>
      <div className={styles.card}>
        <h1>🔐 관리자</h1>
        <div className={styles.ipDisplay}>{ip}</div>
        <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={() => call('POST')}>
          ✅ 내 IP 화이트리스트 등록
        </button>
        <button className={`${styles.btn} ${styles.btnDanger}`} onClick={() => call('DELETE')}>
          ❌ 화이트리스트 해제
        </button>
        <button className={`${styles.btn} ${styles.btnNeutral}`} onClick={() => call('GET')}>
          🔍 상태 확인
        </button>
        {status && (
          <div className={`${styles.status} ${styles[status.type]}`}>{status.msg}</div>
        )}
      </div>
    </main>
  );
}
