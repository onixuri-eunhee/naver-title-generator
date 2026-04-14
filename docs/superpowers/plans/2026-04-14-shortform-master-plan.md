# 숏폼 벤치마킹 파이프라인 — 마스터 플랜

> **For agentic workers:** 이 마스터 플랜은 12 Phase의 의존 관계, 실행 순서, 각 Phase의 범위를 정의합니다. 실제 task별 실행은 각 Phase 상세 플랜 파일을 참고하세요.

**Goal:** 자영업자가 키워드/블로그 글 + 본인 정체성 입력 → YouTube 벤치마킹 → Gemini 패턴 분석 → Claude 대본 → Remotion 영상 + 캡션까지 자동 생성하는 통합 파이프라인 구축. 브랜드 킷·프로젝트 히스토리·SSE 진행 표시·YouTube 직접 업로드까지 SaaS 완성도 갖추기.

**Architecture:** 단계형 UI(Step 1~7) + 키워드 확장 5쿼리 병렬 검색 + Gemini Vertex AI Pro thinking 영상 분석 + Claude Opus 페르소나 대본 + Remotion 키네틱 메인 + 사진 액센트. 기존 카드뉴스 Phase 3(내 이미지 보관함)와 기존 `/api/shortform-benchmark` 인프라 재활용.

**Tech Stack:** Next.js 15 App Router, Neon PostgreSQL, Cloudflare R2, YouTube Data API v3, Gemini Vertex AI (Pro thinking), Claude Opus, ElevenLabs/Supertone TTS, Remotion, react-easy-crop (재활용), SSE

**Spec:** `/Users/gong-eunhui/Desktop/naver-title-generator/docs/superpowers/specs/2026-04-14-shortform-benchmark-pipeline-design.md`

---

## 코드 탐색 결과 (재사용 가능 자산)

구현 시작 전 발견된 기존 자산:

| 자산 | 위치 | 상태 | 활용 |
|---|---|---|---|
| YouTube 검색 + 비율 필터 + Claude 분석 + Redis 캐싱 | `app/api/shortform-benchmark/route.js` (282줄) | ✅ 작동 중 | 5x 비율 + 키워드 확장 + Gemini 전환으로 enhance |
| 숏폼 대본 생성 + 벤치마크 통합 | `app/api/shortform-script/route.js` (491줄) | ✅ 작동 중 | 페르소나 + 톤 + Gemini JSON 입력 추가 |
| 숏폼 클라이언트 UI | `app/shortform/ShortformClient.js` (486줄) | ✅ 작동 중 | 단계형 UI 재구조화 |
| 내 이미지 보관함 (DB + R2 + API) | `lib/user-images.js`, `app/api/my-images/*` | ✅ 어제 구현 완료 | Step 5에서 그대로 재사용 |
| ImagePickerModal 공용 컴포넌트 | `components/ImagePickerModal.js` (515줄) | ✅ 어제 구현 완료 | Step 5에서 그대로 재사용 |
| Threads OAuth 패턴 | `app/api/threads-auth/route.js` | ✅ 작동 중 | YouTube OAuth 구현 시 패턴 복사 |
| Remotion 키네틱 프리셋 10종 | `remotion/shortform/` | ✅ 4/14 리브랜딩 완료 | Phase 2 효과 풀의 베이스 |
| TTS (Google/Supertone/ElevenLabs) | `app/api/shortform-tts/route.js` | ✅ 작동 중 | 그대로 재사용 |

**구현 작업량 재추정:** 6~8주 → **4~5주** (기존 자산 70% 재활용)

---

## Phase 의존 관계 그래프

```
[A. Foundation: UI 동선 + Step 1 입력]
        │
        ├──→ [B. Benchmarking: 키워드 확장 + 5쿼리 + Gemini]
        │        │
        │        └──→ [D. Script: Claude 페르소나 대본 + 캡션]
        │                  │
        ├──→ [C. Project Model: shortform_projects DB + auto-save]
        │                  │
        ├──→ [E. Image Library: Step 5 사진 액센트]
        │                  │
        │                  └──→ [F. Preview UI: Step 6 미리보기 + 프리셋 + 자막 커스터마이징]
        │                              │
        ├──→ [G. Brand Kit: 마이페이지 섹션 + DB + 자동 적용]──┐
        │                                                       │
        ├──→ [H. Project History: drafts + published UI]───────┤
        │                                                       │
        ├──→ [I. SSE Progress: 실시간 진행 표시 + 취소]─────────┤
        │                                                       │
        ├──→ [J. YouTube Upload: OAuth + Direct upload]─────────┤
        │                                                       │
        ├──→ [K. Onboarding: 샘플 4종 + 첫 영상 무료]────────────┤
        │                                                       │
        └──→ [L. Validation: 회귀 + 메모리 + 도그푸드]←─────────┘
```

