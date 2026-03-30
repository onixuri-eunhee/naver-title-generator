# 카드뉴스 변환 PoC 구현 리포트

- 팀명: kkirikkiri-dev-0328-card-news
- 일자: 2026-03-28
- 상태: 1라운드 완료 + PM 통합 검증 완료

---

## 1. 생성된 파일 목록

| 파일 | 담당 | 크기 | 설명 |
|------|------|------|------|
| `api/card-news.js` | core-dev + PM 수정 | ~15KB | 서버 API (Claude Sonnet + Satori + Resvg) |
| `api/_card-news-themes.js` | ui-dev | ~2.2KB | 테마 프리셋 9종 |
| `api/_card-news-layouts.js` | ui-dev | ~10KB | 슬라이드 레이아웃 6종 (cover/summary/content/quote/data/cta) |
| `fonts/NotoSansKR-Regular.subset.ttf` | core-dev | ~2.4MB | 한글 서브셋 (Regular 400) |
| `fonts/NotoSansKR-Bold.subset.ttf` | core-dev | ~2.4MB | 한글 서브셋 (Bold 700) |
| `fonts/subset.cjs` | core-dev | ~2.2KB | 서브셋 빌드 스크립트 |
| `blog-writer.html` | ui-dev (수정) | 3526줄 (+498줄) | 카드뉴스 변환 UI 섹션 추가 |

---

## 2. 검증 결과 (4가지 기준)

### 2-1. 목표 달성도: PASS
- 블로그 글 → Claude Sonnet → JSON 구조화 → Satori/Resvg PNG 렌더링 파이프라인 구현 완료
- 프론트엔드 UI → POST /api/card-news → base64 PNG 배열 → 미리보기 + 개별/ZIP 다운로드

### 2-2. 완성도: PASS
- 테마 9종: cafe, beauty, fitness, food, edu, realty, clean, dark, vivid
- 슬라이드 5~10장 선택 UI 구현
- 14가지 훅 심리 공식이 시스템 프롬프트에 완전 포함
- 6종 레이아웃: cover, summary, content, quote, data, cta
- 글자수 제한 (프롬프트 + 백엔드 truncation 이중 가드)

### 2-3. 정확성: PASS (수정 후)
- Satori CSS 제약 준수: Flexbox만 사용, grid/box-shadow/filter/transform 없음
- 한글 폰트: TTF 서브셋, Satori 호환
- 기존 패턴 준수: `_helpers.js` import, INCR-first rate limit, CORS, 에러 시 decr
- JSX 미사용: 객체 리터럴 `h()` 헬퍼로 VNode 생성
- 직렬 렌더링: Promise.all 미사용 (메모리 초과 방지)

### 2-4. 일관성: PASS (수정 후)
- 프론트-백엔드 필드명 정합: core-dev가 호환 매핑 처리
- base64 응답 형식: PM이 이중 접두사 버그 수정
- GET 인증 순서: PM이 수정 (인증 없이 잔여 횟수 조회 가능)

---

## 3. 발견/수정된 버그

| ID | 심각도 | 내용 | 수정자 |
|----|--------|------|--------|
| BUG-1 | CRITICAL | 프론트 `text`/`theme` vs 백엔드 `blogText`/`themeId` 불일치 | core-dev 자체 수정 |
| BUG-2 | CRITICAL | base64에 `data:image/png;base64,` 이중 접두사 → 이미지 깨짐 | PM 수정 |
| BUG-3 | MEDIUM | ESM 파일 내 `require()` 호출 → 런타임 에러 가능 | core-dev 자체 수정 (createRequire) |
| BUG-4 | LOW | brandColor UI 존재하지만 백엔드 미사용 | 향후 반영 |
| BUG-5 | MEDIUM | GET 요청이 인증 체크에 걸려 401 반환 | PM 수정 |

---

## 4. 기술 아키텍처

```
[blog-writer.html]
  글 생성 완료 → "카드뉴스 변환" 섹션 표시
  슬라이드 수(5~10) + 테마(9종) + 브랜드컬러(선택) 선택
  → POST /api/card-news { text, slideCount, theme }

[api/card-news.js]
  인증(resolveAdmin + 세션) → Rate limit(1일 1회) →
  Claude Sonnet 4 호출 (14가지 훅 공식 시스템 프롬프트) →
  safeParseJson + validateSlides →
  Satori(VNode→SVG) + Resvg(SVG→PNG) 직렬 렌더링 →
  { images: [base64, ...], slides: [...], remaining }

[api/_card-news-themes.js]  → 9종 색상 팔레트
[api/_card-news-layouts.js] → 6종 슬라이드 VNode 생성기
[fonts/*.subset.ttf]        → Noto Sans KR 한글 서브셋
```

---

## 5. 남은 과제 (TODO)

1. **brandColor 반영**: 프론트에서 보내는 브랜드 컬러를 테마의 accent에 오버라이드하는 로직 추가
2. **Vercel 배포 테스트**: fonts/ 디렉토리가 Vercel 번들에 포함되는지 확인 (vercel.json includeFiles 설정 필요할 수 있음)
3. **quote/data 레이아웃 활용**: 현재 AI 프롬프트가 cover/summary/content/cta만 생성 지시 → quote/data 타입 활용 프롬프트 개선
4. **응답 크기 모니터링**: 10장 풀 렌더링 시 4.5MB Vercel 제한 초과 여부 확인
5. **크레딧 차감 연동**: 유료화 시 카드뉴스 크레딧 정책 결정 필요
