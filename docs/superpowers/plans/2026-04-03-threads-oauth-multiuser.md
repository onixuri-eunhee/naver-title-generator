# Threads OAuth 다중 사용자 연동 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 일반 회원이 마이페이지에서 Threads 계정을 OAuth로 연결하고, 스레드 도구에서 자기 계정으로 즉시/예약 발행할 수 있도록 한다.

**Architecture:** `/api/threads-auth.js`가 OAuth 전체 흐름(authorize→callback→status→disconnect)을 처리한다. 사용자 토큰은 Redis(`threads:user:{email}`)에 저장한다. 기존 관리자 발행(환경변수 토큰)은 그대로 유지하고, 일반 회원은 Redis 토큰으로 발행한다.

**Tech Stack:** Vercel Serverless Functions, @upstash/redis, Threads Graph API v1.0

**스펙:** `docs/superpowers/specs/2026-04-03-threads-oauth-multiuser.md`

---

## 파일 구조

| 파일 | 역할 | 변경 |
|------|------|------|
| `api/threads-auth.js` | OAuth 전체 흐름 | 새로 생성 |
| `api/threads-publish.js` | 즉시 발행 | 수정: 사용자별 토큰 지원 |
| `api/threads-schedule.js` | 예약 발행 | 수정: 사용자별 토큰 지원 |
| `api/threads-callback.js` | QStash 예약 콜백 | 수정: email로 사용자 토큰 조회 |
| `mypage.html` | 마이페이지 | 수정: Threads 연결 카드 추가 |
| `threads.html` | 스레드 도구 | 수정: 일반 회원 발행 버튼 |
| `vercel.json` | 라우팅 | 수정: threads-auth 추가 |

---

### Task 1: `/api/threads-auth.js` — OAuth API 생성

**Files:**
- Create: `api/threads-auth.js`
- Modify: `vercel.json`

- [ ] **Step 1: `api/threads-auth.js` 생성**

```js
import { getRedis, extractToken, resolveSessionEmail, setCorsHeaders } from './_helpers.js';

const THREADS_APP_ID = process.env.THREADS_APP_ID;
const THREADS_APP_SECRET = process.env.THREADS_APP_SECRET;
const REDIRECT_URI = 'https://ddukddaktool.co.kr/api/threads-auth';
const TOKEN_TTL = 5184000; // 60일

export default async function handler(req, res) {
  setCorsHeaders(res, req);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const action = req.query.action || req.query.code ? 'callback' : '';

  if (action === 'authorize') return handleAuthorize(req, res);
  if (action === 'callback' || req.query.code) return handleCallback(req, res);
  if (action === 'status') return handleStatus(req, res);
  if (action === 'disconnect') return handleDisconnect(req, res);

  return res.status(400).json({ error: '잘못된 요청입니다.' });
}

async function handleAuthorize(req, res) {
  const token = extractToken(req) || req.query.token;
  const email = await resolveSessionEmail(token);
  if (!email) return res.status(401).json({ error: '로그인이 필요합니다.' });

  // state에 세션 토큰 저장 (CSRF 방지)
  await getRedis().set(`threads:oauth:${token}`, email, { ex: 600 }); // 10분 TTL

  const scope = 'threads_basic,threads_content_publish';
  const url = `https://threads.net/oauth/authorize?client_id=${THREADS_APP_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=${scope}&response_type=code&state=${token}`;

  return res.redirect(302, url);
}

