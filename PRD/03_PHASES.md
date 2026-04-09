# 뚝딱툴 숏폼 v2 -- Phase 분리 계획

> 한 번에 다 만들면 복잡해져서 품질이 떨어집니다.
> Phase별로 나눠서 각각 "진짜 동작하는 제품"을 만듭니다.

---

## Phase 1: MVP -- 4/25 오픈 (2주)

### 목표
키워드 입력 하나로 벤치마킹 → 전략 → 기획서 → 대본 → 영상까지 완전 자동 생성되는 파이프라인 완성.

### Week 1: 백엔드 파이프라인

- [ ] **YouTube 벤치마킹 API** (`api/shortform-benchmark.js`)
  - YouTube Data API v3 연동 (search.list + videos.list)
  - 구독자 낮고 조회수 높은 영상 필터링 (viewToSubRatio 기준)
  - 자막 추출 (YouTube caption API 또는 Apify 폴백)
  - Claude AI로 영상 구조/대본/후킹 패턴 분석
  - Redis 캐시 (키워드별 TTL 24h)

- [ ] **전략 설계 프롬프트** (shortform-script.js 내 통합)
  - 벤치마킹 결과 + 후킹 공식 10종 → 전략 자동 선택
  - 훅/인트로/씬별 비주얼 마커 포함 기획서 생성
  - 프리미엄 이미지생성기 프롬프트 로직 재활용 (api/blog-image-pro.js의 Haiku 마커 추천)

- [ ] **대본 작성 + AI 셀프 검수**
  - 기획서 기반 Few-shot 대본 생성 (바이럴 예시 3~5개 포함)
  - AI 검수: 후킹 강도, 도입부 몰입력, 첫 화면 임팩트, 반복 여부
  - 불합격(8점 미만) 시 자동 재생성 (최대 2회)

- [ ] **FLUX Schnell 이미지 생성** (fal.ai)
  - 기존 Imagen 3 → FLUX Schnell 전환
  - 기획서 마커의 visualPrompt로 이미지 생성
  - 객체/환경 중심 B-roll (No-people 전략)

- [ ] **Kling 3.0 I2V 영상 변환** (fal.ai)
  - 기존 Veo 3.1 Lite → Kling 3.0 전환
  - 기획서의 i2vRequired 마커 기반 비디오 슬롯 자동 결정
  - 이미지 base64 → Kling I2V API 호출

### Week 2: 프론트엔드 + 통합

- [ ] **shortform.html UI 개편**
  - 벤치마킹 로딩 표시 (프로그레스 바 + 단계 표시)
  - 기존 대본 편집기 유지 (벤치마킹→생성 전체가 자동이므로 UI 변경 최소)
  - 크레딧 차감 로직 조정 (원가 변동 반영)

- [ ] **Supertone Play TTS 연동** (`api/shortform-tts.js`)
  - Google TTS → Supertone Play API 전환
  - 한국어 음성 선택 UI (기존 음성 목록 교체)
  - 감정 제어 파라미터 (기본: neutral)

- [ ] **전체 파이프라인 통합 테스트**
  - 키워드 입력 → 완성 MP4 다운로드 E2E 테스트
  - 에러 핸들링: 벤치마킹 실패 시 폴백 (내장 후킹 공식으로 진행)
  - 크레딧 과금 정상 동작 확인

- [ ] **배포 + 프로덕션 검증**
  - Vercel 배포 (API routes)
  - Railway 배포 (B-roll core + Remotion render)
  - 환경변수 추가: SUPERTONE_API_KEY, YOUTUBE_API_KEY

### 데이터
- BenchmarkResult (Redis)
- Strategy, ProductionPlan (메모리)
- GeneratedAssets (R2)
- 기존: users, credit_ledger, usage_logs (Neon)

### 인증
- 기존 이메일+비밀번호 방식 유지

### "진짜 제품" 체크리스트
- [ ] 실제 YouTube API 연동 (목업 데이터 X)
- [ ] 실제 FLUX + Kling API 연동 (기존 모델 X)
- [ ] 실제 Supertone TTS 연동 (Google TTS X)
- [ ] 실제 서버에 배포 (localhost X)
- [ ] 다른 사람이 URL로 접속해서 숏폼 만들 수 있음

### Phase 1 시작 프롬프트
```
이 PRD를 읽고 Phase 1을 구현해주세요.
@PRD/01_PRD.md
@PRD/02_DATA_MODEL.md
@PRD/04_PROJECT_SPEC.md

Phase 1 범위:
- YouTube 벤치마킹 API (검색+필터+자막추출+AI분석)
- 전략 설계 + 기획서 생성 프롬프트
- 대본 작성 + AI 셀프 검수
- FLUX Schnell + Kling 3.0 영상 파이프라인
- Supertone Play TTS 연동
- shortform.html UI 개편
- 전체 통합 테스트 + 배포

반드시 지켜야 할 것:
- 04_PROJECT_SPEC.md의 "절대 하지 마" 목록 준수
- 기존 인증/크레딧/DB 구조 유지
- 벤치마킹 실패 시 폴백 로직 포함
```

---

## Phase 2: 확장 -- 5~6월

### 전제 조건
- Phase 1이 안정적으로 배포된 상태

### 목표
캐싱, 음성 복제, 플랫폼별 최적화로 품질과 효율 향상.

### 기능
- [ ] 벤치마킹 결과 캐싱 (Redis TTL 24h) + 인기 키워드 프리페치
- [ ] 인기 주제별 B-roll 이미지 풀 사전 생성 (R2)
- [ ] 사용자 음성 복제 (Supertone Clone, 10초 샘플)
- [ ] 플랫폼별 프리셋 (TikTok: 2초 후킹/15~30초, Reels: 3초/30~90초, Shorts: 3~5초/60초)
- [ ] SNS 자동 포스팅 연동 (Threads API 기존 연동 확장)

### 추가 데이터
- VoiceClone 엔티티 (사용자별 복제 음성 메타데이터)
- PlatformPreset 엔티티 (플랫폼별 설정)

### 통합 테스트
- Phase 1 기능이 여전히 정상 동작하는지 확인
- 음성 복제 품질 A/B 테스트

---

## Phase 3: 고도화 -- 7월~

### 전제 조건
- Phase 1 + 2가 안정적으로 운영 중

### 목표
롱폼 확장, 성과 분석, A/B 테스트로 데이터 기반 최적화.

### 기능
- [ ] Upstash Workflow 도입 (타임아웃 근본 해결)
- [ ] 롱폼 영상 지원 (5분+)
- [ ] CTR 설계 + 썸네일 자동 생성 활성화 (롱폼용)
- [ ] A/B 테스트 (대본 변형 2~3개 동시 생성 → 성과 비교)
- [ ] 영상 성과 분석 대시보드 (조회수, 리텐션 추적)

### 주의사항
- 롱폼 영상은 API 비용이 5~10배 증가 → 별도 크레딧 정책 필요
- Upstash Workflow는 기존 API 구조 리팩토링 필요

---

## Phase 로드맵 요약

| Phase | 핵심 기능 | 기간 | 상태 |
|-------|----------|------|------|
| Phase 1 (MVP) | 벤치마킹+전략+기획서+대본+FLUX/Kling 영상 | 4/9~4/25 (2주) | 시작 전 |
| Phase 2 | 캐싱+음성복제+플랫폼별+SNS포스팅 | 5~6월 | Phase 1 완료 후 |
| Phase 3 | 롱폼+썸네일+A/B테스트+성과분석 | 7월~ | Phase 2 완료 후 |
