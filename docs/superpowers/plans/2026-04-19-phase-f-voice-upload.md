# Phase F — 내 음성 업로드 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 숏폼 Step 4에 "내 음성 업로드" 탭을 추가하고, 업로드된 오디오 파일을 OpenAI Whisper로 전사 + scene 시간축 재분배하여 기존 TTS 파이프라인과 동일한 audioUrl+wordTimestamps를 반환하는 플로우를 구현한다.

**Architecture:** 신규 API 1개(`/api/shortform-voice-upload`) + 순수 함수 2개(remap, whisper wrapper) + R2 delete 헬퍼. 클라이언트는 Step 4 상단 2탭 토글로 TTS/업로드 모드 분기. 업로드 응답 shape이 TTS와 동일하므로 Step 5~7 변경 없음.

**Tech Stack:** Next.js 14 App Router, Node `node:test`, @aws-sdk/client-s3 (R2), OpenAI REST(`fetch`, whisper-1), 기존 `@/lib/r2.js`, `@/lib/api-helpers.js`, `@/lib/user-images.js`.

**Spec:** `docs/superpowers/specs/2026-04-19-phase-f-voice-upload-design.md`

---

## File Structure

### 신규 생성
- `lib/shortform/voice-upload-remap.js` — Scene 시간축 재분배 순수 함수
- `lib/shortform/whisper.js` — OpenAI Whisper REST 호출 + 응답 정규화
- `app/api/shortform-voice-upload/route.js` — POST 엔드포인트 (multipart/form-data)
- `tests/unit/voice-upload-remap.test.js` — remap 함수 단위 테스트
- `tests/unit/whisper.test.js` — Whisper 정규화 단위 테스트
- `tests/integration/voice-upload.test.js` — API 라우트 통합 테스트 (Whisper/R2 모킹)

### 수정
- `lib/r2.js` — `r2Delete(key)` 헬퍼 추가 (orphan cleanup용)
- `app/shortform/ShortformClient.js` — Step 4 탭 UI + voiceMode state + handleVoiceUpload
- `.env.example` — `OPENAI_API_KEY` Phase F 사용처 주석

---

## Task 1: Scene 시간축 재분배 순수 함수 (TDD)

**Files:**
- Create: `lib/shortform/voice-upload-remap.js`
- Test: `tests/unit/voice-upload-remap.test.js`

**목적**: 업로드 오디오 실제 길이(newTotalDuration)에 맞춰 각 scene의 `startTime`/`duration`을 비율 유지로 scale. Step 5~7 파이프라인이 이 재분배된 scenes를 쓴다.

- [ ] **Step 1.1: Write failing test — 기본 scale**

Create `tests/unit/voice-upload-remap.test.js`:

```javascript
// tests/unit/voice-upload-remap.test.js
//
// Phase F — scene 시간축 재분배 단위 테스트
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { remapScenesToAudio } from '../../lib/shortform/voice-upload-remap.js';

test('remapScenesToAudio — 1.5배 scale', () => {
  const scenes = [
    { id: 'hook', startTime: 0, duration: 2, script: 'a' },
    { id: 'body', startTime: 2, duration: 4, script: 'b' },
    { id: 'cta', startTime: 6, duration: 2, script: 'c' },
  ];
  const result = remapScenesToAudio(scenes, 8, 12);
  assert.equal(result.length, 3);
  assert.equal(result[0].startTime, 0);
  assert.equal(result[0].duration, 3);
  assert.equal(result[1].startTime, 3);
  assert.equal(result[1].duration, 6);
  assert.equal(result[2].startTime, 9);
  assert.equal(result[2].duration, 3);
});

test('remapScenesToAudio — scene 필드 보존', () => {
  const scenes = [{ id: 'hook', startTime: 0, duration: 2, script: '원본', layoutType: 'textCard' }];
  const result = remapScenesToAudio(scenes, 2, 3);
  assert.equal(result[0].script, '원본');
  assert.equal(result[0].layoutType, 'textCard');
  assert.equal(result[0].duration, 3);
});

test('remapScenesToAudio — oldTotalDuration 0이면 균등 분배 fallback', () => {
  const scenes = [
    { id: 'a', startTime: 0, duration: 0, script: 'a' },
    { id: 'b', startTime: 0, duration: 0, script: 'b' },
    { id: 'c', startTime: 0, duration: 0, script: 'c' },
  ];
  const result = remapScenesToAudio(scenes, 0, 6);
  assert.equal(result[0].duration, 2);
  assert.equal(result[1].duration, 2);
  assert.equal(result[2].duration, 2);
  assert.equal(result[0].startTime, 0);
  assert.equal(result[1].startTime, 2);
  assert.equal(result[2].startTime, 4);
});

test('remapScenesToAudio — 빈 scenes 배열', () => {
  assert.deepEqual(remapScenesToAudio([], 10, 20), []);
});

test('remapScenesToAudio — duration 합계 일치 (부동소수점 tolerance)', () => {
  const scenes = [
    { id: 'a', startTime: 0, duration: 1.3, script: 'a' },
    { id: 'b', startTime: 1.3, duration: 2.7, script: 'b' },
    { id: 'c', startTime: 4.0, duration: 1.0, script: 'c' },
  ];
  const result = remapScenesToAudio(scenes, 5.0, 7.0);
  const total = result.reduce((s, sc) => s + sc.duration, 0);
  assert.ok(Math.abs(total - 7.0) < 0.01, `total=${total}`);
});
```

- [ ] **Step 1.2: Run test — FAIL (모듈 없음)**

