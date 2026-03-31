# 발견 사항 & 공유 자료

## [2026-03-31] shortform-stt.js 502 에러 분석

### 결론: 핵심 원인 2가지 (확정 1 + 의심 1)

---

### 원인 1 (확정): Vercel Serverless의 request body size limit 미적용

**파일:** `/Users/gong-eunhui/Desktop/naver-title-generator/api/shortform-stt.js` (L4-7)
**파일:** `/Users/gong-eunhui/Desktop/naver-title-generator/vercel.json`

`shortform-stt.js`에서 `export const config`로 bodyParser sizeLimit을 15mb로 설정했지만, **vercel.json의 rewrites 배열에 shortform-stt 경로가 등록되어 있지 않다.**

```json
// vercel.json — shortform-stt, shortform-broll 라우트 누락
"rewrites": [
  { "source": "/api/blog-image", "destination": "/api/blog-image" },
  // ... 다른 API들 ...
  // /api/shortform-stt 없음!
  // /api/shortform-broll 없음!
]
```

Vercel의 기본 bodyParser limit은 **5MB**다. 21초 오디오 파일을 base64로 인코딩하면 원본 대비 약 1.33배 크기가 되고, JSON 래핑까지 포함하면 용량이 더 늘어난다. 파일 크기가 5MB를 넘으면 Vercel이 함수 실행 전에 요청을 거부하여 502가 발생할 수 있다.

**다만**, rewrites가 없어도 Vercel은 `/api/` 폴더 구조로 자동 라우팅하므로 함수 자체는 호출된다. `export const config`의 `api.bodyParser.sizeLimit`은 rewrites 유무와 관계없이 적용되어야 한다. 따라서 이것만으로는 502의 직접 원인이 아닐 수 있지만, rewrites 등록은 안전을 위해 추가해야 한다.

---

### 원인 2 (높은 확신): `new FormData()` + `new Blob()` Vercel Node.js 호환성 문제

**파일:** `/Users/gong-eunhui/Desktop/naver-title-generator/api/shortform-stt.js` (L67-69)

```js
const formData = new FormData();
formData.append('file', new Blob([buffer], { type: mimeType || 'audio/webm' }), filename);
```

**이것이 502의 핵심 원인일 가능성이 가장 높다.**

- `FormData`와 `Blob`은 Node.js 18.0+에서 실험적(experimental)으로 도입, **Node.js 20+에서 stable**
- Vercel Serverless Functions의 기본 Node.js 버전은 프로젝트 설정에 따라 다르며, `package.json`에 `engines` 필드가 없으므로 Vercel 기본값을 사용
- **핵심 문제**: Node.js의 `FormData.append()`에 `Blob`을 전달할 때, `fetch()`가 이를 올바른 `multipart/form-data`로 직렬화하지 못하는 알려진 버그가 존재 (Node.js 18.x 일부 버전)
- Whisper API가 잘못된 multipart body를 받으면 에러를 반환하고, 코드 L158에서 이를 502로 변환:

```js
return res.status(502).json({ error: '음성 전사 중 오류: ' + (error?.message || '알 수 없는 오류') });
```

---

### 원인 3 (낮은 가능성): `timestamp_granularities[]` FormData 키

**파일:** `/Users/gong-eunhui/Desktop/naver-title-generator/api/shortform-stt.js` (L72)

```js
formData.append('timestamp_granularities[]', 'word');
```

OpenAI API는 이 키 이름에 `[]`를 포함하는 것을 기대한다. Node.js `FormData`에서는 이것이 정상 동작하지만, 일부 환경에서 `[]`가 URL 인코딩되어 `timestamp_granularities%5B%5D`로 전달될 수 있다. 다만 이 경우 Whisper API가 해당 파라미터를 무시할 뿐 에러를 반환하지는 않으므로 502의 직접 원인은 아니다.

---

### 원인 4 (참고): OPENAI_API_KEY `\n` 문자

**파일:** `/Users/gong-eunhui/Desktop/naver-title-generator/api/shortform-stt.js` (L64)

```js
const apiKey = (process.env.OPENAI_API_KEY || '').replace(/\n/g, '').trim();
```

이 프로젝트에서 이전에 동일 이슈가 발생한 적 있지만, 코드에서 이미 `replace(/\n/g, '').trim()`으로 방어하고 있으므로 현재는 문제없다.

---

### 권장 수정 사항

#### 수정 1: `Blob` 대신 `Buffer`를 직접 사용 (핵심 수정)

```js
// 변경 전 (L67-69)
const formData = new FormData();
const filename = getFilename(mimeType);
formData.append('file', new Blob([buffer], { type: mimeType || 'audio/webm' }), filename);

// 변경 후 — undici의 File 또는 직접 fetch body 구성
import { File } from 'node:buffer';  // Node.js 20+

const formData = new FormData();
const filename = getFilename(mimeType);
const file = new File([buffer], filename, { type: mimeType || 'audio/webm' });
formData.append('file', file);
```

