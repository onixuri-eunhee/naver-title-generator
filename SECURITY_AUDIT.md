# 뚝딱툴 (ddukddaktool.co.kr) 보안 감사 보고서 v2

**감사 일시**: 2026-04-08  
**감사 대상**: `/Users/gong-eunhui/Desktop/naver-title-generator`  
**스택**: Static HTML + Vercel Serverless Functions (Node.js) + Anthropic Claude API  
**감사자**: Claude Opus 4.6 (8-Category Security Audit)

---

## 요약

| 심각도 | 건수 |
|--------|------|
| CRITICAL | 1 |
| HIGH | 3 |
| MEDIUM | 4 |
| LOW | 3 |
| **합계** | **11** |

### 이전 감사(4/5) 대비 개선사항
- `.env` 파일 git 커밋 이력 없음 확인 (양호)
- model/max_tokens 화이트리스트 적용 완료
- Redis 키 인젝션 방지 적용 완료
- x-real-ip 우선 사용 적용 완료
- admin IP TTL 24h 적용 완료
- SQL 파라미터 바인딩 사용 (인젝션 방지)

---

## 카테고리별 감사 결과

### 카테고리 1: 환경변수/시크릿 노출

**상태: 양호**

- `.gitignore`에 `.env*.local`, `.env.test` 포함
- git history에 .env 커밋 이력 없음
- 소스코드 내 하드코딩된 API 키 없음
- 모든 시크릿은 `process.env`를 통해 참조
- `config.js`에 민감 정보 없음

---

### 카테고리 2: 인증/인가 점검

#### [HIGH-1] 관리자 페이지(admin-8524.html) 삭제 상태 — 복구 시 보안 강화 필요

- **심각도:** HIGH
- **위치:** `admin-8524.html` (현재 git에서 삭제됨)
- **설명:** 관리자 대시보드 HTML이 삭제되었으나 API 엔드포인트(`api/admin.js`, `api/admin-dashboard.js`, `api/admin-init-db.js`)는 여전히 존재하고 작동 중
- **영향:** API는 `resolveAdmin()` 보호가 되어 있으나, admin HTML 복구 시 클라이언트 사이드 보안 강화 필요
- **권장 수정:**
  - admin 페이지 복구 시 URL 난독화 유지 (admin-8524.html)
  - CSP 헤더 추가
  - 세션 타임아웃 강화 (현재 30일 → admin은 2시간 권장)
  - 2FA 또는 IP 기반 추가 인증 고려

#### [MEDIUM-1] admin-init-db.js 접근 제어 확인 필요

- **심각도:** MEDIUM
- **위치:** `api/admin-init-db.js`
- **설명:** DB 초기화 엔드포인트로, resolveAdmin 보호는 있으나 프로덕션에서 실수로 호출 시 데이터 유실 가능
- **권장 수정:** 환경변수 플래그(`ALLOW_DB_INIT=true`)로 이중 보호 추가

---

### 카테고리 3: Rate Limiting

**상태: 양호**

- 모든 주요 API에 일별 rate limit 적용 확인:
  - `api/generate.js` — 이메일 기반 일별 제한
  - `api/titles.js` — 이메일 기반 일별 제한
  - `api/hooks.js` — 이메일 기반 일별 제한
  - `api/blog-image-pro.js` — IP 기반 일별 제한
  - `api/card-news.js` — IP 기반 일별 제한
  - `api/keywords.js` — 이메일/IP 기반 일별 제한
  - `api/auth.js` — 로그인/회원가입 rate limit
  - `api/threads.js` — 이메일 기반 일별 제한

#### [MEDIUM-2] skipRateLimit 로직 잔류

- **심각도:** MEDIUM
- **위치:** `api/generate.js:143-168`
- **설명:** `isAutoCorrect` 파라미터로 rate limit을 스킵하는 로직이 있음. Redis 서버사이드 검증(1일 1회)으로 보호되지만, 변수명 `skipRateLimit`이 남아있음
- **현재 보호:** Redis `autocorrect:{email}:{date}` 플래그로 1일 1회 제한 — 실제 위험도는 낮음

---

### 카테고리 4: 파일 업로드 보안

**상태: 양호**

- 파일 업로드는 `api/_r2.js`, `api/blog-image-pro.js`, `api/card-news.js`, `api/shortform-broll.js`에서 처리
- R2에 업로드 시 서버사이드에서 생성된 이미지만 업로드 (사용자 직접 업로드 아님)
- 파일명은 서버에서 UUID/해시로 생성

---

### 카테고리 5: 스토리지 보안

#### [MEDIUM-3] R2 퍼블릭 접근

- **심각도:** MEDIUM
- **위치:** `api/_r2.js`
- **설명:** R2 버킷이 CDN(cdn.ddukddaktool.co.kr)을 통해 퍼블릭 접근 가능. 이미지 파일이므로 민감도는 낮으나, URL 추측으로 다른 사용자의 생성 이미지 열람 가능
- **권장:** 이미지 URL에 충분한 엔트로피(UUID) 사용 확인. 민감한 콘텐츠는 서명된 URL 사용 검토