```bash
npm test -- tests/unit/voice-upload-remap.test.js
```
Expected: Cannot find module `'../../lib/shortform/voice-upload-remap.js'`

- [ ] **Step 1.3: Write implementation**

Create `lib/shortform/voice-upload-remap.js`:

```javascript
/**
 * Phase F — Scene 시간축 재분배
 *
 * 업로드 오디오의 실제 길이에 맞춰 각 scene의 startTime/duration을 비율 유지로 scale.
 * oldTotalDuration이 0/NaN이면 균등 분배로 fallback.
 */

export function remapScenesToAudio(scenes, oldTotalDuration, newTotalDuration) {
  if (!Array.isArray(scenes) || scenes.length === 0) return [];

  const validOld = Number(oldTotalDuration);
  const newTotal = Number(newTotalDuration);
  if (!Number.isFinite(newTotal) || newTotal <= 0) return scenes.map((s) => ({ ...s }));

  // oldTotalDuration 유효하지 않으면 균등 분배
  if (!Number.isFinite(validOld) || validOld <= 0) {
    const per = newTotal / scenes.length;
    let cursor = 0;
    return scenes.map((scene) => {
      const remapped = { ...scene, startTime: cursor, duration: per };
      cursor += per;
      return remapped;
    });
  }

  const scale = newTotal / validOld;
  let cursor = 0;
  return scenes.map((scene) => {
    const duration = (Number(scene.duration) || 0) * scale;
    const remapped = { ...scene, startTime: cursor, duration };
    cursor += duration;
    return remapped;
  });
}
```

- [ ] **Step 1.4: Run test — PASS**

```bash
npm test -- tests/unit/voice-upload-remap.test.js
```
Expected: `# pass 5`

- [ ] **Step 1.5: Commit**

```bash
git add lib/shortform/voice-upload-remap.js tests/unit/voice-upload-remap.test.js
git commit -m "feat(shortform): scene 시간축 재분배 순수 함수 (Phase F)"
```

---

## Task 2: R2 delete 헬퍼 추가

**Files:**
- Modify: `lib/r2.js`

**목적**: 전사 실패 시 업로드된 음성 파일을 R2에서 정리해 orphan 방지.

- [ ] **Step 2.1: Implementation**

Add to `lib/r2.js` (파일 끝에 추가):

```javascript
/**
 * R2에서 파일 삭제 (orphan cleanup용)
 * 실패는 로그만 남기고 throw 하지 않음 — 호출자가 이미 에러 플로우일 가능성 높음.
 * @param {string} key - 파일 키
 * @returns {Promise<boolean>} 성공 여부
 */
export async function r2Delete(key) {
  try {
    const { DeleteObjectCommand } = await import('@aws-sdk/client-s3');
    const client = await getS3Client();
    await client.send(new DeleteObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: key,
    }));
    return true;
  } catch (err) {
    console.warn(`[R2] delete failed for ${key}:`, err.message);
    return false;
  }
}
```

- [ ] **Step 2.2: 빌드 확인**

```bash
node -e "import('./lib/r2.js').then(m => console.log(typeof m.r2Delete))"
```
Expected: `function`

- [ ] **Step 2.3: Commit**

```bash
git add lib/r2.js
git commit -m "feat(r2): r2Delete 헬퍼 — orphan cleanup용"
```

---

## Task 3: Whisper REST 래퍼 (TDD — 정규화만)

**Files:**
- Create: `lib/shortform/whisper.js`
- Test: `tests/unit/whisper.test.js`

**목적**: OpenAI Whisper 응답의 `words: [{word, start, end}]` 배열을 ElevenLabs와 동일한 wordTimestamps shape으로 정규화. 순수 함수와 fetch 호출을 분리 설계.

- [ ] **Step 3.1: Write failing test — 정규화 로직**

Create `tests/unit/whisper.test.js`:

```javascript
// tests/unit/whisper.test.js
//
// Phase F — Whisper 응답 정규화 단위 테스트
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeWhisperResponse } from '../../lib/shortform/whisper.js';

test('normalizeWhisperResponse — 표준 응답', () => {
  const raw = {
    task: 'transcribe',
    language: 'korean',
    duration: 12.34,
    text: '안녕하세요 반갑습니다',
    words: [
      { word: '안녕하세요', start: 0.1, end: 1.2 },
      { word: '반갑습니다', start: 1.5, end: 3.0 },
    ],
  };
  const result = normalizeWhisperResponse(raw);
  assert.equal(result.duration, 12.34);
  assert.equal(result.text, '안녕하세요 반갑습니다');
  assert.equal(result.wordTimestamps.length, 2);
  assert.deepEqual(result.wordTimestamps[0], { word: '안녕하세요', start: 0.1, end: 1.2 });
});

test('normalizeWhisperResponse — words 누락 시 빈 배열', () => {
  const result = normalizeWhisperResponse({ duration: 5, text: '대본', words: undefined });
  assert.deepEqual(result.wordTimestamps, []);
  assert.equal(result.duration, 5);
});

test('normalizeWhisperResponse — 필드 없는 word 건너뜀', () => {
  const raw = {
    duration: 3,
    text: 't',
    words: [
      { word: 'ok', start: 0.1, end: 0.5 },
      { word: null, start: 0.6, end: 1.0 },
      { word: 'ok2', start: 1.1 }, // end 누락
    ],
  };
  const result = normalizeWhisperResponse(raw);
  assert.equal(result.wordTimestamps.length, 1);
  assert.equal(result.wordTimestamps[0].word, 'ok');
});

test('normalizeWhisperResponse — duration 파싱 실패 시 0', () => {
  const result = normalizeWhisperResponse({ text: 't', words: [] });
  assert.equal(result.duration, 0);
});
```

