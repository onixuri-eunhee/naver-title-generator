# 뚝딱도구 숏폼 영상 파이프라인 — 코드 재사용 리뷰

작성일: 2026-04-05
범위: `services/shortform-broll-core.js`, `services/shortform-stt-service/server.js`, `remotion/shortform/ShortformComposition.jsx`

---

## 1. Imagen 3 호출 함수: 중복 리스크 | 심각도: 중요

### 현재 상황
- `api/blog-image-pro.js`: `callVertexImagen3()` (라인 216)
- `services/shortform-broll-core.js`: `callImagen3Image()` (라인 386)

### 코드 비교

#### blog-image-pro.js (기존)
```javascript
async function callVertexImagen3(prompt) {
  const token = await _getVertexToken();
  const projectId = process.env.GOOGLE_VERTEX_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || 'ddukddaktool';
  const location = process.env.GOOGLE_VERTEX_LOCATION || 'us-central1';
  const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/imagen-3.0-generate-002:predict`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instances: [{ prompt }],
        parameters: { sampleCount: 1, aspectRatio: '1:1', outputOptions: { mimeType: 'image/png' } },
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const data = await res.json();
    if (!res.ok) throw new Error(`Imagen 3 error: ${res.status}`);
    const b64 = data.predictions?.[0]?.bytesBase64Encoded;
    if (!b64) throw new Error('Imagen 3: no image in response');
    return `data:image/png;base64,${b64}`;  // ← data URL 반환
  } catch (err) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') throw new Error('Vertex AI Imagen 30s timeout');
    throw err;
  }
}
```

#### shortform-broll-core.js (신규)
```javascript
async function callImagen3Image(prompt, key) {
  const token = await getGoogleAccessToken();
  const projectId = getVeoProjectId();
  const location = (process.env.GOOGLE_VERTEX_LOCATION || 'us-central1').trim();
  const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/imagen-3.0-generate-002:predict`;

  const response = await fetchWithTimeout(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      instances: [{ prompt }],
      parameters: { sampleCount: 1, aspectRatio: '9:16', outputOptions: { mimeType: 'image/png' } },
    }),
  }, 30000);
  const data = await parseJsonResponse(response);
  if (!response.ok) throw new Error(`Imagen 3 failed: ${response.status}`);

  const b64 = data?.predictions?.[0]?.bytesBase64Encoded;
  if (!b64) throw new Error('Imagen 3: no image in response');

  const imageBuffer = Buffer.from(b64, 'base64');
  const r2Url = await uploadToR2(key, imageBuffer, 'image/png');
  if (!r2Url) throw new Error('R2 image upload failed');
  console.log('[SHORTFORM-BROLL] Imagen 3 hero image uploaded:', r2Url);
  return { type: 'image', url: r2Url, r2Url, prompt, provider: 'imagen-3' };  // ← R2 URL + 메타데이터 반환
}
```

### 발견된 중복
1. **Imagen 3 API 호출 로직**: 동일한 엔드포인트, 요청 포맷, 토큰 관리
2. **에러 처리**: 동일한 패턴 (응답 검증, base64 디코딩)
3. **토큰 관리**: 두 파일 모두 Google Vertex JWT 토큰 생성 로직 (별도 분석 아래)

### 차이점 분석
| 항목 | blog-image-pro | shortform-broll-core |
|-----|-------|---------|
| **반환값** | data URL 문자열 | 객체 (R2 URL + 메타) |
| **aspectRatio** | 1:1 (정사각형) | 9:16 (세로형) |
| **타임아웃** | AbortController | fetchWithTimeout() 유틸리티 |
| **저장소** | 클라이언트 측 (data URL) | R2 (영구 저장) |

### 권장사항

**중요**: `callImagen3Image()`는 이미 비즈니스 요구에 맞게 최적화됨 (R2 저장, 9:16 비율). 기존 `callVertexImagen3()`을 대체하기보다는 **공유 설정 상수** 추출 권장:

```javascript
// api/_imagen3-config.js (신규)
export const IMAGEN3_ENDPOINT = 'https://aiplatform.googleapis.com/v1/projects/{projectId}/locations/{location}/publishers/google/models/imagen-3.0-generate-002:predict';
export const IMAGEN3_TIMEOUT_MS = 30000;

// 또는 두 함수가 독립적으로 필요하면 현상 유지, 다음 리팩토링 에포크에서 처리
```

---

## 2. Google Vertex Token 생성: 중복 구현 | 심각도: 중요

### 현재 상황

#### blog-image-pro.js
- `_parseServiceAccount()` (라인 183)
- `_base64url()` (라인 188)
- `_getVertexToken()` (라인 193) — 토큰 캐시 포함

#### shortform-broll-core.js
- `parseJsonEnv()` (라인 142) — 일반 버전
- `parseBase64JsonEnv()` (라인 151) — Base64 디코딩 버전
- `getGoogleServiceAccount()` (라인 160) — 4가지 env var 지원
- `base64UrlEncode()` (라인 134)
- `getGoogleAccessToken()` (라인 191) — 토큰 캐시 포함

### 코드 비교

#### blog-image-pro.js (간단, 단일 환경변수)
```javascript
function _parseServiceAccount() {
  const raw = process.env.GOOGLE_VERTEX_SERVICE_ACCOUNT_JSON || process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '';
  try { 
    const p = JSON.parse(raw); 
    return p?.client_email && p?.private_key ? p : null; 
  } catch { 
    return null; 
  }
}

function _base64url(input) {
  const b = typeof input === 'string' ? Buffer.from(input) : input;
  return b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
```

#### shortform-broll-core.js (복잡, 4가지 환경변수 지원)
```javascript
function getGoogleServiceAccount() {
  const parsed = parseJsonEnv(process.env.GOOGLE_VERTEX_SERVICE_ACCOUNT_JSON)
    || parseJsonEnv(process.env.GOOGLE_SERVICE_ACCOUNT_JSON)
    || parseBase64JsonEnv(process.env.GOOGLE_VERTEX_SERVICE_ACCOUNT_JSON_BASE64)
    || parseBase64JsonEnv(process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64);
  // 더 견고한 폴백
}

function base64UrlEncode(value) {
  return Buffer.from(value)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}
```

### 호환성 평가

✅ **함수 시그니처 동일**: 둘 다 같은 토큰/캐시 메커니즘
✅ **토큰 캐시 전략 동일**: `expiresAt` 기반, 60초 버퍼
❌ **환경변수 지원 불균일**: shortform-broll-core.js가 4가지 지원, blog-image-pro.js는 2가지만 지원
❌ **코드 위치 분산**: 2곳에 복제된 JWT 생성 로직

### 문제점

1. **JWT 서명 로직 중복**: 두 곳 모두 RSA-SHA256 JWT 생성
   - blog-image-pro.js: `crypto.createSign('RSA-SHA256')`
   - shortform-broll-core.js: `createSign('RSA-SHA256')`
2. **환경변수 일관성 부족**: blog-image-pro는 Base64 버전 미지원
3. **유지보수 리스크**: 토큰 갱신 로직 수정 시 2곳 동시 변경 필요

### 권장사항 | 우선순위: 높음

**방안 A: 공유 모듈 추출 (권장)**

```javascript
// api/_google-vertex.js (신규 공유 유틸)
import { createSign } from 'node:crypto';

const GOOGLE_OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_CLOUD_PLATFORM_SCOPE = 'https://www.googleapis.com/auth/cloud-platform';

let tokenCache = { token: null, expiresAt: 0 };

function parseJsonEnv(value) {
  if (!value || typeof value !== 'string') return null;
  try {
    return JSON.parse(value);
  } catch (_) {
    return null;
  }
}

function parseBase64JsonEnv(value) {
  if (!value || typeof value !== 'string') return null;
  try {
    return JSON.parse(Buffer.from(value, 'base64').toString('utf8'));
  } catch (_) {
    return null;
  }
}

export function getGoogleServiceAccount() {
  return parseJsonEnv(process.env.GOOGLE_VERTEX_SERVICE_ACCOUNT_JSON)
    || parseJsonEnv(process.env.GOOGLE_SERVICE_ACCOUNT_JSON)
    || parseBase64JsonEnv(process.env.GOOGLE_VERTEX_SERVICE_ACCOUNT_JSON_BASE64)
    || parseBase64JsonEnv(process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64);
}

function base64UrlEncode(value) {
  return Buffer.from(value)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

export async function getGoogleAccessToken() {
  const serviceAccount = getGoogleServiceAccount();
  if (!serviceAccount?.client_email || !serviceAccount?.private_key) {
    throw new Error('Google Vertex credentials are missing');
  }

  const now = Math.floor(Date.now() / 1000);
  if (tokenCache.token && tokenCache.expiresAt - 60 > now) {
    return tokenCache.token;
  }

  const header = { alg: 'RS256', typ: 'JWT' };
  const claimSet = {
    iss: serviceAccount.client_email,
    scope: GOOGLE_CLOUD_PLATFORM_SCOPE,
    aud: GOOGLE_OAUTH_TOKEN_URL,
    exp: now + 3600,
    iat: now,
  };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedClaimSet = base64UrlEncode(JSON.stringify(claimSet));
  const unsignedJwt = `${encodedHeader}.${encodedClaimSet}`;
  const signature = createSign('RSA-SHA256').update(unsignedJwt).end().sign(
    serviceAccount.private_key.replace(/\\n/g, '\n')
  );
  const assertion = `${unsignedJwt}.${base64UrlEncode(signature)}`;

  const response = await fetch(GOOGLE_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }).toString(),
  });
  const data = await response.json();
  if (!response.ok || !data?.access_token) {
    throw new Error(`Google access token failed: ${response.status} ${JSON.stringify(data)}`);
  }

  tokenCache = {
    token: data.access_token,
    expiresAt: now + Number(data.expires_in || 3600),
  };
  return data.access_token;
}
```

그 다음 두 파일에서:
- `api/blog-image-pro.js`: `_getVertexToken()`, `_parseServiceAccount()`, `_base64url()` 삭제
- `services/shortform-broll-core.js`: `getGoogleAccessToken()`, `getGoogleServiceAccount()` 삭제 + import 추가

```javascript
// blog-image-pro.js 및 shortform-broll-core.js
import { getGoogleAccessToken } from './_google-vertex.js';
```

**방안 B: 현상 유지 + 주석 추가 (즉시 대응 불가 시)**

만약 긴급한 리팩토링이 불가능하면, 두 파일 모두에 다음 주석 추가:

```javascript
// NOTE: 토큰 갱신 로직은 api/_google-vertex.js와 동일 (코드 리뷰 2026-04-05)
// 향후 공유 모듈로 추출 권장. Vercel 배포 후 해당 주소로 갱신할 것.
```

---

## 3. 오디오 변환 함수: 단일 구현 | 심각도: 낮음

### 현재 상황
- `services/shortform-stt-service/server.js`: `convertToWav()` (라인 151)
- 다른 파일에서 유사 함수 없음 ✅

### 구현 분석

```javascript
async function convertToWav(inputBuffer, inputMimeType) {
  const needsConvert = /webm|ogg|opus/i.test(inputMimeType || '');
  if (!needsConvert) return { buffer: inputBuffer, mimeType: inputMimeType, fileName: 'audio.wav' };

  const { execFile } = await import('child_process');
  const { promisify } = await import('util');
  const execFileAsync = promisify(execFile);
  const inputPath = path.join('/tmp', `audio-in-${randomUUID()}.webm`);
  const outputPath = path.join('/tmp', `audio-out-${randomUUID()}.wav`);

  try {
    await fs.writeFile(inputPath, inputBuffer);
    await execFileAsync('ffmpeg', ['-y', '-i', inputPath, '-ar', '44100', '-ac', '1', outputPath], { timeout: 30000 });
    const wavBuffer = await fs.readFile(outputPath);
    console.log('[AUDIO] Converted WebM→WAV:', inputBuffer.length, '→', wavBuffer.length, 'bytes');
    return { buffer: wavBuffer, mimeType: 'audio/wav', fileName: 'audio.wav' };
  } finally {
    try { await fs.unlink(inputPath); } catch (_) {}
    try { await fs.unlink(outputPath); } catch (_) {}
  }
}
```

### 평가

✅ **재사용 불필요**: 오디오 변환은 숏폼 STT 서비스에만 특화
✅ **중복 없음**: 다른 파일에서 유사 기능 불발견
✅ **에러 처리**: 파일 정리(cleanup) 완벽 구현
✅ **로깅**: 변환 크기 추적 포함

### 미흡한 점 | 심각도: 낮음-중간

1. **ffmpeg 바이너리 존재 여부 미확인**
   ```javascript
   // 개선 제안
   try {
     await execFileAsync('ffmpeg', ['--version'], { timeout: 5000 });
   } catch (err) {
     throw new Error('ffmpeg not found in PATH. Required for audio conversion.');
   }
   ```

2. **/tmp 권한/용량 미보장**
   - Vercel Serverless 환경에서 `/tmp`는 512MB 제한
   - 대용량 오디오 변환 시 에러 가능
   - 권장: 사전 유효성 검사
   ```javascript
   if (inputBuffer.length > 100 * 1024 * 1024) {
     throw new Error('Audio file too large (>100MB)');
   }
   ```

3. **MIME type 폴백 불완전**
   ```javascript
   // 현재: 'audio/wav' 고정
   // 개선: 입력 MIME type 보존 고려
   return { buffer: wavBuffer, mimeType: inputMimeType || 'audio/wav', fileName: 'audio.wav' };
   ```

---

## 4. Ken Burns 프리셋 해시: 단일 구현 | 심각도: 제안

### 현재 상황
- `remotion/shortform/ShortformComposition.jsx`: `getKenBurnsPreset()` (라인 110)
- 다른 파일에서 유사 함수 없음 ✅

### 구현 분석

```javascript
const KEN_BURNS_PRESETS = [
  {scaleFrom: 1.0, scaleTo: 1.12, xFrom: 0, xTo: -15, yFrom: 0, yTo: -10},
  {scaleFrom: 1.12, scaleTo: 1.0, xFrom: -10, xTo: 10, yFrom: -8, yTo: 8},
  {scaleFrom: 1.0, scaleTo: 1.10, xFrom: 10, xTo: -5, yFrom: 5, yTo: -5},
  {scaleFrom: 1.08, scaleTo: 1.0, xFrom: 0, xTo: 12, yFrom: -10, yTo: 0},
  {scaleFrom: 1.0, scaleTo: 1.14, xFrom: -8, xTo: 0, yFrom: 8, yTo: -8},
];

function getKenBurnsPreset(url) {
  let hash = 0;
  for (let i = 0; i < (url || '').length; i++) {
    hash = ((hash << 5) - hash + (url || '').charCodeAt(i)) | 0;
  }
  return KEN_BURNS_PRESETS[Math.abs(hash) % KEN_BURNS_PRESETS.length];
}
```

### 평가

✅ **재사용 불필요**: Ken Burns는 Remotion 비디오 렌더링에만 특화
✅ **구현 정상**: DJB2 해시(비암호화, 경량) 적절
✅ **중복 없음**: 유사 함수 불발견

### 최적화 제안 | 심각도: 낮음

1. **URL 변경 시 애니메이션 일관성**
   - 현재: 동일 URL은 항상 동일 preset 반환 ✅
   - 개선 가능: CDN URL 매개변수 무시하여 안정성 증대
   ```javascript
   function getKenBurnsPreset(url) {
     // CDN 버전/캐시 파라미터 제거
     const cleanUrl = (url || '').split('?')[0];
     let hash = 0;
     for (let i = 0; i < cleanUrl.length; i++) {
       hash = ((hash << 5) - hash + cleanUrl.charCodeAt(i)) | 0;
     }
     return KEN_BURNS_PRESETS[Math.abs(hash) % KEN_BURNS_PRESETS.length];
   }
   ```

2. **캐싱 고려** (선택)
   ```javascript
   const presetsCache = new Map();

   function getKenBurnsPreset(url) {
     if (presetsCache.has(url)) {
       return presetsCache.get(url);
     }
     let hash = 0;
     for (let i = 0; i < (url || '').length; i++) {
       hash = ((hash << 5) - hash + (url || '').charCodeAt(i)) | 0;
     }
     const preset = KEN_BURNS_PRESETS[Math.abs(hash) % KEN_BURNS_PRESETS.length];
     presetsCache.set(url, preset);
     return preset;
   }
   ```

---

## 5. 인라인된 R2/DB 로직: 설계 문제 | 심각도: 중요

### 발견된 문제

`shortform-broll-core.js` 라인 1-54에서 다음 기능을 **인라인으로 중복 구현**:

1. **R2 업로드** (라인 3-40)
   - 기존: `api/_r2.js`에 `uploadToR2()`, `uploadImageUrlToR2()` 존재
   - 문제: 서비스 모듈에서 또 구현 (인라인)
   - 영향: 유지보수 난제, 정책 변경 시 2곳 수정

2. **DB 로깅** (라인 42-54)
   - 기존: `api/_db.js`에 `logUsage()` 존재
   - 문제: 서비스 모듈에서 또 구현 (인라인)
   - 영향: 데이터베이스 정책 변경 시 동기화 복잡

### 해결 방법

#### 현재 상황 (shortform-broll-core.js)
```javascript
/* ── R2 upload (inlined from api/_r2.js) ── */
async function uploadToR2(key, body, contentType = 'image/png') { ... }
async function uploadImageUrlToR2(imageUrl, key) { ... }

/* ── DB usage log (inlined from api/_db.js) ── */
async function logUsage(userEmail, tool, mode, ip) { ... }
```

#### 권장: 리팩토링 후

```javascript
// services/shortform-broll-core.js (수정)
import { uploadToR2, uploadImageUrlToR2 } from '../api/_r2.js';
import { logUsage } from '../api/_db.js';

// 인라인 구현 제거
```

**주의**: 만약 Node.js ESM import 경로 문제가 발생하면, 다음 대안 고려:

```javascript
// services/_shared.js (신규)
export async function uploadToR2(key, body, contentType = 'image/png') { ... }
export async function logUsage(userEmail, tool, mode, ip) { ... }

// 그 다음:
// api/blog-image-pro.js, services/shortform-broll-core.js 모두 import
import { uploadToR2, logUsage } from '../services/_shared.js';
```

---

## 요약 및 우선순위

| 항목 | 파일 | 문제 | 심각도 | 권장 조치 |
|-----|-----|------|--------|---------|
| **Imagen 3** | blog-image-pro.js<br/>shortform-broll-core.js | 비슷한 API 호출, 비율/저장소만 다름 | 중요 | 공유 유틸/상수 검토 (즉시 리팩토링 불가 시 주석 추가) |
| **Google Vertex Token** | blog-image-pro.js<br/>shortform-broll-core.js | 완전 중복 JWT 생성 로직 | **높음** | `api/_google-vertex.js` 추출 권장 (다음 에포크) |
| **오디오 변환** | shortform-stt-service/server.js | 단일 구현, 간소 개선 권장 | 낮음-중간 | ffmpeg 체크, 파일 크기 검증 추가 |
| **Ken Burns 해시** | ShortformComposition.jsx | 단일 구현, 정상 | 낮음 | URL 정규화 고려 (선택) |
| **R2/DB 인라인** | shortform-broll-core.js | 기존 모듈과 중복 구현 | **높음** | `api/_r2.js`, `api/_db.js` import로 전환 |

---

## 수정 체크리스트 (다음 스프린트)

- [ ] `api/_google-vertex.js` 생성 후 두 파일에서 import로 전환
- [ ] `shortform-broll-core.js`에서 R2/DB 인라인 코드 제거, import 추가
- [ ] `convertToWav()`: ffmpeg 존재 확인, 파일 크기 검증 추가
- [ ] `getKenBurnsPreset()`: URL 정규화 고려 (선택)
- [ ] 각 수정 후 로컬 테스트 + 유닛 테스트 추가

---

**작성자**: Claude (Code Review Agent)  
**권장 리뷰어**: 뚝딱도구 백엔드 담당자
