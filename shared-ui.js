/**
 * 공통 Navbar + Footer 인젝션
 * 사용법: <script src="/shared-ui.js" data-active="제목"></script>
 *
 * - data-active: 현재 페이지에 해당하는 네비 링크 텍스트 (예: "제목", "후킹", "블로그 글")
 * - navbar는 <nav class="navbar"> 또는 id="shared-navbar" 위치에 삽입
 * - footer는 <footer> 또는 id="shared-footer" 위치에 삽입
 */
(function() {
  'use strict';

  // ── 네비게이션 메뉴 데이터 ──
  var NAV_ITEMS = [
    { href: 'guide.html', label: '사용법' },
    { href: '/', label: '제목' },
    { href: 'hook-generator.html', label: '후킹' },
    { href: 'threads.html', label: '스레드' },
    { href: 'blog-writer.html', label: '블로그 글', badge: 'pro' },
    { href: 'blog-image-pro.html', label: '(프)이미지', badge: 'pro' },
    { href: 'card-news.html', label: '카드뉴스', badge: 'pro' },
    { href: 'column.html', label: '칼럼' },
    { href: 'keyword-finder.html', label: '황금키워드', badge: 'new' },
    { href: 'shortform.html', label: '숏폼', badge: 'new' },
    { href: 'pricing.html', label: '크레딧 충전' }
  ];

  // ── 현재 active 페이지 감지 ──
  var scriptTag = document.currentScript;
  var activePage = scriptTag ? scriptTag.getAttribute('data-active') : '';

  // ── Navbar HTML 생성 ──
  function buildNavbar() {
    var links = NAV_ITEMS.map(function(item) {
      var isActive = item.label === activePage;
      var cls = item.badge === 'pro' ? ' class="pro-badge"' : item.badge === 'new' ? ' class="new-badge"' : '';
      var style = isActive ? ' style="color:#ff5f1f; font-weight:700;"' : '';
      return '<a href="' + item.href + '"' + cls + style + '>' + item.label + '</a>';
    }).join('\n    ');

    return '<nav class="navbar">\n' +
      '  <a href="/" class="navbar-logo"><span>뚝</span>딱툴</a>\n' +
      '  <div class="navbar-links">\n    ' + links + '\n  </div>\n' +
      '  <div class="navbar-auth" id="navbarAuth"></div>\n' +
      '</nav>';
  }

  // ── Footer HTML 생성 ──
  function buildFooter() {
    return '<footer>\n' +
      '  <div style="margin-bottom:4px;">상호명: 어나더핸즈 | 대표자명: 공은희 | 사업자등록번호: 561-01-02951</div>\n' +
      '  <div style="margin-bottom:4px;">통신판매업 신고번호: 2023-서울강남-01379 | 유선번호: 010-4761-5951 | lboss.reboot@gmail.com</div>\n' +
      '  <div style="margin-bottom:4px;">주소: 서울특별시 강남구 논현로2길 60, 2층 2147호 (개포동, 세화빌딩)</div>\n' +
      '  <div style="margin-bottom:4px;"><a href="/terms.html" style="color:#9CA3AF; text-decoration:none;">이용약관</a> | <a href="/privacy.html" style="color:#9CA3AF; text-decoration:none;">개인정보처리방침</a> | <a href="/refund-policy.html" style="color:#9CA3AF; text-decoration:none;">환불규정</a></div>\n' +
      '  <div>&copy; 2026 어나더핸즈. All rights reserved.</div>\n' +
      '</footer>';
  }

  // ── DOM 삽입 ──
  function inject() {
    // Navbar: 기존 <nav class="navbar">를 교체하거나, #shared-navbar에 삽입
    var existingNav = document.querySelector('nav.navbar');
    if (existingNav) {
      existingNav.outerHTML = buildNavbar();
    } else {
      var navPlaceholder = document.getElementById('shared-navbar');
      if (navPlaceholder) navPlaceholder.innerHTML = buildNavbar();
    }

    // Footer: 기존 <footer>를 교체하거나, #shared-footer에 삽입
    var existingFooter = document.querySelector('footer');
    if (existingFooter) {
      existingFooter.outerHTML = buildFooter();
    } else {
      var footerPlaceholder = document.getElementById('shared-footer');
      if (footerPlaceholder) footerPlaceholder.innerHTML = buildFooter();
    }
  }

  // DOMContentLoaded 전에 로드되면 즉시 실행, 아니면 이벤트 대기
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inject);
  } else {
    inject();
  }
})();
