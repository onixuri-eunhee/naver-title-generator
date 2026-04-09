# 뚝딱툴 숏폼 v2 -- 데이터 모델

> 이 문서는 숏폼 v2 파이프라인에서 다루는 핵심 데이터의 구조를 정의합니다.

---

## 전체 구조

```
[UserInput] ──1:1──> [BenchmarkResult] ──1:1──> [Strategy]
                                                     │
                                                     ▼
                                              [ProductionPlan]
                                                     │
                                                     ▼
                                              [GeneratedAssets]
                                                     │
                                                     ▼
                                              [usage_logs] (기존)
                                              [credit_ledger] (기존)
```

---

## 엔티티 상세

### UserInput
사용자가 입력하는 최초 데이터. 키워드 또는 블로그 글.

| 필드 | 설명 | 예시 | 필수 |
|------|------|------|------|
| keyword | 주제 키워드 | "중학생 진로상담" | O (둘 중 하나) |
| blogText | 블로그 글 전문 | "요즘 엄마들 모이면..." (3000자) | O (둘 중 하나) |
| targetDurationSec | 영상 길이 | 30, 45, 60, 90 | O |
| tone | 말투 | "professional" / "casual" | O |
| concept | 비주얼 컨셉 | "cinematic" / "minimal" / "dynamic" / "natural" | O |

---

### BenchmarkResult
YouTube에서 찾은 벤치마킹 영상 분석 결과.

| 필드 | 설명 | 예시 | 필수 |
|------|------|------|------|
| id | 고유 식별자 | "bench_abc123" | O |
| keyword | 검색 키워드 | "중학생 진로상담" | O |
| videos[] | 분석된 영상 목록 (3~5개) | | O |
| videos[].url | YouTube 숏폼 URL | "https://youtube.com/shorts/xxx" | O |
| videos[].title | 영상 제목 | "진로 고민 이것만 알면 됩니다" | O |
| videos[].viewCount | 조회수 | 150000 | O |
| videos[].subscriberCount | 채널 구독자수 | 2300 | O |
| videos[].viewToSubRatio | 조회수/구독자 비율 | 65.2 | O |
| videos[].transcript | 자막/대본 텍스트 | "여러분 진로 고민 많으시죠..." | O |
| patterns | AI 분석 패턴 | | O |
| patterns.hookType | 후킹 유형 | "질문형" | O |
| patterns.structure | 대본 구조 | "hook→problem→solution→cta" | O |
| patterns.visualStyle | 비주얼 스타일 | "B-roll 중심, 텍스트 오버레이" | O |
| patterns.avgDuration | 평균 영상 길이 (초) | 28 | O |
| viralFormula | 종합 바이럴 공식 | "질문형 후킹 + 3단 구조 + 강한 CTA" | O |
| createdAt | 생성 시각 | "2026-04-09T04:00:00Z" | O |

**저장소**: Redis (TTL 24시간) — 같은 키워드 반복 요청 시 캐시 활용

---

### Strategy
벤치마킹 결과를 바탕으로 자동 설계한 전략.

| 필드 | 설명 | 예시 | 필수 |
|------|------|------|------|
| hookType | 선택된 후킹 유형 (10종 중) | "충격형" | O |
| hookText | 후킹 핵심 문구 (12자 이내) | "진로상담의 진실" | O |
| introStructure | 인트로 구조 | "충격 주장 → 근거 암시 → 본론 예고" | O |
| ctrDesign | CTR 설계 (롱폼용 예약) | { thumbnail: null, title: null } | X |
| concept | 비주얼 컨셉 (사용자 선택 또는 자동) | "cinematic" | O |
| targetSceneCount | 목표 씬 수 | 7 | O |

**저장소**: 메모리 (요청 내 파이프라인)

---

### ProductionPlan
기획서. 대본 내용 + 씬별 비주얼 프롬프트 마커.

| 필드 | 설명 | 예시 | 필수 |
|------|------|------|------|
| scenes[] | 씬 목록 | | O |
| scenes[].index | 씬 순서 | 0, 1, 2... | O |
| scenes[].section | 구간 | "hook" / "point" / "cta" | O |
| scenes[].scriptOutline | 대본 방향 | "진로상담 골든타임이 있다는 충격적 사실" | O |
| scenes[].visualPrompt | 이미지 생성 프롬프트 (영어) | "close-up of calendar pages turning, warm cinematic lighting, 9:16" | O |
| scenes[].i2vRequired | 영상 변환 필요 여부 | true / false | O |
| scenes[].visualRef | 프리미엄 이미지생성기 마커 참조 | "맥락: 시간의 흐름, 선택의 기로" | X |
| qualityChecklist | AI 셀프 검수 항목 | | O |
| qualityChecklist.hookStrength | 후킹 강도 (1~10) | 8 | O |
| qualityChecklist.introEngagement | 도입부 몰입력 | 7 | O |
| qualityChecklist.firstScreenImpact | 첫 화면 임팩트 | 9 | O |
| qualityChecklist.overallScore | 종합 점수 (10점 만점) | 8 | O |

**저장소**: 메모리 (요청 내 파이프라인)

---

### GeneratedAssets
최종 생성된 에셋들.

| 필드 | 설명 | 예시 | 필수 |
|------|------|------|------|
| script | 완성 대본 (전문) | { hook, points[], cta, fullScript } | O |
| audioUrl | TTS 음성 파일 URL | "https://cdn.ddukddaktool.co.kr/..." | O |
| audioDurationSec | 음성 길이 (초) | 28.5 | O |
| sttWords[] | 워드 타이밍 | [{ text, start, end }] | O |
| images[] | FLUX 생성 이미지 | [{ url, r2Url, prompt, provider }] | O |
| videos[] | Kling I2V 영상 | [{ url, r2Url, prompt, durationSec, provider }] | O |
| finalVideoUrl | 완성 MP4 URL | "https://cdn.ddukddaktool.co.kr/..." | O |
| finalVideoSize | 파일 크기 (bytes) | 14800000 | O |

**저장소**: R2 (Cloudflare) — 이미지/영상/MP4

---

## 기존 엔티티 (변경 없음)

| 엔티티 | 용도 | 저장소 |
|--------|------|--------|
| users | 회원 정보, 크레딧 잔액 | Neon PostgreSQL |
| credit_ledger | 크레딧 충전/사용 기록 | Neon PostgreSQL |
| usage_logs | 도구 사용 로그 | Neon PostgreSQL |
| session:{token} | 로그인 세션 | Redis |

---

## 왜 이 구조인가

- **Redis 캐시 (BenchmarkResult)**: 같은 키워드로 여러 사용자가 요청 시 YouTube API 쿼터 절약. 24시간 TTL로 트렌드 반영.
- **메모리 파이프라인 (Strategy, ProductionPlan)**: 요청 단위로 생성/소비되므로 영구 저장 불필요. DB 부하 최소화.
- **R2 저장 (GeneratedAssets)**: 이미지/영상은 대용량이므로 CDN 기반 R2에 저장. 기존 인프라 그대로 활용.
- **기존 테이블 유지**: users, credit_ledger, usage_logs는 변경 없이 v2에서도 동일하게 사용.

---

## [NEEDS CLARIFICATION]

- [ ] BenchmarkResult 캐시 TTL 24시간이 적절한지 (트렌드 변화 주기 고려)
- [ ] ProductionPlan을 DB에 저장해서 "이전 기획서 재사용" 기능을 넣을지
