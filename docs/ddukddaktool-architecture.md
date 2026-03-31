# 뚝딱툴 (ddukddaktool.co.kr) 시스템 구조도

> 최종 업데이트: 2026-03-31
> GitHub: https://github.com/onixuri-eunhee/naver-title-generator

---

## 전체 아키텍처

```
┌─────────────────────────────────────────────────────────────┐
│                    ddukddaktool.co.kr                        │
│                    (Vercel Pro 배포)                          │
├──────────────────────┬──────────────────────────────────────┤
│   프론트엔드 (HTML)    │         API (Serverless Functions)    │
│                      │                                      │
│  index.html          │  POST /api/titles      제목 생성      │
│  blog-writer.html    │  POST /api/generate    블로그 글      │
│  blog-image.html     │  POST /api/hooks       후킹문구       │
│  blog-image-pro.html │  POST /api/keywords    황금키워드      │
│  card-news.html      │  POST /api/blog-image  기본이미지      │
│  keyword-finder.html │  POST /api/blog-image-pro 프리미엄    │
│  hook-generator.html │  POST /api/card-news   카드뉴스       │
│  threads.html        │  POST /api/threads     스레드 글      │
│                      │  POST /api/auth        인증           │
└──────────────────────┴──────────────────────────────────────┘
         │                        │
         │                        ▼
         │         ┌──────────────────────────────┐
         │         │        외부 AI API            │
         │         │                              │
         │         │  Claude Sonnet 4  → 글/분석   │
         │         │  Claude Haiku 4.5 → 시드/분류 │
         │         │  FLUX Schnell    → 기본이미지  │
         │         │  FLUX Realism    → 사진형     │
         │         │  GPT Image 1.5   → 인포그래픽 │
         │         │  Nano Banana 2   → 포스터/흐름 │
         │         │  Satori+Resvg    → 카드뉴스   │
         │         └──────────────────────────────┘
         │                        │
         ▼                        ▼
┌─────────────────┐    ┌─────────────────────┐
│  Upstash Redis   │    │  Neon PostgreSQL     │
│                 │    │                     │
│ 세션 (30일 TTL)  │    │ users 테이블         │
│ Rate Limit      │    │ usage_logs 테이블    │
│ 사용자 정보      │    │ credit_ledger 테이블 │
│ 관리자 IP 화이트 │    │                     │
└─────────────────┘    └─────────────────────┘
         │
         ▼
┌─────────────────┐    ┌─────────────────────┐
│ Cloudflare R2    │    │  네이버 API          │
│                 │    │                     │
│ 이미지 저장소    │    │ 검색광고 (키워드)    │
│ 카드뉴스 저장    │    │ 블로그 검색 (포화도) │
│                 │    │ DataLab (트렌드)     │
└─────────────────┘    └─────────────────────┘
```

---

## API 상세

### 1. 블로그 글 생성

```
POST /api/generate
Authorization: Bearer {token}
Content-Type: application/json

{
  "model": "claude-sonnet-4-20250514",
  "max_tokens": 8192,
  "system": "시스템 프롬프트 (프론트에서 구성)",
  "messages": [{ "role": "user", "content": "유저 메시지" }]
}

→ Claude API 프록시. 프론트(blog-writer.html)에서 시스템 프롬프트를 구성하여 전달.
→ 무료 5회/일, 관리자 무제한
```

### 2. 제목 생성

```
POST /api/titles
Authorization: Bearer {token}

{ "keyword": "키워드", "category": "카테고리" }

→ 12가지 패턴 × 2개 = 24개 제목 생성
→ 무료 5회/일
```

### 3. 후킹문구 생성

```
POST /api/hooks
Authorization: Bearer {token}

{
  "type": "homefeed|naver|google",
  "tone": "친근한 구어체|전문가 톤|스토리텔링|간결 실용체",
  "industry": "업종",
  "target": "타겟",
  "topic": "주제",
  "memo": "참고사항"
}

→ 15개 후킹문구 (심리학 14가지 공식 기반)
→ 무료 5회/일
```

### 4. 황금키워드

```
POST /api/keywords
Authorization: Bearer {token}

{
  "field": "내 분야",
  "role": "나는",
  "target": "타겟 독자",
  "questions": "자주 받는 질문 (선택)",
  "userSeeds": "직접 추가 키워드 (선택)"
}

→ AI 시드 → 네이버 검색광고 API → 블로그 포화도 → DataLab 트렌드 → 점수 산출
→ 등급: 블루오션/틈새공략/경쟁있음/레드오션
→ 무료 3회/일
```

### 5. 블로그 이미지 (기본)

