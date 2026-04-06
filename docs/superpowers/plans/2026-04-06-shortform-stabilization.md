# 숏폼 영상 파이프라인 디버깅 + 안정화 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 숏폼 영상 파이프라인(스크립트→음성→STT+B-roll→렌더링)을 엔드투엔드 안정화하여 MP4 다운로드까지 동작하게 한다.

**Architecture:** Railway(media worker)에서 STT+B-roll+Remotion을 처리하고, Vercel(shortform.html)은 UI + API 프록시만 담당. 프론트에서 직접 Railway 렌더 엔드포인트를 호출한다.

**Tech Stack:** Remotion 4.0 (Bundler+Renderer), OpenAI Whisper, Vertex AI Veo 3.0, Flux Realism (fal.ai), Chromium headless, Railway

---

## 파일 구조

| 파일 | 역할 | 수정 내용 |
|------|------|----------|
| `shortform.html` | UI + 렌더 요청 | 에러 표시 강화, audioDuration 디버그 로깅 |
| `services/shortform-stt-service/server.js` | Railway 메인 서버 | 렌더링 에러 로깅 강화, audioDurationSec 로깅 |
| `services/shortform-remotion-render.mjs` | Remotion 렌더러 | 에러 상세화, 타임아웃 확장 |
| `remotion/shortform/timeline.js` | 타임라인 빌더 | 30초 폴백 경고 로깅 |
| `remotion/shortform/ShortformComposition.jsx` | Remotion 컴포넌트 | 변경 없음 (확인만) |

---

### Task 1: 렌더링 에러 로깅 강화

렌더링 실패 시 에러 원인을 정확히 파악할 수 있도록 서버와 프론트 양쪽에 상세 로그를 추가한다.

**Files:**
- Modify: `services/shortform-stt-service/server.js:237-270`
- Modify: `services/shortform-remotion-render.mjs:42-80`

- [ ] **Step 1: server.js 렌더링 핸들러에 상세 에러 로깅 추가**

`/Users/gong-eunhui/Desktop/naver-title-generator/services/shortform-stt-service/server.js` 237번 줄부터 렌더링 try/catch 블록에 상세 로그를 추가한다:

```javascript
  try {
    console.log('[REMOTION-RENDER] Starting render:', {
      audioDurationSec: inputProps.audioDurationSec,
      estimatedSeconds: inputProps.estimatedSeconds,
      trimStartSec: inputProps.trimStartSec,
      trimEndSec: inputProps.trimEndSec,
      sttSegments: inputProps.sttSegments?.length || 0,
      sttWords: inputProps.sttWords?.length || 0,
      visuals: inputProps.visuals?.length || 0,
      audioSrc: inputProps.audioSrc ? 'present' : 'missing',
    });
    await renderShortformRemotion({
      inputProps,
      outputLocation,
    });
```

catch 블록에도 에러 상세 추가:

```javascript
  } catch (renderErr) {
    console.error('[REMOTION-RENDER] Failed:', renderErr.message, renderErr.stack);
    tempAudioStore.delete(audioToken);
    try { await fs.unlink(outputLocation); } catch (_) {}
    return {
      status: 500,
      body: JSON.stringify({ error: '영상 렌더링 실패: ' + renderErr.message }),
      contentType: 'application/json',
    };
  }
```

- [ ] **Step 2: shortform-remotion-render.mjs에 렌더링 파라미터 로깅 추가**

`/Users/gong-eunhui/Desktop/naver-title-generator/services/shortform-remotion-render.mjs` renderShortformRemotion 함수에서 composition 선택 후 로그:

```javascript
  console.info('[shortform-remotion] composition:', {
    id: composition.id,
    durationInFrames: composition.durationInFrames,
    fps: composition.fps,
    width: composition.width,
    height: composition.height,
  });
```

- [ ] **Step 3: 커밋**

```bash
git add services/shortform-stt-service/server.js services/shortform-remotion-render.mjs
git commit -m "fix: 숏폼 렌더링 에러 로깅 강화 — inputProps 및 composition 상세 출력"
```

---

### Task 2: 30초 고정 문제 진단 및 수정

