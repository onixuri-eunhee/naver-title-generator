# Phase J — YouTube Direct Upload (v1.1): OAuth + 브라우저 직접 업로드

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. 12 Phase 중 Phase J. 마스터 플랜: `2026-04-14-shortform-master-plan.md`. 스펙: `2026-04-14-shortform-benchmark-pipeline-design.md` §18.
>
> ⚠️ **v1.1로 배포 유예 (4/25 정식 오픈 후)**. 코드는 다른 Phase와 같이 작성해서 feature flag로 숨겨두고, OAuth verification + 쿼터 승인을 받은 후 활성화한다. Deep Research 결론에 따라 **서버 직접 업로드는 불가능하고 브라우저 resumable 업로드만 가능**.

**Goal:** 숏폼 완성 후 "다운로드 → YouTube 업로드 → 캡션 복붙" 흐름을 **한 클릭으로** 압축한다. 사용자가 YouTube 계정을 연결하면 Step 7에서 "YouTube에 바로 업로드" 버튼으로 영상을 바로 업로드하고, 업로드 진행률은 Phase I의 SSE 버스를 그대로 재활용해 표시한다.

**Architecture (Deep Research 결론 반영):**

1. **Vercel 60초 함수 제한 때문에 서버 직접 업로드 불가능**. 대신 서버는 **OAuth 토큰 발급 + resumable session URI 발급**만 담당하고 **브라우저가 직접 YouTube에 chunk PUT**한다.
2. `youtube_connections` Postgres 테이블에 channel_id + 암호화된 refresh_token 저장 (AES-256-GCM).
3. access_token은 Redis (TTL ~1시간) 캐시.
4. 사용자가 "업로드" 클릭 → 서버가 refresh_token → access_token → resumable session URI → 브라우저에 URI 반환 → 브라우저가 8MB chunk로 PUT → 각 chunk 완료마다 publishProgress → SSE로 진행률.
5. **OAuth verification 4~6주 소요**(sensitive scope `youtube.upload`) → 운영자 4/14 즉시 신청해야 v1.1 시점 가용.
6. **videos.insert 쿼터 = 1,600 units**(확정). 무료 10K/day → 약 6회/day. 쿼터 상향도 병행 신청.

**Tech Stack:** Next.js 15, Google OAuth 2.0, YouTube Data API v3, @upstash/redis, Postgres(Neon), Node crypto AES-256-GCM, XMLHttpRequest (브라우저 업로드 진행률)

**의존성:** Phase I (SSE 버스) — 업로드 진행 표시를 재사용

**예상 작업량:** 13 task, 약 1.5 주 (코드) + 4~6주(OAuth 인증 대기, 병행)

---

## 파일 구조

### 신규 파일

```
lib/encryption.js                             AES-256-GCM 암호화 헬퍼 (refresh_token 저장용)
lib/youtube-oauth.js                          OAuth URL/exchange/refresh/revoke 헬퍼
lib/youtube-connections.js                    Postgres 테이블 + ensureSchema + CRUD
lib/youtube-browser-upload.js                 브라우저에서 import하는 resumable 업로드 유틸
app/api/youtube-auth/route.js                 authorize/callback/disconnect/status
app/api/youtube-upload/route.js               resumable session URI mint (서버 역할은 여기까지)
app/mypage/YouTubeSection.js                  연결/해제 UI
app/mypage/YouTubeSection.module.css
```

### 수정 파일

```
app/mypage/MyPageClient.js                    YouTubeSection 마운트
app/shortform/ShortformClient.js              Step 7에 "YouTube에 바로 업로드" 버튼 + 업로드 모달
components/ProgressIndicator.js               upload-youtube step 라벨 추가
```

---

## Task J0: 운영자 액션 — OAuth verification + 쿼터 상향 신청

⚠️ **이 task는 코드가 아니라 운영자가 직접 수행**하는 Google Cloud Console 작업. Phase J 다른 task와 병행되며 결과는 4~6주 후 도착.

- [ ] **Step 1: Google Cloud Project 준비**

1. Google Cloud Console → 기존 프로젝트(Vertex AI 등) 또는 신규 프로젝트 사용
2. API & Services → Enable APIs → **YouTube Data API v3** 활성화 확인

- [ ] **Step 2: OAuth Consent Screen 구성**

1. API & Services → OAuth consent screen
2. User Type: External
3. App Information:
   - App name: 뚝딱툴 (또는 공식 서비스명)
   - User support email: lboss.reboot@gmail.com
   - Developer contact: lboss.reboot@gmail.com
   - App domain: https://ddukddaktool.co.kr
   - Privacy policy: https://ddukddaktool.co.kr/privacy.html
   - Terms of service: https://ddukddaktool.co.kr/terms.html
4. Scopes → **ADD OR REMOVE SCOPES**:
   - `https://www.googleapis.com/auth/youtube.upload` (sensitive)
   - `https://www.googleapis.com/auth/youtube.readonly` (restricted, 채널 정보용)
5. Test users: 운영자 Gmail 등록 (인증 전 개발용)
6. **Publishing status**: "Submit for verification" 클릭
   - 인증 사유: "Enable users to upload AI-generated shortform videos directly to their own YouTube channels"
   - 인증 영상(YouTube 미등록): 2~3분, 동의 화면 → scope 설명 → 사용 흐름 녹화
7. **예상 소요: 4~6주**. 이 기간에는 Testing mode에서 테스트 사용자만 동작. refresh_token이 7일마다 만료됨.

- [ ] **Step 3: YouTube Data API 쿼터 상향 신청**

1. IAM & Admin → Quotas & System Limits → "YouTube Data API v3" 필터
2. "Queries per day" 항목 선택 → Edit Quotas
3. 신청 사유:
   - 현재 한도: 10,000 units/day (videos.insert 약 6회)
   - 요청 한도: 100,000 units/day (약 60회/일)
   - 근거: 자영업자 타겟, 일일 예상 DAU 50~200, 캐시 80% 가정
4. 사업자 증빙 첨부 (사업자등록증)
5. **예상 소요: 4~8주**. 첫 그랜트는 보통 50K~100K.

- [ ] **Step 4: Credentials 생성**

1. API & Services → Credentials → Create Credentials → OAuth 2.0 Client ID
2. Application type: **Web application**
3. Name: 뚝딱툴 YouTube 연동
4. Authorized JavaScript origins:
   - https://ddukddaktool.co.kr
   - https://www.ddukddaktool.co.kr
   - http://localhost:3000 (개발)
5. Authorized redirect URIs:
   - https://ddukddaktool.co.kr/api/youtube-auth (action=callback 쿼리로 구분)
   - http://localhost:3000/api/youtube-auth
6. 생성 후 Client ID / Client Secret을 운영자 비밀 저장소에 보관

- [ ] **Step 5: Vercel 환경 변수 등록**

```
GOOGLE_OAUTH_CLIENT_ID=...
GOOGLE_OAUTH_CLIENT_SECRET=...
GOOGLE_OAUTH_REDIRECT_URI=https://ddukddaktool.co.kr/api/youtube-auth?action=callback
YOUTUBE_UPLOAD_ENCRYPTION_KEY=<openssl rand -base64 32>
YOUTUBE_UPLOAD_FEATURE_FLAG=false   # verification 받기 전에는 false
```

- [ ] **Step 6: 운영자 액션 로그**

이 task는 커밋 없음. 메모리 파일 `project_shortform_phase_j_oauth_progress.md` 에 신청 일자를 기록:

```markdown
# Phase J — OAuth Verification Progress

- 2026-04-14: Consent screen 제출, verification 접수
- 2026-04-14: 쿼터 상향 신청 제출 (현재 10K → 요청 100K)
- 2026-04-??: Google 1차 회신 (추가 정보 요청?)
- 2026-05-??: 승인 / 거절 결과
```

---

## Task J1: lib/encryption.js — AES-256-GCM 헬퍼

**Files:**
- Create: `lib/encryption.js`

- [ ] **Step 1: 암호화 헬퍼 작성**

