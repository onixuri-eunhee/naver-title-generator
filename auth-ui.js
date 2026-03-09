(function() {
  var AUTH_API = '/api/auth';
  var TOKEN_KEY = 'ddukddak_token';
  var USER_KEY = 'ddukddak_user';

  function getToken() {
    return localStorage.getItem(TOKEN_KEY);
  }

  function getUser() {
    try {
      return JSON.parse(localStorage.getItem(USER_KEY));
    } catch (e) {
      return null;
    }
  }

  async function logout() {
    var token = getToken();
    if (token) {
      try {
        await fetch(AUTH_API + '?action=logout', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + token }
        });
      } catch (e) {
        // Logout API failure is non-critical — still clear local state
      }
    }
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    window.location.href = '/';
  }

  function renderAuthUI() {
    var container = document.getElementById('navbarAuth');
    if (!container) return;

    var user = getUser();
    var token = getToken();

    if (user && token) {
      container.innerHTML =
        '<a href="mypage.html" class="navbar-user-name">' + escapeHtml(user.name || '') + '님</a>' +
        '<span class="navbar-credit">크레딧: ' + escapeHtml(String(user.credits || 0)) + '</span>' +
        '<a href="mypage.html" class="navbar-mypage-btn">마이페이지</a>';
      refreshUser(token);
    } else {
      container.innerHTML =
        '<a href="login.html" class="navbar-login-btn">로그인</a>' +
        '<a href="signup.html" class="navbar-signup-btn">가입</a>';
    }
  }

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
  }

  async function refreshUser(token) {
    try {
      var res = await fetch(AUTH_API + '?action=me', {
        headers: { 'Authorization': 'Bearer ' + token }
      });
      if (res.ok) {
        var data = await res.json();
        localStorage.setItem(USER_KEY, JSON.stringify(data));
        var creditEl = document.querySelector('.navbar-credit');
        if (creditEl) creditEl.textContent = '크레딧: ' + (data.credits || 0);
        var nameEl = document.querySelector('.navbar-user-name');
        if (nameEl) nameEl.textContent = (data.name || '') + '님';
      } else {
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(USER_KEY);
        renderAuthUI();
      }
    } catch (e) {
      // Network error — keep showing cached data, don't force logout
      console.warn('Auth refresh failed:', e.message);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', renderAuthUI);
  } else {
    renderAuthUI();
  }

  window.ddukddakAuth = {
    logout: logout,
    getToken: getToken,
    getUser: getUser,
    renderAuthUI: renderAuthUI
  };
})();
