// admin-mode.js: ?admin=8524 URL 파라미터 또는 관리자 이메일 로그인 감지 시
// 모든 /api/ 호출에 admin 키 자동 주입
(function() {
  var ADMIN_EMAILS = ['onixuri@gmail.com'];
  var params = new URLSearchParams(window.location.search);
  var isAdmin = params.get('admin') === '8524';

  // URL에 admin=8524가 있으면 sessionStorage에 저장
  if (isAdmin) {
    try { sessionStorage.setItem('ddukddak_admin', '8524'); } catch(e) {}
  }

  // sessionStorage에 저장된 admin 모드 확인 (URL 파라미터 유실 대비)
  if (!isAdmin) {
    try { isAdmin = sessionStorage.getItem('ddukddak_admin') === '8524'; } catch(e) {}
  }

  // 로그인된 관리자 이메일 확인
  if (!isAdmin) {
    try {
      var user = JSON.parse(localStorage.getItem('ddukddak_user'));
      if (user && ADMIN_EMAILS.indexOf(user.email) !== -1) {
        isAdmin = true;
        try { sessionStorage.setItem('ddukddak_admin', '8524'); } catch(e) {}
      }
    } catch(e) {}
  }

  // URL에 admin 파라미터가 없지만 sessionStorage에 있으면 URL 복원
  if (isAdmin && !params.has('admin')) {
    var newUrl = window.location.pathname + '?admin=8524' +
      (window.location.hash || '');
    history.replaceState(null, '', newUrl);
  }

  if (isAdmin) {
    var _fetch = window.fetch;
    window.fetch = function(url, opts) {
      if (typeof url === 'string' && url.startsWith('/api/')) {
        url += (url.includes('?') ? '&' : '?') + 'admin=8524';
      }
      return _fetch.call(this, url, opts);
    };
  }
})();