### 의존성 분류

| 분류 | Phase | 시작 가능 시점 |
|---|---|---|
| **독립 (1주차 시작 가능)** | A, C, G, H, J, K | 즉시 |
| **B에 의존** | D (대본은 벤치마크 결과 필요) | B 1주 진행 후 |
| **B + D에 의존** | I (SSE 진행 표시는 양쪽 모두 사용) | B/D 시작 후 |
| **D + E에 의존** | F (미리보기는 대본 + 이미지 모두 필요) | D/E 완료 후 |
| **모두 끝난 후** | L (회귀 + 도그푸드) | 최종 |

### 병렬 실행 가능 (최대 7 worktree)

1주차 시작 가능: **A, C, G, H, J, K, B** = 7 Phase 동시
2주차 합류: **D, E, I**
3주차 합류: **F**
4주차: **L**

---

## Phase 요약

### Phase A — Foundation (UI 동선 + Step 1 입력)

**상세:** `2026-04-14-shortform-phase-a-foundation.md`

**범위:**
- ShortformClient.js를 단계형(Step 1~7)으로 재구조화
- "전체 자동 생성" 버튼을 페이지 맨 아래로 이동 + 작은 보조 버튼화
- Step 1 입력 폼: 블로그 글 / 키워드 / 경험·느낌 / 페르소나(5종+직접입력) / 톤(2택) / 길이(4택)
- 단계 진행 표시 컴포넌트 (`<StepProgress />`) — Step 1~7 시각적 표시
- 단계 간 이동 (다음/이전 버튼)
- 입력 검증

**파일:**
- Modify: `app/shortform/ShortformClient.js` (대규모 재구조화)
- Modify: `app/shortform/page.module.css` (단계형 CSS 추가)
- Create: `components/StepProgress.js` (재사용 가능 단계 표시 컴포넌트)
- Create: `components/StepProgress.module.css`

**예상 작업량:** 약 8 task, 1 주

**의존성:** 없음 (1주차 즉시 시작 가능)

---

### Phase B — Benchmarking (키워드 확장 + 5쿼리 병렬 검색 + Gemini Pro thinking)

**상세:** `2026-04-14-shortform-phase-b-benchmarking.md`

**범위:**
- 기존 `/api/shortform-benchmark/route.js`을 enhance:
  - 단일 키워드 → **5개 키워드 확장** (Gemini Flash로 메인/관련/트렌드 추출)
  - 5개 검색 쿼리 **병렬 실행**
  - dedupe + 5x 비율 필터 (현재 10x → 5x)
  - 결과 5개로 제한 + viewToSubRatio 정렬
- 새 엔드포인트 `/api/shortform-benchmark/analyze` 추가:
  - Vertex AI Gemini Pro thinking으로 1~3개 영상 깊은 분석
  - JSON Schema 검증
  - `bench:analyze:{videoId}` 캐싱 30일
- 기존 Claude 패턴 분석 → Gemini Pro thinking으로 교체
- YouTube Data API 쿼터 상향 신청 (운영자 작업)

**파일:**
- Modify: `app/api/shortform-benchmark/route.js` (큰 폭 enhance)
- Create: `app/api/shortform-benchmark/analyze/route.js` (신규)
- Create: `lib/gemini-vertex.js` (Vertex AI 호출 헬퍼)
- Create: `lib/youtube-search.js` (YouTube Data API 헬퍼, 검색/통계/채널 통합)
- Create: `lib/keyword-expansion.js` (Gemini Flash 키워드 추출)

**예상 작업량:** 약 12 task, 1.5 주

**의존성:** 없음 (1주차 즉시 시작 가능)

**상태:** ✅ 완료 (2026-04-14, 마지막 커밋 `825ed2e`)

---

### Phase C — Project Model (shortform_projects DB + auto-save)

