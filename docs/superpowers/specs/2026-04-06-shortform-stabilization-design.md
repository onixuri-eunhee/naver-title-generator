# 숏폼 영상 파이프라인 디버깅 + 안정화 설계

> 날짜: 2026-04-06
> 목표: 숏폼 4단계 파이프라인(스크립트→음성→STT+B-roll→렌더링) 엔드투엔드 안정화

---

## 배경

숏폼 영상 파이프라인의 코드는 모두 작성되어 있으나, 엔드투엔드 테스트에서 렌더링 단계에서 실패하고 있다. Railway 서버는 정상 동작 중이며, STT(v6-word-timestamps), B-roll(v7-veo-hero-fallback), Remotion(v2-remotion-stt-sync) 모두 코드가 배포된 상태이다.

### 알려진 이슈
1. **Remotion 30초 고정 문제** — 영상이 항상 30초로 렌더링됨. `audioDurationSec`가 `estimatedSeconds` 폴백(기본 30초)으로 떨어지고 있을 가능성
2. **렌더링 실패 원인 불명** — 에러 메시지를 확인하지 못한 상태
3. **Seedance API Key 없음** — Veo 실패 시 영상 폴백 불가 (이미지로만 폴백)

---

## 아키텍처 (현재)

```
[shortform.html]
  ├─ POST /api/shortform-script (Vercel) → Claude Sonnet 4 → HPC JSON
  ├─ 음성 녹음/업로드 (브라우저)
  ├─ POST /api/shortform-stt (Vercel → Railway 프록시) → Whisper → segments+words
  ├─ POST /api/shortform-broll (Railway) → Veo 3.0 + Flux Realism → R2 URLs
  └─ POST /api/shortform-remotion-render (Railway) → Remotion + Chromium → MP4
```

---

## 디버깅 계획 (5단계 순서)

### Step 1: Railway /health 확인
- **상태:** 완료 (2026-04-06 확인)
- **결과:** STT OK, B-roll OK (Veo), Remotion v2, Seedance 없음

### Step 2: STT 단독 테스트
- Railway `/api/shortform-stt?probe=transcribe-dry` 호출
- 실제 오디오 파일로 word-level timestamps 반환 확인
- **성공 기준:** segments + words 배열 모두 반환, duration 정확

### Step 3: B-roll 단독 테스트
- Railway `/api/shortform-broll` 호출 (brollSuggestions 5개 전달)
- Flux Realism hero 이미지 1장 + Veo 영상 2개 생성 확인
- Veo 실패 시 → Seedance 폴백 불가 → 이미지 폴백 확인
- **성공 기준:** items 배열에 3개 이상, R2 URL 유효

### Step 4: Remotion 렌더링 단독 테스트 (핵심)
- 최소 inputProps로 Railway 렌더링 호출
- **30초 고정 문제 진단:**
  - `shortform.html`에서 `audioDurationSec` 전달 경로 추적
  - `server.js` → `renderShortformRemotion()` → `inputProps.audioDurationSec` 확인
  - `timeline.js`에서 `audioDurationSec || estimatedSeconds || 30` 폴백 체인 확인
- **에러 로그 수집:** Railway 로그에서 렌더링 에러 확인
- **성공 기준:** MP4 파일 생성, duration이 오디오 길이와 일치

### Step 5: 전체 관통 테스트
- shortform.html에서 스크립트 생성 → 음성 녹음 → STT+B-roll → 렌더링 → MP4 다운로드
- 각 단계 실패 시 에러 메시지가 사용자에게 표시되는지 확인
- **성공 기준:** 녹음한 음성 길이에 맞는 MP4 다운로드 완료

---

## 30초 고정 문제 — 예상 원인과 수정 방향

### 원인 후보
1. **shortform.html → server.js 전달 누락:** `audioDurationSec`가 렌더 요청 body에 포함되지 않음
2. **server.js → inputProps 매핑 누락:** `audioDurationSec`를 Remotion inputProps에 넣지 않음
3. **timeline.js 폴백:** `audioDurationSec`가 0이나 undefined → `estimatedSeconds || 30` 사용

### 수정 방향
- shortform.html에서 STT 완료 후 `duration` 값을 상태에 저장
- 렌더링 요청 시 `audioDurationSec: sttResult.duration` 포함
- server.js에서 `inputProps.audioDurationSec` 정확히 전달
- timeline.js에서 `audioDurationSec > 0` 일 때만 사용, 아니면 estimatedSeconds

---

## 수정 범위

| 파일 | 수정 내용 |
|------|----------|
| `shortform.html` | audioDurationSec 전달 경로 확인/수정 |
| `services/shortform-stt-service/server.js` | inputProps에 audioDurationSec 매핑 확인 |
| `remotion/shortform/timeline.js` | 30초 폴백 조건 확인 |
| `services/shortform-remotion-render.mjs` | 렌더링 에러 로깅 강화 |

---

## 성공 기준

1. 30초짜리 음성 녹음 → 30초짜리 MP4 출력
2. 45초짜리 음성 녹음 → 45초짜리 MP4 출력
3. MP4에 단어별 자막 싱크가 음성과 일치
4. B-roll 이미지/영상이 배경에 표시
5. MP4 다운로드 동작

---

## 비용 영향

| 항목 | 단가 | 숏폼 1회당 |
|------|------|----------|
| Claude Sonnet 4 (스크립트) | ~$0.05 | ~68원 |
| Whisper STT | ~$0.006/min | ~10원 (1분 기준) |
| Flux Realism (hero 1장) | ~$0.025 | ~34원 |
| Veo 3.0 (2개 클립) | ~$0.10 | ~137원 |
| Remotion 렌더링 (Railway) | ~$0 (Railway Pro 포함) | ~0원 |
| **합계** | | **~249원** |
| **판매가 (5cr)** | | **1,650원** |
| **마진** | | **~85%** |

---

## 제외 범위

- 롱폼 영상 (별도 프로젝트)
- Seedance API 연동 (Key 없음, Veo로 충분)
- UI/UX 개선 (이번 스프린트 아님)
- SNS 직접 발행 (MP4 다운로드만)
