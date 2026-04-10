# 뚝딱툴 API 사용 가이드 (봇 전용)

> **Base URL**: `https://ddukddaktool.co.kr`
> **인증 방식**: 세션 토큰 (Bearer) — 로그인 후 30일 유효
> **응답 형식**: JSON (이미지는 URL로 반환)

## 공통 헤더

```http
Content-Type: application/json
Authorization: Bearer <session_token>
```

---

## 1. 인증

### 1-1. 로그인 — `POST /api/auth?action=login`

```json
Request:
{
  "email": "xxx@xxx.com",
  "password": "xxx"
}

Response 200:
{
  "user": { "email": "...", "name": "...", "credits": 0, "isAdmin": false },
  "token": "세션_토큰"
}
```

> **중요**: `token`을 저장해서 이후 모든 요청의 `Authorization` 헤더에 넣으세요.

### 1-2. 내 정보 — `GET /api/auth?action=me`

```http
Authorization: Bearer <token>
```

---

## 2. 블로그 글 생성 — `POST /api/generate`

Claude를 호출해 텍스트를 생성합니다. 블로그 글, 자동수정, 기타 텍스트 작업에 사용.

```json
Request:
{
  "system": "시스템 프롬프트 (선택)",
  "messages": [
    { "role": "user", "content": "블로그 글 써줘..." }
  ],
  "model": "claude-sonnet-4-20250514",
  "max_tokens": 4000,
  "isAutoCorrect": false
}

Response 200:
{
  "content": [{ "type": "text", "text": "생성된 글..." }],
  "remaining": 4,
  "limit": 5
}
```

**파라미터**:
- `model`: `claude-sonnet-4-20250514` (기본) 또는 `claude-haiku-4-5-20251001`
- `max_tokens`: 최대 8192
- `isAutoCorrect`: 자동수정 모드 (하루 1회 무료 체크)

**4/25 이후**: 1크레딧 차감. 잔액 부족 시 `402 INSUFFICIENT_CREDITS`

---

## 3. 제목 생성 — `POST /api/titles`

```json
Request:
{
  "keyword": "피부과 시술",
  "mode": "seo"
}

Response 200:
{
  "results": { ... },
  "remaining": 4,
  "limit": 5
}
```

**영구 무료** — 일 5회 (로그인 회원).

---

## 4. 후킹 멘트 — `POST /api/hooks`

```json
Request:
{
  "topic": "블로그 첫 문장",
  "tone": "casual"
}

Response 200:
{
  "results": [...],
  "remaining": 4,
  "limit": 5
}
```

**영구 무료** — 일 5회.

---

## 5. 프리미엄 이미지 — `POST /api/blog-image-pro`

### 5-1. Parse 모드 (블로그 글 → 이미지)

블로그 본문에 `(사진: 설명)` 또는 `(이미지: 설명)` 마커를 포함시키면 해당 마커를 이미지로 변환.

> **중요**: Parse 모드는 **마커 1개 = 이미지 1장** 입니다.
> - 본문에 마커 3개 넣으면 → 3장 생성
> - 본문에 마커 8개 넣으면 → 8장 생성 (최대 `MAX_MARKERS = 8`)
> - 8장이 기본이 아니라 **본문에 포함된 마커 수만큼** 생성됩니다.
> - 8장 고정으로 뽑고 싶으면 Direct 모드(5-2)를 쓰세요.

```json
Request:
{
  "mode": "parse",
  "blogText": "오늘은 커피에 대해 얘기해볼게요.\n\n(사진: 원두 클로즈업)\n\n모닝 루틴에는...",
  "thumbnailText": "커피 한잔의 여유"
}

Response 200:
{
  "mode": "parse",
  "images": [
    { "url": "https://...", "marker": "원두 클로즈업", "type": "photo", "model": "fluxr", "r2Url": "..." },
    ...
  ],
  "thumbnailText": "커피 한잔의 여유",
  "remaining": 2,
  "limit": 3
}
```

**권장**: 마커는 본문에 직접 삽입하세요. 별도 `markers` 배열로 보내면 "AI 추천 마커" 경로로 분기되어 품질이 떨어질 수 있습니다.

### 5-2. Direct 모드 (주제 → 이미지 8장)

