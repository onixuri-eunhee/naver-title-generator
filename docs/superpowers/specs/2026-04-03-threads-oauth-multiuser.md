# Threads OAuth 다중 사용자 연동 설계

## 목표
일반 회원이 마이페이지에서 자신의 Threads 계정을 연결하고, 스레드 도구에서 자기 계정으로 직접 발행할 수 있도록 한다.

## 결정 사항

| 항목 | 결정 |
|------|------|
| 대상 | 모든 로그인 회원 |
| 계정 수 | 1인 1계정 (추후 프리미엄으로 멀티 계정 확장) |
| 발행 위치 | 스레드 도구(threads.html)에서 바로 |
| 연결/해제 | 마이페이지에서 토글 |
| 관리자 | 환경변수 토큰 분리 유지 (OAuth 사용 안 함) |

## OAuth 흐름

```
마이페이지 "Threads 연결" 클릭
  → GET /api/threads-auth?action=authorize
  → 302 Redirect → https://threads.net/oauth/authorize?client_id=...&redirect_uri=...&scope=threads_basic,threads_content_publish&response_type=code&state={session_token}
  → 사용자 로그인 & 권한 허용
  → GET /api/threads-auth?action=callback&code=...&state=...
  → POST https://graph.threads.net/oauth/access_token (code → 단기 토큰)
  → GET https://graph.threads.net/access_token?grant_type=th_exchange_token&client_secret=...&access_token=... (단기 → 장기 토큰, 60일)
  → Redis에 저장
  → 302 Redirect → /mypage.html?threads=connected
```

## API: `/api/threads-auth.js`

### `GET ?action=authorize`
- 로그인 필수 (Bearer 토큰으로 세션 확인)
- state 파라미터에 세션 토큰 포함 (CSRF 방지)
- OAuth URL로 302 리디렉트

### `GET ?action=callback`
- code + state 수신
- state에서 세션 토큰 검증
- 단기 토큰 발급 → 장기 토큰 교환
- Threads user ID + username 조회: `GET https://graph.threads.net/v1.0/me?fields=id,username&access_token=...`
- Redis에 저장
- `/mypage.html?threads=connected`로 리디렉트

### `GET ?action=status`
- 로그인 필수
- Redis에서 연결 상태 조회
- 응답: `{ connected: true/false, username: "...", connectedAt: "..." }`

### `POST ?action=disconnect`
- 로그인 필수
- Redis에서 토큰 삭제
- 응답: `{ success: true }`

## Redis 저장 구조

```
키: threads:user:{email}
값: {
  userId: "26798252169782814",
  accessToken: "THAAd...",
  username: "lboss_reboot",
  connectedAt: "2026-04-03T00:00:00Z",
  expiresAt: "2026-06-02T00:00:00Z"
}
TTL: 60일 (토큰 만료와 동일, 5184000초)
```

## 환경변수

기존 환경변수에 추가:
- `THREADS_APP_ID`: Threads 앱 ID (비즈니스 앱 통과 후 교체)
- `THREADS_APP_SECRET`: Threads 앱 시크릿

기존 유지 (관리자 전용):
- `THREADS_USER_ID`: 관리자 사용자 ID
- `THREADS_ACCESS_TOKEN`: 관리자 액세스 토큰

## threads-publish.js 수정

```
기존: resolveAdmin → 환경변수 토큰으로 발행
변경:
  1. resolveAdmin → 환경변수 토큰 (관리자, 기존과 동일)
  2. 일반 회원 → 세션에서 email 추출 → Redis에서 threads:user:{email} 조회 → 사용자 토큰으로 발행
  3. 토큰 없음 → 403 "Threads 계정을 먼저 연결해주세요"
```

## threads-schedule.js 수정

현재 관리자 전용 → 일반 회원도 사용 가능하도록 확장:
- 세션에서 email 추출
- QStash 콜백 body에 email 포함
- threads-callback.js에서 email로 사용자 토큰 조회 후 발행

## threads.html 수정

현재: `resolveAdmin` 결과로 발행 버튼 표시/숨김
변경:
1. 페이지 로드 시 `/api/threads-auth?action=status` 호출
2. Threads 연결됨 → 발행/예약 버튼 표시
3. 미연결 → "Threads 계정을 연결하면 바로 발행할 수 있어요" 안내 + 마이페이지 링크
4. 관리자는 기존과 동일하게 항상 표시

## mypage.html 수정

사용자 정보 카드 아래에 "Threads 연결" 카드 추가:

**미연결 상태:**
```
[Threads 계정 연결]
Threads 계정을 연결하면 생성한 글을 바로 발행할 수 있습니다.
[연결하기] 버튼
```

**연결 상태:**
```
[Threads 계정]
@lboss_reboot 연결됨 (2026.04.03)
[연결 해제] 버튼
```

## Meta 앱 설정

비즈니스 앱 심사 통과 후:
- 리디렉션 콜백 URL에 `https://ddukddaktool.co.kr/api/threads-auth` 추가
- `THREADS_APP_ID`, `THREADS_APP_SECRET`을 비즈니스 앱 값으로 교체

테스트 기간에는 개인 앱(엘보스리부트 스레드자동화) 사용:
- 리디렉션 콜백 URL에 `https://ddukddaktool.co.kr/api/threads-auth` 추가 필요

## 토큰 만료 처리

- 장기 토큰: 60일 유효
- 만료 시 발행 실패 → 사용자에게 "Threads 연결이 만료되었습니다. 마이페이지에서 다시 연결해주세요" 에러
- Redis TTL 60일로 설정하여 자동 삭제
- (향후) 만료 7일 전 알림 기능 추가 가능

## 건드리지 않는 것

- 관리자 발행 로직 (환경변수 방식 그대로)
- 스레드 글 생성 API (api/threads.js) 로직
- 가격/크레딧 정책 (발행 자체는 무료, 글 생성에만 횟수 제한)

## 향후 확장

- 프리미엄 멀티 계정: 2번째 계정부터 유료 (크레딧 or 구독)
- 토큰 자동 갱신: 만료 전 백그라운드 리프레시
- 발행 히스토리: 사용자별 발행 기록 저장
