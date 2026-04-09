# 뚝딱툴 숏폼 v2 -- 프로젝트 스펙

> AI가 코드를 짤 때 지켜야 할 규칙과 절대 하면 안 되는 것.
> 이 문서를 AI에게 항상 함께 공유하세요.

---

## 기술 스택

| 영역 | 선택 | 이유 |
|------|------|------|
| 프레임워크 | 정적 HTML + Vercel Serverless | 기존 인프라 유지, 4/25까지 전환 위험 없음 |
| 벤치마킹 | YouTube Data API v3 | 공식 API, 일 10,000 유닛 무료 쿼터 |
| 대본 생성 | Claude Sonnet 4 | 기존 사용 중, Few-shot + 검수 로직 추가 |
| TTS | Supertone Play API | 한국어 최상 품질, 감정 제어, 음성 복제 대비 |
| 이미지 생성 | FLUX Schnell via fal.ai | $0.015/장, 1초 미만, fal.ai 이미 사용 중 |
| I2V 영상 (첫 씬만) | Kling 3.0 Pro via fal.ai | $0.112/초, 후킹 씬 최고 품질 임팩트 |
| I2V 폴백 | Veo 3.1 Lite (기존) | Kling 실패 시 자동 전환, $0.05/초 |
| 렌더링 | Remotion (Railway) | 기존 구축됨, 변경 불필요 |
| 저장소 | Cloudflare R2 (cdn.ddukddaktool.co.kr) | 기존 구축됨 |
| 캐시 | Redis (Upstash) | 벤치마킹 결과 24h TTL |
| DB | Neon PostgreSQL | 기존 users/credits/logs 유지 |
| 배포 | Vercel (API) + Railway (렌더링/B-roll) | 기존 인프라 유지 |

---

## 프로젝트 구조

```
naver-title-generator/
├── api/
│   ├── shortform-benchmark.js  ★ 신규: YouTube 벤치마킹
│   ├── shortform-script.js     ★ 대폭 수정: 벤치마킹→전략→기획서→대본→검수
│   ├── shortform-tts.js        ★ 수정: Google TTS → Supertone Play
│   ├── shortform-broll.js          유지 (Vercel 프록시)
│   ├── shortform-stt.js            유지
│   ├── shortform-refund.js         유지
│   ├── _helpers.js                 유지
│   ├── _db.js                      유지
│   └── _r2.js                      유지
├── services/
│   ├── shortform-broll-core.js ★ 수정: Imagen→FLUX, Veo→Kling
│   └── shortform-remotion-render.mjs  유지
├── remotion/
│   └── shortform/
│       ├── ShortformComposition.jsx   유지 (텍스트카드 제거됨)
│       └── timeline.js                유지
├── shortform.html              ★ 수정: UI 개편 (로딩 표시 등)
└── PRD/                        ★ 신규: 이 문서들
```

---

## 절대 하지 마 (DO NOT)

> AI에게 코드를 시킬 때 이 목록을 반드시 함께 공유하세요.

- [ ] API 키를 코드에 직접 쓰지 마 (.env 또는 Vercel/Railway 환경변수 사용)
- [ ] 기존 DB 스키마 (users, credit_ledger, usage_logs)를 임의로 변경하지 마
- [ ] 기존 인증 로직 (api/auth.js, auth-ui.js)을 건드리지 마
- [ ] package.json의 기존 의존성 버전을 변경하지 마 (Remotion 4.0.446 등)
- [ ] 다른 도구 (블로그 글, 카드뉴스, 키워드 등)의 API에 영향 주지 마
- [ ] 텍스트 카드 관련 코드를 다시 넣지 마 (폐지됨)
- [ ] AI 아바타나 인물 생성 코드를 넣지 마 (Out of Scope)
- [ ] YouTube API 쿼터를 한 번에 소진하는 배치 호출을 하지 마
- [ ] 프롬프트에 규칙을 4곳 이상 중복 배치하지 마 (AI 혼란 유발, DEAD END)
- [ ] 자동수정 횟수를 1회에서 변경하지 마 (blog-writer 규칙 동일 적용)

---

## 항상 해 (ALWAYS DO)