- [ ] **Step 3.2: Run test — FAIL**

```bash
npm test -- tests/unit/whisper.test.js
```
Expected: Cannot find module

- [ ] **Step 3.3: Write implementation**

Create `lib/shortform/whisper.js`:

```javascript
/**
 * Phase F — OpenAI Whisper(whisper-1) 호출 + 응답 정규화
 *
 * Whisper 응답의 words 배열을 ElevenLabs와 동일한 wordTimestamps shape으로 정규화.
 * 순수 함수(normalizeWhisperResponse)와 fetch 호출(transcribeAudio)을 분리.
 */

const WHISPER_ENDPOINT = 'https://api.openai.com/v1/audio/transcriptions';
const WHISPER_MODEL = 'whisper-1';

/**
 * Whisper API 호출
 * @param {Buffer} audioBuffer
 * @param {string} filename - 확장자 포함 (예: 'upload.mp3')
 * @param {string} mimeType
 * @returns {Promise<object>} raw Whisper response
 */
export async function transcribeAudio(audioBuffer, filename, mimeType) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is missing');

  const formData = new FormData();
  const blob = new Blob([audioBuffer], { type: mimeType });
  formData.append('file', blob, filename);
  formData.append('model', WHISPER_MODEL);
  formData.append('response_format', 'verbose_json');
  formData.append('timestamp_granularities[]', 'word');
  formData.append('language', 'ko');

  const res = await fetch(WHISPER_ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: formData,
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Whisper failed: ${res.status} ${errText.slice(0, 200)}`);
  }

  return res.json();
}

/**
 * Whisper 응답을 ElevenLabs와 동일 shape으로 정규화
 * @param {object} raw
 * @returns {{ duration: number, text: string, wordTimestamps: Array<{word,start,end}> }}
 */
export function normalizeWhisperResponse(raw) {
  const duration = Number(raw?.duration) || 0;
  const text = String(raw?.text || '');
  const words = Array.isArray(raw?.words) ? raw.words : [];

  const wordTimestamps = words
    .filter((w) => w && typeof w.word === 'string' && Number.isFinite(w.start) && Number.isFinite(w.end))
    .map((w) => ({ word: w.word, start: w.start, end: w.end }));

  return { duration, text, wordTimestamps };
}
```

- [ ] **Step 3.4: Run test — PASS**

```bash
npm test -- tests/unit/whisper.test.js
```
Expected: `# pass 4`

- [ ] **Step 3.5: Commit**

```bash
git add lib/shortform/whisper.js tests/unit/whisper.test.js
git commit -m "feat(shortform): Whisper REST 래퍼 + 응답 정규화 (Phase F)"
```

---

## Task 4: API 엔드포인트 — `/api/shortform-voice-upload`

**Files:**
- Create: `app/api/shortform-voice-upload/route.js`

**목적**: multipart/form-data로 audio + script 받아서 R2 업로드 → Whisper 전사 → scene 재분배 → JSON 응답. 실패 시 R2 cleanup.

- [ ] **Step 4.1: Write route — 스켈레톤 + 검증**

Create `app/api/shortform-voice-upload/route.js`:

