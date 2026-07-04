# 시즌2 개발 계획 (코드베이스 매핑)

> 브랜치: `season2-dev`. 🚨 토스 심사 중 → **기존 라우트·페이지 절대 무수정.** 신규 경로에서만.
> 스택 확인: Next.js 15 App Router · React 19 · Neon Postgres(raw SQL, lib/db.js) · 크레딧 멱등(lib/credit-service.js) · R2 저장(lib/r2.js) · 스레드 OAuth 기존(app/api/threads-*).

## 신규 경로 (기존과 분리)
- 페이지: `app/season2/**` (마이페이지·글생성·보관함)
- API: `app/api/season2/**`
- 로직: `lib/season2/**`
- DB: 신규 테이블 `s2_*` 접두(기존 테이블 무수정)

## 재활용 vs 신규

| 시즌2 기능 | 재활용(기존) | 신규 |
|-----------|-------------|------|
| 원고 생성 모델 호출 | app/api/generate 패턴(Anthropic 프록시) | season2 전용 라우트 |
| 3전략 프롬프트 | lib/blog-writer-prompts(A/B/C 개념) | 03·06 기반 재작성 + 업종·페르소나 슬롯 |
| 키워드 확장 | lib/keyword-expansion.js | 씨드→발굴 UI |
| 이미지 생성 | app/api/blog-image-pro(gpt-image) | gpt-image-2 high 고정 + 규제 사전차단 |
| 스레드 발행 | app/api/threads-publish·schedule, lib/threads.js | 스레드용 짧은글 프롬프트 |
| 인증·크레딧 | lib/auth·db·credit-service | 사용권(기간제) 레이어 |
| 저장 | lib/r2.js | 업로드 자료 암호화(09번) |
| **규제 검수** | 없음 | 🆕 lib/season2/regulation-* |
| **AEO·페르소나·업종·사용량카운팅** | 없음 | 🆕 |

## DB 신규 테이블(안)
- `s2_profiles` (계정별: 업종, 페르소나 JSON, 씨드키워드, 참고자료 ref)
- `s2_licenses` (사용권: 기간, 시작·만료, 인증키, 상한)
- `s2_usage` (편수 카운팅: 일·월, 블로그/스레드 별도)
- `s2_posts` (글 보관함: 원고, 전략, 상태, 규제결과)

## 첫 슬라이스 (지금 구현) — 백엔드 핵심 루프
**"검색100 원고 생성 + 규제 검수"** 를 새 API로. UI·DB 전에 파이프라인 뼈대부터(테스트 가능·기존 무영향).
- `lib/season2/regulation-rules.js` — 조문 기반 룰 세트(데이터, 04번)
- `lib/season2/prompts.js` — 검색100 시스템 프롬프트 빌더(03번 + AEO 05번)
- `lib/season2/regulation-check.js` — 규제 검수 프롬프트·파싱(04번)
- `app/api/season2/generate-draft/route.js` — 생성→검수 오케스트레이션

이후 슬라이스: 반반 프롬프트 → 이미지 규제 → DB/보관함 → 마이페이지 세팅 UI → 발행 도우미 → 사용권·결제.
