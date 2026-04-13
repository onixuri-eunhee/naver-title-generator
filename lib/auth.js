'use client';

const TOKEN_KEY = 'ddukddak_token';
const USER_KEY = 'ddukddak_user';

export function getToken() {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function getUser() {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export function setAuth(token, user) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearAuth() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export async function fetchUser(token) {
  try {
    const res = await fetch('/api/auth?action=me', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 401) {
      return { unauthorized: true };
    }
    if (!res.ok) {
      return { networkError: true };
    }
    return await res.json();
  } catch {
    return { networkError: true };
  }
}

export async function logout() {
  const token = getToken();
  if (token) {
    fetch('/api/auth?action=logout', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    }).catch(() => {});
  }
  clearAuth();
}
