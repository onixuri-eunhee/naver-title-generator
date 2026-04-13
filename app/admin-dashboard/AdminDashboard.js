'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import Script from 'next/script';
import styles from './admin.module.css';

const ADMIN_SESSION_LIMIT = 2 * 60 * 60 * 1000;
const ADMIN_SESSION_KEY = 'admin_session';

const TOOL_STYLE_MAP = {
  title: styles.toolTitle,
  hook: styles.toolHook,
  thread: styles.toolThread,
  blog: styles.toolBlog,
  image: styles.toolImage,
  'image-pro': styles.toolImagePro,
  'card-news': styles.toolCardNews,
  keyword: styles.toolDefault,
  shortform: styles.toolDefault,
};

const TOOL_COLORS = {
  title: '#60a5fa',
  hook: '#fbbf24',
  thread: '#a78bfa',
  blog: '#34d399',
  image: '#f472b6',
  'image-pro': '#fb7185',
  'card-news': '#22d3ee',
  keyword: '#f97316',
  shortform: '#8b5cf6',
};

function chartOpts() {
  return {
    responsive: true,
    plugins: { legend: { display: false } },
    scales: {
      x: { ticks: { color: '#64748b', font: { size: 10 } }, grid: { color: '#1e293b' } },
      y: { ticks: { color: '#64748b', font: { size: 10 } }, grid: { color: '#1e293b' }, beginAtZero: true },
    },
  };
}