async function handleCallback(req, res) {
  const { code, state, error } = req.query;

  if (error) {
    return res.redirect(302, '/mypage.html?threads=denied');
  }

  if (!code || !state) {
    return res.redirect(302, '/mypage.html?threads=error');
  }

  // state 검증
  const email = await getRedis().get(`threads:oauth:${state}`);
  if (!email) {
    return res.redirect(302, '/mypage.html?threads=error');
  }
  await getRedis().del(`threads:oauth:${state}`);

  try {
    // Step 1: code → 단기 토큰
    const tokenRes = await fetch('https://graph.threads.net/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: THREADS_APP_ID,
        client_secret: THREADS_APP_SECRET,
        grant_type: 'authorization_code',
        redirect_uri: REDIRECT_URI,
        code,
      }),
    });
    const tokenData = await tokenRes.json();

    if (!tokenRes.ok || tokenData.error) {
      console.error('Threads token exchange error:', tokenData);
      return res.redirect(302, '/mypage.html?threads=error');
    }

    const shortToken = tokenData.access_token;

    // Step 2: 단기 → 장기 토큰
    const longRes = await fetch(
      `https://graph.threads.net/access_token?grant_type=th_exchange_token&client_secret=${THREADS_APP_SECRET}&access_token=${shortToken}`
    );
    const longData = await longRes.json();

    if (!longRes.ok || longData.error) {
      console.error('Threads long-lived token error:', longData);
      return res.redirect(302, '/mypage.html?threads=error');
    }

    const accessToken = longData.access_token;
    const expiresIn = longData.expires_in || TOKEN_TTL;

    // Step 3: 사용자 정보 조회
    const meRes = await fetch(
      `https://graph.threads.net/v1.0/me?fields=id,username&access_token=${accessToken}`
    );
    const meData = await meRes.json();

    if (!meRes.ok || meData.error) {
      console.error('Threads me error:', meData);
      return res.redirect(302, '/mypage.html?threads=error');
    }

    // Step 4: Redis 저장
    const now = new Date();
    const expiresAt = new Date(now.getTime() + expiresIn * 1000).toISOString();

    await getRedis().set(
      `threads:user:${email}`,
      JSON.stringify({
        userId: meData.id,
        accessToken,
        username: meData.username,
        connectedAt: now.toISOString(),
        expiresAt,
      }),
      { ex: expiresIn }
    );

    return res.redirect(302, '/mypage.html?threads=connected');
  } catch (err) {
    console.error('Threads OAuth callback error:', err);
    return res.redirect(302, '/mypage.html?threads=error');
  }
}

async function handleStatus(req, res) {
  const token = extractToken(req);
  const email = await resolveSessionEmail(token);
  if (!email) return res.status(401).json({ error: '로그인이 필요합니다.' });

  const data = await getRedis().get(`threads:user:${email}`);
  if (!data) {
    return res.status(200).json({ connected: false });
  }

  const parsed = typeof data === 'string' ? JSON.parse(data) : data;
  return res.status(200).json({
    connected: true,
    username: parsed.username,
    connectedAt: parsed.connectedAt,
  });
}

async function handleDisconnect(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const token = extractToken(req);
  const email = await resolveSessionEmail(token);
  if (!email) return res.status(401).json({ error: '로그인이 필요합니다.' });

  await getRedis().del(`threads:user:${email}`);
  return res.status(200).json({ success: true });
}
```

- [ ] **Step 2: `vercel.json`에 라우트 추가**

`vercel.json`의 rewrites 배열에 추가:

```json
{ "source": "/api/threads-auth", "destination": "/api/threads-auth" }
```

기존 `threads-callback` 항목 아래에 추가한다.

- [ ] **Step 3: 커밋**

```bash
git add api/threads-auth.js vercel.json
git commit -m "feat: Threads OAuth API 추가 (authorize/callback/status/disconnect)"
```

---

### Task 2: `threads-publish.js` — 사용자별 토큰으로 발행

**Files:**
- Modify: `api/threads-publish.js`

- [ ] **Step 1: `threads-publish.js` 수정**

전체 파일을 아래로 교체한다. 변경점: 관리자가 아닌 로그인 회원도 Redis에 저장된 Threads 토큰으로 발행 가능.

```js
import { resolveAdmin, setCorsHeaders, getRedis, extractToken, resolveSessionEmail } from './_helpers.js';