```
POST /api/blog-image
Authorization: Bearer {token}

{
  "mode": "parse",
  "blogText": "블로그 글 전체",
  "markers": [{ "marker": "마커텍스트", "position": 0 }],
  "topic": "주제",
  "mood": "bright|warm|professional|emotional",
  "thumbnailText": "썸네일 텍스트 (선택)"
}

→ Haiku가 프롬프트 생성 → FLUX Schnell로 이미지 생성
→ 무료 5회/일, 1크레딧
```

### 6. 프리미엄 이미지

```
POST /api/blog-image-pro
Authorization: Bearer {token}

{
  "mode": "parse|suggest_markers|regenerate_one",
  "blogText": "블로그 글",
  "markers": [...],
  "thumbnailText": "썸네일 텍스트"
}

→ Haiku가 이미지 유형 자동 판별 → 최적 모델 라우팅
  photo → FLUX Realism
  infographic_data → GPT Image 1.5
  infographic_flow/poster → Nano Banana 2
→ 무료 1회/일, 5크레딧
→ suggest_markers: AI가 글에서 이미지 삽입 위치 자동 추천
```

### 7. 카드뉴스

```
POST /api/card-news
Authorization: Bearer {token}

{
  "text": "블로그 글 텍스트",
  "slideCount": 7,
  "theme": "clean|cafe|beauty|fitness|food|edu|realty|dark|vivid|sage|indigo|coral|teal|lavender",
  "title": "블로그 제목 (선택)",
  "brandPrimary": "#HEX (선택)",
  "brandSecondary": "#HEX (선택)",
  "snsHandle": "@아이디 (선택)"
}

→ Claude Sonnet이 슬라이드 구조화 → Satori+Resvg로 PNG 렌더링
→ 1080×1350 (4:5 비율), R2에 자동 저장
→ 테마 14종, Content 레이아웃 3종 자동 순환
→ 무료 3회/일
```

### 8. Threads 글

```
POST /api/threads
Authorization: Bearer {token}

{
  "type": "daily|tips|story|question",
  "tone": "친근한|전문가|유머|진지한",
  "industry": "업종",
  "target": "타겟",
  "topic": "주제",
  "memo": "참고사항"
}

→ Claude가 Threads용 짧은 글 생성
→ 무료 5회/일
```

---

## 인증 흐름

```
1. 로그인
   POST /api/auth { "action": "login", "email": "...", "password": "..." }
   → 응답: { "token": "abc123...", "user": { "email", "name" } }

2. API 호출
   POST /api/generate
   Authorization: Bearer abc123...
   → 토큰으로 세션 조회 → 사용자 확인 → Rate Limit 체크 → 처리

3. 토큰 유효기간: 30일 (Redis TTL)
   → 만료 시 재로그인 필요
```

### 관리자 판별
- IP 화이트리스트 (Redis `admin:whitelist:{ip}`, 24시간 TTL)
- 또는 세션 이메일이 `ADMIN_EMAILS` 환경변수에 포함
- 관리자 = Rate Limit 무제한

---

## 비서 활용 가이드

### 자동화 워크플로우 예시

```
1. 키워드 발굴
   POST /api/keywords → 블루오션/틈새 키워드 추출

2. 블로그 글 작성
   POST /api/generate → 키워드 기반 블로그 글 생성

3. 이미지 생성
   POST /api/blog-image-pro (suggest_markers) → 이미지 위치 추천
   POST /api/blog-image-pro (parse) → 프리미엄 이미지 생성

4. 카드뉴스 변환
   POST /api/card-news → 블로그 글을 카드뉴스로 변환

5. SNS 후킹문구
   POST /api/hooks → 후킹문구 15개 생성

6. Threads 발행
   POST /api/threads → Threads 글 생성
```

### 주의사항
- 모든 API는 `Authorization: Bearer {token}` 필수
- 토큰은 30일 유효, 만료 시 `/api/auth` login으로 재발급
- 관리자 계정은 Rate Limit 무제한
- 이미지 결과는 R2 URL로 반환 (영구 저장)
- 카드뉴스는 base64 PNG + R2 URL 모두 반환

---

## 환경변수

| 변수 | 서비스 |
|------|--------|
| `ANTHROPIC_API_KEY` | Claude API |
| `OPENAI_API_KEY` | GPT Image |
| `FAL_KEY` | fal.ai (FLUX, Nano Banana) |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | Upstash Redis |
| `POSTGRES_URL` | Neon PostgreSQL |
| `R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_BUCKET_NAME` | Cloudflare R2 |
| `NAVER_AD_API_KEY` / `NAVER_AD_SECRET_KEY` / `NAVER_AD_CUSTOMER_ID` | 네이버 검색광고 |
| `NAVER_CLIENT_ID` / `NAVER_CLIENT_SECRET` | 네이버 검색 |
| `NAVER_DATALAB_CLIENT_ID` / `NAVER_DATALAB_CLIENT_SECRET` | 네이버 DataLab |
| `ADMIN_EMAILS` | 관리자 이메일 목록 (쉼표 구분) |
