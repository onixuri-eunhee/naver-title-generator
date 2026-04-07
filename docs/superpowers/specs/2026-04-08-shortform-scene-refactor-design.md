# 숏폼 씬 기반 리팩토링 설계

**작성일**: 2026-04-08
**상태**: 승인 대기

---

## 배경

현재 숏폼 파이프라인은 대본(hook/points/cta)과 B-roll 이미지(brollSuggestions 12개 고정)가 분리되어 있어 씬↔대본 매핑이 없고, 스타일 일관성이 보장되지 않으며, 모든 사용자 영상이 유사한 패턴으로 출력됨.

## 목표

1. 씬↔대본 1:1 매핑으로 몰입감 향상
2. 컨셉 4종으로 다양한 영상 스타일 제공
3. 텍스트 카드 도입으로 비용 절감 + 편집 리듬 개선
4. ElevenLabs TTS + 파일 업로드로 음성 퀄리티 향상 (녹음 제거)

---

## 1. JSON 스키마 변경

### 현재

```json
{
  "hook": "string",
  "points": ["string", "string", "string"],
  "cta": "string",
  "brollSuggestions": ["string x12"]
}
```

### 변경 후

```json
{
  "visualStyle": "warm cinematic, golden hour lighting, shallow depth of field",
  "scenes": [
    {
      "script": "대본 문장 (한국어)",
      "section": "hook | point | cta",
      "type": "broll | text",
      "visual": "broll이면 영어 이미지 설명 / text면 화면 표시 문구 (한국어)"
    }
  ]
}
```

- `visualStyle`: AI가 생성하지만 서버가 컨셉별 값으로 강제 교체
- `section`: HPC 추적용
- `type`: AI 자율 판단, 서버 후처리로 보정
- `visual`: broll은 Imagen 3 프롬프트로 사용, text는 Remotion 텍스트 카드에 렌더링

## 2. 씬 수 (영상 길이별)

| 길이 | 씬 수 | 초/씬 |
|------|-------|-------|
| 30초 | 7 | ~4.3초 |
| 45초 | 10 | 4.5초 |
| 60초 | 14 | ~4.3초 |
| 90초 | 20 | 4.5초 |

## 3. 컨셉 4종 + 랜덤

### 3-1. 컨셉별 visualStyle

```js
const CONCEPTS = {
  cinematic: {
    visualStyle: "warm cinematic, golden hour lighting, shallow depth of field, film grain",
    textCard: "dark-gradient"
  },
  minimal: {
    visualStyle: "clean minimal, white background, soft shadows, modern aesthetic",
    textCard: "white-clean"
  },
  dynamic: {
    visualStyle: "vibrant colors, high contrast, bold composition, urban energy",
    textCard: "bold-accent"
  },
  natural: {
    visualStyle: "natural daylight, candid feel, organic textures, everyday life",
    textCard: "soft-overlay"
  }
}
```

- `random`: 서버가 4종 중 랜덤 선택
- AI의 visualStyle은 무시하고 컨셉 값으로 교체

### 3-2. 텍스트 카드 디자인 4종

| 컨셉 | 템플릿 | 배경 | 텍스트 | 애니메이션 |
|------|--------|------|--------|-----------|
| cinematic | dark-gradient | #1a1a2e → #16213e → #0f3460 | 흰색 Bold | fade-in + 위로 슬라이드 |
| minimal | white-clean | #fafafa | 검정 + 밑줄 액센트 | 타이핑 효과 |
| dynamic | bold-accent | #222 | 오렌지(#ff5f1f) + 흰색 | 스케일 바운스 |
| natural | soft-overlay | #f5f0e8 → #e8e0d0 | 다크브라운 세리프 | 서서히 fade-in |

공통: 9:16(1080x1920), 텍스트 최대 15자(초과 시 2줄), Remotion `<Sequence>` 컴포넌트

## 4. 서버 후처리 규칙

AI 재호출 없이 코드만으로 처리:

1. **텍스트 카드 비율 보정**
   - 20% 미만 → point 시작 씬 중 하나를 text로 변경
   - 40% 초과 → 초과분을 broll로 변경

2. **3연속 같은 type 방지**
   - 같은 type 3연속 감지 시 가운데를 반대 type으로 변경
   - broll→text 변경 시: script에서 핵심 키워드 추출하여 visual 생성
   - text→broll 변경 시: script를 영어 번역하여 generic B-roll 설명 생성

3. **씬 수 보정**
   - 목표보다 적으면: 긴 문장(40자+)을 2개 씬으로 분할
   - 목표보다 많으면: 짧은 연속 씬(15자 미만) 병합

4. **visualStyle 강제 주입**
   - AI가 생성한 visualStyle 무시, 선택된 컨셉의 기본값으로 교체

## 5. B-roll 프롬프트 구조