export default async function handler(req, res) {
  setCorsHeaders(res, req);

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { text } = req.body || {};

  if (!text || !text.trim()) {
    return res.status(400).json({ error: '발행할 텍스트가 없습니다.' });
  }

  if (text.length > 500) {
    return res.status(400).json({ error: '500자를 초과하는 글은 발행할 수 없습니다.' });
  }

  // 1) 관리자: 환경변수 토큰
  const isAdmin = await resolveAdmin(req);
  if (isAdmin && process.env.THREADS_USER_ID && process.env.THREADS_ACCESS_TOKEN) {
    try {
      const threadId = await publishToThreads(
        text.trim(),
        process.env.THREADS_USER_ID,
        process.env.THREADS_ACCESS_TOKEN
      );
      return res.status(200).json({ success: true, threadId });
    } catch (err) {
      console.error('Threads Publish Error (admin):', err);
      return res.status(500).json({ error: 'Threads 발행 중 오류가 발생했습니다.' });
    }
  }

  // 2) 일반 회원: Redis 토큰
  const token = extractToken(req);
  const email = await resolveSessionEmail(token);
  if (!email) {
    return res.status(401).json({ error: '로그인이 필요합니다.' });
  }

  const threadsData = await getRedis().get(`threads:user:${email}`);
  if (!threadsData) {
    return res.status(403).json({ error: 'Threads 계정을 먼저 연결해주세요. 마이페이지에서 연결할 수 있습니다.' });
  }

  const parsed = typeof threadsData === 'string' ? JSON.parse(threadsData) : threadsData;

  try {
    const threadId = await publishToThreads(text.trim(), parsed.userId, parsed.accessToken);
    return res.status(200).json({ success: true, threadId });
  } catch (err) {
    console.error('Threads Publish Error (user):', err);
    // 토큰 만료 감지
    if (err.message && err.message.includes('Invalid OAuth')) {
      await getRedis().del(`threads:user:${email}`);
      return res.status(401).json({ error: 'Threads 연결이 만료되었습니다. 마이페이지에서 다시 연결해주세요.' });
    }
    return res.status(500).json({ error: 'Threads 발행 중 오류가 발생했습니다.' });
  }
}

export async function publishToThreads(text, userId, accessToken) {
  if (!userId || !accessToken) {
    throw new Error('Threads API 설정이 완료되지 않았습니다.');
  }

  // Step 1: Create media container
  const createRes = await fetch(
    `https://graph.threads.net/v1.0/${userId}/threads`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        media_type: 'TEXT',
        text,
        access_token: accessToken,
      }),
    }
  );

  const createData = await createRes.json();

  if (!createRes.ok || createData.error) {
    throw new Error(createData.error?.message || 'Media container 생성 실패');
  }

  const containerId = createData.id;

  // Step 2: Publish the container
  const publishRes = await fetch(
    `https://graph.threads.net/v1.0/${userId}/threads_publish`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        creation_id: containerId,
        access_token: accessToken,
      }),
    }
  );

  const publishData = await publishRes.json();

  if (!publishRes.ok || publishData.error) {
    throw new Error(publishData.error?.message || 'Threads 발행 실패');
  }

  return publishData.id;
}
```

`publishToThreads` 시그니처가 `(text)` → `(text, userId, accessToken)`으로 변경된다.

- [ ] **Step 2: 커밋**

```bash
git add api/threads-publish.js
git commit -m "feat: threads-publish 사용자별 토큰 발행 지원"
```

---

### Task 3: `threads-schedule.js` + `threads-callback.js` — 예약 발행 사용자 확장

**Files:**
- Modify: `api/threads-schedule.js`
- Modify: `api/threads-callback.js`

- [ ] **Step 1: `threads-schedule.js` 수정**

관리자뿐 아니라 Threads 연결된 일반 회원도 예약 가능하도록 수정. QStash body에 `email`을 포함하여 콜백에서 사용자 토큰 조회 가능하게 한다.

```js
import { Client } from '@upstash/qstash';
import { Redis } from '@upstash/redis';