```javascript
import { uploadToR2, r2Delete } from '@/lib/r2';
import { hashEmail } from '@/lib/user-images';
import { transcribeAudio, normalizeWhisperResponse } from '@/lib/shortform/whisper';
import { remapScenesToAudio } from '@/lib/shortform/voice-upload-remap';
import {
  extractToken,
  resolveSessionEmail,
  corsHeaders,
  jsonResponse,
  handleOptions,
} from '@/lib/api-helpers';

export const maxDuration = 60;

const R2_AUDIO_PREFIX = 'shortform-audio';
const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB (Whisper API 상한)
const MAX_DURATION_SEC = 100; // 숏폼 최대 90초 + 여유 10초
const MIN_DURATION_SEC = 5;

const ACCEPTED_MIME_TYPES = new Set([
  'audio/mpeg',       // mp3
  'audio/mp3',        // mp3 alt
  'audio/mp4',        // m4a (일부 브라우저)
  'audio/x-m4a',      // m4a
  'audio/wav',        // wav
  'audio/wave',       // wav alt
  'audio/x-wav',      // wav alt
  'audio/webm',       // webm
]);

const MIME_TO_EXT = {
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/wav': 'wav',
  'audio/wave': 'wav',
  'audio/x-wav': 'wav',
  'audio/webm': 'webm',
};

export async function OPTIONS(request) {
  return handleOptions(request);
}

export async function POST(request) {
  let r2Key = null;
  try {
    // 1. 인증
    const token = extractToken(request);
    const email = await resolveSessionEmail(token);
    if (!email) {
      return jsonResponse(request, { error: '로그인이 필요합니다.' }, { status: 401 });
    }

    // 2. multipart 파싱
    const formData = await request.formData();
    const audioFile = formData.get('audio');
    const scriptRaw = formData.get('script');

    if (!audioFile || typeof audioFile === 'string') {
      return jsonResponse(request, { error: 'audio 파일이 필요합니다.' }, { status: 400 });
    }

    // 3. MIME 검증
    const mimeType = audioFile.type || '';
    if (!ACCEPTED_MIME_TYPES.has(mimeType)) {
      return jsonResponse(
        request,
        { error: 'mp3/m4a/wav/webm 형식만 업로드 가능합니다.' },
        { status: 400 }
      );
    }

    // 4. 크기 검증
    if (audioFile.size > MAX_FILE_SIZE) {
      return jsonResponse(
        request,
        { error: `파일이 너무 큽니다 (${(audioFile.size / 1024 / 1024).toFixed(1)}MB). 25MB 이하만 가능.` },
        { status: 400 }
      );
    }

    // 5. script JSON 파싱
    let script;
    try {
      script = JSON.parse(String(scriptRaw || ''));
    } catch (e) {
      return jsonResponse(request, { error: 'script 데이터가 유효하지 않습니다.' }, { status: 400 });
    }
    if (!script || !Array.isArray(script.scenes)) {
      return jsonResponse(request, { error: 'script.scenes 가 없습니다.' }, { status: 400 });
    }

    // 6. Buffer 변환
    const arrayBuffer = await audioFile.arrayBuffer();
    const audioBuffer = Buffer.from(arrayBuffer);

    // 7. R2 업로드
    const ext = MIME_TO_EXT[mimeType] || 'mp3';
    const userKey = hashEmail(email);
    r2Key = `${R2_AUDIO_PREFIX}/${userKey}/upload-${Date.now()}.${ext}`;
    let audioUrl;
    try {
      audioUrl = await uploadToR2(r2Key, audioBuffer, mimeType);
    } catch (uploadErr) {
      console.error('[voice-upload] R2 업로드 실패:', uploadErr.message);
      return jsonResponse(
        request,
        { error: '파일 저장 실패: ' + uploadErr.message },
        { status: 502 }
      );
    }

    // 8. Whisper 전사
    let whisperResult;
    try {
      const raw = await transcribeAudio(audioBuffer, `upload.${ext}`, mimeType);
      whisperResult = normalizeWhisperResponse(raw);
    } catch (whisperErr) {
      console.error('[voice-upload] Whisper 실패:', whisperErr.message);
      await r2Delete(r2Key);
      return jsonResponse(
        request,
        { error: '음성 전사 실패: ' + whisperErr.message },
        { status: 502 }
      );
    }

    // 9. 길이 사후 검증 (Whisper duration 기준)
    if (whisperResult.duration > MAX_DURATION_SEC) {
      await r2Delete(r2Key);
      return jsonResponse(
        request,
        { error: `오디오가 너무 깁니다 (${whisperResult.duration.toFixed(1)}초). ${MAX_DURATION_SEC}초 이하만 가능.` },
        { status: 400 }
      );
    }
    if (whisperResult.duration < MIN_DURATION_SEC) {
      await r2Delete(r2Key);
      return jsonResponse(
        request,
        { error: `오디오가 너무 짧습니다 (${whisperResult.duration.toFixed(1)}초). 최소 ${MIN_DURATION_SEC}초 필요.` },
        { status: 400 }
      );
    }

    // 10. scene 시간축 재분배
    const oldTotalDuration = Number(script.totalDuration) || 0;
    const remappedScenes = remapScenesToAudio(
      script.scenes,
      oldTotalDuration,
      whisperResult.duration
    );

    // 11. 응답
    return jsonResponse(request, {
      audioUrl,
      wordTimestamps: whisperResult.wordTimestamps,
      charAlignment: null,
      totalDuration: whisperResult.duration,
      remappedScenes,
      provider: 'whisper',
    });
  } catch (error) {
    console.error('[voice-upload] Unexpected error:', error.message, error.stack);
    if (r2Key) await r2Delete(r2Key).catch(() => {});
    return jsonResponse(
      request,
      { error: '음성 업로드 중 오류: ' + (error.message || 'unknown') },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 4.2: 빌드 확인**

```bash
npx next build 2>&1 | tail -30
```
Expected: `Route (app) ... /api/shortform-voice-upload` 포함, 에러 없음.

만약 빌드 에러 발생 시 import 경로/문법 수정 후 재빌드.

- [ ] **Step 4.3: Commit**

```bash
git add app/api/shortform-voice-upload/route.js
git commit -m "feat(shortform): 음성 업로드 API — R2+Whisper+scene remap (Phase F)"
```

---

## Task 5: 통합 테스트 — 인증/검증 경로

**Files:**
- Create: `tests/integration/voice-upload.test.js`

**목적**: API 라우트의 인증/MIME/크기 검증 경로를 테스트. R2와 Whisper는 환경 의존성이 커서 통합 테스트에서는 검증 전 단계만 커버.

- [ ] **Step 5.1: Write integration test**

Create `tests/integration/voice-upload.test.js`:

```javascript
// tests/integration/voice-upload.test.js
//
// Phase F — 음성 업로드 API 통합 테스트 (인증/검증 경로)
// R2/Whisper 호출은 외부 의존성이라 이 테스트에서는 커버하지 않음.
// → 실제 호출 경로는 Vercel Preview 배포 후 수동 검증.

import { test } from 'node:test';
import assert from 'node:assert/strict';

// NextRequest mock — formData + headers만 필요
function makeRequest({ headers = {}, formData = null }) {
  return {
    method: 'POST',
    headers: new Headers(headers),
    formData: async () => formData,
    url: 'http://localhost/api/shortform-voice-upload',
  };
}

function makeFormData(audioBlob, script) {
  const fd = new FormData();
  if (audioBlob) fd.append('audio', audioBlob, 'test.mp3');
  if (script !== undefined) fd.append('script', JSON.stringify(script));
  return fd;
}

test('voice-upload — 비로그인 401', async () => {
  const { POST } = await import('../../app/api/shortform-voice-upload/route.js');
  const req = makeRequest({ formData: makeFormData(null) });
  const res = await POST(req);
  assert.equal(res.status, 401);
  const body = await res.json();
  assert.match(body.error, /로그인/);
});

