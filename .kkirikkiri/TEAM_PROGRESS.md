# 진행 상황

## 2026-03-11 — main-session
- 상태: 팀 구성 완료
- 작업: 공유 메모리 초기화, 분석가 스폰 준비
- 결과: 두 도구 모두 JS 템플릿 기반 (AI 미사용) 확인
- 다음: 분석가에게 프롬프트/규칙 분석 + 모델 비교 지시

## 2026-03-11 — analyst (claude-api 분석)
- 상태: 완료
- 작업: 프롬프트/규칙 구조 분석 + Haiku vs Sonnet 비교 + 프롬프트 초안 설계
- 분석 범위:
  - index.html templates 객체 (12패턴 x 2 = 24개 제목)
  - hook-generator.html HOOKS 배열 (99개 템플릿, 17개 카테고리 A~Q)
  - api/threads.js (Haiku 사용 레퍼런스)
  - api/generate.js (Sonnet 기본 범용 프록시)
- Claude API 가격 정보 확인: Haiku $1/$5, Sonnet $3/$15 (백만 토큰당)

### 결과 요약
1. **모델 추천: Haiku 4.5** (가중 점수 8.55 vs Sonnet 6.30)
   - 비용 3배 절감 (월 ~$40 vs ~$120), 속도 2배 빠름
   - 1줄 짧은 텍스트에서 한국어 품질 차이 미미
   - threads.js에서 이미 Haiku로 300자 글 성공적 생성 검증됨
2. **프롬프트 초안 완성**: 블로그 제목 system prompt + 후킹문구 system prompt
3. **API 연동 방식: 새 파일 생성** (api/titles.js + api/hooks.js)
   - threads.js 패턴 차용: 서버에 프롬프트 내장 + 독립 rate limit
   - 기존 JS 템플릿은 fallback으로 유지
4. **핵심 설정값**: max_tokens 600~800, temperature 0.85, IP당 일 20~30회 제한

### 산출물 위치
- TEAM_FINDINGS.md에 전체 분석 보고서 기록 완료
- 다음 단계: developer가 api/titles.js + api/hooks.js 구현

## 2026-03-11 — developer (claude-api 구현)
- 상태: 완료
- 작업: api/titles.js + api/hooks.js 신규 생성, index.html + hook-generator.html API 연동, vercel.json 라우트 추가

### 변경 파일 목록
1. **api/titles.js** (신규) — 블로그 제목 생성 API
   - 모델: claude-haiku-4-5-20251001, max_tokens: 800, temperature: 0.85
   - System prompt: TEAM_FINDINGS.md의 3-1 프롬프트 사용
   - Input: POST { keyword, category }, GET: 남은 횟수
   - Output: { results: { p1: [t1,t2], ... p12: [t1,t2] }, remaining, limit }
   - Rate limit: ratelimit:titles:{ip}:{date}, FREE_DAILY_LIMIT=5
   - 서버 후처리: P1:~P12: 형식 파싱 + 40자 초과 트리밍
   - 파싱 실패 시 fallback 플래그 반환

2. **api/hooks.js** (신규) — 후킹문구 생성 API
   - 모델: claude-haiku-4-5-20251001, max_tokens: 600, temperature: 0.85
   - System prompt: TEAM_FINDINGS.md의 3-2 프롬프트 사용
   - Input: POST { industry, keyword }, GET: 남은 횟수
   - Output: { results: [hook1,...hook15], remaining, limit }
   - Rate limit: ratelimit:hooks:{ip}:{date}, FREE_DAILY_LIMIT=5
   - 서버 후처리: 줄바꿈 split + 번호 제거 + 빈 줄 제거 + 50자 초과 트리밍

3. **index.html** (수정) — API 연동 + fallback
   - generateTitles()를 async로 변경, POST /api/titles 호출
   - 로딩 상태: 버튼 disabled + "AI가 제목을 생성하고 있습니다..." 텍스트
   - 남은 횟수 표시 (loadRemaining + updateRemaining)
   - API 실패/429/파싱 실패 시 기존 templates 객체로 fallback
   - 기존 JS 템플릿 코드 100% 유지 (삭제 없음)
   - Enter 키 지원 추가