**상세:** `2026-04-14-shortform-phase-c-project-model.md`

**범위:**
- `shortform_projects` 테이블 자동 마이그레이션 (`ensureSchema` 패턴, 카드뉴스 Phase 3와 동일)
- 신규 API:
  - `POST /api/shortform-projects` — draft 생성
  - `GET /api/shortform-projects` — 목록 조회
  - `GET /api/shortform-projects/[id]` — 단일 조회
  - `PATCH /api/shortform-projects/[id]` — auto-save 업데이트
  - `POST /api/shortform-projects/[id]/publish` — 완성 처리
  - `POST /api/shortform-projects/[id]/duplicate` — 복제
  - `DELETE /api/shortform-projects/[id]`
- 클라이언트 자동 저장 훅 (`useProjectAutoSave`)
- 단계 변경 시 PATCH 호출

**파일:**
- Create: `lib/shortform-projects.js` (DB 헬퍼 + ensureSchema)
- Create: `app/api/shortform-projects/route.js` (POST + GET)
- Create: `app/api/shortform-projects/[id]/route.js` (GET + PATCH + DELETE)
- Create: `app/api/shortform-projects/[id]/publish/route.js`
- Create: `app/api/shortform-projects/[id]/duplicate/route.js`
- Create: `app/shortform/hooks/useProjectAutoSave.js`

**예상 작업량:** 약 10 task, 1 주

**의존성:** 없음 (1주차 즉시 시작 가능)

---

### Phase D — Script Generation (Claude 페르소나 대본 + 캡션)

**상세:** `2026-04-14-shortform-phase-d-script.md`

**범위:**
- 기존 `app/api/shortform-script/route.js` enhance:
  - 입력에 `persona`, `tone`, `userExperience`, `benchmarkAggregated` 필드 추가
  - 시스템 프롬프트에 페르소나 1인칭 + 이모지 금지 hard rule
  - 사용자 메시지에 Gemini 분석 JSON 통합
  - 출력 JSON에 캡션 필드 추가 (벤치마킹 패턴 적용)
- 캡션 생성 (대본과 같은 컨텍스트로 별도 호출 또는 단일 호출 두 출력)
- 후처리 검증: 이모지 자동 제거, 일반론 표현 검출 경고

**파일:**
- Modify: `app/api/shortform-script/route.js` (시스템 프롬프트 + 입력 스키마 확장)
- Create: `lib/script-prompts.js` (페르소나별 프롬프트 템플릿 + hard rules)
- Create: `lib/script-validator.js` (이모지 검출, 일반론 표현 검출)

**예상 작업량:** 약 10 task, 1.5 주

**의존성:** Phase B (Gemini 분석 JSON 형식 확정 후 시작)

**상태:** ✅ 완료 (커밋 SHA: 9b3aa1c) — lib/script-prompts.js + script-validator.js + script-flow.js 추가, route.js 에 personaId 분기. 레거시 경로(personaMemo) 유지. Phase B aggregated JSON과 Phase G brand-kit 연결 완료.

---

### Phase E — Image Library Connection (Step 5 사진 액센트)

**상세:** `2026-04-14-shortform-phase-e-image-library.md`

**범위:**
- Step 5 UI 추가: 내 사진 보관함에서 0~3장 선택 + AI 이미지 0~2장 옵션
- 기존 `<ImagePickerModal>` 재사용 (카드뉴스 Phase 3 자산)
- AI 이미지 생성: 기존 FLUX Schnell 파이프라인 재사용
- 선택된 이미지를 shortform_projects.user_image_ids에 저장
- 생성 단계에서 Remotion에 이미지 URL 배열 전달

**파일:**
- Modify: `app/shortform/ShortformClient.js` (Step 5 컴포넌트 추가)
- Create: `app/shortform/components/Step5VisualAccent.js`
- Modify: `app/api/shortform-script/route.js` (userImageIds 받기)
- Modify: 영상 렌더링 로직 (이미지 URL을 Remotion props에 전달)

**예상 작업량:** 약 8 task, 1 주

**의존성:** 없음 (1주차 즉시 시작 가능, 자산 재활용)

**상태:** ✅ 완료 — Step5VisualAccent 신설 + ImagePickerModal showModeSelector prop + scriptToProps 이미지 우선순위 병합 + 임시 점프 버튼. Phase D 머지 시 점프 버튼 제거 예정.

