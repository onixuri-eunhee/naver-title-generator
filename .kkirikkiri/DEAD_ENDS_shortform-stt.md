# STT 502 에러 — 시도했으나 실패한 접근들

> 2026-03-31 세션에서 시도한 모든 방법 기록

## 현재 상태
- `api/shortform-stt.js`에서 Whisper API 호출 시 Vercel 함수가 크래시 → 502
- 함수 자체는 로드됨 (401 응답 정상 반환)
- Whisper 호출 단계에서 Vercel이 함수를 강제 종료 (우리 try-catch에 안 걸림)
- 에러 로그가 Vercel CLI에 안 나옴

## 시도 1: `new Blob()` + `FormData` (최초 Codex 구현)
```js
const formData = new FormData();
formData.append('file', new Blob([buffer], { type: mimeType }), filename);
```
- **결과**: 502
- **원인 추정**: Node.js 18의 FormData가 Blob을 multipart로 직렬화할 때 호환성 문제

## 시도 2: `new File()` + `FormData` (Node 20+ API)
```js
const file = new File([buffer], filename, { type: resolvedType });
const formData = new FormData();
formData.append('file', file);
```
- **결과**: 502
- **원인 추정**: Vercel이 Node 18 사용 → `File` 전역 API 없을 수 있음 → ReferenceError 크래시

## 시도 3: 수동 multipart boundary 구성
```js
function buildMultipartBody(buffer, filename, mimeType, fields) {
  const boundary = '----FormBoundary' + Math.random().toString(36).slice(2);
  // 수동으로 --boundary\r\n + Content-Disposition + buffer + 필드들 조립
  return { body: Buffer.concat(buffers), contentType: `multipart/form-data; boundary=${boundary}` };
}
```
- **결과**: 502
- **원인 추정**: 함수가 Whisper 호출 전에 크래시하거나, multipart 포맷이 미묘하게 잘못됨

## 공통 관찰
- Vercel CLI 로그에 `🚫 POST --- /api/shortform-stt` — 함수가 응답 없이 종료
- curl로 인증 없이 호출하면 401 정상 반환 → 모듈 로드/핸들러 진입은 정상
- 인증 통과 후 오디오 처리 단계에서 크래시
- console.error 출력이 Vercel 로그에 안 나옴

## 미시도 방법들 (다음 세션에서 시도할 것)

### 방법 A: `openai` 공식 SDK 사용 (추천)
```bash
npm install openai
```
```js
import OpenAI from 'openai';
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const response = await openai.audio.transcriptions.create({
  file: /* ... */,
  model: 'whisper-1',
  response_format: 'verbose_json',
  timestamp_granularities: ['word'],
  language: 'ko',
});
```
- 장점: multipart 직렬화를 SDK가 처리, Node 18 호환 보장
- 주의: `file` 파라미터에 Buffer를 어떻게 전달하는지 SDK 문서 확인 필요
- SDK 문서: `openai.audio.transcriptions.create({ file: fs.createReadStream() })` 또는 `toFile(buffer, filename)`

### 방법 B: Vercel Node.js 버전을 20으로 업그레이드
package.json에 추가:
```json
{ "engines": { "node": "20.x" } }
```
- Node 20에서는 `FormData`, `Blob`, `File` 모두 stable
- 가장 간단하지만 다른 API에 영향 줄 수 있음

### 방법 C: `form-data` npm 패키지 사용
```bash
npm install form-data
```
```js
import FormData from 'form-data';
const form = new FormData();
form.append('file', buffer, { filename, contentType: mimeType });
// form.getHeaders()로 Content-Type+boundary 자동 생성
```
- Node.js에서 가장 오래되고 검증된 multipart 라이브러리

### 방법 D: bodyParser 비활성화 + raw body 직접 처리
```js
export const config = { api: { bodyParser: false } };
// req를 직접 읽어 Buffer로
```
- base64 JSON 대신 프론트에서 음성 파일을 raw binary로 전송
- Vercel의 bodyParser 관련 문제를 완전히 우회

### 방법 E: 단계별 디버깅 엔드포인트
각 단계에서 즉시 응답 반환하여 크래시 지점 정확히 특정:
```js
// Step 1: body 파싱만
// Step 2: base64 디코딩만
// Step 3: multipart 빌드만 (Whisper 호출 안 함)
// Step 4: Whisper 호출
```

## 환경 정보
- Vercel Pro 플랜 ($20/월)
- Node.js 버전: package.json에 engines 미지정 → Vercel 기본값 (18.x 추정)
- OPENAI_API_KEY: Vercel 환경변수에 등록됨 (다른 API에서 사용 중)
- 프로젝트 기술 스택: 바닐라 HTML + Vercel Serverless Functions (ESM)
- maxDuration: 120초 설정
- bodyParser sizeLimit: 15mb 설정 (적용 여부 불확실)

## 현재 shortform-stt.js 코드 위치
- `/Users/gong-eunhui/Desktop/naver-title-generator/api/shortform-stt.js`
- 수동 multipart 방식 (시도 3)이 현재 배포 상태

## 관련 파일
- `shortform.html` — UI (base64 JSON으로 STT API 호출)
- `api/shortform-script.js` — 대본 생성 (정상 동작)
- `api/shortform-broll.js` — B-roll 생성 (STT와 동시 호출, 별도 테스트 필요)
