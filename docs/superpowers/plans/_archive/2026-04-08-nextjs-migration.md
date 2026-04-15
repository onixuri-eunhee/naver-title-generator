# Next.js 전환 (정적 HTML → App Router) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 뚝딱툴의 66개 정적 HTML + 32개 API 파일을 Next.js App Router로 전환하여 소스 코드 보호(SSR), 컴포넌트 재사용, 유지보수성을 확보한다.

**Architecture:** Next.js 15 App Router + React 19. 프론트엔드 페이지를 `app/` 디렉토리로 이전하고, API 라우트는 `pages/api/`(기존 Vercel serverless 패턴 호환)로 복사하여 최소 변경. 공통 Navbar/Footer/AuthProvider를 추출하여 모든 페이지에서 재사용. 칼럼 34편은 MDX 또는 동적 라우트로 통합.

**Tech Stack:** Next.js 15, React 19, **TypeScript (경계만 — API 라우트 / lib/* / Server Actions / 핵심 상태 타입은 TS, React 컴포넌트는 JS + JSDoc)**, Tailwind CSS (기존 인라인 스타일 점진적 전환), Vercel 배포

**Deadline:** 5/2~5/5 정식 오픈 (4/13 연기 결정 — 원래 4/25였으나 품질 확보 우선)

**결정 기록 (4/13):**
- 4/25 오픈 연기: 유료 오픈 전 품질 확보 원칙. 12일 안에 16 태스크 전면 전환 리스크 큼. 연기는 가역적, 품질 실패는 비가역적.
- TypeScript 경계 적용: 타입 이익의 80%는 경계(API, lib, Server Actions)에서 나옴. 3885줄 blog-writer + 3265줄 shortform을 전부 TS화하면 데드라인 못 맞춤. 컴포넌트 내부는 JSDoc로 보조.
- Hierarchical AI 오케스트레이션 레이어: Task 17로 분리하지 않고 blog-writer(Task 9)에서 **먼저 구현** → shortform(Task 11)에서 패턴 재사용 → 공통점 추출해 `lib/ai/orchestrator.ts`로 이관. "추상화는 3번째 사용 때" 원칙.
- Worktree 격리: main 브랜치는 오픈 준비 + 핫픽스용으로 유지. Next.js 전환은 별도 worktree(`/Users/gong-eunhui/Desktop/naver-title-generator-nextjs/`)에서 진행.

---

## 전략적 판단

### API 라우트: 최소 변경 원칙
기존 32개 API 파일은 `module.exports = async function(req, res)` 패턴. Next.js Pages Router의 `/pages/api/`는 이 패턴을 그대로 지원하므로, **파일 복사 + export 문법만 조정**하면 동작한다. App Router의 Route Handler (`export async function POST(request)`)로 전환하면 `req.body`, `res.status().json()` 등 전체 수정이 필요하므로 **Phase 1에서는 Pages Router API를 사용**한다.

### 페이지 우선순위
1. **핵심 도구** (index, blog-writer, blog-image-pro, hook, threads, card-news, keyword, shortform) — 매출/사용자 직결
2. **인증/결제** (login, signup, mypage, pricing, payment-success/fail) — 핵심 플로우
3. **정보 페이지** (guide, about, column, legal) — SEO 중요하지만 복잡도 낮음
4. **칼럼 34편** — 동적 라우트로 대폭 축소 가능

### 파일 구조 (최종)

```
app/
  layout.js              ← 전역 레이아웃 (Navbar + Footer + AuthProvider + GA + AdSense)
  page.js                ← index (제목 생성기)
  globals.css            ← 공통 CSS (Noto Sans KR, 오렌지 액센트, 다크 히어로 등)
  (auth)/
    login/page.js
    signup/page.js
  mypage/page.js
  pricing/page.js
  payment-success/page.js
  payment-fail/page.js
  blog-writer/page.js
  blog-image-pro/page.js
  hook-generator/page.js
  threads/page.js
  threads-writer/page.js
  card-news/page.js
  keyword-finder/page.js
  shortform/page.js
  guide/page.js
  about/page.js
  column/page.js         ← 칼럼 인덱스
  column/[slug]/page.js  ← 칼럼 상세 (동적 라우트)
  terms/page.js
  privacy/page.js
  privacy-meta/page.js
  refund-policy/page.js
  contact/page.js
  hooking-psychology/page.js
  naver-blog-title-importance/page.js
  admin/page.js
  admin-dashboard/page.js
  not-found.js           ← 404
components/
  Navbar.js
  Footer.js
  AuthProvider.js        ← React Context (token, user, login, logout)
  AdminMode.js           ← fetch interceptor (useEffect)
  SignupBanner.js
  AdSense.js
lib/
  auth.js                ← getToken, getUser, logout 유틸
  utils.js               ← clipCopy, escapeHtml
  constants.js           ← 네비 순서, 공통 상수
public/
  favicon.svg
  og-default.jpg
  navbar-mobile.css      ← (globals.css로 통합 후 삭제)
  robots.txt
  sitemap.xml
  llms.txt
  images/                ← 기존 이미지 에셋
pages/
  api/                   ← 기존 API 파일 복사 (최소 변경)
    _helpers.js
    _db.js
    _r2.js
    _satori-renderer.js
    _satori-templates.js
    _card-news-themes.js
    _card-news-layouts.js
    auth.js
    titles.js
    generate.js
    hooks.js
    keywords.js
    blog-image.js
    blog-image-pro.js
    card-news.js
    card-news-themes.js
    threads.js
    threads-publish.js
    threads-schedule.js
    threads-callback.js
    threads-auth.js
    presets.js
    admin.js
    admin-init-db.js
    admin-dashboard.js
    payment-confirm.js
    payment-client-key.js
    shortform-script.js
    shortform-stt.js
    shortform-tts.js
    shortform-broll.js
    shortform-refund.js
data/
  columns/               ← 칼럼 데이터 (JSON or MDX)
    001.json ... 034.json
```

---

## Task 1: Next.js 프로젝트 초기화 + 기존 코드 백업

**Files:**
- Create: `next.config.js`, `app/layout.js`, `app/globals.css`, `app/page.js`, `jsconfig.json`
- Modify: `package.json`, `.gitignore`

- [ ] **Step 1: 기존 코드를 `legacy/` 브랜치로 백업**

```bash
git checkout -b legacy/static-html
git push -u origin legacy/static-html
git checkout main
git checkout -b feat/nextjs-migration
```

- [ ] **Step 2: Next.js 의존성 설치**

```bash
npm install next@15 react@19 react-dom@19
```

- [ ] **Step 3: package.json scripts 추가**

`package.json`의 `scripts`에 추가:
```json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "railway:shortform-stt": "node services/shortform-stt-service/server.js",
    "remotion:render-shortform": "node scripts/render-shortform-remotion.mjs"
  }
}
```

- [ ] **Step 4: next.config.js 생성**

```js
/** @type {import('next').NextConfig} */
const nextConfig = {
  // 기존 HTML URL 호환을 위한 리다이렉트
  async redirects() {
    return [
      // 기존 .html URL → 새 URL로 301 리다이렉트
      { source: '/index.html', destination: '/', permanent: true },
      { source: '/blog-writer.html', destination: '/blog-writer', permanent: true },
      { source: '/blog-image-pro.html', destination: '/blog-image-pro', permanent: true },
      { source: '/blog-image.html', destination: '/blog-image-pro', permanent: true },
      { source: '/hook-generator.html', destination: '/hook-generator', permanent: true },
      { source: '/threads.html', destination: '/threads', permanent: true },
      { source: '/threads-writer.html', destination: '/threads-writer', permanent: true },
      { source: '/card-news.html', destination: '/card-news', permanent: true },
      { source: '/keyword-finder.html', destination: '/keyword-finder', permanent: true },
      { source: '/shortform.html', destination: '/shortform', permanent: true },
      { source: '/login.html', destination: '/login', permanent: true },
      { source: '/signup.html', destination: '/signup', permanent: true },
      { source: '/mypage.html', destination: '/mypage', permanent: true },
      { source: '/pricing.html', destination: '/pricing', permanent: true },
      { source: '/guide.html', destination: '/guide', permanent: true },
      { source: '/about.html', destination: '/about', permanent: true },
      { source: '/column.html', destination: '/column', permanent: true },
      { source: '/terms.html', destination: '/terms', permanent: true },
      { source: '/privacy.html', destination: '/privacy', permanent: true },
      { source: '/privacy-meta.html', destination: '/privacy-meta', permanent: true },
      { source: '/refund-policy.html', destination: '/refund-policy', permanent: true },
      { source: '/contact.html', destination: '/contact', permanent: true },
      { source: '/payment-success.html', destination: '/payment-success', permanent: true },
      { source: '/payment-fail.html', destination: '/payment-fail', permanent: true },
      { source: '/404.html', destination: '/not-found', permanent: true },
      { source: '/admin-8524.html', destination: '/admin-dashboard', permanent: true },
      { source: '/hooking-psychology.html', destination: '/hooking-psychology', permanent: true },
      { source: '/naver-blog-title-importance.html', destination: '/naver-blog-title-importance', permanent: true },
      // 칼럼 리다이렉트: column-001.html → /column/001
      // 33개 번호 칼럼(001~033) 존재. column-template.html은 내부용, 공개 URL 없음. (2026-04-13 기준)
      ...Array.from({ length: 33 }, (_, i) => {
        const num = String(i + 1).padStart(3, '0');
        return { source: `/column-${num}.html`, destination: `/column/${num}`, permanent: true };
      }),
    ];
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(self), geolocation=()' },
          { key: 'X-DNS-Prefetch-Control', value: 'on' },
        ],
      },
    ];
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'cdn.ddukddaktool.co.kr' },
    ],
  },
};

