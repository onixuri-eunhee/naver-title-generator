# 뚝딱툴 시스템 프롬프트 공유

이 폴더는 뚝딱툴 웹사이트가 `/api/generate`를 호출할 때 사용하는 **원본 시스템 프롬프트**를 비서에게 공유하는 공간입니다.

## ⚠️ 가장 중요한 원칙

**대부분의 기능은 전용 API 엔드포인트를 써야 합니다. 거기엔 규칙이 이미 서버에 내장되어 있습니다.**

| 기능 | 비서가 써야 할 엔드포인트 | 이 폴더의 프롬프트 필요? |
|------|-----------------------|----------------------|
| 제목 생성 | `/api/titles` | ❌ 불필요 (서버 내장) |
| 후킹 멘트 | `/api/hooks` | ❌ 불필요 |
| 스레드 | `/api/threads` | ❌ 불필요 |
| 카드뉴스 | `/api/card-news` | ❌ 불필요 |
| 황금키워드 | `/api/keywords` | ❌ 불필요 |
| 숏폼 대본 | `/api/shortform-script` | ❌ 불필요 |
| 프리미엄 이미지 | `/api/blog-image-pro` | ❌ 불필요 |
| **블로그 글 작성** | `/api/generate` + **이 폴더의 프롬프트** | ✅ **필수** |

→ **비서가 만약 지금 모든 기능을 `/api/generate`로 호출하고 있다면, 위 표대로 전용 엔드포인트로 바꿔주세요.** 그것만으로 대부분의 "규칙 미적용" 문제가 해결됩니다.

---

## 블로그 글 작성 플로우 (유일하게 `/api/generate`를 쓰는 경우)

뚝딱툴 웹사이트의 `blog-writer.html`은 3가지 시스템 프롬프트 × 4가지 톤 가이드를 조합해서 `/api/generate`를 호출합니다. 비서도 동일하게 해야 같은 품질의 글이 나옵니다.

### 1단계: 유형 선택 (3종)

| 파일 | 대상 | 특징 |
|------|------|------|
| `blog-writer-homefeed.md` | 네이버 홈피드(홈판) 노출 | 보편적 감정/호기심, 2200자 |
| `blog-writer-naver-seo.md` | 네이버 VIEW 검색 상위노출 | C-Rank/D.I.A 최적화, 2200자 |
| `blog-writer-google-seo.md` | 구글 검색 상위노출 | E-E-A-T, FAQ 포함, 2500자 |

### 2단계: 톤 선택 (4종)

`blog-writer-tones.md`에서 아래 중 하나:
- 친근한 구어체
- 전문가 톤
- 스토리텔링
- 간결 실용체

### 3단계: 호출

```http
POST /api/generate
Content-Type: application/json
Authorization: Bearer <token>

{
  "model": "claude-sonnet-4-20250514",
  "max_tokens": 8192,
  "system": "<선택한 유형 파일 전체 내용>",
  "messages": [
    { "role": "user", "content": "<blog-writer-user-template.md에 따라 작성한 유저 메시지>" }
  ]
}
```

### 4단계: 응답 파싱

응답은 JSON 형태입니다 (필드는 유형별로 조금씩 다름):

**homefeed / naver-seo**:
```json
{
  "title": "...",
  "hook": "...",
  "body": "... (사진: ...) 마커 8개 포함 ...",
  "cta": "...",
  "tags": [...],
  "internal_links": [...],
  "corrections": [...]
}
```

**google-seo** (위 + `meta_description`, `faq`):
```json
{
  "title": "...",
  "meta_description": "...",
  "hook": "...",
  "body": "... (이미지: ...) 마커 8개 ...",
  "faq": "...",
  "cta": "...",
  "tags": [...],
  "internal_links": [...],
  "corrections": [...]
}
```

**중요**: 응답의 `body`에는 **이미 8개의 이미지 마커가 포함**되어 있습니다. 이 `body`를 그대로 `/api/blog-image-pro`의 `blogText`로 넘기면 8장 이미지가 자동 생성됩니다.

---

## 파일 목록

- `README.md` — 이 파일
- `blog-writer-homefeed.md` — 네이버 홈피드용 시스템 프롬프트
- `blog-writer-naver-seo.md` — 네이버 SEO용 시스템 프롬프트
- `blog-writer-google-seo.md` — 구글 SEO용 시스템 프롬프트
- `blog-writer-tones.md` — 톤 가이드 4종 (모든 유형에 조합)
- `blog-writer-user-template.md` — 유저 메시지 조립 템플릿

---

## 업데이트 정책

이 파일들은 **뚝딱툴 웹사이트의 `blog-writer.html`에서 추출**한 것으로, 웹사이트가 업데이트되면 이 파일들도 업데이트됩니다. 비서는 주기적으로 `git pull`해서 최신 버전을 받아주세요.

마지막 업데이트: 2026-04-10 (blog-writer.html 기준)