```javascript
// lib/encryption.js
/**
 * At-rest 암호화 헬퍼.
 * refresh_token 등 민감 데이터를 DB에 저장하기 전에 이 모듈을 거친다.
 *
 * 알고리즘: AES-256-GCM
 * 키 소스: process.env.YOUTUBE_UPLOAD_ENCRYPTION_KEY (base64, 32 byte)
 *
 * 포맷: `${iv}:${authTag}:${ciphertext}` (전부 base64)
 */
import crypto from 'crypto';

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;

function getKey() {
  const raw = process.env.YOUTUBE_UPLOAD_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error('YOUTUBE_UPLOAD_ENCRYPTION_KEY 환경 변수가 설정되지 않았습니다.');
  }
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error('YOUTUBE_UPLOAD_ENCRYPTION_KEY는 base64 인코딩된 32 byte 여야 합니다.');
  }
  return key;
}

export function encrypt(plaintext) {
  if (plaintext == null) return null;
  const iv = crypto.randomBytes(IV_LEN);
  const key = getKey();
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`;
}

export function decrypt(payload) {
  if (!payload) return null;
  const parts = payload.split(':');
  if (parts.length !== 3) {
    throw new Error('암호문 포맷이 올바르지 않습니다.');
  }
  const [ivB64, tagB64, encB64] = parts;
  const key = getKey();
  const decipher = crypto.createDecipheriv(ALGO, key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  const dec = Buffer.concat([
    decipher.update(Buffer.from(encB64, 'base64')),
    decipher.final(),
  ]);
  return dec.toString('utf8');
}
```

- [ ] **Step 2: 빌드 체크**

```bash
cd /Users/gong-eunhui/Desktop/naver-title-generator
npx next build 2>&1 | grep -iE "error|✓ Compiled" | head -10
```

Expected: 컴파일 성공. 환경 변수 누락은 런타임 에러이므로 빌드는 통과.

- [ ] **Step 3: 커밋**

```bash
git add lib/encryption.js
git commit -m "$(cat <<'EOF'
feat(lib): AES-256-GCM at-rest 암호화 헬퍼

YouTube refresh_token을 DB에 저장하기 전 암호화. IV 12 byte 랜덤,
authTag 분리 저장. 키는 YOUTUBE_UPLOAD_ENCRYPTION_KEY 환경 변수에서
base64(32 byte)로 주입.
EOF
)"
```

---

## Task J2: youtube_connections 테이블 + ensureSchema

**Files:**
- Create: `lib/youtube-connections.js`

- [ ] **Step 1: DB 헬퍼 작성**

```javascript
// lib/youtube-connections.js
/**
 * youtube_connections 테이블 관리.
 * ensureSchema는 첫 호출 시 테이블을 만들고 이후에는 no-op.
 * 카드뉴스 Phase 3에서 사용한 패턴과 동일.
 */
import { neon } from '@neondatabase/serverless';
import { encrypt, decrypt } from '@/lib/encryption';

const sql = neon(process.env.DATABASE_URL);

let schemaEnsured = false;

export async function ensureSchema() {
  if (schemaEnsured) return;
  await sql`
    CREATE TABLE IF NOT EXISTS youtube_connections (
      user_email      VARCHAR(254) PRIMARY KEY,
      channel_id      VARCHAR(50),
      channel_name    VARCHAR(200),
      refresh_token   TEXT NOT NULL,
      scopes          TEXT,
      connected_at    TIMESTAMPTZ DEFAULT NOW(),
      last_used_at    TIMESTAMPTZ
    )
  `;
  schemaEnsured = true;
}

export async function saveConnection({ email, channelId, channelName, refreshToken, scopes }) {
  await ensureSchema();
  const encrypted = encrypt(refreshToken);
  await sql`
    INSERT INTO youtube_connections (user_email, channel_id, channel_name, refresh_token, scopes, connected_at, last_used_at)
    VALUES (${email}, ${channelId}, ${channelName}, ${encrypted}, ${scopes}, NOW(), NOW())
    ON CONFLICT (user_email) DO UPDATE SET
      channel_id    = EXCLUDED.channel_id,
      channel_name  = EXCLUDED.channel_name,
      refresh_token = EXCLUDED.refresh_token,
      scopes        = EXCLUDED.scopes,
      connected_at  = NOW(),
      last_used_at  = NOW()
  `;
}

export async function getConnection(email) {
  await ensureSchema();
  const rows = await sql`
    SELECT user_email, channel_id, channel_name, refresh_token, scopes, connected_at, last_used_at
    FROM youtube_connections
    WHERE user_email = ${email}
    LIMIT 1
  `;
  if (!rows || rows.length === 0) return null;
  const row = rows[0];
  return {
    email: row.user_email,
    channelId: row.channel_id,
    channelName: row.channel_name,
    refreshToken: decrypt(row.refresh_token),
    scopes: row.scopes,
    connectedAt: row.connected_at,
    lastUsedAt: row.last_used_at,
  };
}

export async function touchLastUsed(email) {
  await ensureSchema();
  await sql`UPDATE youtube_connections SET last_used_at = NOW() WHERE user_email = ${email}`;
}

export async function deleteConnection(email) {
  await ensureSchema();
  await sql`DELETE FROM youtube_connections WHERE user_email = ${email}`;
}
```

- [ ] **Step 2: 커밋**

```bash
git add lib/youtube-connections.js
git commit -m "$(cat <<'EOF'
feat(lib): youtube_connections 테이블 + CRUD (lazy ensureSchema)

user_email PK + channel_id/name + 암호화된 refresh_token + 사용 기록.
카드뉴스 Phase 3와 동일한 lazy ensureSchema 패턴.
EOF
)"
```

---

## Task J3: lib/youtube-oauth.js — OAuth URL/exchange/refresh/revoke

**Files:**
- Create: `lib/youtube-oauth.js`

- [ ] **Step 1: OAuth 헬퍼 작성**

```javascript
// lib/youtube-oauth.js
/**
 * Google OAuth 2.0 helper for YouTube Data API v3.
 * Threads OAuth 패턴과 유사하지만 Google은 refresh_token flow가 다르다.
 */
import { getRedis } from '@/lib/api-helpers';

const CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
const REDIRECT_URI = process.env.GOOGLE_OAUTH_REDIRECT_URI;

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';

const SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube.readonly',
];

export function buildAuthorizationUrl(state) {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: SCOPES.join(' '),
    access_type: 'offline',          // refresh_token 발급 필수
    prompt: 'consent',               // 매번 consent 요구 (refresh_token 보장)
    include_granted_scopes: 'true',
    state,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

export async function exchangeCode(code) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      code,
      grant_type: 'authorization_code',
      redirect_uri: REDIRECT_URI,
    }),
  });
  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(`OAuth code exchange 실패: ${data.error || res.status}`);
  }
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in,
    scope: data.scope,
    tokenType: data.token_type,
  };
}

/**
 * refresh_token으로 access_token을 갱신.
 * 결과는 Redis에 `yt:access:{email}` TTL expiresIn - 60초로 캐싱.
 */
export async function refreshAccessToken(email, refreshToken) {
  // 1. Redis 캐시 확인
  const redis = getRedis();
  const cached = await redis.get(`yt:access:${email}`);
  if (cached) return typeof cached === 'string' ? cached : cached.accessToken;

  // 2. 갱신 요청
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(`OAuth refresh 실패: ${data.error || res.status}`);
  }

  const ttl = Math.max(60, (data.expires_in || 3600) - 60);
  await redis.set(`yt:access:${email}`, data.access_token, { ex: ttl });
  return data.access_token;
}

export async function revokeToken(token) {
  // access_token 또는 refresh_token 모두 revoke 가능
  try {
    await fetch(REVOKE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }),
    });
  } catch (err) {
    console.error('[youtube-oauth] revoke 실패:', err?.message);
  }
}

/**
 * 채널 정보 조회 (연결 시 channel_id + channel_name 저장용).
 */