### 변경 전 (buildVisualPrompt)

```
{suggestion}
Create a cinematic vertical 9:16 still image...
Story context: {scriptContext}
```

### 변경 후

```
{scene.visual}
Vertical 9:16 still image for short-form video. No on-screen text.
Style: {concept.visualStyle}
```

- scriptContext 제거 (각 씬이 이미 대본과 매핑되어 있으므로 불필요)
- visualStyle로 스타일 일관성 확보
- 프롬프트 길이 단축 → 토큰 절약

## 6. 음성 파이프라인 변경

### 현재

```
브라우저 녹음 (MediaRecorder) → WAV 업로드 → STT (Whisper) → 자막 싱크
```

### 변경 후

```
음성 입력 선택:
  ① ElevenLabs TTS 자동 생성 (기본)
  ② 음성 파일 업로드 (mp3/wav/m4a)

→ 어느 쪽이든 → STT (Whisper) → 자막 싱크
```

### ElevenLabs TTS 설정

- 모델: `eleven_multilingual_v2` (한국어 지원)
- 기본 음성: `nova` (추후 음성 선택 UI 추가 가능)
- API: `POST /v1/text-to-speech/{voice_id}`
- 환경변수: `ELEVENLABS_API_KEY` (Vercel에 추가 필요)
- 비용: 무료 1만자/월 → 약 66개 숏폼/월 (초기 충분)

### 프론트엔드 UI

```
녹음 버튼 제거 →

┌─────────────────────────┐
│  음성 선택               │
│  ○ TTS 자동 생성 (기본)  │
│    └ 음성: [기본 ▼]      │
│  ○ 내 음성 파일 업로드    │
│    └ [파일 선택]          │
└─────────────────────────┘
```

### 기존 정책 변경

- 기존: "TTS 금지, 실제 음성만"
- 변경: "ElevenLabs TTS 허용 + 음성 파일 업로드 허용, 브라우저 녹음 제거"

## 7. 데이터 흐름

```
[프론트] 사용자 입력
  ├─ topic / blogText
  ├─ tone (casual / professional)
  ├─ targetDuration (30/45/60/90)
  ├─ concept (cinematic/minimal/dynamic/natural/random)  ← 신규
  └─ voiceMode (tts / upload) + voiceFile?               ← 신규
         │
         ▼
[shortform-script.js] Claude API → scenes 생성 → 서버 후처리 보정
         │
         ▼
[shortform-broll-core.js] type:"broll" 씬만 자산 생성
  ├─ Imagen 3 이미지 (visual + visualStyle)
  └─ 영상 슬롯 → Veo i2v 변환
         │
         ▼
[shortform-tts.js] 음성 생성 ← 신규
  ├─ TTS → ElevenLabs API → mp3
  └─ 업로드 → 그대로 사용
         │
         ▼
[shortform-stt.js] Whisper STT → 워드 레벨 타임스탬프
         │
         ▼
[shortform.html → Remotion] 영상 조립
  ├─ broll 씬 → 이미지/영상 + Ken Burns
  ├─ text 씬 → 컨셉별 텍스트 카드 렌더링
  └─ 자막 오버레이 (STT 싱크)
```

## 8. 에러 처리

| 실패 지점 | 처리 |
|----------|------|
| Claude 대본 생성 | 크레딧 자동 환불 (기존 유지) |
| 서버 후처리 씬 부족 (3개 미만) | 폴백: 기존 brollSuggestions 방식 |
| ElevenLabs TTS | "음성 파일을 직접 업로드해주세요" 안내. 환불 안 함 (대본+자산 생성 완료) |
| Imagen 3 / Veo i2v | 기존 폴백 유지 (이미지 → Ken Burns) |
| 텍스트 카드 | 실패 불가 (Remotion 로컬 렌더링) |

## 9. 변경 파일 목록

| 파일 | 변경 내용 |
|------|----------|
| `api/shortform-script.js` | SYSTEM_PROMPT scenes 스키마 + 후처리 로직 + 컨셉 상수 |
| `services/shortform-broll-core.js` | buildVisualPrompt 변경 + text 씬 스킵 + scenes 입력 처리 |
| `api/shortform-tts.js` | 신규 — ElevenLabs TTS API |
| `api/shortform-stt.js` | 녹음 관련 코드 정리 |
| `shortform.html` | 컨셉 선택 UI + 음성 선택 UI + 녹음 제거 + scenes 렌더링 |
| `remotion/` | 텍스트 카드 컴포넌트 4종 추가 |
| `vercel.json` | shortform-tts 라우트 추가 |

## 10. 테스트 시나리오

1. 30초 cinematic + TTS
2. 60초 minimal + 파일 업로드
3. 90초 random + TTS
4. 후처리 보정 검증 (텍스트 카드 비율, 3연속 방지)
