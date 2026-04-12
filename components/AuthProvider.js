'use client';

import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { getToken, getUser, setAuth, clearAuth, fetchUser, logout as doLogout } from '@/lib/auth';

const AuthContext = createContext(null);

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

export default function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // 초기에 캐시된 유저 먼저 표시 (FOUC 방지)
    const cached = getUser();
    if (cached) setUser(cached);

    const token = getToken();
    if (!token) { setLoading(false); return; }

    fetchUser(token).then((data) => {
      if (!data || data.networkError) {
        // 네트워크 장애: 캐시 유지
      } else if (data.unauthorized) {
        // 401: 토큰 무효 → 로그아웃
        clearAuth();
        setUser(null);
      } else {
        setAuth(token, data);
        setUser(data);
        if (data.isAdmin) setupAdminFetch(token);
      }
      setLoading(false);
    });
  }, []);

  const login = useCallback((token, userData) => {
    setAuth(token, userData);
    setUser(userData);
    if (userData.isAdmin) setupAdminFetch(token);
  }, []);

  const logout = useCallback(async () => {
    await doLogout();
    setUser(null);
    window.location.href = '/';
  }, []);

  const refreshUser = useCallback(async () => {
    const token = getToken();
    if (!token) return;
    const data = await fetchUser(token);
    if (data && !data.networkError && !data.unauthorized) {
      setAuth(token, data);
      setUser(data);
    }
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

function setupAdminFetch(token) {
  if (typeof window === 'undefined') return;
  const originalFetch = window.fetch;
  window.fetch = function (url, opts = {}) {
    if (typeof url === 'string' && url.startsWith('/api/')) {
      opts.headers = opts.headers || {};
      if (!opts.headers.Authorization && !opts.headers.authorization) {
        opts.headers.Authorization = `Bearer ${token}`;
      }
    }
    return originalFetch.call(this, url, opts);
  };
}