- [ ] 변경하기 전에 계획을 먼저 보여줘
- [ ] 환경변수는 Vercel/Railway 환경변수에 저장
- [ ] 에러 발생 시 사용자에게 친절한 한국어 메시지 표시
- [ ] 모바일에서도 사용 가능한 반응형 디자인
- [ ] API 호출은 가능한 한 병렬로 (Promise.all)
- [ ] 벤치마킹 실패 시 내장 후킹 공식 폴백 사용
- [ ] 이미지 생성 실패 시 Grok 폴백 사용 (기존 로직)
- [ ] 크레딧 차감은 성공 후에만 (실패 시 자동 환불)
- [ ] B-roll은 객체/환경 중심 (No-people 전략)
- [ ] 커밋 메시지는 한국어, 변경 내용 명확히

---

## 테스트 방법

```bash
# 로컬 실행 (Vercel dev)
vercel dev

# 특정 API 테스트
curl -X POST http://localhost:3000/api/shortform-benchmark \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer {token}" \
  -d '{"keyword": "중학생 진로상담"}'

# 빌드 확인
# (정적 HTML이므로 별도 빌드 불필요, API는 Vercel이 자동 번들)
```

---

## 배포 방법

### Vercel (API + 프론트엔드)
```bash
git push origin main  # 자동 배포
```

### Railway (B-roll core + Remotion render)
```bash
git push origin main  # 자동 배포 (같은 repo)
```

### 배포 후 확인
1. `/api/shortform-benchmark` — 벤치마킹 API 응답 확인
2. `/api/shortform-script` — 대본 생성 (벤치마킹 포함) 확인
3. `/shortform.html` — E2E 영상 생성 테스트

---

## 환경변수

| 변수명 | 설명 | 어디서 발급 | 배포 위치 |
|--------|------|------------|----------|
| YOUTUBE_API_KEY | YouTube Data API v3 | Google Cloud Console | Vercel |
| SUPERTONE_API_KEY | Supertone Play TTS | supertone.ai/api | Vercel + Railway |
| FAL_KEY | fal.ai (FLUX + Kling) | fal.ai/dashboard | Vercel + Railway |
| ANTHROPIC_API_KEY | Claude Sonnet | 기존 | Vercel |
| XAI_API_KEY | Grok 이미지 (폴백) | 기존 | Railway (추가 필요) |
| R2_* | Cloudflare R2 | 기존 | Vercel + Railway |
| KV_REST_API_* | Upstash Redis | 기존 | Vercel |
| POSTGRES_URL | Neon PostgreSQL | 기존 | Vercel |

> Vercel/Railway 환경변수에 저장. 절대 코드에 직접 쓰지 마세요.

---

## API 비용 예산 (30초 숏폼 1편)

| 항목 | API | 예상 비용 |
|------|-----|----------|
| 벤치마킹 | YouTube Data API | ~$0.01 (쿼터 내 무료) |
| 대본 생성 | Claude Sonnet (Few-shot) | ~$0.03 |
| TTS | Supertone Play | ~$0.02~0.05 |
| 이미지 x5 | FLUX Schnell | ~$0.075 |
| I2V x1 (첫 씬, 5초) | Kling 3.0 Pro | ~$0.56 ($0.112×5초) |
| I2V 폴백 | Veo 3.1 Lite | Kling 실패 시만 ($0.25) |
| 렌더링 | Remotion | ~$0.01 |
| **합계** | | **~$0.77** |

크레딧 과금: 7크레딧 = 2,310원 → **마진율 ~52%**

> I2V는 첫 씬(후킹)만 Kling Pro로 최고 품질, 나머지 씬은 FLUX 이미지만 사용.
> Kling 실패 시 Veo 3.1 Lite 자동 폴백.

---

## [NEEDS CLARIFICATION]

- [x] ~~Supertone Play API 발급~~ → 완료 (Starter $2.99/월, 20,000크레딧)
- [x] ~~Kling 3.0 fal.ai I2V 지원~~ → 확인됨 (fal-ai/kling-video/v3/pro/image-to-video)
- [x] ~~YouTube API 키 발급~~ → 완료 (Vercel 환경변수 등록됨)
- [ ] YouTube 자막 추출: 공식 captions API vs 서드파티 (Apify) 비용/안정성 비교
- [ ] Railway에 XAI_API_KEY + SUPERTONE_API_KEY 환경변수 추가
