# Phase F — 내 음성 업로드 (Voice Upload) 설계

**작성일**: 2026-04-19
**작성자**: 공은희 + Claude (brainstorming 세션)
**선행**: 2026-04-16-video-phase-a-bis-design.md ("Phase F(음성 업로드)·optimistic credit lock은 분리" 결정)
**참고**: [project_shortform_voice.md](../../../.claude/projects/-Users-gong-eunhui-Desktop-naver-title-generator/memory/project_shortform_voice.md) — 2026-04-08 TTS 정책 완화

## 배경 · 목적

뚝딱툴 숏폼은 현재 ElevenLabs TTS(eleven_multilingual_v2) 6종 보이스만 제공. 자영업자/인플루언서 중 "내 목소리로 영상 만들고 싶다"는 요구가 분명하고, 이번 Phase F에서 파일 업로드 플로우를 완성한다.

- **타겟 플로우**: AI 대본 생성 → 사용자가 직접 녹음 → mp3/m4a/wav/webm 업로드 → 싱크 맞춘 영상 생성
- **핵심 가치**: 개인 브랜드 일관성 (TTS 양산형 리스크 회피), 자영업자 신뢰도
- **범위 제외**: 브라우저 MediaRecorder 녹음 (품질 편차로 2026-04-08 제거 후 복원 안 함)

## 의사결정 기록 (브레인스토밍 Q&A)

| # | 질문 | 확정 |
|---|------|------|
| Q1 | 업로드 오디오의 단어 타임스탬프를 어떻게 뽑을지 | **A. OpenAI Whisper(whisper-1) 전사만 사용** — 실제 발화 기준 싱크가 ±50ms로 최고 정확. 대본과 애드립 차이는 실제 발화로 덮어씀. |
| Q2 | 크레딧 정책 | **동일 크레딧** (30초 7cr / 45초 10cr / 60초 14cr / 90초 18cr). ElevenLabs 비용 절감분(~$0.04)과 Whisper 비용(~$0.006) 차이 미미, 가격표 단순화 우선. |
| Q3 | UI 배치 | **A. 탭 방식** — Step 4 상단에 `TTS 음성 | 내 음성 업로드` 2탭. default=TTS. 업로드 상태(전사 중/에러) 전용 영역 확보. |
| Q4 | 업로드 오디오 길이 불일치 처리 | **A. 자동 맞춤** — 업로드 실제 길이로 `totalDuration` 덮어쓰기. scenes startTime/duration은 원본 비율 유지하며 scale 곱함. 30~100초 허용. |

## 아키텍처

기존 TTS 플로우와 **완전히 동일한 출력 shape**을 반환하는 대체 엔드포인트를 신설한다. Step 5~7은 코드 변경 없이 재사용.

```
[Step 4] ─┬─ TTS 탭 ──→ POST /api/shortform-tts (ElevenLabs with-timestamps)
         │                  └─→ { audioUrl, wordTimestamps, charAlignment, ... }
         │
         └─ 업로드 탭 ──→ POST /api/shortform-voice-upload (R2 + Whisper)
                            └─→ { audioUrl, wordTimestamps, charAlignment:null, totalDuration, remappedScenes }

                   ↓ [공통] setAudioUrl(data.audioUrl) + setScript(remap)
[Step 5] VisualAccent → [Step 6] Preview → [Step 7] Render/Caption
```

## 새 API — `POST /api/shortform-voice-upload`

### 요청 (multipart/form-data)

| 필드 | 타입 | 제약 |
|------|------|------|
| `audio` | File | mp3/m4a/wav/webm, ≤25MB, ≤100초 |
| `script` | string (JSON) | 현재 스크립트 — scenes 재분배 source |

### 처리 순서

1. **인증** — `extractToken` + `resolveSessionEmail`. 로그인 필수 (401).
2. **파일 검증**
   - MIME type 화이트리스트: `audio/mpeg`, `audio/mp4`, `audio/x-m4a`, `audio/wav`, `audio/webm`
   - 크기: `request.formData()` 후 `file.size ≤ 25 * 1024 * 1024`
   - 확장자 파싱 → R2 키 네이밍에 반영
3. **R2 업로드**
   - 키: `shortform-audio/{hashEmail}/upload-{timestamp}-{ext}.{ext}`
   - `uploadToR2(key, buffer, mimeType)` — 기존 lib/r2.js 재사용
   - 실패 시 즉시 502 반환, Whisper 호출 생략
4. **Whisper 전사** (OpenAI whisper-1)
   - 엔드포인트: `POST https://api.openai.com/v1/audio/transcriptions`
   - 파라미터:
     - `model=whisper-1`
     - `response_format=verbose_json`
     - `timestamp_granularities[]=word`
     - `language=ko`
   - 응답의 `duration`으로 실제 오디오 길이 확인 → 100초 초과 시 R2 delete + 400
   - 실패 시 R2 delete + 502