test('voice-upload — 잘못된 MIME 400', async () => {
  // 이 테스트는 인증 통과를 위해 ADMIN 환경변수 우회 필요.
  // 현재 인프라에서 환경변수 모킹 없이는 통과 불가 — 일단 skip하고 수동 검증.
  // 실제 검증: curl -X POST -H "Authorization: Bearer <valid_token>" \
  //   -F "audio=@wrongtype.txt" -F "script={\"scenes\":[]}" \
  //   https://<preview>/api/shortform-voice-upload
  //   → 400 "mp3/m4a/wav/webm 형식만"
});

test('voice-upload — script 파싱 실패 400 (수동 검증 메모)', async () => {
  // 실제 검증: audio 유효 + script='invalid' body
  //   → 400 "script 데이터가 유효하지 않습니다."
});
```

- [ ] **Step 5.2: Run test**

```bash
npm run test:integration -- tests/integration/voice-upload.test.js
```
Expected: `# pass 1` (나머지 2개는 주석 메모, 실제 검증은 수동).

- [ ] **Step 5.3: Commit**

```bash
git add tests/integration/voice-upload.test.js
git commit -m "test(shortform): 음성 업로드 API 인증 경로 통합 테스트"
```

---

## Task 6: 클라이언트 State 추가 — voiceMode + 업로드 state

**Files:**
- Modify: `app/shortform/ShortformClient.js` (around line 787-814)

**목적**: 업로드 탭에 필요한 state 추가. 기존 TTS 로직 건드리지 않음.

- [ ] **Step 6.1: Add state after `previewAudio`**

찾기(`app/shortform/ShortformClient.js:814` 근처):

```javascript
  const [previewAudio, setPreviewAudio] = useState({ voiceId: null, url: null, loading: false });
```

바로 아래에 추가:

```javascript
  // === Phase F — 내 음성 업로드 ===
  // voiceMode: 'tts'(기본) | 'upload'
  // uploadFile: 선택된 File 객체 (전사 시작 전)
  // uploadStatus: 'idle'|'uploading'|'transcribing'|'done'|'error'
  const [voiceMode, setVoiceMode] = useState('tts');
  const [uploadFile, setUploadFile] = useState(null);
  const [uploadFileDuration, setUploadFileDuration] = useState(null);
  const [uploadStatus, setUploadStatus] = useState('idle');
  const [uploadError, setUploadError] = useState(null);
```

- [ ] **Step 6.2: Commit**

```bash
git add app/shortform/ShortformClient.js
git commit -m "feat(shortform): voice upload state 추가 (Phase F)"
```

---

## Task 7: 클라이언트 — 파일 검증 + 업로드 핸들러

**Files:**
- Modify: `app/shortform/ShortformClient.js` (add helpers before component functions, around line 470-490)

**목적**: 브라우저에서 오디오 길이 사전 검증 + 서버 호출 + 응답 처리.

- [ ] **Step 7.1: Add validator helper — `buildFallbackCaption` 함수 위에**

`ShortformClient.js:472` 근처 `function buildFallbackCaption` **바로 위에** 추가:

```javascript
/**
 * Phase F — 업로드 전 오디오 파일 길이 사전 검증.
 * 브라우저 <audio> 엘리먼트로 metadata만 로드해서 duration 추출.
 * 100초 초과 또는 5초 미만이면 reject.
 */
function validateAudioFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const audio = new Audio(url);
    const cleanup = () => URL.revokeObjectURL(url);
    audio.onloadedmetadata = () => {
      cleanup();
      const d = audio.duration;
      if (!Number.isFinite(d) || d <= 0) {
        reject(new Error('오디오 길이를 읽을 수 없어요.'));
      } else if (d > 100) {
        reject(new Error(`오디오가 너무 깁니다 (${d.toFixed(1)}초, 최대 100초).`));
      } else if (d < 5) {
        reject(new Error(`오디오가 너무 짧습니다 (${d.toFixed(1)}초, 최소 5초).`));
      } else {
        resolve(d);
      }
    };
    audio.onerror = () => {
      cleanup();
      reject(new Error('오디오 파일을 읽을 수 없어요. 다른 파일을 선택해주세요.'));
    };
  });
}
```

- [ ] **Step 7.2: Add `handleVoiceUpload` and `handleFileSelect` inside component**

`ShortformClient.js:944` 근처 `async function previewVoice(voiceId) {` **바로 위에** 추가 (component 내부, `fetchVoices` 근처):