---

### Phase F — Preview + Customization (Step 6 미리보기 + 프리셋 + 자막)

**상세:** `2026-04-14-shortform-phase-f-preview.md`

**범위:**
- Step 6 UI: Remotion Player 실시간 미리보기
- 진입 시 벤치마킹 결과의 `recommendedPreset` 자동 추천
- 프리셋 6종 선택 (전문가/친근/임팩트/차분/트렌디/비즈니스)
- 세부 조정 모드: 텍스트 위치/카메라 모션/씬 전환/자막 폰트/색/크기 슬라이더/배경색
- 액센트 위치 조정 (사진 드래그)
- 모든 변경 즉시 미리보기 반영

**파일:**
- Create: `app/shortform/components/Step6Preview.js`
- Create: `app/shortform/components/PresetPicker.js`
- Create: `app/shortform/components/SubtitleCustomizer.js`
- Create: `lib/shortform-presets.js` (프리셋 6종 정의)
- Modify: `remotion/shortform/ShortformComposition.jsx` (props 확장)

**예상 작업량:** 약 14 task, 2 주

**의존성:** Phase D (대본) + Phase E (이미지)

**상태:** ✅ 완료 — lib/shortform-presets.js + PresetPicker/SubtitleCustomizer/RecommendationBanner/Step6Preview + Remotion Composition subtitle/textPosition/cameraMotion/sceneTransition props 확장 + Scene/KenBurnsImage props 수용 + ShortformClient Step 6 통합 + scriptToProps sceneImageOrder. F10 (Genkit AI 자막 추천) P1로 스킵. benchmarkAggregated는 Phase B 머지 시 wire-up 예정.

---

### Phase G — Brand Kit (마이페이지 섹션 + 자동 적용)

**상세:** `2026-04-14-shortform-phase-g-brand-kit.md`

**범위:**
- `brand_kits` 테이블 자동 마이그레이션
- API: `GET/POST/DELETE /api/brand-kit`
- 마이페이지에 "내 브랜드 킷" 섹션 (내 이미지 옆)
- 입력 폼: 가게명/슬로건/로고/메인색/서브색/폰트/시그니처 멘트/연락처
- 통합 지점:
  - Step 3 대본: 시그니처 인사·클로징·CTA를 Claude 프롬프트에 전달
  - Step 6 미리보기: primary_color를 자막·키네틱 액센트에 적용
  - Step 7 캡션: 위치/영업시간/연락처 자동 삽입

**파일:**
- Create: `lib/brand-kit.js` (DB 헬퍼 + ensureSchema)
- Create: `app/api/brand-kit/route.js`
- Create: `app/mypage/BrandKitSection.js`
- Create: `app/mypage/BrandKitSection.module.css`
- Modify: `app/mypage/MyPageClient.js` (섹션 추가)
- Modify: `app/api/shortform-script/route.js` (brand_kit 데이터 통합)

**예상 작업량:** 약 12 task, 1 주

**의존성:** 없음 (1주차 즉시 시작 가능)

---

### Phase H — Project History (drafts + published UI)

**상세:** `2026-04-14-shortform-phase-h-history.md`

**범위:**
- 마이페이지에 "내 영상" 섹션 (브랜드 킷 옆)
- Drafts (작업 중) 목록 + 이어서 작업 버튼
- Published (완성) 목록 + 다운로드 + 복제 + YouTube 업로드 버튼
- Phase C의 `shortform_projects` API 활용

**파일:**
- Create: `app/mypage/ShortformProjectsSection.js`
- Create: `app/mypage/ShortformProjectsSection.module.css`
- Modify: `app/mypage/MyPageClient.js` (섹션 추가)

**예상 작업량:** 약 6 task, 4 일

**의존성:** Phase C (shortform_projects API)

**상태:** ✅ 완료 (커밋 SHA: c3455c7)

---

### Phase I — SSE Progress + Cancel (실시간 진행 표시)

**상세:** `2026-04-14-shortform-phase-i-sse-progress.md`

**범위:**
- SSE 엔드포인트 `/api/shortform-progress?jobId=xxx`
- 백엔드: 단계별 진행 상태를 Redis pub/sub로 전달
- 클라이언트: SSE 구독 + 진행률 UI
- 취소 처리: `POST /api/shortform-cancel?jobId=xxx`
- 크레딧 환불 정책 (Step 7 진입 전까지 100%)
- 백그라운드 모드: 브라우저 닫혀도 작업 계속