5. **wordTimestamps 변환**
   - Whisper `words: [{word, start, end}]` → ElevenLabs와 동일 shape 그대로
   - 빈 배열이면 경고 로그 + 업로드는 성공 처리 (자막 편집기에서 fallback)
6. **scenes 시간축 재분배** (아래 알고리즘)
7. **응답**

### 응답 shape

```json
{
  "audioUrl": "https://cdn.ddukddaktool.co.kr/shortform-audio/{hash}/upload-{ts}.mp3",
  "wordTimestamps": [{"word": "안녕", "start": 0.12, "end": 0.48}, ...],
  "charAlignment": null,
  "totalDuration": 52.3,
  "remappedScenes": [
    {"id": "hook", "script": "...", "startTime": 0, "duration": 3.2, ...},
    ...
  ],
  "provider": "whisper"
}
```

## Scene 시간축 재분배 알고리즘

업로드 오디오의 실제 duration에 맞춰 scene 시간을 비율 유지하며 scale.

```javascript
function remapScenesToAudio(scenes, oldTotalDuration, newTotalDuration) {
  const scale = newTotalDuration / oldTotalDuration;
  let cursor = 0;
  return scenes.map((scene, i) => {
    const duration = (scene.duration ?? 0) * scale;
    const remapped = {
      ...scene,
      startTime: cursor,
      duration: duration,
    };
    cursor += duration;
    return remapped;
  });
}
```

- **입력 보호**: `oldTotalDuration` 0/NaN이면 균등 분배 fallback (`newTotalDuration / scenes.length`)
- **단어 자막**: Whisper wordTimestamps를 그대로 사용 (scenes text와 독립)
- **Remotion 적용**: ShortformClient `playerProps` 계산 시 `remappedScenes`와 `totalDuration`을 script에 병합

## 클라이언트 변경 — Step 4 탭 UI

### State 추가 (ShortformClient.js)

```javascript
const [voiceMode, setVoiceMode] = useState('tts'); // 'tts' | 'upload'
const [uploadFile, setUploadFile] = useState(null);
const [uploadStatus, setUploadStatus] = useState('idle'); // 'idle'|'uploading'|'transcribing'|'done'|'error'
const [uploadError, setUploadError] = useState(null);
```

### UI 구조 (Step 4 음성 영역)

```
┌────────────────────────────────────────┐
│ 🎙 음성 선택                           │
│ ┌──────────────┬──────────────┐       │
│ │  TTS 음성    │ 내 음성 업로드 │ ← 탭  │
│ └──────────────┴──────────────┘       │
│                                        │
│ [TTS 탭 선택 시]                       │
│   - 기존 6 voice 그리드 + preview      │
│   - "3단계만 (TTS)" 버튼               │
│                                        │
│ [업로드 탭 선택 시]                    │
│   - 드롭존 + <input type="file">       │
│   - 선택 파일: 이름 + 길이 + 크기      │
│   - 길이 사전 검증 (브라우저 Audio)    │
│   - [전사 시작] 버튼                   │
│   - 진행 상태 표시                     │
│     - uploading: "업로드 중..."        │
│     - transcribing: "전사 중 (~30초)"  │
│     - done: 그대로 Step 5로 CTA        │
│     - error: 메시지 + 재시도 버튼      │
└────────────────────────────────────────┘
```

### 업로드 핸들러

```javascript
async function handleVoiceUpload() {
  if (!uploadFile || !script) return;
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
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `업로드 실패 (${res.status})`);
    }
    const data = await res.json();
    setAudioUrl(data.audioUrl);
    setScript({
      ...script,
      scenes: data.remappedScenes,
      totalDuration: data.totalDuration,
    });
    setUploadStatus('done');
  } catch (err) {
    setUploadStatus('error');
    setUploadError(err.message);
  }
}
```

### 브라우저 사전 길이 검증

```javascript
function validateAudioLength(file) {
  return new Promise((resolve, reject) => {
    const audio = new Audio(URL.createObjectURL(file));
    audio.onloadedmetadata = () => {
      URL.revokeObjectURL(audio.src);
      if (audio.duration > 100) {
        reject(new Error(`오디오가 너무 깁니다 (${audio.duration.toFixed(1)}초, 최대 100초)`));
      } else if (audio.duration < 5) {
        reject(new Error(`오디오가 너무 짧습니다 (${audio.duration.toFixed(1)}초, 최소 5초)`));
      } else {
        resolve(audio.duration);
      }
    };
    audio.onerror = () => reject(new Error('오디오 파일을 읽을 수 없어요'));
  });
}
```

## 에러 핸들링