4. **hook-generator.html** (수정) — API 연동 + fallback
   - generateHooks()를 async로 변경, POST /api/hooks 호출
   - 로딩 상태: 버튼 disabled + "AI가 후킹문구를 생성하고 있습니다..."
   - 남은 횟수 표시
   - API 실패 시 기존 HOOKS 배열 + josa 함수로 fallback
   - 기존 JS 코드 100% 유지

5. **vercel.json** (수정) — /api/titles, /api/hooks 라우트 추가

### 구현 패턴
- threads.js 패턴을 정확히 차용: Redis 연동, IP 기반 rate limit, KST 일별 키, admin whitelist, CORS, INCR-first
- 두 API 모두 독립적 rate limit 키 사용 (titles/hooks 분리)
- 프론트엔드는 API 우선 시도 -> 실패 시 기존 JS 템플릿으로 자동 fallback

### 주의사항
- Haiku가 출력 형식을 벗어날 경우를 대비해 파싱 로직에 유연성 확보
- 제목 40자, 후킹문구 50자 하드리밋으로 모바일 최적화
- 429 에러 시 alert 표시 + fallback으로 UX 유지

## 2026-03-11 — tester (kkirikkiri-dev-0311-claude-api)
- 상태: 완료
- 작업: api/titles.js, api/hooks.js, index.html, hook-generator.html, vercel.json 전체 코드 검증

### 검증 결과 요약
- **종합 판정: PASS** (수정 후)
- 총 4개 버그 발견 및 직접 수정 완료

### 발견 및 수정한 버그 목록

#### 버그 1 (심각도: 높음) — rateLimitKey 스코프 버그
- **파일**: `/Users/gong-eunhui/Desktop/naver-title-generator/api/titles.js`, `/Users/gong-eunhui/Desktop/naver-title-generator/api/hooks.js`
- **문제**: `let rateLimitKey = null`이 try 블록 내부에 선언되어 catch 블록에서 접근 불가. INCR 후 예외 발생 시 rate limit 카운트가 복원되지 않는 경합 조건 버그.
- **수정**: rateLimitKey 선언을 try 블록 바깥(METHOD 검사 직후)으로 이동

#### 버그 2 (심각도: 중간) — XSS 취약점
- **파일**: `/Users/gong-eunhui/Desktop/naver-title-generator/index.html`, `/Users/gong-eunhui/Desktop/naver-title-generator/hook-generator.html`
- **문제**: makeItem 함수에서 API 응답 text를 innerHTML에 직접 삽입. 악성 HTML 삽입 가능.
- **수정**: escapeHtml() 함수 추가 후 텍스트 표시에 적용, onclick 인수는 JSON.stringify(text) 사용

#### 버그 3 (심각도: 낮음) — hooks.js 번호 제거 정규식 과도함
- **파일**: `/Users/gong-eunhui/Desktop/naver-title-generator/api/hooks.js`
- **문제**: `/^\d{1,2}[\.\)\s]+/`에서 `\s+`(공백만 있는 경우)도 포함되어 숫자로 시작하는 후킹문구 손상 가능
- **수정**: `/^\d{1,2}[\.)][\s]+/`로 변경 (마침표 또는 괄호가 있는 경우만 제거)

#### 버그 4 (심각도: 낮음) — 미사용 변수
- **파일**: `/Users/gong-eunhui/Desktop/naver-title-generator/index.html`
- **문제**: makeItem 내 `const safeAttr = escapeHtml(text)` 선언 후 미사용
- **수정**: 해당 줄 제거

### 검증 통과 항목 (변경 없음)
- 모델: claude-haiku-4-5-20251001 정확히 사용
- API 파라미터: max_tokens/temperature 설계와 일치
- CORS: threads.js와 동일 패턴
- Rate limit: Redis INCR-first, KST 일별 키, admin whitelist 모두 올바름
- System prompt: TEAM_FINDINGS.md 설계와 완전 일치
- 파싱: P1:~P12: regex / 줄바꿈 split 동작 확인
- 프론트엔드: 로딩 상태, fallback, 남은 횟수 표시 모두 정상
- vercel.json: /api/titles, /api/hooks 라우트 존재 확인
- 기존 JS 템플릿 코드(templates/HOOKS 배열) 100% 보존 확인