export async function fetchChannelInfo(accessToken) {
  const res = await fetch(
    'https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true',
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(`channels.list 실패: ${data.error?.message || res.status}`);
  }
  const item = data.items?.[0];
  if (!item) return null;
  return {
    channelId: item.id,
    channelName: item.snippet?.title || '',
  };
}
```

- [ ] **Step 2: 커밋**

```bash
git add lib/youtube-oauth.js
git commit -m "$(cat <<'EOF'
feat(lib): youtube-oauth — authorize URL + code exchange + refresh + revoke

access_type=offline + prompt=consent 로 refresh_token 보장. access_token은
Redis (yt:access:{email}) 에 expiresIn-60s TTL 캐싱. 채널 정보 조회
(channels.list?mine=true) 함수도 포함.
EOF
)"
```

---

## Task J4: /api/youtube-auth 라우트 — OAuth 전체 플로우

**Files:**
- Create: `app/api/youtube-auth/route.js`

- [ ] **Step 1: 라우트 작성**

```javascript
// app/api/youtube-auth/route.js
/**
 * YouTube OAuth 라우트.
 * Threads OAuth 패턴(app/api/threads-auth/route.js) 을 기반으로 Google OAuth 특성에 맞게 수정.
 *
 * action=authorize : Google Consent URL로 리다이렉트
 * action=callback  : code 수신 → token exchange → DB 저장 → 마이페이지 리다이렉트
 * action=status    : 연결 상태 JSON 응답
 * action=disconnect: refresh_token revoke + DB 삭제
 */
import crypto from 'crypto';
import { NextResponse } from 'next/server';
import {
  getRedis,
  extractToken,
  resolveSessionEmail,
  jsonResponse,
  handleOptions,
} from '@/lib/api-helpers';
import {
  buildAuthorizationUrl,
  exchangeCode,
  revokeToken,
  fetchChannelInfo,
} from '@/lib/youtube-oauth';
import {
  saveConnection,
  getConnection,
  deleteConnection,
} from '@/lib/youtube-connections';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function getQuery(request) {
  return new URL(request.url).searchParams;
}

function resolveAction(request) {
  const sp = getQuery(request);
  const action = sp.get('action');
  if (action) return action;
  if (sp.get('code') || sp.get('error')) return 'callback';
  return '';
}

export async function OPTIONS(request) {
  return handleOptions(request);
}

async function handleAuthorize(request) {
  const sp = getQuery(request);
  const token = extractToken(request) || sp.get('token');
  const email = await resolveSessionEmail(token);
  if (!email) return jsonResponse(request, { error: '로그인이 필요합니다.' }, { status: 401 });

  const nonce = crypto.randomUUID();
  await getRedis().set(`yt:oauth:${nonce}`, email, { ex: 600 });

  const url = buildAuthorizationUrl(nonce);
  return NextResponse.redirect(url, 302);
}

async function handleCallback(request) {
  const sp = getQuery(request);
  const code = sp.get('code');
  const state = sp.get('state');
  const error = sp.get('error');

  const origin = new URL(request.url).origin;
  const redirectUrl = (qs) => new URL(`/mypage?${qs}`, origin);

  if (error) return NextResponse.redirect(redirectUrl('youtube=denied'), 302);
  if (!code || !state) return NextResponse.redirect(redirectUrl('youtube=error'), 302);

  const email = await getRedis().get(`yt:oauth:${state}`);
  if (!email) return NextResponse.redirect(redirectUrl('youtube=error'), 302);
  await getRedis().del(`yt:oauth:${state}`);

  try {
    const tokens = await exchangeCode(code);

    // refresh_token이 없으면 prompt=consent 를 실패한 것 → 재시도 유도
    if (!tokens.refreshToken) {
      console.warn('[yt-auth] refresh_token 누락:', email);
      return NextResponse.redirect(redirectUrl('youtube=no_refresh'), 302);
    }

    const channel = await fetchChannelInfo(tokens.accessToken);

    await saveConnection({
      email,
      channelId: channel?.channelId || null,
      channelName: channel?.channelName || null,
      refreshToken: tokens.refreshToken,
      scopes: tokens.scope,
    });

    // access_token은 oauth 모듈이 이미 Redis에 캐싱했지만 명시적으로 한 번 더
    await getRedis().set(`yt:access:${email}`, tokens.accessToken, {
      ex: Math.max(60, (tokens.expiresIn || 3600) - 60),
    });

    return NextResponse.redirect(redirectUrl('youtube=connected'), 302);
  } catch (err) {
    console.error('[yt-auth] callback error:', err);
    return NextResponse.redirect(redirectUrl('youtube=error'), 302);
  }
}

async function handleStatus(request) {
  const token = extractToken(request);
  const email = await resolveSessionEmail(token);
  if (!email) return jsonResponse(request, { error: '로그인이 필요합니다.' }, { status: 401 });

  const conn = await getConnection(email);
  if (!conn) {
    return jsonResponse(request, { connected: false });
  }
  return jsonResponse(request, {
    connected: true,
    channelId: conn.channelId,
    channelName: conn.channelName,
    connectedAt: conn.connectedAt,
  });
}

async function handleDisconnect(request) {
  const token = extractToken(request);
  const email = await resolveSessionEmail(token);
  if (!email) return jsonResponse(request, { error: '로그인이 필요합니다.' }, { status: 401 });

  const conn = await getConnection(email);
  if (conn?.refreshToken) {
    await revokeToken(conn.refreshToken);
  }
  await deleteConnection(email);
  await getRedis().del(`yt:access:${email}`);
  return jsonResponse(request, { success: true });
}

export async function GET(request) {
  const action = resolveAction(request);
  if (action === 'authorize') return handleAuthorize(request);
  if (action === 'callback') return handleCallback(request);
  if (action === 'status') return handleStatus(request);
  return jsonResponse(request, { error: '잘못된 요청입니다.' }, { status: 400 });
}

export async function POST(request) {
  const action = resolveAction(request);
  if (action === 'disconnect') return handleDisconnect(request);
  return jsonResponse(request, { error: '잘못된 요청입니다.' }, { status: 400 });
}
```

- [ ] **Step 2: 빌드 체크 + 로컬 authorize flow 수동 검증 (test user 상태)**

```bash
npx next build 2>&1 | grep -iE "error|✓ Compiled" | head -10
```

Expected: 컴파일 성공. 실제 OAuth는 verification 전이므로 test user 계정으로만 동작.

- [ ] **Step 3: 커밋**

```bash
git add app/api/youtube-auth/route.js
git commit -m "$(cat <<'EOF'
feat(api): /api/youtube-auth — OAuth authorize/callback/status/disconnect

Threads OAuth 패턴을 Google OAuth 에 맞게 수정. callback에서 code 교환
→ channels.list 로 channel 정보 조회 → saveConnection으로 DB 저장.
refresh_token이 누락되면 redirect에 youtube=no_refresh 파라미터로 알림.
disconnect는 revoke + DB delete + Redis access 캐시 삭제.
EOF
)"
```

---

## Task J5: /api/youtube-upload — resumable session URI 발급만

**Files:**
- Create: `app/api/youtube-upload/route.js`

이 라우트는 **절대 영상 바이트를 받지 않는다**. 오직 YouTube에 resumable session URI를 요청하고 브라우저에 전달한다.

- [ ] **Step 1: 라우트 작성**

```javascript
// app/api/youtube-upload/route.js
/**
 * YouTube 업로드 — resumable session URI 발급 전용.
 *
 * 이 라우트는 영상 파일 자체를 절대 받지 않는다.
 * 1. 사용자 로그인 검증
 * 2. feature flag 확인 (verification 전에는 운영자만)
 * 3. refresh_token → access_token
 * 4. YouTube videos.insert?uploadType=resumable 로 POST (body는 메타데이터만)
 * 5. 응답 Location 헤더의 sessionUri 를 클라이언트에 반환
 * 6. 브라우저가 sessionUri로 직접 chunk PUT
 */
import { NextResponse } from 'next/server';
import {
  extractToken,
  resolveSessionEmail,
  resolveAdmin,
  jsonResponse,
  handleOptions,
} from '@/lib/api-helpers';
import { getConnection, touchLastUsed } from '@/lib/youtube-connections';
import { refreshAccessToken } from '@/lib/youtube-oauth';
import { publishProgress, createJobId } from '@/lib/job-progress';