| 상황 | HTTP | 메시지 | 정리 |
|------|------|--------|------|
| 비로그인 | 401 | "로그인이 필요합니다." | — |
| 파일 누락 | 400 | "audio 파일이 필요합니다" | — |
| MIME 불일치 | 400 | "mp3/m4a/wav/webm만 업로드 가능" | — |
| 크기 초과 | 400 | "25MB 이하 파일만" | — |
| 길이 초과 | 400 | "100초 이하 파일만" | R2 delete |
| 길이 과소 (<5초) | 400 | "5초 이상 파일만" | R2 delete |
| R2 업로드 실패 | 502 | "파일 저장 실패" | — |
| Whisper 호출 실패 | 502 | "전사 실패, 다시 시도" | R2 delete |
| Whisper 빈 결과 | 200 | (경고 로그) | — |
| `script` JSON 파싱 실패 | 400 | "script 데이터가 유효하지 않습니다" | — |

**R2 orphan 방지**: 전사 실패 시 `r2Delete(key)` 호출하는 헬퍼 추가 (lib/r2.js 미존재 시 신설).

## 크레딧 · 결제

- **업로드 API 자체는 크레딧 차감 없음** — 기존 TTS API와 동일 설계.
- **차감 시점**: Step 7 렌더 요청(`/api/shortform-render`)에서만 차감 — 이미 구현돼있음.
- **환불**: Step 7 실패 시 기존 `/api/shortform-refund` 경로 그대로.

## 환경변수

- `OPENAI_API_KEY` — **이미 존재** (GPT Image 1.5 레거시 코드에서 사용 중). 추가 설정 불필요.
- Whisper 호출은 OpenAI 직접 REST — `openai` SDK 없이 `fetch` 사용 (의존성 추가 피함).

## 테스트 계획

### 단위 테스트 (신규)
- `tests/unit/voice-upload-remap.test.js` — `remapScenesToAudio` 함수
  - 비율 유지 검증 (scale 계산)
  - oldTotalDuration=0 fallback
  - scenes 빈 배열
  - duration 합계가 newTotalDuration과 일치 (±0.01 tolerance)

### 통합 테스트 (신규)
- `tests/integration/voice-upload.test.js` — API 라우트
  - 비로그인 401
  - 잘못된 MIME → 400
  - Whisper 모킹 → 정상 응답 shape
  - Whisper 실패 → R2 delete 호출 검증

### E2E (수동 — 사용자)
1. 45초 대본 생성
2. 실제 녹음 (mp3, ~40초)
3. 업로드 → 전사 진행 확인
4. Step 5~7 정상 진행
5. 완성 영상에서 오디오 싱크 확인

## 구현 파일 목록

### 신규
- `app/api/shortform-voice-upload/route.js`
- `lib/shortform/voice-upload-remap.js` — `remapScenesToAudio` 순수 함수
- `lib/shortform/whisper.js` — Whisper 호출 + 응답 파싱
- `tests/unit/voice-upload-remap.test.js`
- `tests/integration/voice-upload.test.js`

### 수정
- `app/shortform/ShortformClient.js` — Step 4 UI에 탭 추가, voiceMode state, handleVoiceUpload
- `lib/r2.js` — `r2Delete(key)` 헬퍼 추가 (orphan cleanup용)
- `.env.example` — `OPENAI_API_KEY` 주석 (Phase F 사용 용도 명시)

## Rollout 계획

1. 로컬 구현 + 단위/통합 테스트 통과
2. Staging 배포 없이 Vercel Preview 브랜치 검증 (사용자 수동)
3. main 머지 → 프로덕션 자동 배포
4. Guide 페이지 업데이트 (별건 — 4/19 백로그 "#6 Guide 업데이트"에 포함)

## Out of scope (이번 배치 제외)

- **브라우저 MediaRecorder 녹음** — 2026-04-08 제거 정책 유지
- **B-roll 타이밍 재배치** — 현재는 scene 비율 유지 + B-roll 내부 타이밍 그대로 (필요 시 Phase G)
- **다국어 Whisper** — `language=ko` 고정
- **음성 클로닝(ElevenLabs voice cloning)** — 무료 플랜 미지원, 별도 Phase
- **긴 오디오 (100초+)** — 숏폼 max 90초 + 10초 여유만 허용
- **실시간 전사 진행률** — Whisper API는 스트리밍 미지원, "전사 중" 표시로 충분
- **optimistic credit lock** — Phase A-bis에서 분리 기록됨, 별도 Phase

## 참조

- [4/16 Phase A-bis 설계](./2026-04-16-video-phase-a-bis-design.md) — Phase F 분리 결정 근거
- [4/18 Async render 설계](./2026-04-18-async-render-design.md) — Step 7 렌더 파이프라인
- [OpenAI Whisper API](https://platform.openai.com/docs/api-reference/audio/createTranscription) — `verbose_json` + `word` timestamp_granularities
- [ElevenLabs with-timestamps](https://elevenlabs.io/docs/api-reference/text-to-speech-with-timestamps) — 기존 TTS 참조