또는 더 안전한 방법으로 `node-fetch` + `form-data` 패키지를 사용:

```js
import FormData from 'form-data';

const formData = new FormData();
formData.append('file', buffer, {
  filename: getFilename(mimeType),
  contentType: mimeType || 'audio/webm',
});
formData.append('model', 'whisper-1');
// ...

const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${apiKey}`,
    ...formData.getHeaders(),
  },
  body: formData,
});
```

#### 수정 2: vercel.json에 라우트 추가

```json
{ "source": "/api/shortform-stt", "destination": "/api/shortform-stt" },
{ "source": "/api/shortform-broll", "destination": "/api/shortform-broll" }
```

#### 수정 3: 에러 로깅 강화

현재 L157에서 `error?.message`만 로깅하는데, Whisper API의 실제 응답 body를 함께 로깅하면 디버깅이 쉬워진다:

```js
if (!response.ok) {
  const message = data?.error?.message || 'Whisper transcription failed';
  console.error('[shortform-stt] Whisper API responded:', response.status, text.slice(0, 500));
  throw new Error(message);
}
```

---

### 프론트엔드 측 (정상)

**파일:** `/Users/gong-eunhui/Desktop/naver-title-generator/shortform.html` (L2034-2068)

- `blobToBase64()`: FileReader.readAsDataURL() → base64 추출 (정상)
- `buildSttPayload()`: `{ audioBase64, mimeType }` JSON 구성 (정상)
- fetch 호출: `Content-Type: application/json`, `JSON.stringify(sttBody)` (정상)
- 프론트엔드 측에는 문제 없음

---

## [2026-03-31] UI-API 인터페이스 전체 점검 (ui-reviewer)

### 인터페이스 일치 상태: 전반적 양호

1. **Script API 요청/응답**: UI→API body 일치 (불필요 필드 포함하나 동작에 무해). `points[]`→`point` 변환은 `join('\n\n')`으로 정상 (shortform.html:1621)
2. **STT API 요청**: `{ audioBase64, mimeType }` JSON 정상 전송. `blobToBase64()`는 순수 base64만 추출, `decodeAudioPayload()`가 양방 처리 가능
3. **B-roll API 요청**: `{ brollSuggestions[], scriptContext }` 정상 전송. brollSuggestions 흐름 완전 추적 완료 (Script응답 → state → B-roll API)
4. **에러 핸들링**: 401→authModal, 429→에러메시지, 500/502→catch 블록 모두 정상
5. **워크플로우 잠금**: Step 1→2→3→4 연쇄 잠금/해제 정상 동작
6. **음성 녹음 mimeType**: `pickRecordingMimeType()` → `state.audioMimeType` → `buildSttPayload()` 경로 정상

### [WARNING] 빈 scriptContext 엣지 케이스
- **위치**: shortform.html:2042-2049 vs api/shortform-broll.js:385-386
- 사용자가 대본 텍스트를 모두 수동 삭제 후 Step 3 자동 실행 시, `scriptContext`가 빈 문자열 → B-roll API가 400 에러 반환
- 권장: UI에서 scriptContext 빈 경우 B-roll 호출 스킵 또는 사전 경고

---

## [2026-03-31] 코드 분석가 1 (api-reviewer) — 보안/패턴/비용 추가 분석

### [CRITICAL] shortform-stt.js, shortform-broll.js 모두 rate limit 미구현
- `shortform-script.js`는 일일 1회 무료 제한 + 에러 롤백이 잘 구현됨
- `shortform-stt.js`와 `shortform-broll.js`에는 rate limit이 전혀 없음
- Whisper API, Grok Image, Seedance Video 등 외부 유료 API 호출 → 비용 폭증 위험
- `shortform-script.js`의 rate limit 패턴을 그대로 복제하여 적용 권장

### [WARNING] shortform-broll.js:418 logUsage에 await 누락
- `logUsage(email, 'shortform-broll', null, ip);` — await 없음
- Vercel Serverless에서 res 반환 후 비동기 작업 중단 → 로그 유실 가능
- `generate.js:190`도 동일 패턴이므로 프로젝트 전반의 문제

### [WARNING] KST 날짜 계산 방식 3가지 공존 (일관성 부재)
- `shortform-script.js:42-46`, `generate.js:28-30` — 수동 UTC+9 offset 방식
- `shortform-broll.js:15-26` — `Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Seoul'})` 방식
- `_helpers.js`에는 KST 유틸이 없음 → 공유 함수로 추출하여 통일 필요
- `getTTLUntilMidnightKST()`도 `shortform-script.js`와 `generate.js`에 중복 정의