module.exports = nextConfig;
```

- [ ] **Step 5: jsconfig.json 생성 (경로 별칭)**

```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["./*"],
      "@/components/*": ["components/*"],
      "@/lib/*": ["lib/*"]
    }
  }
}
```

- [ ] **Step 6: .gitignore에 Next.js 항목 추가**

`.gitignore`에 추가:
```
.next/
out/
```

- [ ] **Step 7: 빌드 확인**

```bash
npx next build
```
Expected: 빌드 성공 (빈 app이지만 에러 없음)

- [ ] **Step 8: 커밋**

```bash
git add package.json package-lock.json next.config.js jsconfig.json .gitignore
git commit -m "chore: Next.js 15 초기화 + .html 리다이렉트 설정"
```

---

## Task 2: 공통 CSS + 전역 레이아웃

**Files:**
- Create: `app/globals.css`, `app/layout.js`
- Reference: 기존 `index.html`의 `<style>` 블록, `navbar-mobile.css`

- [ ] **Step 1: globals.css — 기존 공통 스타일 추출**

기존 HTML 파일들에서 반복되는 CSS를 추출한다. `app/globals.css`:

```css
@import url('https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@300;400;500;600;700;900&display=swap');

:root {
  --accent: #ff5f1f;
  --accent-hover: #e5551b;
  --hero-gradient: linear-gradient(135deg, #1A1A2E, #16213E, #0F3460);
  --text-primary: #1a1a1a;
  --text-secondary: #555;
  --text-muted: #888;
  --bg-primary: #fff;
  --bg-secondary: #f5f5f5;
  --border: #e0e0e0;
  --radius: 12px;
  --max-width: 860px;
}

* { margin: 0; padding: 0; box-sizing: border-box; }

body {
  font-family: 'Noto Sans KR', -apple-system, BlinkMacSystemFont, sans-serif;
  color: var(--text-primary);
  background: var(--bg-primary);
  line-height: 1.6;
}

a { color: inherit; text-decoration: none; }

/* ── 네비게이션 바 ── */
.navbar {
  position: sticky;
  top: 0;
  z-index: 1000;
  background: #fff;
  border-bottom: 1px solid var(--border);
  padding: 0 20px;
}
.navbar-inner {
  max-width: 1200px;
  margin: 0 auto;
  display: flex;
  align-items: center;
  height: 56px;
  gap: 8px;
}
.navbar-logo {
  font-weight: 900;
  font-size: 1.25rem;
  color: var(--text-primary);
  margin-right: 16px;
  white-space: nowrap;
}
.navbar-logo span { color: #2ecc71; }
.navbar-links {
  display: flex;
  align-items: center;
  gap: 4px;
  overflow-x: auto;
  flex: 1;
}
.navbar-links::-webkit-scrollbar { display: none; }
.navbar-links a {
  font-size: 0.85rem;
  padding: 6px 10px;
  border-radius: 6px;
  white-space: nowrap;
  transition: background 0.2s;
  position: relative;
}
.navbar-links a:hover { background: #f5f5f5; }
.navbar-links a.active { color: var(--accent); font-weight: 600; }
.navbar-auth {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
  white-space: nowrap;
}
.pro-badge {
  font-size: 0.6rem;
  background: #7c3aed;
  color: #fff;
  padding: 1px 4px;
  border-radius: 3px;
  margin-left: 2px;
  vertical-align: super;
}
.new-badge {
  font-size: 0.6rem;
  background: #ef4444;
  color: #fff;
  padding: 1px 4px;
  border-radius: 3px;
  margin-left: 2px;
  vertical-align: super;
}

/* ── 모바일 네비바 ── */
@media (max-width: 768px) {
  .navbar-inner {
    flex-wrap: wrap;
    height: auto;
    padding: 8px 0;
  }
  .navbar-links {
    width: 100%;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    padding: 4px 0;
  }
  .navbar-links::-webkit-scrollbar { display: none; }
  .navbar-links a { font-size: 0.8rem; padding: 4px 8px; }
  .navbar-auth { font-size: 0.85rem; }
}

/* ── 푸터 ── */
.footer {
  background: #f8f8f8;
  border-top: 1px solid var(--border);
  padding: 40px 20px;
  margin-top: 60px;
  font-size: 0.85rem;
  color: var(--text-muted);
  text-align: center;
}
.footer-inner {
  max-width: 700px;
  margin: 0 auto;
  line-height: 1.8;
}
.footer-links {
  margin-top: 12px;
}
.footer-links a {
  color: var(--text-secondary);
  margin: 0 8px;
  text-decoration: underline;
}

/* ── 히어로 배너 ── */
.hero {
  background: var(--hero-gradient);
  color: #fff;
  padding: 48px 20px;
  text-align: center;
}
.hero h1 { font-size: 2rem; font-weight: 900; margin-bottom: 12px; }
.hero p { font-size: 1.1rem; opacity: 0.9; }

/* ── 버튼 공통 ── */
.btn-primary {
  background: var(--accent);
  color: #fff;
  border: none;
  padding: 12px 24px;
  border-radius: var(--radius);
  font-size: 1rem;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.2s;
}
.btn-primary:hover { background: var(--accent-hover); }
.btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }

/* ── 컨테이너 ── */
.container {
  max-width: var(--max-width);
  margin: 0 auto;
  padding: 32px 20px;
}
```

- [ ] **Step 2: app/layout.js — 전역 레이아웃 뼈대**

```jsx
import './globals.css';
import Script from 'next/script';

export const metadata = {
  title: { default: '뚝딱툴 — AI 블로그 마케팅 도구', template: '%s | 뚝딱툴' },
  description: 'AI로 네이버 블로그 제목, 글, 이미지, 카드뉴스, 숏폼 영상을 뚝딱 만들어보세요.',
  metadataBase: new URL('https://ddukddaktool.co.kr'),
  openGraph: {
    siteName: '뚝딱툴',
    locale: 'ko_KR',
    type: 'website',
    images: ['/og-default.jpg'],
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="ko">
      <head>
        <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
      </head>
      <body>
        {/* Google Analytics */}
        <Script
          src="https://www.googletagmanager.com/gtag/js?id=G-C61VWMGQ8R"
          strategy="afterInteractive"
        />
        <Script id="ga-init" strategy="afterInteractive">
          {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('js',new Date());gtag('config','G-C61VWMGQ8R');`}
        </Script>
        {/* Google AdSense */}
        <Script
          src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-4973804132466200"
          crossOrigin="anonymous"
          strategy="afterInteractive"
        />
        {children}
      </body>
    </html>
  );
}
```

참고: Navbar/Footer는 Task 3에서 컴포넌트화 후 여기에 삽입.

- [ ] **Step 3: 빌드 확인**

```bash
npx next build
```

- [ ] **Step 4: 커밋**

```bash
git add app/globals.css app/layout.js
git commit -m "feat: 전역 CSS + RootLayout 뼈대 (GA, AdSense, 메타데이터)"
```

---

## Task 3: 공통 컴포넌트 — Navbar, Footer, AuthProvider

**Files:**
- Create: `components/Navbar.js`, `components/Footer.js`, `components/AuthProvider.js`, `lib/auth.js`, `lib/constants.js`
- Modify: `app/layout.js`

- [ ] **Step 1: lib/constants.js — 네비 메뉴 데이터**

```js
export const NAV_ITEMS = [
  { href: '/guide', label: '사용법' },
  { href: '/', label: '제목' },
  { href: '/hook-generator', label: '후킹' },
  { href: '/threads', label: '스레드' },
  { href: '/blog-writer', label: '블로그 글', badge: 'pro' },
  { href: '/blog-image-pro', label: '이미지', badge: 'pro' },
  { href: '/card-news', label: '카드뉴스', badge: 'pro' },
  { href: '/column', label: '칼럼', badge: 'new' },
  { href: '/keyword-finder', label: '황금키워드', badge: 'new' },
  { href: '/shortform', label: '숏폼', badge: 'new' },
];
```

- [ ] **Step 2: lib/auth.js — 클라이언트 인증 유틸**

```js
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
  const res = await fetch('/api/auth?action=me', {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data;
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
```

- [ ] **Step 3: components/AuthProvider.js — React Context**

```jsx
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

  // 페이지 로드 시 세션 확인
  useEffect(() => {
    const token = getToken();
    if (!token) { setLoading(false); return; }

    fetchUser(token).then((data) => {
      if (data) {
        setAuth(token, data);
        setUser(data);
        // Admin일 때 fetch interceptor 설정
        if (data.isAdmin) setupAdminFetch(token);
      } else {
        clearAuth();
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
    if (data) {
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

// Admin fetch interceptor (기존 admin-mode.js 로직)
function setupAdminFetch(token) {
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
```

- [ ] **Step 4: components/Navbar.js**

```jsx
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from './AuthProvider';
import { NAV_ITEMS } from '@/lib/constants';

export default function Navbar() {
  const pathname = usePathname();
  const { user, loading } = useAuth();

  return (
    <nav className="navbar">
      <div className="navbar-inner">
        <Link href="/" className="navbar-logo">
          뚝딱<span>툴</span>
        </Link>
        <div className="navbar-links">
          {NAV_ITEMS.map(({ href, label, badge }) => (
            <Link
              key={href}
              href={href}
              className={pathname === href ? 'active' : ''}
            >
              {label}
              {badge === 'pro' && <span className="pro-badge">PRO</span>}
              {badge === 'new' && <span className="new-badge">NEW</span>}
            </Link>
          ))}
        </div>
        <div className="navbar-auth">
          {loading ? null : user ? (
            <>
              <span style={{ fontSize: '0.9rem' }}>{user.name || user.email}</span>
              <Link href="/mypage" style={{ fontSize: '0.85rem', color: '#555' }}>
                마이페이지
              </Link>
            </>
          ) : (
            <>
              <Link href="/login" style={{ fontSize: '0.85rem' }}>로그인</Link>
              <Link
                href="/signup"
                style={{
                  fontSize: '0.85rem',
                  background: 'var(--accent)',
                  color: '#fff',
                  padding: '6px 14px',
                  borderRadius: '6px',
                }}
              >
                회원가입
              </Link>
            </>
          )}
        </div>
      </div>
    </nav>
  );
}
```

- [ ] **Step 5: components/Footer.js**

```jsx
import Link from 'next/link';

export default function Footer() {
  return (
    <footer className="footer">
      <div className="footer-inner">
        <p><strong>어나더핸즈</strong> | 대표: 공은희</p>
        <p>사업자등록번호: 849-29-01690 | 통신판매업 신고번호: 2025-서울강남-01234</p>
        <p>서울특별시 강남구 도산대로 317, 8층</p>
        <p>전화: 010-8584-3283 | 이메일: lboss.reboot@gmail.com</p>
        <div className="footer-links">
          <Link href="/terms">이용약관</Link>
          <Link href="/privacy">개인정보처리방침</Link>
          <Link href="/refund-policy">환불규정</Link>
        </div>
        <p style={{ marginTop: 12 }}>&copy; 2026 뚝딱툴. All rights reserved.</p>
      </div>
    </footer>
  );
}
```

- [ ] **Step 6: app/layout.js에 공통 컴포넌트 삽입**

```jsx
import './globals.css';
import Script from 'next/script';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import AuthProvider from '@/components/AuthProvider';

export const metadata = {
  title: { default: '뚝딱툴 — AI 블로그 마케팅 도구', template: '%s | 뚝딱툴' },
  description: 'AI로 네이버 블로그 제목, 글, 이미지, 카드뉴스, 숏폼 영상을 뚝딱 만들어보세요.',
  metadataBase: new URL('https://ddukddaktool.co.kr'),
  openGraph: {
    siteName: '뚝딱툴',
    locale: 'ko_KR',
    type: 'website',
    images: ['/og-default.jpg'],
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="ko">
      <head>
        <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
      </head>
      <body>
        <Script
          src="https://www.googletagmanager.com/gtag/js?id=G-C61VWMGQ8R"
          strategy="afterInteractive"
        />
        <Script id="ga-init" strategy="afterInteractive">
          {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('js',new Date());gtag('config','G-C61VWMGQ8R');`}
        </Script>
        <Script
          src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-4973804132466200"
          crossOrigin="anonymous"
          strategy="afterInteractive"
        />
        <AuthProvider>
          <Navbar />
          <main>{children}</main>
          <Footer />
        </AuthProvider>
      </body>
    </html>
  );
}
```

- [ ] **Step 7: 빌드 확인**

```bash
npx next build
```

- [ ] **Step 8: 커밋**

```bash
git add components/ lib/ app/layout.js
git commit -m "feat: Navbar + Footer + AuthProvider 공통 컴포넌트"
```

---

## Task 4: API 라우트 이전 (pages/api/)

**Files:**
- Create: `pages/api/` (기존 `api/` 폴더의 32개 파일 복사)
- Modify: 각 파일의 export 패턴 확인

- [ ] **Step 1: 기존 API 파일을 pages/api/로 복사**

```bash
mkdir -p pages/api
cp api/*.js pages/api/
```

- [ ] **Step 2: export 패턴 확인**

기존 파일들이 `module.exports = async function handler(req, res)` 패턴을 쓰는지 확인. Next.js Pages Router API는 `export default function handler(req, res)` 패턴을 요구한다.

각 API 파일에서 `module.exports` → `export default`로 변환:

```bash
# 확인: 모든 API 파일의 export 패턴
grep -l "module.exports" pages/api/*.js
```

각 파일에서:
```js
// Before
module.exports = async function handler(req, res) { ... }
// After  
export default async function handler(req, res) { ... }
```

helper 파일(`_helpers.js`, `_db.js`, `_r2.js` 등)은 `module.exports`를 유지해도 된다 (Next.js가 CJS 지원).
다만 API 엔드포인트 파일(export default가 필요한 파일)만 변환한다.

- [ ] **Step 3: config export 확인**

`shortform-stt.js`의 bodyParser 비활성화 등 특수 config가 있는 파일:

```js
// shortform-stt.js
export const config = { api: { bodyParser: false } };
export default async function handler(req, res) { ... }
```

`blog-image-pro.js`:
```js
export const config = { maxDuration: 300 };
```

각 파일에서 기존 `module.exports.config` 패턴이 있으면 `export const config`로 변환.

- [ ] **Step 4: helper import 경로 확인**

기존 API 파일에서 `require('./_helpers')` 패턴은 `pages/api/_helpers.js`를 정상적으로 참조한다 (같은 디렉토리). 경로 변경 불필요.

- [ ] **Step 5: 기존 root api/ 폴더에서 충돌 방지**

Next.js가 `pages/api/`를 사용하므로 root `api/` 폴더가 충돌할 수 있다. 기존 `api/` 폴더를 `_legacy-api/`로 이름 변경:

```bash
mv api _legacy-api
```

- [ ] **Step 6: vercel.json rewrites 정리**

Next.js가 `/pages/api/*`를 자동으로 라우팅하므로, `vercel.json`의 API rewrites를 제거한다. headers만 유지 (next.config.js에서도 설정했으므로 vercel.json 자체를 최소화):

```json
{}
```

(headers와 redirects는 모두 `next.config.js`에서 관리)

- [ ] **Step 7: 로컬 dev 서버 확인**

```bash
npm run dev
# 브라우저에서 http://localhost:3000/api/auth?action=me 호출 확인
```

Expected: 401 또는 정상 응답 (Redis 연결 필요)

- [ ] **Step 8: 커밋**

```bash
git add pages/api/ vercel.json
git rm -r api/  # 또는 git mv api _legacy-api
git commit -m "feat: API 라우트를 pages/api/로 이전 (export default 변환)"
```

---

## Task 5: 첫 번째 페이지 전환 — index.html (제목 생성기)

**Files:**
- Create: `app/page.js`, `lib/utils.js`
- Reference: 기존 `index.html` (1349줄)

- [ ] **Step 1: lib/utils.js 생성**

기존 `utils.js`에서 추출:
```js
export function clipCopy(text) {
  if (navigator.clipboard) {
    return navigator.clipboard.writeText(text);
  }
  return fallbackCopy(text);
}

function fallbackCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  document.execCommand('copy');
  document.body.removeChild(ta);
}

export function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}
```

- [ ] **Step 2: index.html 분석 → app/page.js 작성**

기존 `index.html`의 구조를 분석하여 React 컴포넌트로 변환한다:
- Hero 배너 (다크 네이비)
- 키워드 입력 폼
- 카테고리 선택
- 생성 버튼 + 로딩 상태
- 결과 카드 24개 (12패턴 × 2)
- 각 결과의 복사 버튼

`app/page.js`를 `'use client'`로 작성. 기존 `<script>` 블록의 JS 로직을 React state/effect로 변환:
- `useState`: keyword, category, titles, loading, remaining
- `useEffect`: 없음 (폼 제출 기반)
- API 호출: `fetch('/api/titles', { method: 'POST', ... })`

**핵심**: 기존 HTML의 인라인 `<style>`은 `globals.css`에 이미 공통화된 부분을 쓰고, 페이지 고유 스타일만 CSS Modules 또는 인라인으로 처리.

이 단계에서는 기존 `index.html`을 읽고 1:1로 React로 포팅한다. 기능 추가/변경 없이 동일한 UI와 동작을 재현.

- [ ] **Step 3: dev 서버에서 시각적 확인**

```bash
npm run dev
# http://localhost:3000 에서 원본과 동일한 UI 확인
```

- [ ] **Step 4: 커밋**

```bash
git add app/page.js lib/utils.js
git commit -m "feat: 제목 생성기 (index) Next.js 전환"
```

---

## Task 6: 인증 페이지 전환 — login, signup

**Files:**
- Create: `app/(auth)/login/page.js`, `app/(auth)/signup/page.js`
- Reference: `login.html` (276줄), `signup.html` (311줄)

- [ ] **Step 1: app/(auth)/login/page.js**

기존 `login.html`에서 폼 + API 호출 로직을 React로 변환:
- `useState`: email, password, error, loading
- 폼 제출 → `fetch('/api/auth?action=login', { method: 'POST', body: JSON.stringify({ email, password }) })`
- 성공 시: `useAuth().login(token, user)` → `router.push('/')`
- `useRouter` from `next/navigation`

```jsx
'use client';
export const metadata = undefined; // 클라이언트 컴포넌트에선 metadata를 별도 layout에서 처리

// 페이지 메타데이터는 app/(auth)/login/layout.js 또는 generateMetadata로 처리
```

- [ ] **Step 2: app/(auth)/signup/page.js**

기존 `signup.html` 변환:
- 이메일, 비밀번호, 이름, 전화번호 폼
- 이용약관/개인정보처리방침/환불규정 동의 체크박스 3개
- API: `fetch('/api/auth?action=signup', { method: 'POST', ... })`
- 성공 시: 자동 로그인 + 리다이렉트

- [ ] **Step 3: 로그인 → 회원가입 → 마이페이지 플로우 테스트**

```bash
npm run dev
# 1. /signup 회원가입
# 2. /login 로그인
# 3. 네비바에 사용자 이름 표시 확인
```

- [ ] **Step 4: 커밋**

```bash
git add app/\(auth\)/
git commit -m "feat: 로그인/회원가입 페이지 Next.js 전환"
```

---

## Task 7: 마이페이지 + 결제 페이지 전환

**Files:**
- Create: `app/mypage/page.js`, `app/pricing/page.js`, `app/payment-success/page.js`, `app/payment-fail/page.js`
- Reference: `mypage.html` (488줄), `pricing.html` (575줄), `payment-success.html`, `payment-fail.html`

- [ ] **Step 1: app/mypage/page.js**

- 프로필 정보 (이름, 이메일)
- 크레딧 잔액 표시
- 구매 내역 (credit_ledger)
- 로그아웃 버튼
- 비로그인 시 로그인 페이지로 리다이렉트

- [ ] **Step 2: app/pricing/page.js**

- 크레딧 상품 안내 (30크레딧 = 9,900원)
- Toss Payments SDK 로드 + 결제 요청
- `TOSS_CLIENT_KEY`는 `/api/payment-client-key`에서 fetch

- [ ] **Step 3: payment-success/fail 페이지**

- `payment-success`: query param에서 `paymentKey`, `orderId`, `amount` 추출 → `/api/payment-confirm` 호출
- `payment-fail`: 에러 메시지 표시

- [ ] **Step 4: 결제 플로우 테스트 (테스트 모드)**

```bash
npm run dev
# /pricing → 결제 → /payment-success 또는 /payment-fail 확인
```

- [ ] **Step 5: 커밋**

```bash
git add app/mypage/ app/pricing/ app/payment-success/ app/payment-fail/
git commit -m "feat: 마이페이지 + 크레딧 결제 Next.js 전환"
```

---

## Task 8: 핵심 도구 페이지 전환 (1) — hook-generator, threads, threads-writer

**Files:**
- Create: `app/hook-generator/page.js`, `app/threads/page.js`, `app/threads-writer/page.js`
- Reference: `hook-generator.html` (896줄), `threads.html` (1121줄), `threads-writer.html` (735줄)

이 3개는 복잡도가 상대적으로 낮다 (900~1100줄).

- [ ] **Step 1: app/hook-generator/page.js**

- 키워드 입력 → `/api/hooks` POST → 15개 후킹 문구 결과
- 복사 버튼 (clipCopy)
- 사용법 참조: guide.html

- [ ] **Step 2: app/threads/page.js**

- 주제/톤 선택 → `/api/threads` POST → 3개 변형 결과
- Threads 계정 연동 (OAuth): `/api/threads-auth`
- 즉시 게시 / 예약 게시 기능

- [ ] **Step 3: app/threads-writer/page.js**

- 텍스트 입력 → 스레드 형식 변환
- 직접 작성 모드

- [ ] **Step 4: 각 페이지 동작 확인**

```bash
npm run dev
# /hook-generator, /threads, /threads-writer 확인
```

- [ ] **Step 5: 커밋**

```bash
git add app/hook-generator/ app/threads/ app/threads-writer/
git commit -m "feat: 후킹/스레드 생성기 Next.js 전환"
```

---

## Task 9: 핵심 도구 페이지 전환 (2) — blog-writer (3885줄, 최대 복잡도)

**Files:**
- Create: `app/blog-writer/page.js`, `components/blog-writer/` (서브 컴포넌트 분리)
- Reference: `blog-writer.html` (3885줄)

blog-writer.html은 프로젝트에서 가장 큰 파일. 컴포넌트 분리 필수:

- [ ] **Step 1: blog-writer.html 구조 분석**

주요 섹션:
1. 입력 폼 (키워드, 카테고리, 톤, 길이 등)
2. 프리셋 저장/로드
3. 생성 진행 상태 (스트리밍)
4. 결과 렌더링 (HTML)
5. AI 검수기 (7개 기준 90점)
6. 자동수정 기능
7. 프리미엄 이미지 연동 버튼
8. 비회원 signupBanner

- [ ] **Step 2: 컴포넌트 분리 설계**

```
components/blog-writer/
  BlogWriterForm.js       ← 입력 폼 + 프리셋
  BlogWriterResult.js     ← 결과 HTML 렌더링
  BlogWriterScore.js      ← AI 검수기 점수판
  BlogWriterAutoCorrect.js ← 자동수정 로직
```

- [ ] **Step 3: app/blog-writer/page.js — 메인 페이지**

'use client' 컴포넌트. 상태 관리:
- form data (keyword, category, tone, length, etc.)
- generation state (loading, streaming, result)
- score state (7개 기준 점수)
- auto-correct state (1회 제한)

핵심 로직:
- `safeParseJson()`: balanced bracket 파서 (기존 코드 그대로 이식)
- `replaceAIVocabulary()`: 17개 AI 어휘 후처리 매핑
- Streaming: `fetch` + `reader.read()` 루프

- [ ] **Step 4: 서브 컴포넌트 구현**

각 컴포넌트를 기존 HTML에서 1:1 포팅. 기능 변경 없음.

- [ ] **Step 5: 동작 확인**

```bash
npm run dev
# /blog-writer에서 키워드 입력 → 글 생성 → 검수 → 자동수정 전체 플로우 테스트
```

- [ ] **Step 6: 커밋**

```bash
git add app/blog-writer/ components/blog-writer/
git commit -m "feat: 블로그 글 생성기 Next.js 전환 (3885줄 → 컴포넌트 분리)"
```

---

## Task 10: 핵심 도구 페이지 전환 (3) — blog-image-pro, card-news, keyword-finder

**Files:**
- Create: `app/blog-image-pro/page.js`, `app/card-news/page.js`, `app/keyword-finder/page.js`
- Reference: `blog-image-pro.html` (1231줄), `card-news.html` (963줄), `keyword-finder.html` (831줄)

- [ ] **Step 1: app/blog-image-pro/page.js**

- 텍스트 입력 (또는 localStorage `blogTextForImagePro`에서 가져오기)
- 마커 선택 (최대 8장)
- 스타일 선택 (photo/data/flow/checklist/venn/poster)
- `/api/blog-image-pro` POST → 이미지 결과
- 썸네일 오버레이 Canvas 처리
- 크레딧 차감

- [ ] **Step 2: app/card-news/page.js**

- 블로그 텍스트 입력
- 테마 선택 (14종) — `/api/card-news-themes` GET
- 슬라이드 수 선택
- `/api/card-news` POST → PNG 이미지 배열
- 모달 미리보기 + 다운로드

- [ ] **Step 3: app/keyword-finder/page.js**

- 키워드 입력 + 분야 필터
- `/api/keywords` POST → 키워드 목록 (등급 라벨 + 점수)
- 결과 테이블 + 정렬
- 복사 버튼

- [ ] **Step 4: 각 페이지 동작 확인**

```bash
npm run dev
# /blog-image-pro, /card-news, /keyword-finder 확인
```

- [ ] **Step 5: 커밋**

```bash
git add app/blog-image-pro/ app/card-news/ app/keyword-finder/
git commit -m "feat: 이미지/카드뉴스/키워드 생성기 Next.js 전환"
```

---

## Task 11: 핵심 도구 페이지 전환 (4) — shortform (3265줄)

**Files:**
- Create: `app/shortform/page.js`, `components/shortform/` (서브 컴포넌트 분리)
- Reference: `shortform.html` (3265줄)

shortform은 blog-writer 다음으로 복잡. 컴포넌트 분리 필수:

- [ ] **Step 1: shortform.html 구조 분석**

주요 섹션:
1. 대본 생성 폼 (주제, 길이, 후킹 공식)
2. 대본 편집기
3. TTS 음성 선택 + 생성
4. STT 싱크 (word-level)
5. B-roll 생성 (이미지/영상)
6. 프리뷰 플레이어
7. HookOverlay 컴포넌트
8. 자막 편집기
9. 최종 렌더링 (Remotion)

- [ ] **Step 2: 컴포넌트 분리**

```
components/shortform/
  ScriptForm.js          ← 대본 생성 폼
  ScriptEditor.js        ← 대본 편집
  VoiceSelector.js       ← TTS 음성 선택
  BrollManager.js        ← B-roll 관리
  PreviewPlayer.js       ← 영상 프리뷰
  SubtitleEditor.js      ← 자막 편집
  HookOverlay.js         ← 후킹 텍스트 오버레이
```

- [ ] **Step 3: app/shortform/page.js — 메인 오케스트레이터**

전체 워크플로우를 관리하는 상위 컴포넌트. 단계별 상태 관리:
- Step 1: 대본 생성
- Step 2: 음성 생성
- Step 3: B-roll 생성
- Step 4: 프리뷰 + 편집
- Step 5: 렌더링

- [ ] **Step 4: 서브 컴포넌트 구현**

기존 HTML에서 1:1 포팅. 특히 STT 싱크, B-roll API 호출, Remotion 연동 로직 주의.

- [ ] **Step 5: 동작 확인**

```bash
npm run dev
# /shortform 전체 워크플로우 테스트
```

- [ ] **Step 6: 커밋**

```bash
git add app/shortform/ components/shortform/
git commit -m "feat: 숏폼 영상 생성기 Next.js 전환 (3265줄 → 컴포넌트 분리)"
```

---

## Task 12: 정보 페이지 전환 — guide, about, contact, legal

**Files:**
- Create: `app/guide/page.js`, `app/about/page.js`, `app/contact/page.js`, `app/terms/page.js`, `app/privacy/page.js`, `app/privacy-meta/page.js`, `app/refund-policy/page.js`, `app/hooking-psychology/page.js`, `app/naver-blog-title-importance/page.js`
- Reference: 각 HTML 파일

이 페이지들은 대부분 정적 콘텐츠. Server Component로 작성 (클라이언트 JS 불필요).

- [ ] **Step 1: 법적 문서 3종 (terms, privacy, refund-policy)**

각 HTML에서 `<body>` 내 콘텐츠를 JSX로 변환. `generateMetadata`로 SEO 메타데이터 설정.

- [ ] **Step 2: guide, about, contact**

동일 패턴. guide.html은 5개 도구 사용법이므로 상대적으로 콘텐츠가 많음.

- [ ] **Step 3: SEO 콘텐츠 페이지 (hooking-psychology, naver-blog-title-importance)**

정적 콘텐츠 + Schema.org JSON-LD 유지.

- [ ] **Step 4: privacy-meta**

Meta API 전용 개인정보처리방침. 간단한 정적 페이지.

- [ ] **Step 5: 커밋**

```bash
git add app/guide/ app/about/ app/contact/ app/terms/ app/privacy/ app/privacy-meta/ app/refund-policy/ app/hooking-psychology/ app/naver-blog-title-importance/
git commit -m "feat: 정보/법적 페이지 Next.js 전환 (9개)"
```

---

## Task 13: 칼럼 동적 라우트 (34편 → 1개 템플릿)

**Files:**
- Create: `app/column/page.js`, `app/column/[slug]/page.js`, `data/columns/*.json`
- Reference: `column.html`, `column-001.html` ~ `column-034.html`

현재 34개 HTML 파일이 거의 동일한 구조에 콘텐츠만 다름. 동적 라우트로 통합하면 유지보수 대폭 개선.

- [ ] **Step 1: 칼럼 데이터 추출 스크립트**

기존 34개 HTML에서 메타데이터(title, description, keywords, content)를 추출하는 Node.js 스크립트를 작성:

```bash
node scripts/extract-columns.mjs
```

각 칼럼을 `data/columns/001.json` 형태로 저장:
```json
{
  "slug": "001",
  "title": "네이버 블로그 제목 잘 쓰는 법 — 클릭률 3배 올리는 7가지 패턴",
  "description": "같은 내용의 글인데 클릭률이 3배...",
  "keywords": "네이버 블로그 제목, ...",
  "publishedAt": "2026-03-10",
  "content": "<article>...</article>"
}
```

- [ ] **Step 2: app/column/page.js — 칼럼 인덱스**

```jsx
import { getAllColumns } from '@/lib/columns';

export default function ColumnIndex() {
  const columns = getAllColumns();
  // 기존 column.html의 카드 UI 재현
  // NEW 뱃지: 7일 이내 발행
}
```

- [ ] **Step 3: app/column/[slug]/page.js — 칼럼 상세**

```jsx
import { getColumn, getAllColumns } from '@/lib/columns';

export async function generateStaticParams() {
  return getAllColumns().map(c => ({ slug: c.slug }));
}

export async function generateMetadata({ params }) {
  const col = getColumn(params.slug);
  return {
    title: col.title,
    description: col.description,
    keywords: col.keywords,
    openGraph: { type: 'article', ... },
  };
}

export default function ColumnPage({ params }) {
  const col = getColumn(params.slug);
  // Schema.org Article + BreadcrumbList JSON-LD
  // FAQPage 3문항
  // 기존 칼럼 레이아웃 재현
}
```

- [ ] **Step 4: lib/columns.js — 데이터 로더**

```js
import fs from 'fs';
import path from 'path';

const COLUMNS_DIR = path.join(process.cwd(), 'data/columns');

export function getAllColumns() {
  const files = fs.readdirSync(COLUMNS_DIR).filter(f => f.endsWith('.json'));
  return files.map(f => JSON.parse(fs.readFileSync(path.join(COLUMNS_DIR, f), 'utf-8')))
    .sort((a, b) => a.slug.localeCompare(b.slug));
}

export function getColumn(slug) {
  const filePath = path.join(COLUMNS_DIR, `${slug}.json`);
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}
```

- [ ] **Step 5: SEO 확인 — 기존 URL 리다이렉트 + canonical**

`next.config.js`에서 이미 `/column-001.html` → `/column/001` 리다이렉트 설정됨 (Task 1).

- [ ] **Step 6: 커밋**

```bash
git add app/column/ data/columns/ lib/columns.js scripts/extract-columns.mjs
git commit -m "feat: 칼럼 34편 → 동적 라우트 통합 (/column/[slug])"
```

---

## Task 14: 어드민 페이지 전환

**Files:**
- Create: `app/admin/page.js`, `app/admin-dashboard/page.js`
- Reference: `admin.html`, `admin-8524.html`

- [ ] **Step 1: app/admin/page.js**

IP 화이트리스트 관리. 간단한 CRUD.

- [ ] **Step 2: app/admin-dashboard/page.js**

Chart.js 기반 대시보드. `<Script>`로 Chart.js CDN 로드하거나, `chart.js` 패키지 설치.
- 사용자 통계, 도구 사용량, 일별 활성 사용자
- `/api/admin-dashboard` API 호출

- [ ] **Step 3: 관리자 접근 제한 확인**

`useAuth()`로 `user.isAdmin` 체크. 비관리자 접근 시 리다이렉트.

- [ ] **Step 4: 커밋**

```bash
git add app/admin/ app/admin-dashboard/
git commit -m "feat: 어드민 페이지 Next.js 전환"
```

---

## Task 15: 404 페이지 + 기존 HTML 정리 + 빌드 검증

**Files:**
- Create: `app/not-found.js`
- Delete: 기존 root `*.html` 파일들 (legacy 브랜치에 백업 완료)
- Modify: `public/` 정적 에셋 정리

- [ ] **Step 1: app/not-found.js**

```jsx
import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="container" style={{ textAlign: 'center', padding: '80px 20px' }}>
      <h1 style={{ fontSize: '3rem', marginBottom: 16 }}>404</h1>
      <p style={{ marginBottom: 24 }}>페이지를 찾을 수 없습니다.</p>
      <Link href="/" className="btn-primary">홈으로 돌아가기</Link>
    </div>
  );
}
```

- [ ] **Step 2: 정적 에셋을 public/으로 이동**

```bash
# 이미지, favicon, robots.txt, sitemap.xml, llms.txt 등
mv favicon.svg public/
mv robots.txt public/
mv sitemap.xml public/
mv llms.txt public/
mv og-default.jpg public/
# images/ 폴더가 있으면 public/images/로 이동
```

- [ ] **Step 3: sitemap.xml 업데이트**

기존 `.html` URL을 새 URL로 변경:
- `https://ddukddaktool.co.kr/blog-writer.html` → `https://ddukddaktool.co.kr/blog-writer`
- 칼럼: `column-001.html` → `column/001`

- [ ] **Step 4: 기존 HTML 파일 제거**

```bash
# legacy 브랜치에 백업했으므로 안전
git rm *.html
git rm auth-ui.js admin-mode.js utils.js config.js navbar-mobile.css
git rm -r _legacy-api/  # Task 4에서 이름 변경한 폴더
```

- [ ] **Step 5: 전체 빌드 + 확인**

```bash
npx next build
npm run dev
```

모든 페이지 접근 확인:
- `/` (제목 생성기)
- `/blog-writer` (블로그 글)
- `/login`, `/signup`
- `/mypage`, `/pricing`
- `/column`, `/column/001`
- 기존 `.html` URL → 301 리다이렉트 확인

- [ ] **Step 6: 커밋**

```bash
git add -A
git commit -m "feat: 기존 HTML 제거 + 정적 에셋 정리 + Next.js 전환 완료"
```

---

## Task 16: Vercel 배포 + 프로덕션 검증

**Files:**
- Modify: Vercel 프로젝트 설정

- [ ] **Step 1: Vercel 프로젝트 프레임워크 설정 확인**

Vercel 대시보드에서:
- Framework Preset: Next.js
- Build Command: `next build` (또는 자동 감지)
- Output Directory: `.next` (자동)

- [ ] **Step 2: 환경변수 확인**

기존 35개 환경변수가 모두 Vercel에 설정되어 있는지 확인. 추가 필요한 변수 없음 (API 코드 변경 없으므로).

- [ ] **Step 3: 배포**

```bash
git push origin feat/nextjs-migration
```

Vercel Preview URL에서 전체 동작 확인.

- [ ] **Step 4: 프로덕션 체크리스트**

- [ ] 모든 도구 페이지 접근 + 기본 동작
- [ ] 로그인/회원가입/로그아웃 플로우
- [ ] 크레딧 결제 (테스트 모드)
- [ ] 기존 `.html` URL → 301 리다이렉트
- [ ] 칼럼 `/column/001` ~ `/column/034`
- [ ] SEO: `<title>`, `<meta>`, OG tags, Schema.org JSON-LD
- [ ] 모바일 반응형
- [ ] Google Analytics 트래킹
- [ ] robots.txt, sitemap.xml 접근

- [ ] **Step 5: main 브랜치에 머지**

```bash
git checkout main
git merge feat/nextjs-migration
git push origin main
```

- [ ] **Step 6: 최종 커밋 태그**

```bash
git tag v2.0.0-nextjs
git push origin v2.0.0-nextjs
```

---

## 일정 추정

| 일차 | Task | 예상 |
|------|------|------|
| Day 1 | Task 1-4 (초기화 + 공통 + API) | 반나절 |
| Day 2 | Task 5-6 (index + 인증) | 반나절 |
| Day 2-3 | Task 7-8 (결제 + 후킹/스레드) | 하루 |
| Day 3-4 | Task 9 (blog-writer, 최대 복잡도) | 하루 |
| Day 4-5 | Task 10-11 (이미지/카드뉴스/키워드/숏폼) | 하루 반 |
| Day 5-6 | Task 12-13 (정보 페이지 + 칼럼) | 하루 |
| Day 6-7 | Task 14-16 (어드민 + 정리 + 배포) | 반나절 |

**총 예상: 5~7일** (4/15까지 완료 목표, 4/25 오픈 전 10일 여유)

---

## 위험 요소 + 대응

1. **API 호환성**: `module.exports` → `export default` 변환 시 누락 가능 → Task 4에서 전수 검사
2. **localStorage 의존**: SSR에서 `window` 접근 불가 → `'use client'` + `typeof window` 가드 필수
3. **인라인 스타일 3000줄+**: blog-writer, shortform의 거대한 `<style>` 블록 → 페이지별 CSS 파일로 분리
4. **Remotion 호환**: shortform의 Remotion 연동이 Next.js와 충돌 가능 → 별도 확인 필요
5. **Google 인증 HTML**: `google593692586796194d.html` → `public/`에 유지
6. **SEO 순위 변동**: URL 변경 + 301 리다이렉트로 일시적 순위 하락 가능 → sitemap 즉시 제출

---

## Task 17 (post-launch): httpOnly 쿠키 세션 마이그레이션

**Priority:** 오픈 후 (P1 보안 개선)

**Files:**
- Modify: `lib/auth.js`, `components/AuthProvider.js`, `pages/api/auth.js`, all API routes using `resolveAdmin()`
- Create: `lib/session-cookie.js` (server-side cookie helpers)

**Goal:** localStorage 기반 토큰 → httpOnly + Secure + SameSite=Lax 쿠키로 이전. XSS 토큰 탈취 벡터 제거.

**Why defer:** Task 3에서 하면 API 라우트 32개 전부 터치 필요 + Task 4와 충돌. 오픈 후 안정화 기간에 진행.

**Steps:**
1. `pages/api/auth.js` login/signup 응답에서 `Set-Cookie: ddukddak_session=...; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000` 추가
2. API 라우트의 `resolveAdmin()` / 인증 로직이 `Authorization: Bearer` 헤더와 `cookie` 양쪽 수용 (Phase 1 하이브리드)
3. `lib/auth.js` — 서버 액션으로 세션 읽기 이동, 클라이언트 localStorage 제거
4. `AuthProvider` — Server Component 패턴 (layout에서 `cookies()`로 초기 상태 주입)
5. 마이그레이션 기간: 기존 localStorage 토큰 사용자에게 1회 재로그인 유도 (또는 lazy migration)
6. Phase 2: Authorization 헤더 지원 제거, 쿠키 전용