export default function AdminDashboard() {
  const [token, setToken] = useState(null);
  const [authError, setAuthError] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [sessionTimer, setSessionTimer] = useState('');
  const [chartJsReady, setChartJsReady] = useState(false);

  const [stats, setStats] = useState(null);
  const [users, setUsers] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 20, pages: 1 });
  const [searchQ, setSearchQ] = useState('');
  const [logs, setLogs] = useState([]);
  const [creditAmounts, setCreditAmounts] = useState({});
  const [creditResults, setCreditResults] = useState({});

  const signupChartRef = useRef(null);
  const toolChartRef = useRef(null);
  const usageChartRef = useRef(null);
  const chartInstances = useRef({});
  const adminLoginTimeRef = useRef(null);

  const apiHeaders = useCallback(
    () => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }),
    [token]
  );

  const logout = useCallback(() => {
    if (typeof window !== 'undefined') sessionStorage.removeItem(ADMIN_SESSION_KEY);
    setToken(null);
    adminLoginTimeRef.current = null;
    setSessionTimer('');
    setStats(null);
    setUsers([]);
    setLogs([]);
    Object.values(chartInstances.current).forEach((c) => c?.destroy?.());
    chartInstances.current = {};
  }, []);

  // Session restore
  useEffect(() => {
    const saved = sessionStorage.getItem(ADMIN_SESSION_KEY);
    if (!saved) return;
    try {
      const s = JSON.parse(saved);
      const elapsed = Date.now() - s.loginTime;
      if (elapsed < ADMIN_SESSION_LIMIT) {
        setToken(s.token);
        adminLoginTimeRef.current = s.loginTime;
        return;
      }
    } catch {}
    sessionStorage.removeItem(ADMIN_SESSION_KEY);
  }, []);

  // Verify admin after token set
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/auth?action=me', {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok || !data.isAdmin) {
          setAuthError('관리자 권한이 없습니다.');
          logout();
        }
      } catch {
        if (!cancelled) logout();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, logout]);

  // Session timer
  useEffect(() => {
    if (!token) return;
    const id = setInterval(() => {
      if (!adminLoginTimeRef.current) return;
      const remaining = ADMIN_SESSION_LIMIT - (Date.now() - adminLoginTimeRef.current);
      if (remaining <= 0) {
        logout();
        alert('관리자 세션이 만료되었습니다. 다시 로그인해주세요.');
        return;
      }
      const min = Math.floor(remaining / 60000);
      const sec = Math.floor((remaining % 60000) / 1000);
      setSessionTimer(`세션 ${min}:${sec < 10 ? '0' : ''}${sec}`);
    }, 1000);
    return () => clearInterval(id);
  }, [token, logout]);

  const loadStats = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch('/api/admin-dashboard?action=stats', { headers: apiHeaders() });
      const data = await res.json();
      if (!res.ok) return;
      setStats(data);
    } catch {}
  }, [token, apiHeaders]);

  const loadUsers = useCallback(
    async (page = 1, q = searchQ) => {
      if (!token) return;
      let url = `/api/admin-dashboard?action=users&page=${page}&limit=20`;
      if (q) url += `&search=${encodeURIComponent(q)}`;
      try {
        const res = await fetch(url, { headers: apiHeaders() });
        const data = await res.json();
        if (!res.ok) return;
        setUsers(data.users);
        setPagination(data.pagination);
      } catch {}
    },
    [token, apiHeaders, searchQ]
  );

  const loadLogs = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch('/api/admin-dashboard?action=logs&limit=50', {
        headers: apiHeaders(),
      });
      const data = await res.json();
      if (!res.ok) return;
      setLogs(data.logs);
    } catch {}
  }, [token, apiHeaders]);

  // Initial load
  useEffect(() => {
    if (!token) return;
    loadStats();
    loadUsers(1);
    loadLogs();
  }, [token, loadStats, loadUsers, loadLogs]);

  // Render charts when stats + Chart.js ready
  useEffect(() => {
    if (!stats || !chartJsReady || typeof window === 'undefined') return;
    const Chart = window.Chart;
    if (!Chart) return;

    Object.values(chartInstances.current).forEach((c) => c?.destroy?.());
    chartInstances.current = {};

    if (signupChartRef.current) {
      chartInstances.current.signup = new Chart(signupChartRef.current, {
        type: 'line',
        data: {
          labels: stats.signupTrend.map((r) => r.date.slice(5)),
          datasets: [
            {
              label: '가입',
              data: stats.signupTrend.map((r) => r.count),
              borderColor: '#60a5fa',
              backgroundColor: '#60a5fa20',
              fill: true,
              tension: 0.3,
            },
          ],
        },
        options: chartOpts(),
      });
    }

    if (toolChartRef.current) {
      chartInstances.current.tool = new Chart(toolChartRef.current, {
        type: 'doughnut',
        data: {
          labels: stats.toolUsage.map((r) => r.tool),
          datasets: [
            {
              data: stats.toolUsage.map((r) => r.count),
              backgroundColor: stats.toolUsage.map((r) => TOOL_COLORS[r.tool] || '#64748b'),
            },
          ],
        },
        options: {
          responsive: true,
          plugins: {
            legend: { position: 'bottom', labels: { color: '#94a3b8', font: { size: 11 } } },
          },
        },
      });
    }

    if (usageChartRef.current) {
      chartInstances.current.usage = new Chart(usageChartRef.current, {
        type: 'bar',
        data: {
          labels: stats.usageTrend.map((r) => r.date.slice(5)),
          datasets: [
            {
              label: '생성',
              data: stats.usageTrend.map((r) => r.count),
              backgroundColor: '#fbbf2480',
              borderColor: '#fbbf24',
              borderWidth: 1,
            },
          ],
        },
        options: chartOpts(),
      });
    }

    return () => {
      Object.values(chartInstances.current).forEach((c) => c?.destroy?.());
      chartInstances.current = {};
    };
  }, [stats, chartJsReady]);

  async function login() {
    setAuthError('');
    if (!email || !password) {
      setAuthError('이메일과 비밀번호를 입력하세요.');
      return;
    }
    try {
      const res = await fetch('/api/auth?action=login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAuthError(data.error || '로그인 실패');
        return;
      }
      const now = Date.now();
      adminLoginTimeRef.current = now;
      sessionStorage.setItem(
        ADMIN_SESSION_KEY,
        JSON.stringify({ token: data.token, loginTime: now })
      );
      setToken(data.token);
    } catch {
      setAuthError('서버 오류');
    }
  }

  async function adjustCredit(userEmail, rowKey, direction) {
    const amount = parseInt(creditAmounts[rowKey] || '1', 10);
    if (!amount || amount < 1) {
      setCreditResults((p) => ({ ...p, [rowKey]: { text: '1 이상', type: 'err' } }));
      return;
    }
    const delta = amount * direction;
    setCreditResults((p) => ({ ...p, [rowKey]: { text: '...', type: '' } }));
    try {
      const res = await fetch('/api/admin-dashboard?action=credit', {
        method: 'POST',
        headers: apiHeaders(),
        body: JSON.stringify({ email: userEmail, delta }),
      });
      const data = await res.json();
      if (!res.ok) {
        setCreditResults((p) => ({ ...p, [rowKey]: { text: data.error || '실패', type: 'err' } }));
        return;
      }
      setUsers((prev) =>
        prev.map((u) => (u.email === userEmail ? { ...u, credits: data.newCredits } : u))
      );
      setCreditResults((p) => ({
        ...p,
        [rowKey]: { text: `${delta > 0 ? '+' : ''}${delta} 완료`, type: 'ok' },
      }));
      setTimeout(() => {
        setCreditResults((p) => {
          const n = { ...p };
          delete n[rowKey];
          return n;
        });
      }, 3000);
    } catch {
      setCreditResults((p) => ({ ...p, [rowKey]: { text: '서버 오류', type: 'err' } }));
    }
  }

  if (!token) {
    return (
      <main className={styles.root}>
        <div className={styles.authCard}>
          <h2>관리자 대시보드</h2>
          <p className={styles.subtitle}>관리자 계정으로 로그인하세요</p>
          <input
            type="email"
            placeholder="이메일"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <input
            type="password"
            placeholder="비밀번호"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') login();
            }}
          />
          <button onClick={login}>로그인</button>
          {authError && <div className={styles.error}>{authError}</div>}
        </div>
      </main>
    );
  }

  return (
    <main className={styles.root}>
      <Script
        src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"
        strategy="afterInteractive"
        onLoad={() => setChartJsReady(true)}
      />
      <div className={styles.header}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <h1>뚝딱툴 관리자</h1>
          <span className={styles.badge}>ADMIN</span>
        </div>
        <div className={styles.headerRight}>
          <span className={styles.sessionTimer}>{sessionTimer}</span>
          <button className={styles.logoutBtn} onClick={logout}>
            로그아웃
          </button>
        </div>
      </div>

      <div className={styles.container}>
        <div className={styles.statsGrid}>
          {[
            { label: '총 가입자', value: stats?.summary?.totalUsers, color: styles.blue },
            { label: '오늘 가입', value: stats?.summary?.todaySignups, color: styles.green },
            { label: '오늘 생성', value: stats?.summary?.todayUsage, color: styles.amber },
            { label: '주간 활성 (7일)', value: stats?.summary?.weeklyActive, color: styles.purple },
          ].map((s) => (
            <div key={s.label} className={styles.statCard}>
              <div className={styles.label}>{s.label}</div>
              <div className={`${styles.value} ${s.color}`}>
                {s.value?.toLocaleString() ?? '-'}
              </div>
            </div>
          ))}
        </div>

        <div className={styles.chartsGrid}>
          <div className={styles.chartCard}>
            <h3>일별 가입 추이 (30일)</h3>
            <canvas ref={signupChartRef} />
          </div>
          <div className={styles.chartCard}>
            <h3>도구별 사용량 (30일)</h3>
            <canvas ref={toolChartRef} />
          </div>
          <div className={styles.chartCard}>
            <h3>일별 사용량 추이 (30일)</h3>
            <canvas ref={usageChartRef} />
          </div>
        </div>

        <div className={styles.tableCard}>
          <h3>사용자 목록</h3>
          <div className={styles.searchBar}>
            <input
              type="text"
              placeholder="이메일 또는 이름 검색..."
              value={searchQ}
              onChange={(e) => setSearchQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') loadUsers(1, searchQ);
              }}
            />
            <button onClick={() => loadUsers(1, searchQ)}>검색</button>
          </div>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>#</th>
                <th>이메일</th>
                <th>이름</th>
                <th>전화번호</th>
                <th>크레딧</th>
                <th>가입일</th>
                <th>크레딧 관리</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u, i) => {
                const num = (pagination.page - 1) * pagination.limit + i + 1;
                const rowKey = u.email;
                const result = creditResults[rowKey];
                return (
                  <tr key={rowKey}>
                    <td>{num}</td>
                    <td>{u.email}</td>
                    <td>{u.name || '-'}</td>
                    <td>{u.phone || '-'}</td>
                    <td>{u.credits}</td>
                    <td>{new Date(u.created_at).toLocaleDateString('ko-KR')}</td>
                    <td>
                      <div className={styles.creditActions}>
                        <input
                          type="number"
                          min="1"
                          max="9999"
                          value={creditAmounts[rowKey] || '1'}
                          onChange={(e) =>
                            setCreditAmounts((p) => ({ ...p, [rowKey]: e.target.value }))
                          }
                        />
                        <button
                          className={styles.btnAdd}
                          onClick={() => adjustCredit(u.email, rowKey, 1)}
                        >
                          +
                        </button>
                        <button
                          className={styles.btnSub}
                          onClick={() => adjustCredit(u.email, rowKey, -1)}
                        >
                          -
                        </button>
                        {result && (
                          <span className={`${styles.creditResult} ${styles[result.type] || ''}`}>
                            {result.text}
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className={styles.pagination}>
            <button
              disabled={pagination.page <= 1}
              onClick={() => loadUsers(pagination.page - 1)}
            >
              &lt;
            </button>
            {Array.from({ length: pagination.pages }, (_, i) => i + 1).map((p) => (
              <button
                key={p}
                className={p === pagination.page ? styles.active : ''}
                onClick={() => loadUsers(p)}
              >
                {p}
              </button>
            ))}
            <button
              disabled={pagination.page >= pagination.pages}
              onClick={() => loadUsers(pagination.page + 1)}
            >
              &gt;
            </button>
          </div>
        </div>

        <div className={styles.tableCard}>
          <h3>최근 사용 로그 (50건)</h3>
          <div>
            {logs.map((log, i) => {
              const time = new Date(log.created_at).toLocaleString('ko-KR', {
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
              });
              const tool = log.tool || 'unknown';
              const toolCls = TOOL_STYLE_MAP[tool] || styles.toolDefault;
              return (
                <div key={i} className={styles.logRow}>
                  <span className={styles.logTime}>{time}</span>
                  <span className={`${styles.logTool} ${toolCls}`}>
                    {tool}
                    {log.mode ? `:${log.mode}` : ''}
                  </span>
                  <span className={styles.logEmail}>{log.user_email || log.ip || '-'}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </main>
  );
}
