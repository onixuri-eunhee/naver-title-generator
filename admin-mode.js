// admin-mode.js: 서버(/me)가 내려준 isAdmin만 참조
// 관리자 키·이메일을 클라이언트에 노출하지 않음
(function() {
  var isAdmin = false;
  try {
    var user = JSON.parse(localStorage.getItem('ddukddak_user'));
    if (user && user.isAdmin) isAdmin = true;
  } catch(e) {}

  if (isAdmin) {
    var _fetch = window.fetch;
    window.fetch = function(url, opts) {
      if (typeof url === 'string' && url.startsWith('/api/')) {
        opts = opts || {};
        opts.headers = opts.headers || {};
        var token = '';
        try { token = localStorage.getItem('ddukddak_token'); } catch(e) {}
        if (token && !opts.headers['Authorization']) {
          opts.headers['Authorization'] = 'Bearer ' + token;
        }
      }
      return _fetch.call(this, url, opts);
    };
  }
})();