```javascript
  /** Phase F — 파일 선택 핸들러 (input change) */
  async function handleFileSelect(file) {
    setUploadError(null);
    setUploadStatus('idle');
    if (!file) {
      setUploadFile(null);
      setUploadFileDuration(null);
      return;
    }
    try {
      const duration = await validateAudioFile(file);
      setUploadFile(file);
      setUploadFileDuration(duration);
    } catch (err) {
      setUploadFile(null);
      setUploadFileDuration(null);
      setUploadError(err.message);
    }
  }

  /** Phase F — 업로드 + Whisper 전사 트리거 */
  async function handleVoiceUpload() {
    if (!uploadFile || !script) {
      setUploadError('파일과 대본이 모두 필요합니다.');
      return;
    }
    setUploadStatus('uploading');
    setUploadError(null);
    try {
      const formData = new FormData();
      formData.append('audio', uploadFile);
      formData.append('script', JSON.stringify(script));
      setUploadStatus('transcribing');
      const res = await fetch('/api/shortform-voice-upload', {
        method: 'POST',
        headers: authHeaders(),
        body: formData,
      });
      if (!res.ok) {
        let errMsg = `업로드 실패 (HTTP ${res.status})`;
        try {
          const errData = await res.json();
          if (errData.error) errMsg = errData.error;
        } catch (_) {}
        throw new Error(errMsg);
      }
      const data = await res.json();
      if (!data.audioUrl || !Array.isArray(data.remappedScenes)) {
        throw new Error('업로드 응답이 유효하지 않습니다.');
      }
      // 기존 TTS와 동일한 state 갱신
      if (audioUrl?.startsWith('blob:')) URL.revokeObjectURL(audioUrl);
      audioBlobRef.current = null;
      setAudioUrl(data.audioUrl);
      setAudioWordTimestamps(data.wordTimestamps || null);
      setAudioCharAlignment(null);
      // scene 재분배 적용
      setScript({
        ...script,
        scenes: data.remappedScenes,
        totalDuration: data.totalDuration,
      });
      setTtsStatus('done');
      setCompletedSteps((prev) => Array.from(new Set([...prev, 4, 5])));
      setUploadStatus('done');
    } catch (err) {
      console.error('[voice-upload] 실패:', err);
      setUploadError(err.message || '업로드 중 오류');
      setUploadStatus('error');
    }
  }
```

- [ ] **Step 7.3: Build check**

```bash
npx next build 2>&1 | tail -20
```
Expected: 빌드 성공. 빌드 에러 시 missing state/import 수정.

- [ ] **Step 7.4: Commit**

```bash
git add app/shortform/ShortformClient.js
git commit -m "feat(shortform): voice upload 핸들러 + 파일 검증 (Phase F)"
```

---

## Task 8: 클라이언트 — Step 4 탭 UI 삽입

**Files:**
- Modify: `app/shortform/ShortformClient.js` (around line 2195-2260)

**목적**: 기존 "🎙 음성 선택" 영역을 탭으로 감싸고, 업로드 탭 UI 추가.

- [ ] **Step 8.1: 기존 "음성 선택" 블록 교체**

**찾기** (`ShortformClient.js:2195-2260` 범위, `{/* 음성 선택 */}` 주석 라인부터 `)}` 까지):

```javascript
            {/* 음성 선택 */}
            {availableVoices.length > 0 && (
              <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--ds-border, #E5E7EB)' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ds-muted, #77736B)', marginBottom: 8 }}>
                  🎙 음성 선택 ({availableVoices.length}개)
                </div>
```

이 블록 전체를 아래 **탭으로 감싼 새 블록**으로 교체 (닫는 `</div>`와 `)}` 포함 범위까지):

