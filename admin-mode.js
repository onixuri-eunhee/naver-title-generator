// admin-mode.js: ?admin=8524 URL 파라미터 감지 시 모든 /api/ 호출에 admin 키 자동 주입
(function() {
  var params = new URLSearchParams(window.location.search);
  if (params.get('admin') === '8524') {
    var _fetch = window.fetch;
    window.fetch = function(url, opts) {
      if (typeof url === 'string' && url.startsWith('/api/')) {
        url += (url.includes('?') ? '&' : '?') + 'admin=8524';
      }
      return _fetch.call(this, url, opts);
    };
  }
})();
