# 내부 비서팀 API 키 — 가이드

> 도입 일자: 2026-04-30
> 목적: 14개 AI 비서팀이 만료 없는 영구 키로 뚝딱툴 API 호출. 매월 30일 토큰 갱신 부담 제거.
> 위치: `lib/api-helpers.js` 내 `resolveAuthIdentity()` · `resolveInternalIdentity()`

## 1. 권한 모델

| 권한 | 일반 사용자 | 내부 비서팀 (Internal) | Admin |
|---|---|---|---|
| API 호출 | ✅ (크레딧 차감) | ✅ **무제한 + 크레딧 차감 X** | ✅ |
| Rate limit | ✅ 적용 | **우회** | 일반과 동일 |
| Admin 페이지 (`/admin`, `/admin-dashboard`) | ❌ | ❌ | ✅ |
| 사용자 데이터·매출 조회 | ❌ | ❌ | ✅ |
| 토큰 만료 | 30일 TTL | **만료 없음 (영구)** | 30일 TTL |

## 2. 환경변수

`.env`:
```
INTERNAL_API_KEYS=sk_internal_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx:bot@reditowed.com
```

다중 키 (콤마 구분):
```
INTERNAL_API_KEYS=sk_xxx:bot1@e.com,sk_yyy:bot2@e.com
```

## 3. 호출 방법 (비서팀 → 뚝딱툴)

### Bearer token 방식 (기존 사용자 흐름)
```bash
curl -H "Authorization: Bearer 64자hex_token" \
  https://ddukddaktool.co.kr/api/...
```

### Internal Key 방식 (비서팀 — 신규)
```bash
curl -H "X-Internal-Key: sk_internal_xxxxxxxxxxxx" \
  https://ddukddaktool.co.kr/api/...
```

→ 둘 중 어느 헤더든 인증 통과. Internal Key 우선 검사.

## 4. 보호 API 라우트에서 사용

기존 패턴:
```js
import { extractToken, resolveSessionEmail, jsonResponse } from '@/lib/api-helpers';

const token = extractToken(request);
const email = await resolveSessionEmail(token);
if (!email) return jsonResponse(request, { error: '인증 필요' }, { status: 401 });
```

신규 통합 패턴 ⭐:
```js
import { resolveAuthIdentity, jsonResponse } from '@/lib/api-helpers';

const auth = await resolveAuthIdentity(request);
if (!auth) return jsonResponse(request, { error: '인증 필요' }, { status: 401 });

// auth.email · auth.isInternal · auth.isAdmin 사용
if (!auth.isInternal) {
  // 일반 사용자만: 크레딧 차감 + rate limit 검사
  await deductCredit(auth.email);
}
```

## 5. 키 발급 방법

```bash
# 32바이트 랜덤 → 64자 hex (sk_internal_ prefix 포함)
node -e "console.log('sk_internal_' + require('crypto').randomBytes(32).toString('hex'))"
```

발급 후:
1. Vercel 환경변수 `INTERNAL_API_KEYS`에 추가 (`{key}:{email}`)
2. 1Password vault `뚝딱툴 봇`에 저장
3. 비서팀 운영 환경(`.env`)에 `DDUKDDAK_INTERNAL_KEY=sk_internal_xxx` 박음

## 6. 키 회수 (유출 시 또는 정기 회전)

1. Vercel 환경변수 `INTERNAL_API_KEYS`에서 해당 키 삭제 (`re-deploy` 자동 적용)
2. 새 키 발급 → 같은 자리에 갱신
3. 1Password vault 갱신

## 7. 보안 룰

- 키는 **timing-safe 비교** (`crypto.timingSafeEqual`) — 타이밍 공격 차단
- 평문 환경변수만 사용 (Bcrypt 해시 X — admin이 직접 키 비교해야 빠름. 환경변수 자체가 secret)
- 키 노출 금지: 카톡/슬랙/이메일 평문 X, Notion/Google Doc 공유 X, GitHub 커밋 X
- 1Password vault만 사용 (또는 Vercel UI 직접 입력)
- 비서팀 사용량 모니터링 (admin-dashboard에 카운트 추가 — Phase 2)

## 8. 운영 모니터링 (TBD — Phase 2)

- admin-dashboard에 비서팀 호출 카운트·시간 분포 대시보드
- 일일 임계치 초과 시 텔레그램 알림 (이상 트래픽 = 키 유출 신호)
- Redis: `internal:usage:{email}:{YYYYMMDD}` incr 카운터

## 9. 관련 결정 메모리

- `feedback_canva_mcp_deprecated.md` — 외부 도구 안전성 결정 패턴
- `project_ddukddak_bot_credentials.md` — 결정 사건 로그 (2026-04-30)