Remotion composition이 항상 30초 분량으로 렌더링되는 문제를 해결한다. `buildShortformTimeline`의 `audioDurationSec`가 0으로 떨어지면 `estimatedSeconds || 30`으로 폴백된다.

**Files:**
- Modify: `remotion/shortform/timeline.js:440-456`
- Modify: `services/shortform-stt-service/server.js:244-245`

- [ ] **Step 1: timeline.js에 duration 폴백 경고 로깅 추가**

`/Users/gong-eunhui/Desktop/naver-title-generator/remotion/shortform/timeline.js` 449번 줄 부근, `buildShortformTimeline` 함수에서:

```javascript
  const sourceDuration = audioDurationSec > 0 ? audioDurationSec : estimatedSeconds;

  if (audioDurationSec <= 0) {
    console.warn('[timeline] audioDurationSec is', audioDurationSec, '— falling back to estimatedSeconds:', estimatedSeconds);
  }
```

- [ ] **Step 2: server.js에서 audioDurationSec 전달 확인**

`/Users/gong-eunhui/Desktop/naver-title-generator/services/shortform-stt-service/server.js` 244~245번 줄:

현재 코드:
```javascript
        estimatedSeconds: Number(body.estimatedSeconds) || 30,
        audioDurationSec: Number(body.audioDurationSec) || Number(body.estimatedSeconds) || 30,
```

이 코드 자체는 정상이다. 문제는 프론트에서 `audioDurationSec`가 0으로 전달될 때인데, `Number(0) || 30`은 `30`이 된다. `0`은 falsy이므로 `||`가 다음 값으로 넘어간다.

수정:

```javascript
        estimatedSeconds: Number(body.estimatedSeconds) || 30,
        audioDurationSec: body.audioDurationSec != null && Number(body.audioDurationSec) > 0
          ? Number(body.audioDurationSec)
          : Number(body.estimatedSeconds) || 30,
```

- [ ] **Step 3: shortform.html에서 audioDuration 디버그 로그 추가**

`/Users/gong-eunhui/Desktop/naver-title-generator/shortform.html` 2858번 줄, 렌더 요청 직전에:

```javascript
          console.log('[shortform] render request:', {
            audioDurationSec: audioDuration,
            estimatedSeconds: state.estimatedSeconds,
            trimStart: trimStart,
            trimEnd: trimEnd,
            sttSegments: state.sttSegments?.length,
            sttWords: state.sttWords?.length,
            visuals: mediaItems?.length,
          });
```

- [ ] **Step 4: 커밋**

```bash
git add remotion/shortform/timeline.js services/shortform-stt-service/server.js shortform.html
git commit -m "fix: 숏폼 30초 고정 문제 — audioDurationSec 0일 때 폴백 수정 + 디버그 로깅"
```

---

### Task 3: 렌더링 에러 응답 개선

현재 서버에서 렌더링 실패 시 에러가 binary 응답으로 돌아와 프론트에서 파싱이 안 될 수 있다. 에러 시 JSON 응답을 보장한다.

**Files:**
- Modify: `services/shortform-stt-service/server.js:237-270`
- Modify: `shortform.html:2875-2878`

- [ ] **Step 1: server.js 렌더링 실패 시 JSON 에러 응답 보장**

현재 `handleRemotionRenderRequest`의 catch에서 에러를 JSON으로 반환하도록 수정. 현재 코드 확인 후 catch 블록이 없으면 추가:

```javascript
  } catch (renderErr) {
    console.error('[REMOTION-RENDER] Failed:', renderErr.message, renderErr.stack);
    tempAudioStore.delete(audioToken);
    try { await fs.unlink(outputLocation); } catch (_) {}
    return {
      status: 500,
      body: JSON.stringify({ error: '영상 렌더링 실패: ' + renderErr.message }),
      contentType: 'application/json',
    };
  }
```

- [ ] **Step 2: shortform.html에서 에러 응답 파싱 개선**

`/Users/gong-eunhui/Desktop/naver-title-generator/shortform.html` 2875번 줄:

현재:
```javascript
          if (!response.ok) {
            var errorText = await response.text();
            throw new Error('Remotion 렌더 오류: ' + summarizeRawErrorText(errorText) + ' (HTTP ' + response.status + ')');
          }
```

수정:
```javascript
          if (!response.ok) {
            var errorText = '';
            try {
              var contentType = response.headers.get('content-type') || '';
              if (contentType.includes('application/json')) {
                var errJson = await response.json();
                errorText = errJson.error || JSON.stringify(errJson);
              } else {
                errorText = await response.text();
              }
            } catch (_) { errorText = 'HTTP ' + response.status; }
            throw new Error('Remotion 렌더 오류: ' + (errorText || 'HTTP ' + response.status));
          }
```

- [ ] **Step 3: 커밋**

```bash
git add services/shortform-stt-service/server.js shortform.html
git commit -m "fix: 숏폼 렌더링 에러 응답 JSON 보장 + 프론트 에러 파싱 개선"
```

---

### Task 4: Remotion 렌더링 타임아웃 확장

Railway에서 Remotion 렌더링은 영상 길이에 따라 60초 이상 걸릴 수 있다. 현재 타임아웃이 120초인데, 여유를 두고 300초로 확장한다.

**Files:**
- Modify: `services/shortform-remotion-render.mjs:60-70`
- Modify: `services/shortform-stt-service/server.js` (요청 타임아웃)

- [ ] **Step 1: shortform-remotion-render.mjs 렌더링 타임아웃 확인 및 확장**

`/Users/gong-eunhui/Desktop/naver-title-generator/services/shortform-remotion-render.mjs`에서 `renderMedia` 호출 부분에 `timeoutInMilliseconds` 옵션 추가:

```javascript
  await renderMedia({
    composition,
    serveUrl,
    inputProps,
    outputLocation,
    codec,
    browserExecutable,
    chromeMode,
    overwrite: true,
    timeoutInMilliseconds: 300000, // 5분
    chromiumOptions: {
      gl: 'angle',
    },
  });
```

- [ ] **Step 2: 커밋**

```bash
git add services/shortform-remotion-render.mjs
git commit -m "fix: Remotion 렌더링 타임아웃 300초로 확장"
```

---

### Task 5: Railway 배포 및 엔드투엔드 테스트

수정한 코드를 Railway에 배포하고, 전체 파이프라인을 관통 테스트한다.

**Files:**
- 변경 없음 (배포 + 테스트)

- [ ] **Step 1: 코드 푸시 (Vercel + Railway 자동 배포)**

```bash
git push
```

Vercel은 shortform.html 변경을 자동 배포. Railway는 services/ 변경을 자동 배포.

- [ ] **Step 2: Railway 배포 확인**

```bash
curl -s https://naver-title-generator-production.up.railway.app/health | python3 -m json.tool
```

Expected: `remotionVersion: "v2-remotion-stt-sync"`, `ok: true`

- [ ] **Step 3: STT 단독 테스트**

Railway에서 Whisper가 동작하는지 확인:

```bash
curl -s "https://naver-title-generator-production.up.railway.app/api/shortform-stt?probe=transcribe-dry" \
  -H "Authorization: Bearer {token}" | python3 -m json.tool
```

Expected: segments + words 배열 반환

- [ ] **Step 4: 전체 관통 테스트**

브라우저에서 `ddukddaktool.co.kr/shortform.html` 접속:
1. 스크립트 생성 (아무 주제)
2. 음성 녹음 (30초 + 45초 각각 테스트)
3. STT + B-roll 실행
4. 렌더링 실행
5. MP4 다운로드

**성공 기준:**
- 30초 녹음 → 30초 MP4 (±2초)
- 45초 녹음 → 45초 MP4 (±2초)
- 자막이 음성과 싱크
- B-roll 배경 이미지/영상 표시

- [ ] **Step 5: 테스트 결과에 따라 추가 수정 또는 완료 커밋**

문제 없으면:
```bash
git commit --allow-empty -m "chore: 숏폼 영상 파이프라인 엔드투엔드 테스트 통과"
```

문제 있으면: 에러 로그 확인 후 해당 Task로 돌아가서 수정.