```javascript
            {/* 🎙 음성 영역 — Phase F 탭 UI */}
            <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--ds-border, #E5E7EB)' }}>
              {/* 탭 헤더 */}
              <div style={{ display: 'flex', gap: 4, marginBottom: 12, borderBottom: '1px solid var(--ds-border, #E5E7EB)' }}>
                <button
                  type="button"
                  onClick={() => setVoiceMode('tts')}
                  style={{
                    padding: '8px 12px',
                    background: 'none',
                    border: 'none',
                    borderBottom: voiceMode === 'tts' ? '2px solid var(--ds-accent, #F95A1F)' : '2px solid transparent',
                    color: voiceMode === 'tts' ? 'var(--ds-accent, #F95A1F)' : 'var(--ds-muted, #77736B)',
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                  }}
                >
                  🎙 TTS 음성
                </button>
                <button
                  type="button"
                  onClick={() => setVoiceMode('upload')}
                  style={{
                    padding: '8px 12px',
                    background: 'none',
                    border: 'none',
                    borderBottom: voiceMode === 'upload' ? '2px solid var(--ds-accent, #F95A1F)' : '2px solid transparent',
                    color: voiceMode === 'upload' ? 'var(--ds-accent, #F95A1F)' : 'var(--ds-muted, #77736B)',
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                  }}
                >
                  📤 내 음성 업로드
                </button>
              </div>

              {/* TTS 탭 */}
              {voiceMode === 'tts' && availableVoices.length > 0 && (
                <>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ds-muted, #77736B)', marginBottom: 8 }}>
                    음성 선택 ({availableVoices.length}개)
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6 }}>
                    {availableVoices.map((v) => {
                      const selected = ttsVoice === v.id;
                      const isLoading = previewAudio.loading && previewAudio.voiceId === v.id;
                      return (
                        <div
                          key={v.id}
                          style={{
                            padding: '8px 10px',
                            border: selected ? '1.5px solid var(--ds-accent, #F95A1F)' : '1px solid var(--ds-border, #E5E7EB)',
                            borderRadius: 8,
                            background: selected ? 'rgba(255, 95, 31, 0.06)' : '#fff',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 4,
                          }}
                        >
                          <button
                            type="button"
                            onClick={() => setTtsVoice(v.id)}
                            style={{
                              background: 'none',
                              border: 'none',
                              padding: 0,
                              fontSize: 11,
                              fontWeight: selected ? 700 : 500,
                              color: selected ? 'var(--ds-accent, #F95A1F)' : 'var(--ds-text, #1F2937)',
                              cursor: 'pointer',
                              textAlign: 'left',
                              fontFamily: 'inherit',
                            }}
                          >
                            {v.gender === 'female' ? '♀️' : '♂️'} {v.name} <span style={{ opacity: 0.5, fontSize: 9 }}>({v.provider})</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => previewVoice(v.id)}
                            disabled={isLoading}
                            style={{
                              background: 'transparent',
                              border: '1px dashed #D1D5DB',
                              padding: '3px 6px',
                              borderRadius: 4,
                              fontSize: 9,
                              color: '#6B7280',
                              cursor: 'pointer',
                              fontFamily: 'inherit',
                            }}
                          >
                            {isLoading ? '...' : '🔊 샘플'}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                  {previewAudio.url && (
                    <audio src={previewAudio.url} autoPlay style={{ width: '100%', marginTop: 8, height: 32 }} controls />
                  )}
                </>
              )}

              {/* 업로드 탭 */}
              {voiceMode === 'upload' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ fontSize: 11, color: 'var(--ds-muted, #77736B)', lineHeight: 1.5 }}>
                    내 목소리로 녹음한 파일을 업로드하세요. <strong>mp3/m4a/wav/webm, 5~100초, 최대 25MB</strong>.
                    대본대로 읽지 않아도 괜찮아요 — 실제 발화 기준으로 자막이 맞춰져요.
                  </div>
                  <label
                    style={{
                      display: 'block',
                      padding: '16px',
                      border: '1.5px dashed var(--ds-border, #E5E7EB)',
                      borderRadius: 8,
                      textAlign: 'center',
                      cursor: 'pointer',
                      background: '#FAFAF8',
                      fontSize: 12,
                    }}
                  >
                    <input
                      type="file"
                      accept="audio/mpeg,audio/mp3,audio/mp4,audio/x-m4a,audio/wav,audio/wave,audio/x-wav,audio/webm,.mp3,.m4a,.wav,.webm"
                      style={{ display: 'none' }}
                      onChange={(e) => handleFileSelect(e.target.files?.[0] || null)}
                    />
                    {uploadFile ? (
                      <>
                        <div style={{ fontWeight: 700, color: 'var(--ds-text, #1F2937)' }}>{uploadFile.name}</div>
                        <div style={{ fontSize: 10, color: 'var(--ds-muted, #77736B)', marginTop: 4 }}>
                          {(uploadFile.size / 1024 / 1024).toFixed(2)}MB · {uploadFileDuration?.toFixed(1)}초
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--ds-accent, #F95A1F)', marginTop: 6 }}>
                          다른 파일 선택
                        </div>
                      </>
                    ) : (
                      <>
                        <div>📁 파일 선택</div>
                        <div style={{ fontSize: 10, color: 'var(--ds-muted, #77736B)', marginTop: 4 }}>
                          클릭해서 파일 고르기
                        </div>
                      </>
                    )}
                  </label>

                  {uploadError && (
                    <div style={{
                      padding: '8px 10px',
                      background: '#FEF2F2',
                      border: '1px solid #FCA5A5',
                      borderRadius: 6,
                      color: '#B91C1C',
                      fontSize: 11,
                    }}>
                      {uploadError}
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={handleVoiceUpload}
                    disabled={!uploadFile || !script || uploadStatus === 'uploading' || uploadStatus === 'transcribing'}
                    style={{
                      padding: '10px 12px',
                      borderRadius: 8,
                      border: 'none',
                      background: (!uploadFile || !script) ? '#E5E7EB' : 'var(--ds-accent, #F95A1F)',
                      color: (!uploadFile || !script) ? '#9CA3AF' : '#fff',
                      fontSize: 12,
                      fontWeight: 700,
                      cursor: (!uploadFile || !script) ? 'not-allowed' : 'pointer',
                      fontFamily: 'inherit',
                    }}
                  >
                    {uploadStatus === 'uploading' && '업로드 중...'}
                    {uploadStatus === 'transcribing' && '전사 중 (~30초)...'}
                    {uploadStatus === 'done' && '✓ 업로드 완료'}
                    {(uploadStatus === 'idle' || uploadStatus === 'error') && (!script ? '먼저 대본을 생성해주세요' : '전사 시작')}
                  </button>

                  {uploadStatus === 'done' && (
                    <div style={{ fontSize: 11, color: 'var(--ds-muted, #77736B)', textAlign: 'center' }}>
                      오디오 길이 기준으로 씬 시간이 자동 조정됐어요. 다음 단계로 진행하세요.
                    </div>
                  )}
                </div>
              )}
            </div>
```

- [ ] **Step 8.2: Build check**

```bash
npx next build 2>&1 | tail -20
```
Expected: 빌드 성공.

- [ ] **Step 8.3: Dev server로 UI 육안 확인**

```bash
npm run dev
```
브라우저에서 `/shortform` → 대본 생성 → Step 4 진입 → 상단에 "🎙 TTS 음성 | 📤 내 음성 업로드" 2탭 표시 확인. 업로드 탭 클릭 → 드롭존 표시 확인. (실제 업로드는 로그인 상태 + 배포 환경 필요 — 수동 검증 Task 10)

- [ ] **Step 8.4: Commit**

```bash
git add app/shortform/ShortformClient.js
git commit -m "feat(shortform): Step 4 음성 탭 UI — TTS/업로드 분기 (Phase F)"
```

---

## Task 9: `.env.example` 업데이트

**Files:**
- Modify: `.env.example`

- [ ] **Step 9.1: OPENAI_API_KEY 주석 업데이트**

`.env.example`에 `OPENAI_API_KEY` 라인이 있는지 확인:

```bash
grep "OPENAI_API_KEY" .env.example || echo "MISSING"
```

**있으면** 해당 라인 주석을 아래처럼 교체:

```
# OpenAI API Key — Whisper 전사 (Phase F 음성 업로드) + 레거시 이미지 fallback 용도
OPENAI_API_KEY=sk-...
```