**파일:**
- Create: `lib/job-progress.js` (Redis pub/sub 헬퍼)
- Create: `app/api/shortform-progress/route.js` (SSE)
- Create: `app/api/shortform-cancel/route.js`
- Create: `app/shortform/hooks/useJobProgress.js`
- Create: `components/ProgressIndicator.js`
- Modify: `app/api/shortform-benchmark/*` (진행 상태 발행)
- Modify: `app/api/shortform-script/route.js` (진행 상태 발행)

**예상 작업량:** 약 12 task, 1.5 주

**의존성:** Phase B + D (진행 발행 지점이 있어야 함)

---

### Phase J — YouTube Direct Upload (OAuth + 업로드)

**상세:** `2026-04-14-shortform-phase-j-youtube-upload.md`

**범위:**
- Google OAuth 2.0 (YouTube Data API v3 scope)
- API:
  - `POST /api/youtube-auth?action=authorize`
  - `GET /api/youtube-auth?action=callback`
  - `POST /api/youtube-auth?action=disconnect`
  - `GET /api/youtube-auth?action=status`
  - `POST /api/youtube-upload`
- `youtube_connections` 테이블 (refresh_token 암호화 저장)
- 마이페이지에 "YouTube 계정" 섹션
- Step 7 다운로드 화면에 "YouTube에 바로 업로드" 버튼
- Resumable upload (60s 함수 timeout 회피)

**파일:**
- Create: `lib/youtube-oauth.js`
- Create: `app/api/youtube-auth/route.js` (Threads 패턴 복사)
- Create: `app/api/youtube-upload/route.js`
- Create: `app/mypage/YouTubeSection.js`
- Modify: `app/mypage/MyPageClient.js`
- Modify: `app/shortform/ShortformClient.js` (Step 7에 업로드 버튼)

**예상 작업량:** 약 12 task, 1.5 주

**의존성:** 없음 (1주차 즉시 시작 가능, Threads 패턴 재활용)

---

### Phase K — Onboarding Wizard (샘플 4종 + 첫 영상 무료)

**상태:** ✅ 완료 (2026-04-14, worktree feat/shortform-v2 기준)

**상세:** `2026-04-14-shortform-phase-k-onboarding.md`

**완료 요약:**
- `lib/shortform-samples.js` 샘플 4종 (매장 사장·강사·컨설턴트·블로거)
- `app/shortform/components/OnboardingModal.js/.module.css` 첫 방문 모달
- `lib/shortform-onboarding.js` users 컬럼 lazy migration + 무료 자격 헬퍼
  (K3 파일명을 플랜의 `onboarding-helpers` 대신 에이전트 영역 구분을
  위해 `shortform-onboarding` 으로 채택)
- `/api/auth?action=me` 에 onboardingCompleted / firstShortformAt /
  eligibleForFreeFirstShortform 필드 추가
- `/api/auth/onboarding` POST 엔드포인트 (완료 표시)
- `ShortformClient` 에 모달 마운트 + 무료 배너 + 샘플 pre-fill +
  freeFirstApplied 응답 처리
- `/api/shortform-script` 의 크레딧 차감 skip + markFirstShortform
  호출은 Agent D 담당. 현재는 `lib/shortform-onboarding.js` 에
  `checkFreeFirstShortform` 헬퍼를 문서화된 사용 패턴과 함께 제공해둠.
  post-merge 통합 시점에 D 가 wire-up 예정.

**범위:**
- 첫 방문 모달 ("샘플로 시작" / "직접 입력")
- 샘플 4종 (매장 사장 / 강사 / 컨설턴트 / 블로거)
- 각 샘플: 미리 채워진 블로그 글 + 경험·느낌 + 페르소나/톤
- 신규 사용자 첫 영상 무료 (가입 후 7일 이내)
- `users` 테이블에 `onboarding_completed`, `first_shortform_at` 컬럼 추가

**파일:**
- Create: `app/shortform/components/OnboardingModal.js`
- Create: `lib/shortform-samples.js` (샘플 4종 데이터)
- Modify: `app/api/shortform-script/route.js` (첫 영상 무료 로직)
- Modify: 마이그레이션: `users` 테이블 컬럼 추가

**예상 작업량:** 약 8 task, 1 주