export const runtime = 'nodejs';

export async function OPTIONS(request) {
  return handleOptions(request);
}

export async function POST(request) {
  // Feature flag: verification 전에는 관리자만
  const featureOn = process.env.YOUTUBE_UPLOAD_FEATURE_FLAG === 'true';
  const isAdmin = await resolveAdmin(request);
  if (!featureOn && !isAdmin) {
    return jsonResponse(request, { error: 'YouTube 업로드는 v1.1에서 제공됩니다.' }, { status: 403 });
  }

  const token = extractToken(request);
  const email = await resolveSessionEmail(token);
  if (!email) return jsonResponse(request, { error: '로그인이 필요합니다.' }, { status: 401 });

  const body = await request.json();
  const {
    title,
    description,
    tags = [],
    categoryId = '22', // People & Blogs (기본). Howto & Style = '26'
    privacyStatus = 'public',
    madeForKids = false,
    fileSize,
    contentType = 'video/mp4',
    jobId: incomingJobId,
  } = body || {};

  if (!title || !fileSize) {
    return jsonResponse(request, { error: 'title, fileSize 필수' }, { status: 400 });
  }

  const conn = await getConnection(email);
  if (!conn) {
    return jsonResponse(request, { error: 'YouTube 계정 연결이 필요합니다.' }, { status: 400 });
  }

  const jobId = incomingJobId || createJobId();

  try {
    await publishProgress(jobId, {
      type: 'step',
      step: 'upload-youtube',
      status: 'running',
      progress: 0,
      subStep: 'mint-session',
    });

    const accessToken = await refreshAccessToken(email, conn.refreshToken);

    const metadata = {
      snippet: {
        title: title.slice(0, 100),
        description: (description || '').slice(0, 5000),
        tags: Array.isArray(tags) ? tags.slice(0, 15) : [],
        categoryId,
      },
      status: {
        privacyStatus,
        selfDeclaredMadeForKids: madeForKids,
      },
    };

    const initRes = await fetch(
      'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json; charset=UTF-8',
          'X-Upload-Content-Type': contentType,
          'X-Upload-Content-Length': String(fileSize),
        },
        body: JSON.stringify(metadata),
      }
    );

    if (!initRes.ok) {
      const errText = await initRes.text();
      console.error('[yt-upload] resumable init 실패:', initRes.status, errText);
      await publishProgress(jobId, {
        type: 'error',
        step: 'upload-youtube',
        error: `YouTube 업로드 초기화 실패 (${initRes.status})`,
      });
      return jsonResponse(
        request,
        { error: 'YouTube 업로드 초기화 실패', detail: errText.slice(0, 500) },
        { status: 502 }
      );
    }

    const sessionUri = initRes.headers.get('location') || initRes.headers.get('Location');
    if (!sessionUri) {
      await publishProgress(jobId, {
        type: 'error',
        step: 'upload-youtube',
        error: 'sessionUri 누락',
      });
      return jsonResponse(request, { error: 'sessionUri 발급 실패' }, { status: 502 });
    }

    await touchLastUsed(email);

    await publishProgress(jobId, {
      type: 'step',
      step: 'upload-youtube',
      status: 'running',
      progress: 5,
      subStep: 'browser-upload-start',
    });

    return jsonResponse(request, {
      jobId,
      sessionUri,
      accessTokenHint: null, // 절대 반환 금지
      chunkSize: 8 * 1024 * 1024, // 8MB
    });
  } catch (err) {
    console.error('[yt-upload] 예외:', err);
    await publishProgress(jobId, {
      type: 'error',
      step: 'upload-youtube',
      error: err?.message || 'unknown error',
    });
    return jsonResponse(request, { error: '업로드 준비 실패', detail: err?.message }, { status: 500 });
  }
}
```

- [ ] **Step 2: 커밋**

```bash
git add app/api/youtube-upload/route.js
git commit -m "$(cat <<'EOF'
feat(api): /api/youtube-upload — resumable session URI 발급

서버는 영상 바이트를 절대 받지 않고, YouTube Data API에
videos.insert?uploadType=resumable 로 메타데이터만 POST.
응답 Location 헤더의 sessionUri 를 브라우저에 반환. 이후 브라우저가
직접 chunk PUT. feature flag + admin 가드로 v1.1 전 비활성.
Phase I의 publishProgress 로 진행 이벤트 발행.
EOF
)"
```

---

## Task J6: lib/youtube-browser-upload.js — 브라우저 chunk 업로드 유틸

**Files:**
- Create: `lib/youtube-browser-upload.js`

- [ ] **Step 1: 업로드 헬퍼 작성**

이 파일은 클라이언트 컴포넌트에서 `import` 한다. Node 전용 모듈을 쓰지 않도록 주의.

```javascript
// lib/youtube-browser-upload.js
/**
 * YouTube Resumable Upload (브라우저 전용).
 *
 * 사용:
 *   import { uploadToYoutube } from '@/lib/youtube-browser-upload';
 *   await uploadToYoutube({ sessionUri, file, chunkSize, onProgress });
 *
 * chunk 마다 PUT → 308 Resume Incomplete 가 정상 응답.
 * 마지막 chunk가 200/201 이면 업로드 완료.
 * 실패 시 Range 헤더로 재개 가능.
 */

const DEFAULT_CHUNK = 8 * 1024 * 1024; // 8MB

export async function uploadToYoutube({
  sessionUri,
  file,
  chunkSize = DEFAULT_CHUNK,
  onProgress,
  onChunkComplete,
  signal,
}) {
  if (!sessionUri) throw new Error('sessionUri 필수');
  if (!(file instanceof Blob)) throw new Error('file은 Blob/File 이어야 합니다.');

  const total = file.size;
  let uploaded = 0;

  while (uploaded < total) {
    if (signal?.aborted) {
      throw new Error('업로드가 취소되었습니다.');
    }
    const end = Math.min(uploaded + chunkSize, total);
    const chunk = file.slice(uploaded, end);
    const contentRange = `bytes ${uploaded}-${end - 1}/${total}`;

    // 브라우저 fetch는 PUT body progress 콜백을 지원하지 않으므로
    // XMLHttpRequest로 upload progress를 받는다.
    const { status, responseText, resumeOffset } = await putChunk({
      sessionUri,
      chunk,
      contentRange,
      onProgress: (loaded) => {
        if (typeof onProgress === 'function') {
          onProgress({
            loaded: uploaded + loaded,
            total,
            percent: Math.round(((uploaded + loaded) / total) * 100),
          });
        }
      },
      signal,
    });

    if (status === 200 || status === 201) {
      // 업로드 완료
      uploaded = total;
      if (typeof onProgress === 'function') {
        onProgress({ loaded: total, total, percent: 100 });
      }
      if (typeof onChunkComplete === 'function') {
        onChunkComplete({ uploaded: total, total });
      }
      try {
        return JSON.parse(responseText);
      } catch {
        return { raw: responseText };
      }
    }

    if (status === 308) {
      // Resume Incomplete — Range 헤더의 bytes=0-X 에서 다음 offset 계산
      uploaded = resumeOffset != null ? resumeOffset + 1 : end;
      if (typeof onChunkComplete === 'function') {
        onChunkComplete({ uploaded, total });
      }
      continue;
    }

    throw new Error(`YouTube 업로드 실패: status=${status} body=${responseText?.slice(0, 300)}`);
  }

  return { success: true };
}

function putChunk({ sessionUri, chunk, contentRange, onProgress, signal }) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', sessionUri, true);
    xhr.setRequestHeader('Content-Range', contentRange);
    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable && typeof onProgress === 'function') {
        onProgress(e.loaded);
      }
    });
    xhr.onload = () => {
      const rangeHeader = xhr.getResponseHeader('Range');
      let resumeOffset = null;
      if (rangeHeader) {
        // 예: "bytes=0-1048575"
        const match = rangeHeader.match(/bytes=\d+-(\d+)/);
        if (match) resumeOffset = parseInt(match[1], 10);
      }
      resolve({ status: xhr.status, responseText: xhr.responseText, resumeOffset });
    };
    xhr.onerror = () => reject(new Error('네트워크 오류'));
    xhr.onabort = () => reject(new Error('업로드 중단'));
    if (signal) {
      signal.addEventListener('abort', () => xhr.abort());
    }
    xhr.send(chunk);
  });
}