let redis;
function getRedis() {
  if (!redis) {
    redis = new Redis({
      url: process.env.KV_REST_API_URL,
      token: process.env.KV_REST_API_TOKEN,
    });
  }
  return redis;
}

import { resolveAdmin, setCorsHeaders, extractToken, resolveSessionEmail } from './_helpers.js';

export default async function handler(req, res) {
  setCorsHeaders(res, req);

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const isAdmin = await resolveAdmin(req);

  // 일반 회원: Threads 연결 확인
  let email = null;
  if (!isAdmin) {
    const token = extractToken(req);
    email = await resolveSessionEmail(token);
    if (!email) {
      return res.status(401).json({ error: '로그인이 필요합니다.' });
    }
    const threadsData = await getRedis().get(`threads:user:${email}`);
    if (!threadsData) {
      return res.status(403).json({ error: 'Threads 계정을 먼저 연결해주세요.' });
    }
  }

  const { text, publishAt } = req.body || {};

  if (!text || !text.trim()) {
    return res.status(400).json({ error: '발행할 텍스트가 없습니다.' });
  }

  if (text.length > 500) {
    return res.status(400).json({ error: '500자를 초과하는 글은 발행할 수 없습니다.' });
  }

  if (!publishAt) {
    return res.status(400).json({ error: '예약 시간을 지정해주세요.' });
  }

  const publishDate = new Date(publishAt);
  const now = new Date();
  const delaySec = Math.floor((publishDate.getTime() - now.getTime()) / 1000);

  if (delaySec < 60) {
    return res.status(400).json({ error: '예약 시간은 현재로부터 최소 1분 이후여야 합니다.' });
  }

  try {
    const qstash = new Client({ token: process.env.QSTASH_TOKEN });

    const baseUrl = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : 'https://ddukddaktool.co.kr';

    // email을 body에 포함 (관리자는 null → 콜백에서 환경변수 사용)
    const result = await qstash.publishJSON({
      url: `${baseUrl}/api/threads-callback`,
      body: { text: text.trim(), email: isAdmin ? null : email },
      delay: delaySec,
    });

    const scheduleId = result.messageId;
    await getRedis().set(
      `schedule:threads:${scheduleId}`,
      JSON.stringify({
        text: text.trim(),
        email: isAdmin ? null : email,
        publishAt,
        createdAt: now.toISOString(),
        status: 'scheduled',
      }),
      { ex: delaySec + 3600 }
    );

    return res.status(200).json({
      success: true,
      scheduleId,
      publishAt,
    });
  } catch (err) {
    console.error('Threads Schedule Error:', err);
    return res.status(500).json({ error: '예약 발행 등록 중 오류가 발생했습니다.' });
  }
}
```

- [ ] **Step 2: `threads-callback.js` 수정**

email이 있으면 사용자 토큰으로, 없으면 관리자 환경변수 토큰으로 발행.

```js
import { Receiver } from '@upstash/qstash';
import { Redis } from '@upstash/redis';
import { publishToThreads } from './threads-publish.js';