**의존성:** 없음 (1주차 즉시 시작 가능)

---

### Phase L — Validation (회귀 + 메모리 + 도그푸드)

**상세:** `2026-04-14-shortform-phase-l-validation.md`

**범위:**
- 모든 Phase 통합 후 회귀 시나리오 수동 확인
  - 기존 숏폼 사용자가 영향 없는지
  - 폴백 모드 (벤치마킹 없이) 정상 작동
  - 브랜드 킷 + 프로젝트 히스토리 + SSE + YouTube 업로드 연쇄 작동
  - 신규 사용자 온보딩 → 첫 영상 60초 안에 완성
- 운영자 도그푸드: 본인 사업(웨딩플래너)으로 5편 만들어 SNS에 게시
- 메모리 업데이트:
  - `MEMORY.md`에 신규 세션 entry
  - `project_shortform_v2.md` (이번 작업 요약)
  - `project_shortform_voice.md`, `project_shortform_todo.md` 업데이트

**파일:**
- 회귀 테스트 결과 문서: `docs/test-results/2026-04-XX-shortform-v2-regression.md`
- 메모리 파일들

**예상 작업량:** 약 6 task, 1 주

**의존성:** 모든 Phase 완료 후

---

## 실행 순서 (병렬 최적화)

```
Week 1 — 7 Phase 병렬 시작 (worktree 7개)
├ A. Foundation        ←─ 독립
├ B. Benchmarking     ←─ 독립
├ C. Project Model    ←─ 독립
├ E. Image Library    ←─ 독립 (자산 재활용)
├ G. Brand Kit        ←─ 독립
├ H. Project History  ←─ 독립 (Phase C와 인터페이스만 합의)
├ J. YouTube Upload   ←─ 독립 (Threads 패턴 재활용)

Week 2 — 의존 Phase 합류
├ D. Script           ←─ Phase B 1주 후
├ I. SSE Progress     ←─ Phase B/D 시작 후
├ K. Onboarding       ←─ Phase A/D 1주 후

Week 3 — 통합 Phase
└ F. Preview          ←─ Phase D + E 완료 후

Week 4 — 통합 검증
└ L. Validation       ←─ 모두 완료 후
```

총 4~5주 (병렬 가정).

---

## 기존 자산 재활용 매핑

각 Phase가 어떤 기존 자산을 재활용하는지:

| Phase | 재활용 자산 | 절감 효과 |
|---|---|---|
| A | shortform/ShortformClient.js (486줄) | 처음부터 짜는 대신 enhance |
| B | shortform-benchmark/route.js (282줄) + Redis 캐싱 | 70% 감소 |
| C | 카드뉴스 Phase 3 ensureSchema 패턴 | DB 마이그레이션 패턴 복사 |
| D | shortform-script/route.js (491줄) + 기존 fetchBenchmark() | 60% 감소 |
| E | ImagePickerModal + my-images API (어제 구현 완료) | 100% 재사용 |
| F | Remotion 키네틱 프리셋 10종 + Player 컴포넌트 | 베이스 그대로 |
| G | 카드뉴스 Phase 3 마이페이지 섹션 패턴 | UI 패턴 복사 |
| H | 카드뉴스 Phase 3 보관함 UI 패턴 | UI 패턴 복사 |
| I | shortform-tts에 진행 상태 발행 추가 (기존 동작 유지) | 기존 코드 enhance |
| J | threads-auth/route.js (OAuth 패턴) | 패턴 복사 |
| K | 기존 가입/세션 시스템 | 컬럼 1~2개만 추가 |
| L | 회귀 시나리오 수동 진행 | 시간 투자만 |

---

## 🚨 Deep Research 주요 발견 (2026-04-14 검증 완료)

### 1. Gemini Vertex AI 모델 — 확정
- **Model ID: `gemini-2.5-pro`** (Vertex AI)
- 사고 모드는 기본 탑재, `thinkingConfig.thinkingBudget` 파라미터로 제어
- 가격: Input $1.25/1M (≤200K ctx), Output $10/1M (사고 토큰 포함)
- YouTube URL 직접 분석 가능 (`fileData.fileUri` 파라미터 사용)
- 한국어 품질 ★★★★★
- → 스펙에 적힌 "최상위 모델 결정" 부분 `gemini-2.5-pro`로 확정

