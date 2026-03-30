# 끼리끼리 팀 작업 리포트

- 팀명: kkirikkiri-development-0309
- 목표: 회원가입/로그인 시스템 구현 + Pro/Free 배지 업데이트
- 날짜: 2026-03-09
- 라운드: 1 (품질 검증 통과)

---

## 팀 구성
| 역할 | 담당 업무 |
|------|----------|
| 팀장 (main-session) | 계획 수립, 태스크 배분, 검증, 통합 |
| 백엔드 개발자 | api/auth.js, vercel.json |
| 프론트 개발자 1 | signup.html, login.html, mypage.html, auth-ui.js |
| 프론트 개발자 2 | index.html, blog-writer.html, blog-image.html, threads.html, hook-generator.html 수정 |
| 테스터 | 전체 61개 항목 검증 |

---

## 생성된 파일 (4개)

### 1. `/api/auth.js` — 인증 API
- 4개 엔드포인트: signup, login, me, logout
- Redis 기반 사용자/세션 저장 (@upstash/redis)
- pbkdf2Sync 비밀번호 해싱 (100K iterations, SHA-512)
- 세션 토큰: randomBytes(32), 30일 TTL
- 회원가입 시 5크레딧 자동 지급
- CORS 전체 응답 적용

### 2. `/signup.html` — 회원가입 페이지
- 5개 필드: 이메일, 비밀번호, 비밀번호 확인, 이름, 전화번호
- 클라이언트 유효성 검사
- 성공 시 로그인 페이지로 이동

### 3. `/login.html` — 로그인 페이지
- 이메일, 비밀번호 입력
- 성공 시 토큰/유저 정보 localStorage 저장 → 메인 페이지 이동

### 4. `/mypage.html` — 마이페이지
- 사용자 정보 (이름, 이메일, 전화번호)
- 크레딧 잔액 표시
- 가격표: 30크레딧/9,900원, 100크레딧/29,700원, 200크레딧/49,500원
- 첫 결제 +20% 보너스 안내
- 로그아웃 기능

### 5. `/auth-ui.js` — 공통 인증 네비바 JS
- 모든 페이지에서 사용
- 로그인 상태: 이름, 크레딧, 마이페이지 버튼
- 비로그인 상태: 로그인, 가입 버튼
- 세션 자동 갱신 + 만료 처리

---

## 수정된 파일 (6개)

### 1. `index.html`
- 스레드 링크에서 pro-badge 제거
- 스레드 카드: PRO → FREE 섹션 이동
- PRO 그리드: 3열 → 2열 (블로그 글, 이미지만)
- FREE 그리드: 2열 → 3열 (제목, 후킹, 스레드)
- 네비바 로그인/가입 버튼 추가

### 2. `blog-writer.html`
- 다크 테마 네비바 → 라이트 테마 .navbar로 통일
- PRO 배지 네비바 + 페이지 헤더에 추가
- 네비바 로그인/가입 버튼 추가

### 3. `blog-image.html`
- 블로그 글, 이미지 링크에 pro-badge 추가
- pro-badge::after CSS 추가
- 네비바 로그인/가입 버튼 추가

### 4. `threads.html`
- pro-badge CSS + 블로그 글/이미지 링크에 추가
- 네비바 로그인/가입 버튼 추가

### 5. `hook-generator.html`
- pro-badge CSS + 블로그 글 링크에 추가
- 네비바 로그인/가입 버튼 추가

### 6. `vercel.json`
- `/api/auth` 라우트 추가

---

## 검증 결과
- **61/61 항목 PASS** (0 FAIL)
- 일관성 수정: threads.html, hook-generator.html에 pro-badge 추가 (팀장이 직접 수정)

---

## 메모리 저장
- `/Users/gong-eunhui/.claude/projects/-Users-gong-eunhui-Desktop-naver-title-generator/memory/MEMORY.md`에 가격 정책 + 기술 스택 + 인증 시스템 정보 저장 완료