### [WARNING] generate.js가 _helpers.js 패턴과 불일치 (레거시)
- `generate.js`는 `getRedis`, `extractToken`, `resolveSessionEmail`, `getClientIp` 등을 로컬에 재정의
- `shortform-script.js`는 `_helpers.js`에서 import하는 신규 표준 패턴을 따름
- `generate.js`도 `_helpers.js` import로 리팩토링해야 일관성 확보

### [INFO] shortform-stt.js:141 에러 응답에 내부 정보 노출
- `'audioBase64가 필요합니다. (body keys: ' + Object.keys(body || {}).join(',') + ')'`
- 프로덕션에서 body key 목록이 클라이언트에 노출됨 → 제거 필요

### [INFO] shortform-stt.js 디버그 console.log 3곳 프로덕션 잔류
- L75, L125, L138에서 요청 정보를 console.log로 출력
- 디버깅 완료 후 제거 또는 console.debug 전환 필요

### [INFO] Seedance 폴링 타임아웃 30초 vs maxDuration 180초 불균형
- `shortform-broll.js:12` — SEEDANCE_TIMEOUT_MS = 30000
- 영상 생성은 보통 30초 이상 소요 → 거의 항상 Grok 이미지 fallback 예상
- 의도적 설계인지 확인 필요; 아니라면 60~120초로 조정 권장

---

## [2026-03-31] Script API + B-roll API 독립 검증 (8항목 체크리스트)

### 검증 항목별 결과

| # | 항목 | 결과 | 상세 |
|---|------|------|------|
| 1 | Script API: Claude 호출 | PASS | endpoint `api.anthropic.com/v1/messages`, model `claude-sonnet-4-20250514`, temp 0.7, `x-api-key`+`anthropic-version` 헤더 모두 정확 |
| 2 | Script API: JSON 파싱 | PASS | 3단계 파서(직접파싱 -> 코드블록 -> balanced bracket). escape/depth 추적 올바름. `buildScriptPayload`에서 스키마 유효성 검증 포함 |
| 3 | Script API: Rate Limit | PASS | incr->초과시 decr 패턴 + catch 블록 `rateLimitIncremented` 플래그 롤백. 견고함 |
| 4 | B-roll API: Grok Imagine | PASS | endpoint `api.x.ai/v1/images/generations`, model `grok-2-image`, size `1024x1792`(9:16). fetchWithTimeout 45초 적용 |
| 5 | B-roll API: Seedance 폴백 | PASS | try/catch 구조. 폴링(4초간격/30초타임아웃) + 3개 상태 엔드포인트 순차 시도. 실패시 Grok 이미지 대체 |
| 6 | B-roll API: R2 업로드 | PASS | 키=`shortform-broll/{userId}/{KST날짜}/{UUID}-{suffix}`. Content-Type 검증. b64_json/URL/dataURI 3경로 처리 |
| 7 | B-roll API: Promise.all | PASS | 개별 `.catch(()->null)` + `filter(Boolean)`. 전부 실패시 502, 부분 성공 허용 |
| 8 | Import 정합성 | PASS | Script 6개, B-roll 7개 import 전부 export와 일치 확인 |

### 기존 팀 분석과의 교차 검증

위 api-reviewer(코드 분석가 1)의 발견 사항을 독립 검증한 결과 모두 정확함을 확인:

- **B-roll rate limit 부재**: 확인됨. Script API는 `FREE_DAILY_LIMIT=1` 적용, B-roll/STT는 로그인 체크만 수행. 프론트엔드에서 B-roll 단독 호출 시 Grok/Seedance API 비용 무제한 발생 가능.
- **logUsage await 누락** (B-roll L418): 확인됨. `logUsage(email, ...)` vs Script의 `await logUsage(email, ...)`. Vercel 함수 종료 후 로그 유실 위험.
- **Seedance 30초 타임아웃**: 확인됨. 영상 생성에 30초는 짧아 대부분 Grok 이미지 폴백으로 빠질 가능성 높음.
- **KST 날짜 계산 불일치**: 확인됨. Script는 수동 UTC+9, B-roll은 `Intl.DateTimeFormat`. 기능 버그는 아니나 `_helpers.js`에 공유 함수 추출 권장.

### 추가 발견 (기존 분석에 없는 항목)

1. **`normalizeBrollSuggestions` 방어 로직 (Script L141-155)**: brollSuggestions가 3개 미만이면 fallback 문구(`person speaking to camera` 등)로 채움. B-roll API가 정확히 3개를 요구(L383)하므로 필수적인 방어. 올바름.

2. **`estimatedSeconds` 계산 (Script L171)**: 공백 제거 후 글자수/5로 초 추정. 한국어 기준 초당 ~5글자는 합리적 추정치.

3. **B-roll `getSafeUserId` (L28-30)**: 이메일의 `@`, `.` 등을 `_`로 치환하여 R2 키에 안전한 문자열 생성. S3 키 제약을 올바르게 처리.

---

# DEAD_ENDS (시도했으나 실패한 접근)

(실패한 접근은 여기에 기록)