---

### 카테고리 6: Prompt Injection

**상태: 양호(조건부)**

- `api/generate.js`: 사용자 입력이 `messages` 배열로 전달되며, `system` 프롬프트와 분리됨
- 시스템 프롬프트 길이 제한(10,000자), 메시지 총 길이 제한(50,000자) 적용
- AI 응답이 DB 쿼리나 코드 실행에 직접 사용되지 않음

#### [LOW-1] 시스템 프롬프트를 클라이언트가 전송

- **심각도:** LOW
- **위치:** `api/generate.js:103`
- **설명:** `system` 프롬프트를 클라이언트에서 받아 사용. 현재 blog-writer.html에서만 사용하며 정상적인 설계이나, 악의적 사용자가 시스템 프롬프트를 변조하여 예상 외 출력 유도 가능
- **현재 보호:** 길이 제한 10,000자
- **권장:** 중요한 시스템 프롬프트는 서버사이드에 하드코딩 고려

---

### 카테고리 7: 정보 노출

#### [CRITICAL-1] 보안 헤더 미설정

- **심각도:** CRITICAL
- **위치:** `vercel.json`, 모든 HTML 페이지
- **설명:** Content-Security-Policy, X-Frame-Options, X-Content-Type-Options 등 보안 헤더가 전혀 설정되지 않음
- **영향:** 
  - XSS 공격 시 방어벽 없음
  - 클릭재킹(Clickjacking) 가능
  - MIME 타입 스니핑 공격 가능
- **수정 방법:** `vercel.json`에 headers 섹션 추가
```json
{
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        { "key": "X-Frame-Options", "value": "DENY" },
        { "key": "X-Content-Type-Options", "value": "nosniff" },
        { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" },
        { "key": "Permissions-Policy", "value": "camera=(), microphone=(self), geolocation=()" }
      ]
    }
  ]
}
```

#### [HIGH-2] console.error/log 92건 — 프로덕션 로깅 과다

- **심각도:** HIGH
- **위치:** API 전체 (22개 파일, 총 92건)
- **설명:** `console.error`, `console.log`가 92건 존재. Vercel 로그에 내부 에러 상세가 기록됨. 에러 메시지에 토큰, URL, 내부 경로 등이 포함될 수 있음
- **권장:** 에러 로깅은 유지하되, 민감 정보(accessToken, API 키 등)가 로그에 포함되지 않도록 필터링

#### [LOW-2] 에러 응답에 내부 정보 미노출 — 양호

- `api/admin-dashboard.js:112`: `err.message`를 로그에만 기록하고 클라이언트에는 "서버 오류" 반환 — 양호

---

### 카테고리 8: 의존성 취약점

#### [HIGH-3] loader-utils 프로토타입 오염 (CVE CVSS 9.8)

- **심각도:** HIGH (CRITICAL CVE지만 @remotion/bundler 경유 → 서버 빌드 시에만 영향)
- **위치:** `node_modules/@remotion/bundler` → `loader-utils@2.0.0-2.0.3`
- **CVE:** GHSA-76p3-8jx3-jpfq (프로토타입 오염, CVSS 9.8)
- **추가:** ReDoS 취약점 2건 (GHSA-3rfm-jhwj-7488, GHSA-hhq3-ff78-jv3g)
- **수정:** `@remotion/bundler`를 4.0.446 이상으로 업데이트
```bash
npm update @remotion/bundler
```

#### [LOW-3] 기타 의존성

- 주요 패키지(@upstash/redis, @anthropic-ai/sdk 등) 최신 상태 확인 필요

---

## 우선순위 액션 아이템

| 순위 | 심각도 | 난이도 | 액션 | 예상 소요시간 |
|------|--------|--------|------|---------------|
| 1 | CRITICAL | 낮음 | vercel.json에 보안 헤더 추가 | 10분 |
| 2 | HIGH | 낮음 | @remotion/bundler 업데이트 | 5분 |
| 3 | HIGH | 중간 | admin 페이지 복구 + 보안 강화 | 1시간 |
| 4 | HIGH | 낮음 | console.log에 민감정보 필터링 확인 | 30분 |
| 5 | MEDIUM | 낮음 | admin-init-db.js 환경변수 이중 보호 | 10분 |
| 6 | MEDIUM | 낮음 | R2 이미지 URL 엔트로피 확인 | 15분 |

---

## 전반적 평가

**이전 감사(4/5) 대비 크게 개선됨.** 핵심 보안 조치(model 화이트리스트, Redis 키 인젝션 방지, IP 처리, SQL 파라미터 바인딩)가 잘 적용되어 있음. 가장 시급한 것은 **보안 헤더 추가**와 **관리자 페이지 보안 강화 후 복구**임.
