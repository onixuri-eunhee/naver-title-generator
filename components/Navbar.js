'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from './AuthProvider';
import { NAV_ITEMS } from '@/lib/constants';

export default function Navbar() {
  const pathname = usePathname();
  const { user, loading } = useAuth();

  const isActive = (href) =>
    href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(href + '/');

  return (
    <nav className="navbar">
      <div className="navbar-inner">
        <Link href="/" className="navbar-logo">
          <span>뚝</span>딱툴
        </Link>
        <div className="navbar-links">
          {NAV_ITEMS.map(({ href, label, badge }) => (
            <Link
              key={href}
              href={href}
              className={isActive(href) ? 'active' : ''}
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
              <Link href="/mypage" style={{ fontSize: '0.9rem' }}>
                {(user.name || '')}님
              </Link>
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
                가입
              </Link>
            </>
          )}
        </div>
      </div>
    </nav>
  );
}