/**
 * 업로드 재개 시 현재 offset 조회.
 * PUT bytes *\/totalSize 로 요청 → 308 응답의 Range 헤더에 현재 업로드된 바이트 표시.
 */
export async function queryUploadStatus(sessionUri, totalSize) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', sessionUri, true);
    xhr.setRequestHeader('Content-Range', `bytes */${totalSize}`);
    xhr.onload = () => {
      if (xhr.status === 308) {
        const rangeHeader = xhr.getResponseHeader('Range');
        let nextOffset = 0;
        if (rangeHeader) {
          const match = rangeHeader.match(/bytes=\d+-(\d+)/);
          if (match) nextOffset = parseInt(match[1], 10) + 1;
        }
        resolve({ resumable: true, nextOffset });
      } else if (xhr.status === 200 || xhr.status === 201) {
        resolve({ resumable: false, completed: true });
      } else {
        reject(new Error(`status check 실패: ${xhr.status}`));
      }
    };
    xhr.onerror = () => reject(new Error('status check 네트워크 오류'));
    xhr.send('');
  });
}
```

- [ ] **Step 2: 커밋**

```bash
git add lib/youtube-browser-upload.js
git commit -m "$(cat <<'EOF'
feat(lib): youtube-browser-upload — 브라우저 resumable PUT 유틸

XMLHttpRequest로 upload progress 이벤트를 수신하며 8MB chunk로 PUT.
308 Resume Incomplete → Range 헤더 파싱 → 다음 offset 계산.
실패 시 queryUploadStatus 로 재개 가능. signal로 abort 지원.
EOF
)"
```

---

## Task J7: 마이페이지 YouTubeSection 컴포넌트

**Files:**
- Create: `app/mypage/YouTubeSection.js`
- Create: `app/mypage/YouTubeSection.module.css`
- Modify: `app/mypage/MyPageClient.js`

- [ ] **Step 1: 컴포넌트 작성**

```javascript
// app/mypage/YouTubeSection.js
'use client';

import { useEffect, useState } from 'react';
import styles from './YouTubeSection.module.css';

