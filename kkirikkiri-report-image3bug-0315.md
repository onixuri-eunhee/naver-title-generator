# 프리미엄 이미지 3장 버그 디버깅 리포트

- 팀명: kkirikkiri-debug-0315-image3
- 날짜: 2026-03-15
- 목표: 8개 마커 → 3장만 출력되는 버그 원인 규명 + 수정

## 팀 구성
| 역할 | 담당 | 결과 |
|------|------|------|
| 팀장 | 조사 계획 + 검증 + 수정 통합 | 3건 버그 수정 완료 |
| 백엔드 탐색자 | api/blog-image-pro.js 전체 흐름 추적 | 버그 3건 발견 |
| 프론트 탐색자 | blog-image-pro.html 마커/렌더링 검증 | 프론트 원인 없음 확인 |

## 조사 결과

### 영상 코드 혼입: 없음
- blog-image-quick.js, blog-video.js 모두 별도 파일
- blog-image-pro.js에 영상 관련 코드 혼입 흔적 없음

### 프론트엔드 원인: 없음
- 마커 추출 정규식 정상 (8개까지 slice)
- API에 마커 전체 전달 (필터링 없음)
- 응답 이미지 전수 렌더링 (자르지 않음)

## 발견 버그 3건

### 1. ip 변수 미선언 (CRITICAL)
- GET/POST rate limit에서 `getTodayKeyPro(ip)` 호출 시 `ip`가 선언되지 않음
- ES modules strict mode → ReferenceError → 500 에러
- **관리자는 rate limit 블록을 스킵하므로 이 버그에 영향받지 않음** (관리자 테스트에서 발견 불가)
- **수정:** `const ip = getClientIp(req);` 추가 (GET/POST 각각)

### 2. Haiku JSON 정규식 깨짐 (HIGH)
- `/\[[\s\S]*?\](?=[^[\]]*$)/` → Haiku가 후행 `[photo]` 등 추가 시 파싱 실패
- **수정:** `extractJsonArray()` 균형 잡힌 대괄호 매칭 함수로 교체

### 3. fal.ai rate limit → 3장만 출력 (HIGH)
- 8장을 2장씩 4배치 연속 호출 → rate limit 429 → url:null → 필터링으로 3장만 남음
- **수정:** 배치 간 500ms 딜레이 + 실패 시 1초 대기 후 1회 재시도 + maxDuration 120초

## 적용 커밋
- `c470c1c` — fix: 프리미엄 이미지 3장 버그 — ip 미선언·JSON 정규식·rate limit 3건 수정

## 검증 방법
1. 일반 회원 계정으로 로그인 → 프리미엄 이미지 생성 → 500 에러 없이 동작 확인
2. 8개 마커 포함 블로그 글 → 8장 모두 출력 확인
3. Vercel 로그에서 retry 로그 확인
