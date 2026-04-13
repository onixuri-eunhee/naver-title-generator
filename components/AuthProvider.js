'use client';

import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { getToken, getUser, setAuth, clearAuth, fetchUser, logout as doLogout } from '@/lib/auth';

const AuthContext = createContext(null);

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

// Module-scoped single-install pattern: patch is installed exactly once,
// token is a mutable reference so logout clears injection immediately.
let currentAdminToken = null;
let fetchPatched = false;

function ensureAdminFetchPatch() {
  if (fetchPatched || typeof window === 'undefined') return;
  const originalFetch = window.fetch;
  window.fetch = function (url, opts = {}) {
    if (currentAdminToken && typeof url === 'string' && url.startsWith('/api/')) {
      opts.headers = opts.headers || {};
      if (!opts.headers.Authorization && !opts.headers.authorization) {
        opts.headers.Authorization = `Bearer ${currentAdminToken}`;
      }
    }
    return originalFetch.call(this, url, opts);
  };
  fetchPatched = true;
}

function setAdminToken(token) {
  currentAdminToken = token;
  if (token) ensureAdminFetchPatch();
}

export default function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const cached = getUser();
    const token = getToken();

    // Cache hit → show immediately and mark loading done
    if (cached) {
      setUser(cached);
      setLoading(false);
    }

    if (!token) {
      setLoading(false);
      return;
    }

    // Background refresh: verify token + sync latest user state
    fetchUser(token).then((data) => {
      if (!data || data.networkError) {
        // Keep cache — no state change needed
      } else if (data.unauthorized) {
        clearAuth();
        setUser(null);
        setAdminToken(null);
      } else {
        setAuth(token, data);
        setUser(data);
        if (data.isAdmin) setAdminToken(token);
      }
      setLoading(false);
    });
  }, []);

  const login = useCallback((token, userData) => {
    setAuth(token, userData);
    setUser(userData);
    if (userData.isAdmin) setAdminToken(token);
  }, []);

  const logout = useCallback(async () => {
    setAdminToken(null);
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