```json
Request:
{
  "mode": "direct",
  "topic": "커피 로스팅 과정",
  "mood": "bright",
  "thumbnailText": "커피 한잔의 여유"
}

Response 200:
{
  "mode": "direct",
  "images": [ { "url": "..." }, ... 8장 ],
  "remaining": 2
}
```

**mood 옵션**: `bright` | `warm` | `cozy` | `minimal` | `vivid`

### 5-3. Regenerate Single (개별 재생성)

```json
Request:
{
  "mode": "regenerate_single",
  "blogText": "...",
  "markerText": "원두 클로즈업",
  "originalPrompt": "coffee beans close-up...",
  "originalType": "photo",
  "originalModel": "nb2"
}
```

**크레딧**: 전체 생성 3cr, 개별 재생성 1cr (4/25 이후)

---

## 6. 카드뉴스 — `POST /api/card-news`

```json
Request:
{
  "text": "블로그 글 본문 (100자 이상, 30000자 이하)",
  "title": "블로그 제목 (선택)",
  "slideCount": 7,
  "theme": "clean",
  "brandPrimary": "#ff5f1f",
  "brandSecondary": "#1a1a2e",
  "snsHandle": "@your_handle"
}

Response 200:
{
  "slides": [
    { "type": "cover", "imageBase64": "data:image/png;base64,..." },
    ...
  ],
  "remaining": 2
}
```

**테마**: `clean` | `charcoal` | `midnight` | `ocean` | `sage` | `indigo` | `coral` | `teal` | `lavender` (전 14종)
**slideCount**: 5~10

---

## 7. 황금키워드 — `POST /api/keywords`

```json
Request:
{
  "field": "뷰티",
  "role": "1인 사업가",
  "target": "30~40대 여성",
  "questions": "피부 고민을 어떻게 해결?",
  "userSeeds": "피부과, 시술"
}

Response 200:
{
  "results": [
    { "keyword": "...", "score": 85, "searchVolume": 12000, "grade": "A" },
    ...
  ],
  "remaining": 2
}
```

---

## 8. 스레드 — `POST /api/threads`

```json
Request:
{
  "type": "experience",
  "tone": "casual",
  "industry": "웨딩",
  "target": "예비 신부",
  "topic": "웨딩 플래너가 알려주는 꿀팁",
  "memo": "추가 맥락..."
}

Response 200:
{
  "results": [ { "text": "...", "charCount": 180 }, ... ],
  "remaining": 4
}
```

---

## 9. 숏폼 대본 — `POST /api/shortform-script`

```json
Request:
{
  "topic": "피부과 시술 후기",
  "blogText": "본문... (선택)",
  "tone": "casual",
  "targetDurationSec": 30,
  "concept": "cinematic"
}

Response 200:
{
  "script": {
    "hook": "...",
    "point": "...",
    "cta": "...",
    "scenes": [...]
  }
}
```

**targetDurationSec**: `30` | `45` | `60` | `90`
**concept**: `cinematic` | `minimal` | `dynamic` | `natural` | `random`

---

## 공통 에러

| 상태 | 의미 | 대응 |
|------|------|------|
| **401** | 토큰 만료/누락 | 재로그인 필요 |
| **402** | 크레딧 부족 (4/25 이후) | 충전 유도 |
| **429** | 일일 한도 초과 | 다음날까지 대기 |
| **500** | 서버 내부 오류 | `docs/bot-feedback/reports/`에 리포트 작성 |
| **502** | 외부 API (fal.ai, Anthropic 등) 실패 | 재시도 후에도 지속되면 리포트 |

---

## 봇 구현 시 주의사항

1. **세션 토큰 만료 대응**: 401 받으면 자동 재로그인 로직 넣을 것
2. **429 백오프**: 일일 한도 초과는 자정(KST) 리셋
3. **크레딧 잔액 확인**: 4/25 이후 중요한 작업 전에 `GET /api/auth?action=me`로 잔액 체크
4. **이미지 URL 만료**: fal.ai URL은 임시 — `r2Url` 필드를 우선 사용 (영구 저장)
5. **타임아웃**: 일부 API는 300초까지 걸림 (이미지 8장, 카드뉴스) — 클라이언트 타임아웃 여유있게

---

## 문제 발생 시

`docs/bot-feedback/TEMPLATE.md`를 복사해서 `docs/bot-feedback/reports/NNN-제목.md`로 작성 → commit & push → 사용자에게 알림.

개발자 측에서 리포트 파일에 답변 작성 후 수정 반영됩니다.