### 2. YouTube Data API 쿼터 — 출시 일정 영향 ⚠️
- 무료 쿼터 10,000 units/day는 그대로
- 쿼터 상향 신청 절차: Cloud Console → YouTube API Audit Form
- **승인 소요 4~8주, 작은 무명 앱은 거절률 높음**
- 승인되어도 **첫 그랜트는 보통 50K~100K** (1M은 드물게 트래픽 입증된 앱만)
- → **출시 8주 전 신청 필수**. 4/25 출시 시 2월 중순에 신청했어야 함. 이미 늦음.
- **현실적 대응:** 4/25 출시 강행 시 일일 ~17회 fresh 검색만 가능. 캐시 80% 적중 가정 시 ~85회 검색/일 = 50 DAU 가능. 그 이상은 폴백 모드.

### 3. YouTube 직접 업로드 — 아키텍처 변경 필수 🔥
- **videos.insert = 1,600 units/업로드** (확정)
- **Vercel 60초 함수 제한과 호환 불가** (영상 100MB 업로드는 60초 안에 못 끝남)
- **유일한 해결책: 브라우저 직접 resumable 업로드**
  - 서버는 OAuth 토큰만 발급 + resumable session URI만 제공
  - 브라우저가 직접 chunk 단위로 YouTube에 PUT
  - 서버는 바이트를 절대 거치지 않음
- **OAuth verification 필수 (4~6주 소요, sensitive scope)**
  - youtube.upload는 sensitive scope
  - 미인증 앱은 7일마다 재인증 필요 (Testing mode)
  - 인증 받으면 refresh token 영구 유지
- → **Phase J 아키텍처 재설계**: 브라우저 직접 업로드로 변경 + OAuth verification 4/14 즉시 신청

### 4. ElevenLabs Voice Clone — 한국어 품질 약함
- ElevenLabs의 한국어 품질은 영어 대비 떨어짐 (Multilingual v2)
- **Supertone이 한국어에서 압도적 우위** (네이티브 학습 데이터)
- → **음성 복제는 v2 스펙에서 ElevenLabs 대신 Supertone 음성 복제 검토** (Supertone Voice Cloning이 가능한지 확인 필요)
- 또는 v2 음성 복제 자체 보류

### 액션 아이템 (4/14 즉시 시작)

1. **운영자**: 4/14 오늘 YouTube API 쿼터 상향 신청서 작성 시작
2. **운영자**: 4/14 오늘 Google OAuth Verification 신청 (sensitive scope)
3. **개발**: Phase J 아키텍처를 브라우저 직접 업로드로 변경
4. **출시 일정**: 4/25 → **5월 말 또는 6월 초** 현실적 목표
5. **출시 시 폴백**: YouTube 업로드는 베타 (verification 진행 중) 표시

---

## 환경 변수 추가 필요

구현 시작 전 Vercel 환경 변수에 추가:

```
GOOGLE_CLOUD_PROJECT=...                    # Vertex AI 프로젝트 ID
VERTEX_AI_LOCATION=us-central1              # 또는 asia-northeast3
GEMINI_VERTEX_MODEL=gemini-2.5-pro          # 또는 3.0 (deep-research 결과 후 확정)
GOOGLE_OAUTH_CLIENT_ID=...                  # YouTube 업로드용
GOOGLE_OAUTH_CLIENT_SECRET=...
GOOGLE_OAUTH_REDIRECT_URI=https://ddukddaktool.co.kr/api/youtube-auth?action=callback
ENCRYPTION_KEY=...                          # YouTube refresh_token 암호화 (32자 이상 랜덤)
```

YOUTUBE_API_KEY는 이미 등록되어 있음 (기존 shortform-benchmark가 사용 중).

---

## 다음 단계

이 마스터 플랜 승인 후:

1. **각 Phase 상세 플랜 작성** (총 12개 파일)
   - 우선순위: A → B → C → E → G → H → J (1주차 시작 가능 7개 먼저)
   - 그 다음: D, I, K → F → L
2. **피처 브랜치 + worktree 셋업** (구현 시작 직전)
3. **subagent-driven-development로 병렬 실행**

각 상세 플랜은 약 8~14 task, 400~700 줄 분량 예상.

**현재 상태:** 마스터 플랜 작성 완료. Phase 상세 플랜은 우선순위 순으로 순차 작성.