let redis;
function getRedis() {
  if (!redis) {
    redis = new Redis({
      url: process.env.KV_REST_API_URL,
      token: process.env.KV_REST_API_TOKEN,
    });
  }
  return redis;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Verify QStash signature
  try {
    const receiver = new Receiver({
      currentSigningKey: process.env.QSTASH_CURRENT_SIGNING_KEY,
      nextSigningKey: process.env.QSTASH_NEXT_SIGNING_KEY,
    });

    const signature = req.headers['upstash-signature'];
    const body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);

    await receiver.verify({
      signature,
      body,
    });
  } catch (err) {
    console.error('QStash signature verification failed:', err);
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const parsed = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  const { text, email } = parsed;

  if (!text) {
    return res.status(400).json({ error: 'No text provided' });
  }

  try {
    let userId, accessToken;

    if (email) {
      // 일반 회원: Redis에서 토큰 조회
      const threadsData = await getRedis().get(`threads:user:${email}`);
      if (!threadsData) {
        console.error(`Threads token not found for ${email}`);
        return res.status(400).json({ error: 'Threads 연결이 만료되었습니다.' });
      }
      const data = typeof threadsData === 'string' ? JSON.parse(threadsData) : threadsData;
      userId = data.userId;
      accessToken = data.accessToken;
    } else {
      // 관리자: 환경변수
      userId = process.env.THREADS_USER_ID;
      accessToken = process.env.THREADS_ACCESS_TOKEN;
    }

    const threadId = await publishToThreads(text, userId, accessToken);

    // Update Redis record
    const messageId = req.headers['upstash-message-id'];
    if (messageId) {
      const key = `schedule:threads:${messageId}`;
      const existing = await getRedis().get(key);
      if (existing) {
        const data = typeof existing === 'string' ? JSON.parse(existing) : existing;
        data.status = 'published';
        data.threadId = threadId;
        data.publishedAt = new Date().toISOString();
        await getRedis().set(key, JSON.stringify(data), { ex: 86400 });
      }
    }

    return res.status(200).json({ success: true, threadId });
  } catch (err) {
    console.error('Threads Callback Publish Error:', err);
    return res.status(500).json({ error: 'Threads 발행 중 오류가 발생했습니다.' });
  }
}
```

- [ ] **Step 3: 커밋**

```bash
git add api/threads-schedule.js api/threads-callback.js
git commit -m "feat: 예약 발행 사용자별 토큰 지원"
```

---

### Task 4: `mypage.html` — Threads 연결 카드 추가

**Files:**
- Modify: `mypage.html`

- [ ] **Step 1: CSS 추가**

`mypage.html`의 `</style>` 직전에 Threads 연결 카드 스타일 추가:

```css
/* Threads 연결 */
.threads-card { margin-top: 0; }
.threads-status {
  display: flex; align-items: center; gap: 12px;
  padding: 16px; background: #F8F9FD; border-radius: 12px;
}
.threads-status .threads-icon {
  width: 40px; height: 40px; border-radius: 50%;
  background: linear-gradient(135deg, #000 0%, #333 100%);
  display: flex; align-items: center; justify-content: center;
  color: #fff; font-size: 18px; font-weight: 700;
}
.threads-status .threads-info { flex: 1; }
.threads-status .threads-username {
  font-size: 15px; font-weight: 700; color: #1A1A2E;
}
.threads-status .threads-date {
  font-size: 12px; color: #6B7280; margin-top: 2px;
}
.threads-connect-btn {
  display: inline-block; padding: 10px 24px;
  background: #1A1A2E; color: #fff; border: none;
  border-radius: 10px; font-size: 14px; font-weight: 600;
  cursor: pointer; transition: background 0.15s;
  text-decoration: none;
}
.threads-connect-btn:hover { background: #2d2d4e; }
.threads-disconnect-btn {
  padding: 6px 14px; background: #fff; color: #DC2626;
  border: 1px solid #E5E7EB; border-radius: 8px;
  font-size: 13px; font-weight: 500; cursor: pointer;
  transition: background 0.15s;
}
.threads-disconnect-btn:hover { background: #FEF2F2; }
.threads-desc {
  font-size: 13px; color: #6B7280; margin-bottom: 16px; line-height: 1.6;
}
```

- [ ] **Step 2: JS 수정 — Threads 카드 렌더링**

`mypage.html`의 `loadMyPage()` 함수 안, `container.innerHTML = ''` 블록에서 Card 2(로그아웃) 앞에 Threads 카드를 삽입한다.

기존 Card 2(로그아웃) 부분:

```js
        // Card 2: 로그아웃
        + '<div class="card">'
        + '  <button class="logout-btn" id="logoutBtn">로그아웃</button>'
        + '</div>';
```

이 부분을 아래로 교체:

```js
        // Card 2: Threads 연결
        + '<div class="card threads-card">'
        + '  <div class="card-title">Threads 계정</div>'
        + '  <div id="threadsSection">'
        + '    <div class="loading-text" style="font-size:13px;">연결 상태 확인 중...</div>'
        + '  </div>'
        + '</div>'

        // Card 3: 로그아웃
        + '<div class="card">'
        + '  <button class="logout-btn" id="logoutBtn">로그아웃</button>'
        + '</div>';
```

- [ ] **Step 3: JS 추가 — Threads 상태 로드 및 연결/해제 함수**

`loadMyPage()` 함수의 로그아웃 핸들러 바인딩(`document.getElementById('logoutBtn').addEventListener...`) 이후에 Threads 상태 로드 호출을 추가한다:

```js
      // Threads 연결 상태 로드
      loadThreadsStatus();
```

그리고 `loadMyPage()` 함수 바깥, `escapeHtml` 함수 앞에 아래 함수들을 추가한다:

```js
  async function loadThreadsStatus() {
    var section = document.getElementById('threadsSection');
    if (!section) return;
    try {
      var res = await fetch('/api/threads-auth?action=status', {
        headers: { 'Authorization': 'Bearer ' + token }
      });
      var data = await res.json();
      if (data.connected) {
        var dateStr = new Date(data.connectedAt).toLocaleDateString('ko-KR');
        section.innerHTML = ''
          + '<div class="threads-status">'
          + '  <div class="threads-icon">@</div>'
          + '  <div class="threads-info">'
          + '    <div class="threads-username">@' + escapeHtml(data.username) + '</div>'
          + '    <div class="threads-date">' + dateStr + ' 연결됨</div>'
          + '  </div>'
          + '  <button class="threads-disconnect-btn" id="threadsDisconnectBtn">연결 해제</button>'
          + '</div>';
        document.getElementById('threadsDisconnectBtn').addEventListener('click', disconnectThreads);
      } else {
        section.innerHTML = ''
          + '<p class="threads-desc">Threads 계정을 연결하면 스레드 도구에서 생성한 글을 바로 발행할 수 있습니다.</p>'
          + '<a class="threads-connect-btn" href="/api/threads-auth?action=authorize&token=' + encodeURIComponent(token) + '">Threads 계정 연결</a>';
      }
    } catch (err) {
      section.innerHTML = '<p class="threads-desc" style="color:#DC2626;">연결 상태를 확인할 수 없습니다.</p>';
    }
  }

  async function disconnectThreads() {
    if (!confirm('Threads 계정 연결을 해제할까요?')) return;
    try {
      var res = await fetch('/api/threads-auth?action=disconnect', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token }
      });
      if (res.ok) {
        loadThreadsStatus();
      }
    } catch (err) {}
  }
```

- [ ] **Step 4: URL 파라미터 토스트 처리**

`loadMyPage()` 호출 직전에 URL 파라미터 기반 토스트 알림 추가:

```js
  // Threads 연결 결과 토스트
  var urlParams = new URLSearchParams(window.location.search);
  var threadsResult = urlParams.get('threads');
  if (threadsResult) {
    window.history.replaceState({}, '', '/mypage.html');
    setTimeout(function() {
      var msg = threadsResult === 'connected' ? 'Threads 계정이 연결되었습니다!'
        : threadsResult === 'denied' ? 'Threads 연결이 취소되었습니다.'
        : 'Threads 연결 중 오류가 발생했습니다.';
      var toast = document.createElement('div');
      toast.style.cssText = 'position:fixed;top:20px;left:50%;transform:translateX(-50%);padding:12px 24px;border-radius:10px;font-size:14px;font-weight:500;z-index:9999;animation:fadeUp 0.3s;'
        + (threadsResult === 'connected' ? 'background:#ECFDF5;color:#065F46;border:1px solid #A7F3D0;' : 'background:#FEF2F2;color:#991B1B;border:1px solid #FECACA;');
      toast.textContent = msg;
      document.body.appendChild(toast);
      setTimeout(function() { toast.remove(); }, 3000);
    }, 500);
  }

  loadMyPage();
```

기존 `loadMyPage();` 호출은 이 블록 안으로 이동한다.

- [ ] **Step 5: 커밋**

```bash
git add mypage.html
git commit -m "feat: 마이페이지 Threads 연결/해제 UI 추가"
```

---

### Task 5: `threads.html` — 일반 회원 발행 버튼 활성화

**Files:**
- Modify: `threads.html`

- [ ] **Step 1: 발행 감지 로직 수정**

`threads.html`의 897행 `// --- Threads 발행 기능 (관리자 전용) ---` 부터 `loadRemaining();`(999행) 까지의 블록을 아래로 교체한다:

```js
// --- Threads 발행 기능 ---
var isAdmin = false;
var threadsConnected = false;

function showToast(msg, type) {
  var t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast show' + (type ? ' ' + type : '');
  setTimeout(function() { t.className = 'toast'; }, 3000);
}

// 관리자 또는 Threads 연결 회원 감지
var _origLoadRemaining = loadRemaining;
loadRemaining = async function() {
  try {
    var _t2 = ''; try { _t2 = localStorage.getItem('ddukddak_token') || ''; } catch(e) {}
    var _h2 = {}; if (_t2) _h2['Authorization'] = 'Bearer ' + _t2;
    var res = await fetch('/api/threads', { headers: _h2 });
    var data = await res.json();
    updateRemainingUI(data.remaining, data.limit);
    if (data.admin) {
      isAdmin = true;
      showPublishButtons();
    }
  } catch(e) {
    document.getElementById('remainingCount').textContent = '';
  }

  // Threads 연결 상태 확인 (비관리자)
  if (!isAdmin) {
    try {
      var _t3 = ''; try { _t3 = localStorage.getItem('ddukddak_token') || ''; } catch(e) {}
      if (_t3) {
        var statusRes = await fetch('/api/threads-auth?action=status', {
          headers: { 'Authorization': 'Bearer ' + _t3 }
        });
        var statusData = await statusRes.json();
        if (statusData.connected) {
          threadsConnected = true;
          showPublishButtons();
        }
      }
    } catch(e) {}
  }
};

function showPublishButtons() {
  document.getElementById('publishBtn').style.display = '';
  document.getElementById('scheduleBtn').style.display = '';
  // Threads 미연결 안내 숨기기
  var hint = document.getElementById('threadsHint');
  if (hint) hint.style.display = 'none';
}

async function publishNow() {
  var text = results[activeTab];
  if (!text) { showToast('발행할 글이 없습니다.', 'error'); return; }
  if (!confirm('이 글을 Threads에 바로 발행할까요?')) return;

  var btn = document.getElementById('publishBtn');
  btn.disabled = true;
  btn.textContent = '발행 중...';

  try {
    var _tk = ''; try { _tk = localStorage.getItem('ddukddak_token') || ''; } catch(e) {}
    var headers = { 'Content-Type': 'application/json' };
    if (_tk) headers['Authorization'] = 'Bearer ' + _tk;

    var res = await fetch('/api/threads-publish', {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({ text: text })
    });
    var data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || '발행 실패');
    }
    showToast('발행 완료!', 'success');
  } catch (err) {
    showToast('발행 실패: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '즉시 발행';
  }
}

function openScheduleModal() {
  var now = new Date();
  now.setHours(now.getHours() + 1);
  var local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  document.getElementById('scheduleTime').value = local.toISOString().slice(0, 16);
  document.getElementById('scheduleModal').classList.add('show');
}

function closeScheduleModal() {
  document.getElementById('scheduleModal').classList.remove('show');
}

async function confirmSchedule() {
  var text = results[activeTab];
  if (!text) { showToast('발행할 글이 없습니다.', 'error'); return; }

  var scheduleTime = document.getElementById('scheduleTime').value;
  if (!scheduleTime) { showToast('예약 시간을 선택해주세요.', 'error'); return; }

  var publishAt = new Date(scheduleTime).toISOString();
  closeScheduleModal();

  try {
    var _tk = ''; try { _tk = localStorage.getItem('ddukddak_token') || ''; } catch(e) {}
    var headers = { 'Content-Type': 'application/json' };
    if (_tk) headers['Authorization'] = 'Bearer ' + _tk;

    var res = await fetch('/api/threads-schedule', {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({ text: text, publishAt: publishAt })
    });
    var data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || '예약 실패');
    }
    var dt = new Date(data.publishAt);
    var timeStr = dt.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
    showToast('예약 완료! ' + timeStr + ' 발행 예정', 'success');
  } catch (err) {
    showToast('예약 실패: ' + err.message, 'error');
  }
}

loadRemaining();
```

- [ ] **Step 2: Threads 미연결 안내 힌트 추가**

`threads.html`에서 발행 버튼(`publishBtn`, `scheduleBtn`) 아래에 안내 문구를 추가한다. 662~663행 근처:

```html
          <button class="publish-btn" id="publishBtn" onclick="publishNow()" style="display:none;">즉시 발행</button>
          <button class="schedule-btn" id="scheduleBtn" onclick="openScheduleModal()" style="display:none;">예약 발행</button>
          <div id="threadsHint" style="display:none; margin-top:8px; font-size:12px; color:#6B7280;">
            <a href="mypage.html" style="color:#8B5CF6; text-decoration:underline;">마이페이지</a>에서 Threads 계정을 연결하면 바로 발행할 수 있어요
          </div>
```

그리고 `loadRemaining` 함수에서 로그인 회원인데 Threads 미연결이면 힌트를 표시하도록, `showPublishButtons()` 호출 대신 아래 로직 추가 (이미 위 Step 1 코드에 포함):
- `threadsConnected`가 false이고 로그인 상태이면 `threadsHint.style.display = ''`

Step 1의 `loadRemaining` 함수 끝에 추가:

```js
  // 로그인 회원인데 Threads 미연결이면 힌트 표시
  if (!isAdmin && !threadsConnected) {
    var _t4 = ''; try { _t4 = localStorage.getItem('ddukddak_token') || ''; } catch(e) {}
    if (_t4) {
      var hint = document.getElementById('threadsHint');
      if (hint) hint.style.display = '';
    }
  }
```

이 코드는 `loadRemaining` 함수의 마지막, `loadRemaining();` 호출 직전에 위치한다.

- [ ] **Step 3: 커밋**

```bash
git add threads.html
git commit -m "feat: 스레드 도구 일반 회원 발행 버튼 활성화"
```

---

### Task 6: Vercel 환경변수 등록 및 배포 테스트

**Files:** 없음 (Vercel 대시보드 + Meta 앱 설정)

- [ ] **Step 1: Meta 앱 설정 — 리디렉션 URL 추가**

개인 앱(엘보스리부트 스레드자동화) → 이용 사례 → 설정:
- 리디렉션 콜백 URL에 `https://ddukddaktool.co.kr/api/threads-auth` 추가
- 저장

- [ ] **Step 2: Vercel 환경변수 추가**

Vercel 대시보드 → Settings → Environment Variables:
- `THREADS_APP_ID`: `2059846801600294` (개인 앱 Threads 앱 ID)
- `THREADS_APP_SECRET`: 앱 시크릿 (기본 설정에서 확인)

- [ ] **Step 3: 배포 후 테스트**

1. 마이페이지 → "Threads 계정 연결" 클릭
2. Threads 로그인 & 권한 허용
3. 마이페이지로 돌아와서 `@lboss_reboot 연결됨` 확인
4. 스레드 도구에서 글 생성 → "즉시 발행" 버튼 표시 확인
5. 테스트 글 발행
6. 마이페이지에서 "연결 해제" → 스레드 도구 새로고침 → 발행 버튼 사라짐 확인

- [ ] **Step 4: 커밋 (코드 변경 있을 경우만)**

테스트 중 발견된 버그 수정 시 커밋.