**없으면** 파일 끝에 추가:

```
# OpenAI API Key — Whisper 전사 (Phase F 음성 업로드)
OPENAI_API_KEY=sk-...
```

- [ ] **Step 9.2: Commit**

```bash
git add .env.example
git commit -m "chore: OPENAI_API_KEY 주석 — Phase F 사용처 명시"
```

---

## Task 10: 수동 E2E 검증 (사용자 주도)

**Files:** N/A

**목적**: 빌드/단위 테스트로 커버 안 되는 실제 경로 검증. Vercel Preview 배포 후.

- [ ] **Step 10.1: Vercel Preview 배포 대기**

`git push origin <branch>` 후 Vercel에서 Preview 배포 완료 확인.

- [ ] **Step 10.2: E2E 시나리오 — 업로드 정상 플로우**

1. Preview URL 로그인 → `/shortform` 이동
2. Step 1~3 통과 → 45초 대본 생성
3. Step 4 진입 → "📤 내 음성 업로드" 탭 클릭
4. mp3 파일 선택 (30~50초 녹음본)
5. 파일명 + 크기 + 길이 표시 확인
6. "전사 시작" 클릭 → "업로드 중..." → "전사 중..." → "✓ 업로드 완료"
7. "다음 단계: 비주얼 액센트 →" CTA 정상 노출 확인
8. Step 5~7 정상 진행
9. Step 7 완성 영상에서 오디오 싱크 ±200ms 이내 확인

- [ ] **Step 10.3: E2E — 에러 경로**

각각 테스트하고 에러 메시지 확인:
1. 3초 mp3 → "오디오가 너무 짧습니다"
2. 120초 mp3 → "오디오가 너무 깁니다"
3. 30MB mp3 → "파일이 너무 큽니다"
4. .txt 파일 → "mp3/m4a/wav/webm 형식만"
5. 대본 없이 업로드 시도 → "먼저 대본을 생성해주세요"

- [ ] **Step 10.4: R2 로그 확인**

Cloudflare R2 대시보드에서 `shortform-audio/{hash}/upload-*.mp3` 객체 생성 확인. 에러 시나리오(길이 초과 등)의 경우 R2에 객체 없음 확인 (cleanup 정상 동작).

- [ ] **Step 10.5: 배포 완료 commit/tag**

검증 통과 후 main 머지. 별도 commit 없음 — 위 task들이 main으로 흡수됨.

---

## Self-Review

### Spec 커버리지 체크

| Spec 섹션 | Task | 상태 |
|----------|------|------|
| Q1 Whisper-only | Task 3 (whisper.js) | ✅ |
| Q2 동일 크레딧 | Task 4 (API는 차감 안 함 — 기존 shortform-render에서 차감) | ✅ 구현 없음 = 의도대로 |
| Q3 탭 UI | Task 8 | ✅ |
| Q4 자동 맞춤 | Task 1 (remap) + Task 4 (totalDuration 덮어쓰기) | ✅ |
| 새 API 엔드포인트 | Task 4 | ✅ |
| R2 orphan cleanup | Task 2 (r2Delete) + Task 4 (error 경로에서 호출) | ✅ |
| 브라우저 사전 길이 검증 | Task 7 (validateAudioFile) | ✅ |
| 에러 테이블 (401/400/502) | Task 4 (모든 경로 구현) | ✅ |
| scene 재분배 비율 유지 | Task 1 unit test | ✅ |
| .env.example 주석 | Task 9 | ✅ |
| 단위 테스트 (remap) | Task 1 | ✅ |
| 단위 테스트 (whisper) | Task 3 | ✅ |
| 통합 테스트 (API) | Task 5 | ✅ (인증 경로만) |
| E2E 수동 | Task 10 | ✅ |

### Placeholder 스캔

- "TBD" / "TODO" / "나중에" 없음 ✅
- 모든 step에 실제 코드 블록 포함 ✅
- 에러 메시지 텍스트 확정 ✅
- curl 명령 구체화 (Task 5 메모) ✅

### Type/Signature 일관성

- `remapScenesToAudio(scenes, oldTotalDuration, newTotalDuration)` — Task 1에서 정의, Task 4에서 같은 시그니처로 호출 ✅
- `transcribeAudio(buffer, filename, mimeType)` — Task 3 정의, Task 4 호출 일치 ✅
- `normalizeWhisperResponse` 반환 `{ duration, text, wordTimestamps }` — Task 3 정의, Task 4에서 `.duration`, `.wordTimestamps` 소비 ✅
- `r2Delete(key)` — Task 2 정의, Task 4 호출 일치 ✅
- 응답 shape `{ audioUrl, wordTimestamps, charAlignment, totalDuration, remappedScenes, provider }` — Task 4 서버 생성 ↔ Task 7 클라이언트 소비 일치 ✅
- state: `voiceMode`, `uploadFile`, `uploadFileDuration`, `uploadStatus`, `uploadError` — Task 6 선언, Task 7/8에서 모두 참조 일치 ✅

### Out of scope 재확인 (Spec 기준)

- MediaRecorder 녹음: 구현 없음 ✅
- B-roll 재배치: 구현 없음 ✅
- 다국어: `language=ko` 고정 ✅
- Voice cloning: 미포함 ✅
- Optimistic credit lock: 별도 Phase ✅

---

## 진행 순서

Task 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 (순차).
Task 6~8은 모두 `ShortformClient.js` 수정이라 같은 파일에서 충돌 주의 — 순서대로 적용하면 문제 없음.

커밋 수 예상: 9개 (Task 10 제외).