export default function YouTubeSection({ authToken }) {
  const [loading, setLoading] = useState(true);
  const [conn, setConn] = useState(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch('/api/youtube-auth?action=status', {
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
      });
      const data = await res.json();
      setConn(data?.connected ? data : null);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();

    // 쿼리스트링 결과 처리 (callback에서 /mypage?youtube=connected)
    const url = new URL(window.location.href);
    const ytStatus = url.searchParams.get('youtube');
    if (ytStatus) {
      if (ytStatus === 'connected') alert('YouTube 계정이 연결되었어요.');
      else if (ytStatus === 'denied') alert('권한이 거부되었어요.');
      else if (ytStatus === 'error') alert('연결 중 오류가 발생했어요.');
      else if (ytStatus === 'no_refresh') alert('재연결이 필요해요. (refresh token 누락)');
      url.searchParams.delete('youtube');
      window.history.replaceState({}, '', url.toString());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleConnect() {
    setBusy(true);
    try {
      // 서버가 302로 Google consent로 보내므로 브라우저 전체 이동
      window.location.href = `/api/youtube-auth?action=authorize&token=${encodeURIComponent(authToken || '')}`;
    } finally {
      setBusy(false);
    }
  }

  async function handleDisconnect() {
    if (!window.confirm('YouTube 계정 연결을 해제할까요?')) return;
    setBusy(true);
    try {
      await fetch('/api/youtube-auth?action=disconnect', {
        method: 'POST',
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
      });
      await load();
    } catch (err) {
      console.error(err);
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <section className={styles.section}>
        <h2 className={styles.title}>YouTube 계정</h2>
        <p className={styles.muted}>불러오는 중...</p>
      </section>
    );
  }

  return (
    <section className={styles.section}>
      <h2 className={styles.title}>YouTube 계정</h2>
      {conn ? (
        <div className={styles.connected}>
          <div className={styles.channel}>
            <div className={styles.channelName}>{conn.channelName || '연결됨'}</div>
            <div className={styles.channelId}>{conn.channelId}</div>
          </div>
          <button
            type="button"
            className={styles.disconnectBtn}
            disabled={busy}
            onClick={handleDisconnect}
          >
            연결 해제
          </button>
        </div>
      ) : (
        <div className={styles.notConnected}>
          <p className={styles.muted}>
            연결하면 숏폼을 한 번에 YouTube에 업로드할 수 있어요. (v1.1)
          </p>
          <button
            type="button"
            className={styles.connectBtn}
            disabled={busy}
            onClick={handleConnect}
          >
            Google로 연결하기
          </button>
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 2: CSS 작성**

```css
/* app/mypage/YouTubeSection.module.css */
.section {
  padding: 24px;
  background: var(--ds-surface-1, #fff);
  border: 1px solid var(--ds-border, #E5E7EB);
  border-radius: 16px;
  margin-top: 24px;
}
.title {
  font-size: 18px;
  font-weight: 700;
  color: var(--ds-text, #1F2937);
  margin: 0 0 16px;
}
.muted { color: var(--ds-muted, #77736B); font-size: 13px; }
.connected {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  padding: 16px;
  background: var(--ds-surface-2, #F9FAFB);
  border-radius: 12px;
}
.channel { min-width: 0; }
.channelName { font-weight: 700; color: var(--ds-text, #1F2937); }
.channelId { font-size: 12px; color: var(--ds-muted, #77736B); margin-top: 2px; }
.connectBtn {
  margin-top: 12px;
  padding: 12px 20px;
  background: var(--ds-accent, #ff5f1f);
  color: #fff;
  border: none;
  border-radius: 10px;
  font-weight: 700;
  cursor: pointer;
}
.connectBtn:hover { filter: brightness(0.95); }
.disconnectBtn {
  padding: 8px 14px;
  background: var(--ds-surface-1, #fff);
  border: 1px solid var(--ds-border, #E5E7EB);
  border-radius: 8px;
  color: #DC2626;
  font-weight: 600;
  cursor: pointer;
}
.notConnected { display: flex; flex-direction: column; gap: 8px; align-items: flex-start; }
```

- [ ] **Step 3: MyPageClient에 마운트**

```javascript
// app/mypage/MyPageClient.js (발췌)
import YouTubeSection from './YouTubeSection';
// ...
{token && <YouTubeSection authToken={token} />}
```

- [ ] **Step 4: 커밋**

```bash
git add app/mypage/YouTubeSection.js app/mypage/YouTubeSection.module.css app/mypage/MyPageClient.js
git commit -m "$(cat <<'EOF'
feat(mypage): YouTubeSection — 연결/해제 UI

/api/youtube-auth?action=status 로 상태 조회. 연결 시 channelName 표시.
연결 클릭 → authorize redirect. 해제 클릭 → disconnect API + 상태 새로고침.
callback redirect의 ?youtube=... 파라미터를 읽어 alert으로 피드백.
EOF
)"
```

---

## Task J8: ShortformClient Step 7 — "YouTube에 바로 업로드" 버튼 + 업로드 모달

**Files:**
- Modify: `app/shortform/ShortformClient.js`
- Create: `app/shortform/components/YouTubeUploadModal.js`
- Create: `app/shortform/components/YouTubeUploadModal.module.css`

- [ ] **Step 1: 업로드 모달 컴포넌트 작성**

```javascript
// app/shortform/components/YouTubeUploadModal.js
'use client';

import { useState, useEffect } from 'react';
import { uploadToYoutube } from '@/lib/youtube-browser-upload';
import styles from './YouTubeUploadModal.module.css';

export default function YouTubeUploadModal({
  open,
  onClose,
  authToken,
  videoBlob,
  defaultTitle,
  defaultDescription,
  defaultTags,
  jobId,
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState('');
  const [categoryId, setCategoryId] = useState('26'); // Howto & Style
  const [privacyStatus, setPrivacyStatus] = useState('public');
  const [madeForKids, setMadeForKids] = useState(false);
  const [status, setStatus] = useState('idle'); // idle|minting|uploading|done|error
  const [progress, setProgress] = useState(0);
  const [videoId, setVideoId] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      setTitle(defaultTitle || '');
      setDescription(defaultDescription || '');
      setTags((defaultTags || []).join(', '));
      setStatus('idle');
      setProgress(0);
      setVideoId(null);
      setError('');
    }
  }, [open, defaultTitle, defaultDescription, defaultTags]);

  async function handleUpload() {
    if (!videoBlob) {
      setError('영상 파일이 없습니다.');
      return;
    }
    if (!title.trim()) {
      setError('제목을 입력해주세요.');
      return;
    }

    setStatus('minting');
    setError('');

    try {
      // 1. 서버에 sessionUri 요청
      const res = await fetch('/api/youtube-upload', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          jobId,
          title,
          description,
          tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
          categoryId,
          privacyStatus,
          madeForKids,
          fileSize: videoBlob.size,
          contentType: 'video/mp4',
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || 'sessionUri 발급 실패');
      }

      setStatus('uploading');

      // 2. 브라우저에서 직접 업로드
      const result = await uploadToYoutube({
        sessionUri: data.sessionUri,
        file: videoBlob,
        chunkSize: data.chunkSize || 8 * 1024 * 1024,
        onProgress: ({ percent }) => setProgress(percent),
      });

      setStatus('done');
      const uploadedId = result?.id || result?.raw ? JSON.parse(result.raw)?.id : null;
      setVideoId(uploadedId);
    } catch (err) {
      console.error('[YouTubeUploadModal]', err);
      setStatus('error');
      setError(err?.message || '업로드 실패');
    }
  }

  if (!open) return null;

  return (
    <div className={styles.backdrop} onClick={status === 'uploading' ? undefined : onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <div className={styles.title}>YouTube 업로드</div>
          {status !== 'uploading' && (
            <button type="button" className={styles.closeBtn} onClick={onClose}>✕</button>
          )}
        </div>

        {status === 'done' ? (
          <div className={styles.done}>
            <div>✅ 업로드 완료</div>
            {videoId && (
              <a
                className={styles.watchLink}
                href={`https://www.youtube.com/watch?v=${videoId}`}
                target="_blank"
                rel="noreferrer"
              >
                YouTube에서 보기
              </a>
            )}
            <button type="button" className={styles.primaryBtn} onClick={onClose}>닫기</button>
          </div>
        ) : (
          <>
            <label className={styles.field}>
              <span>제목</span>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={100}
                disabled={status !== 'idle'}
              />
            </label>

            <label className={styles.field}>
              <span>설명</span>
              <textarea
                rows={5}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={5000}
                disabled={status !== 'idle'}
              />
            </label>

            <label className={styles.field}>
              <span>태그 (쉼표 구분)</span>
              <input
                type="text"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                disabled={status !== 'idle'}
              />
            </label>

            <div className={styles.row}>
              <label className={styles.field}>
                <span>카테고리</span>
                <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} disabled={status !== 'idle'}>
                  <option value="26">Howto & Style</option>
                  <option value="22">People & Blogs</option>
                  <option value="24">Entertainment</option>
                  <option value="27">Education</option>
                </select>
              </label>
              <label className={styles.field}>
                <span>공개 범위</span>
                <select value={privacyStatus} onChange={(e) => setPrivacyStatus(e.target.value)} disabled={status !== 'idle'}>
                  <option value="public">공개</option>
                  <option value="unlisted">일부공개</option>
                  <option value="private">비공개</option>
                </select>
              </label>
            </div>

            <label className={styles.checkRow}>
              <input
                type="checkbox"
                checked={madeForKids}
                onChange={(e) => setMadeForKids(e.target.checked)}
                disabled={status !== 'idle'}
              />
              <span>어린이용 영상</span>
            </label>

            {status === 'uploading' && (
              <div className={styles.progressWrap}>
                <div className={styles.progressText}>업로드 중... {progress}%</div>
                <div className={styles.progressBar}>
                  <div className={styles.progressFill} style={{ width: `${progress}%` }} />
                </div>
              </div>
            )}

            {error && <div className={styles.error}>{error}</div>}

            <button
              type="button"
              className={styles.primaryBtn}
              onClick={handleUpload}
              disabled={status !== 'idle'}
            >
              {status === 'minting' && '준비 중...'}
              {status === 'uploading' && '업로드 중...'}
              {status === 'idle' && '업로드 시작'}
              {status === 'error' && '다시 시도'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: CSS 작성**

```css
/* app/shortform/components/YouTubeUploadModal.module.css */
.backdrop {
  position: fixed; inset: 0;
  background: rgba(0,0,0,0.55);
  display: flex; align-items: center; justify-content: center;
  z-index: 1000;
}
.modal {
  width: min(540px, 92vw);
  max-height: 90vh;
  overflow: auto;
  background: #fff;
  border-radius: 16px;
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.header { display: flex; justify-content: space-between; align-items: center; }
.title { font-size: 18px; font-weight: 700; }
.closeBtn { background: none; border: none; font-size: 20px; cursor: pointer; }
.field { display: flex; flex-direction: column; gap: 6px; font-size: 13px; color: #1F2937; }
.field input, .field textarea, .field select {
  padding: 10px 12px;
  border: 1px solid #E5E7EB;
  border-radius: 8px;
  font-size: 14px;
  font-family: inherit;
}
.row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.checkRow { display: flex; align-items: center; gap: 8px; font-size: 13px; }
.primaryBtn {
  padding: 14px 20px;
  background: var(--ds-accent, #ff5f1f);
  color: #fff;
  border: none;
  border-radius: 10px;
  font-weight: 700;
  cursor: pointer;
}
.primaryBtn:disabled { opacity: 0.6; cursor: not-allowed; }
.progressWrap { display: flex; flex-direction: column; gap: 6px; margin-top: 8px; }
.progressText { font-size: 13px; color: #1F2937; }
.progressBar { height: 8px; background: #F3F4F6; border-radius: 4px; overflow: hidden; }
.progressFill { height: 100%; background: var(--ds-accent, #ff5f1f); transition: width 0.2s; }
.error { padding: 10px 12px; background: rgba(239,68,68,0.08); color: #DC2626; border-radius: 8px; font-size: 13px; }
.done { display: flex; flex-direction: column; gap: 12px; align-items: flex-start; }
.watchLink { color: var(--ds-accent, #ff5f1f); text-decoration: underline; font-weight: 600; }
```

- [ ] **Step 3: ShortformClient Step 7에 버튼 추가**

```javascript
// app/shortform/ShortformClient.js (Step 7 부분)
import YouTubeUploadModal from './components/YouTubeUploadModal';
// ...
const [youtubeConnected, setYoutubeConnected] = useState(false);
const [ytModalOpen, setYtModalOpen] = useState(false);
const [videoBlob, setVideoBlob] = useState(null); // 렌더 완료 시 설정

useEffect(() => {
  if (!token) return;
  fetch('/api/youtube-auth?action=status', { headers: { Authorization: `Bearer ${token}` } })
    .then((r) => r.json())
    .then((d) => setYoutubeConnected(Boolean(d?.connected)))
    .catch(() => setYoutubeConnected(false));
}, [token]);

// Step 7 JSX:
{currentStep === 7 && videoBlob && (
  <div className={styles.step7Actions}>
    <a href={videoBlobUrl} download="shortform.mp4" className={styles.downloadBtn}>
      mp4 다운로드
    </a>
    {youtubeConnected ? (
      <button type="button" className={styles.uploadBtn} onClick={() => setYtModalOpen(true)}>
        ▶ YouTube에 바로 업로드
      </button>
    ) : (
      <a href="/mypage" className={styles.uploadBtnGhost}>
        YouTube 계정 연결하기
      </a>
    )}
  </div>
)}

<YouTubeUploadModal
  open={ytModalOpen}
  onClose={() => setYtModalOpen(false)}
  authToken={token}
  videoBlob={videoBlob}
  defaultTitle={script?.title}
  defaultDescription={caption?.body}
  defaultTags={caption?.hashtags || []}
  jobId={jobId}
/>
```

- [ ] **Step 4: 커밋**

```bash
git add app/shortform/components/YouTubeUploadModal.js app/shortform/components/YouTubeUploadModal.module.css app/shortform/ShortformClient.js
git commit -m "$(cat <<'EOF'
feat(shortform): Step 7 YouTube 직접 업로드 버튼 + 모달

연결 상태를 fetch로 확인해서 연결 시 "YouTube에 바로 업로드" 버튼 노출.
모달에서 제목/설명/태그/카테고리/공개범위/어린이용 입력 후 업로드 시작.
sessionUri 받아서 브라우저가 직접 resumable PUT. 업로드 진행률 실시간.
완료 시 watch URL 링크 제공.
EOF
)"
```

---

## Task J9: SSE 업로드 진행률 통합 (Phase I 재사용)

**Files:**
- Modify: `components/ProgressIndicator.js`
- Modify: `app/shortform/components/YouTubeUploadModal.js` (onProgress → publishProgress 브리지)

브라우저 upload progress 는 이미 모달 내부 state로 표시되지만, 큰 영상은 업로드 자체가 3~5분 걸릴 수 있으므로 **같은 SSE 버스로도 진행 상태를 흘려보내** 사용자가 다른 탭에서도 확인할 수 있게 한다.

- [ ] **Step 1: ProgressIndicator에 upload-youtube 라벨 추가**

```javascript
// components/ProgressIndicator.js (STEP_LABELS 수정)
const STEP_LABELS = {
  // ...
  'upload-youtube': 'YouTube 업로드',
};
```

- [ ] **Step 2: 모달이 브라우저 progress 를 서버로 push**

브라우저가 직접 서버 publishProgress를 호출할 수 있는 경량 엔드포인트를 만들거나, 기존 SSE 채널에 쓰기 전용 API가 필요하다. 간단한 구현은 별도 POST 엔드포인트:

```javascript
// app/api/shortform-progress/push/route.js
import { publishProgress } from '@/lib/job-progress';
import { extractToken, resolveSessionEmail, jsonResponse, handleOptions } from '@/lib/api-helpers';

export const runtime = 'nodejs';
export async function OPTIONS(request) { return handleOptions(request); }

export async function POST(request) {
  const token = extractToken(request);
  const email = await resolveSessionEmail(token);
  if (!email) return jsonResponse(request, { error: '로그인이 필요합니다.' }, { status: 401 });

  const body = await request.json();
  const { jobId, step, status, progress, subStep } = body || {};
  if (!jobId || !step) return jsonResponse(request, { error: 'jobId/step 필수' }, { status: 400 });

  // 화이트리스트: 클라이언트가 임의 step을 주입 못하게
  const allowed = ['upload-youtube'];
  if (!allowed.includes(step)) return jsonResponse(request, { error: '허용되지 않은 step' }, { status: 400 });

  await publishProgress(jobId, { type: 'step', step, status, progress, subStep });
  return jsonResponse(request, { ok: true });
}
```

- [ ] **Step 3: 모달의 onProgress 에서 throttle해서 push**

```javascript
// YouTubeUploadModal 발췌
const lastPushedRef = useRef(0);
const pushProgress = async (percent) => {
  const now = Date.now();
  if (now - lastPushedRef.current < 1000) return; // 1초 throttle
  lastPushedRef.current = now;
  try {
    await fetch('/api/shortform-progress/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({
        jobId,
        step: 'upload-youtube',
        status: 'running',
        progress: percent,
      }),
    });
  } catch (err) {
    console.warn('[yt-progress push]', err?.message);
  }
};

// uploadToYoutube 호출부
onProgress: ({ percent }) => {
  setProgress(percent);
  pushProgress(percent);
},
```

- [ ] **Step 4: 커밋**

```bash
git add components/ProgressIndicator.js app/api/shortform-progress/push/route.js app/shortform/components/YouTubeUploadModal.js
git commit -m "$(cat <<'EOF'
feat(shortform): YouTube 업로드 진행률을 SSE 버스로 발행

/api/shortform-progress/push 엔드포인트 추가 (upload-youtube step만 화이트
리스트). 브라우저 upload progress를 1초 throttle로 서버에 post해서
SSE 구독자에게 재발행. 다른 탭/마이페이지에서도 진행률 확인 가능.
EOF
)"
```

---

## Task J10: 에러 처리 + 재개

**Files:**
- Modify: `app/shortform/components/YouTubeUploadModal.js`

- [ ] **Step 1: 네트워크 실패 시 재개 로직**

```javascript
// YouTubeUploadModal 발췌
import { queryUploadStatus, uploadToYoutube } from '@/lib/youtube-browser-upload';

async function handleUpload() {
  // ... 기존 sessionUri mint 이후
  try {
    await uploadToYoutube({ /* ... */ });
  } catch (err) {
    // 네트워크 단절 시 재개 시도
    if (sessionUri) {
      try {
        const state = await queryUploadStatus(sessionUri, videoBlob.size);
        if (state.resumable) {
          // 남은 offset 부터 재개 — 현재는 slice로 uploaded 부분 skip 하는 uploadToYoutube 호출
          await uploadToYoutube({
            sessionUri,
            file: videoBlob.slice(state.nextOffset),
            // TODO: 내부 uploaded 초기 offset 지원 개선
          });
          return;
        }
      } catch (err2) {
        console.error('[yt] 재개 실패:', err2);
      }
    }
    throw err;
  }
}
```

> **주의:** 현재 `uploadToYoutube`는 전체 파일을 처음부터 보낸다. 재개를 완전히 구현하려면 `initialOffset` 파라미터를 추가해서 `slice(initialOffset)` 대신 내부적으로 offset을 관리해야 한다. Phase L(검증)에서 실제 큰 영상(50~80MB)으로 테스트 후 필요하면 리팩토링.

- [ ] **Step 2: 자주 발생하는 에러 별도 처리**

- `401 Unauthorized`: access_token 만료 → `refreshAccessToken` 호출 후 재시도 (서버 응답 detect 필요)
- `403 quotaExceeded`: 쿼터 소진 → "오늘 업로드 한도에 도달했어요" 메시지
- `403 insufficientPermissions`: scope 부족 → 재연결 유도
- `400 invalidCategoryId`: 카테고리 재선택 안내

```javascript
function describeYoutubeError(status, detail) {
  if (status === 401) return '인증 만료. 마이페이지에서 재연결해주세요.';
  if (status === 403 && /quota/i.test(detail)) return '오늘 업로드 한도에 도달했어요. 내일 다시 시도해주세요.';
  if (status === 403) return '권한 부족. 마이페이지에서 재연결해주세요.';
  if (status === 400 && /category/i.test(detail)) return '카테고리가 잘못됐어요. 다른 카테고리를 선택해주세요.';
  return `업로드 실패 (${status})`;
}
```

- [ ] **Step 3: 커밋**

```bash
git add app/shortform/components/YouTubeUploadModal.js
git commit -m "$(cat <<'EOF'
feat(shortform): YouTube 업로드 에러 처리 + 재개 skeleton

네트워크 단절 시 queryUploadStatus로 offset 확인 후 재개 시도.
401/403/400 주요 에러를 사용자 친화 메시지로 변환. 완전 재개는
uploadToYoutube에 initialOffset 추가 리팩토링 필요 (Phase L 검증 후).
EOF
)"
```

---

## Task J11: 수동 검증 — Test user 플로우

**Files:**
- 없음 (검증 전용)

- [ ] **Step 1: OAuth 연결 테스트 (verification 전, test user 계정으로)**

1. 로컬 서버 기동
2. /mypage 접속, 로그인 (test user 등록된 Gmail)
3. "Google로 연결하기" 클릭
4. Google consent 화면 → youtube.upload + youtube.readonly 동의
5. /mypage?youtube=connected 로 리다이렉트 + alert
6. 상태 재조회 → channelName 표시 확인

- [ ] **Step 2: 실제 업로드 테스트 (작은 mp4로)**

1. /shortform 에서 기존 흐름으로 30초 영상 렌더 완료
2. Step 7 "YouTube에 바로 업로드" 클릭
3. 모달에서 제목/설명 입력 후 "업로드 시작"
4. sessionUri mint → chunk PUT 진행 (브라우저 네트워크 탭에서 확인)
5. 완료 후 videoId 받아 YouTube watch URL 링크 표시
6. YouTube Studio에서 실제 업로드 여부 확인

- [ ] **Step 3: 재개 테스트 (네트워크 단절 시뮬)**

1. 큰 파일(30MB+) 업로드 시작
2. 브라우저 devtools → Network 탭 → "Offline" 토글
3. 업로드 실패 감지
4. "다시 시도" 클릭 → queryUploadStatus → 재개

- [ ] **Step 4: 연결 해제 테스트**

1. 마이페이지 "연결 해제" 클릭
2. DB + Redis에서 데이터 제거 확인
3. 다시 /shortform Step 7 → "YouTube 계정 연결하기" 링크로 변경

- [ ] **Step 5: SSE 진행률 교차 확인**

1. 업로드 시작
2. 다른 탭에서 /shortform 접속 → 같은 jobId 복원 → ProgressIndicator에 `upload-youtube` step 진행률 표시 확인

- [ ] **Step 6: 검증 결과 커밋**

```bash
git commit --allow-empty -m "$(cat <<'EOF'
chore: Phase J YouTube 업로드 수동 검증 완료 (test user)

- OAuth authorize/callback/disconnect OK
- 30초 shortform 업로드 OK (videoId 수신)
- SSE upload-youtube 진행률 OK
- 재개 로직 skeleton 동작 확인

남은 작업:
- OAuth verification 승인 대기 (Task J0)
- 쿼터 상향 승인 대기
- 50MB+ 대용량 재개 완전 테스트 (Phase L)
EOF
)"
```

---

## Task J12: 메모리 + 마스터 플랜 업데이트

**Files:**
- Create: `~/.claude/projects/-Users-gong-eunhui-Desktop-naver-title-generator/memory/project_shortform_phase_j_complete.md`
- Modify: `~/.claude/projects/-Users-gong-eunhui-Desktop-naver-title-generator/memory/MEMORY.md`
- Modify: `docs/superpowers/plans/2026-04-14-shortform-master-plan.md`

- [ ] **Step 1: 메모리 파일 작성**

```markdown
---
name: 숏폼 Phase J 완료 (v1.1 코드 준비)
description: YouTube OAuth + 브라우저 직접 resumable 업로드
type: project
---

# 숏폼 Phase J 완료 (v1.1 배포 대기)

**완료일:** 2026-04-XX
**배포 상태:** 코드 머지 완료, feature flag OFF. OAuth verification 승인 후 활성화.
**스펙:** docs/superpowers/specs/2026-04-14-shortform-benchmark-pipeline-design.md §18
**플랜:** docs/superpowers/plans/2026-04-14-shortform-phase-j-youtube-upload.md

## 핵심 변경

- lib/encryption.js: AES-256-GCM refresh_token 암호화
- lib/youtube-oauth.js: authorize/exchange/refresh/revoke + 채널 정보 조회
- lib/youtube-connections.js: Postgres 테이블 + lazy ensureSchema
- lib/youtube-browser-upload.js: 브라우저 resumable PUT (XHR progress)
- /api/youtube-auth 라우트 (Threads 패턴 기반)
- /api/youtube-upload 라우트 (sessionUri 발급 전용, 바이트 통과 금지)
- /api/shortform-progress/push 엔드포인트 (업로드 진행률 SSE 브리지)
- YouTubeSection 마이페이지 UI
- YouTubeUploadModal 컴포넌트 + Step 7 버튼

## 기술 결정

- **Vercel 60s 제한 때문에 서버 직접 업로드 포기**. 브라우저 resumable 업로드로 전환.
- 8MB chunk, XMLHttpRequest upload progress 이벤트 사용.
- refresh_token은 AES-256-GCM으로 암호화해 DB 저장.
- access_token은 Redis TTL expires_in-60s 캐싱.
- feature flag `YOUTUBE_UPLOAD_FEATURE_FLAG` 로 v1.1 전까지는 관리자만 접근.

## 운영자 대기 항목

- [ ] OAuth verification 승인 (4~6주, 4/14 신청)
- [ ] YouTube Data API 쿼터 상향 10K → 100K (4~8주)
- [ ] 승인 후 YOUTUBE_UPLOAD_FEATURE_FLAG=true 로 전환
- [ ] 실 사용자 테스트 후 한계 재확인

## 다음 Phase

Phase K (온보딩) — 신규 사용자 첫 영상 무료 플로우
```

- [ ] **Step 2: MEMORY.md 업데이트**

```markdown
- [4/XX 숏폼 Phase J 완료 (v1.1)](project_shortform_phase_j_complete.md) — YouTube OAuth + 브라우저 resumable 업로드
```

- [ ] **Step 3: 마스터 플랜 상태 마킹**

```markdown
**상태:** ✅ 코드 완료 (커밋 SHA: XXXXXXX) — OAuth verification 대기 (feature flag OFF)
```

- [ ] **Step 4: 최종 커밋**

```bash
git add docs/superpowers/plans/2026-04-14-shortform-master-plan.md
git commit -m "$(cat <<'EOF'
docs: Phase J 코드 완료 마킹 + 메모리 기록

코드 머지 완료. Google OAuth verification 승인까지 feature flag OFF.
승인 후 v1.1로 활성화 예정.
EOF
)"
```

---

## Phase J 자기 검토

### Spec coverage

| 스펙 섹션 | 커버 task |
|---|---|
| §18 OAuth 플로우 | J3, J4 |
| §18 업로드 플로우 | J5, J6, J8 |
| §18 API 엔드포인트 | J4, J5 |
| §18 데이터 모델 | J2 |
| §18 보안 (암호화) | J1, J2 |
| §18 쿼터 정책 | J0 |
| §18 Resumable 폴백 | J6, J10 |

### Deep Research 결론 반영

- [x] 서버 직접 업로드 포기 → 브라우저 resumable 업로드 (J5, J6)
- [x] videos.insert 1,600 units 인지 (J0 쿼터 신청)
- [x] OAuth verification 4~6주 대기 (J0 운영자 액션)
- [x] refresh_token 암호화 저장 (J1, J2)
- [x] Phase J는 v1.1로 유예되지만 코드는 같이 머지 (feature flag)

### 알려진 미완

- 완전한 재개(initialOffset) 리팩토링 — Phase L 검증 시 실제 필요하면 추가
- YouTube 업로드 실패 시 자동 재시도 없음 (사용자가 "다시 시도" 클릭해야 함)
- 업로드 후 분석(조회수 수신) 기능 없음 — v2 스펙에서 고려

### 회귀 안전성

- feature flag OFF 상태에서 /api/youtube-upload는 403 반환 → 기존 사용자 영향 0
- ShortformClient 의 버튼도 youtubeConnected=false 이면 표시 안 됨
- 마이페이지 YouTubeSection은 "연결 안 됨" 상태로만 표시 (연결 시도는 verification 전 test user만 성공)

### 통합 지점

- Phase I (SSE): upload-youtube step을 같은 버스에서 푸시
- Phase H (프로젝트 히스토리): 업로드 완료 시 project 레코드에 youtube_video_id 저장 (v1.1 추가)

---

## Phase J 완료 후 다음 단계

코드 관점에서는 완료. 운영자는 4~6주 동안 OAuth verification 진행 + 쿼터 상향 승인 대기. 그동안 Phase K, L 작업 진행. 승인 후 feature flag 전환 + 50MB 대용량 실 테스트 + 소규모 베타 오픈.
