---
id: 001
title: 프리미엄 이미지 파싱 시 폴백 발생 (200 OK이지만 품질 저하)
status: closed
severity: high
reporter: bot
created: 2026-04-10
closed: 2026-04-10
api_endpoint: /api/blog-image-pro
---

## 증상

`/api/blog-image-pro` parse 모드 호출 시 응답의 `images[].reason`이 다음과 같이 찍히며 모델이 `imagen3`가 아닌 `fluxr`/`nb2`로 폴백됨:

- `"FLUX Realism 실패 → FLUX Realism 대체"` — 1차 시도 실패 후 Flux로 폴백
- `"AI 추천 마커 → 번역 실패 → 기본 사진"` — 번역 실패 후 기본 사진으로 폴백

## 재현 방법

요청:
```http
POST /api/blog-image-pro
{
  "mode": "parse",
  "blogText": "...",
  "markers": [...]    ← 이게 트리거
}
```

응답 200 OK, 하지만 `images[].reason`에 폴백 메시지가 있고, 여러 장이 거의 동일한 generic 사진으로 나옴.

## 기대 동작

- Imagen 3 / FLUX Realism / Satori 템플릿이 라우팅에 따라 정상 작동
- 각 마커에 맞는 개별 프롬프트로 다양한 이미지 생성

## 실제 동작

- 번역 실패 경로: 5~8장이 전부 같은 generic 프롬프트로 생성됨
- FLUX 재시도 경로: 같은 엔진으로 재시도 → 의미 없는 retry

## 추가 정보

- 계정: onixuri@gmail.com
- 호출 시각: 2026-04-10
- 인증: admin: true, remaining: 999
- 반복 발생 여부: `markers` 배열 직접 전달 시 매번

---

## 개발자 답변

- 확인일: 2026-04-10
- 원인:
  1. **번역 실패 폴백 버그**: Claude 번역 응답이 JSON 파싱 실패하거나 마커 개수 mismatch일 때, 서버가 **모든 마커를 동일한 generic 프롬프트**로 대체했음
  2. **FLUX 재시도 로직**: `fluxr` 실패 시 **같은 모델로 재시도**하던 코드 → 실질적 효과 없음

- 수정 커밋: `1283ece`
  - `api/blog-image-pro.js`
  - 번역 실패 시 → 마커별 다른 프롬프트 생성 (마커 텍스트 + 라우팅 정보 기반)
  - FLUX 실패 시 → Imagen 3로 교차 폴백 (다른 엔진 시도)
  - reason 라벨 명확화

- 봇 측 권장 사항:
  - **가능하면 `markers` 배열 대신 `blogText` 본문에 `(사진: 설명)` 형식으로 마커 삽입** → "AI 추천 마커" 경로를 피해서 더 정확한 Haiku 라우팅과 프롬프트 품질 확보
  - 불가피하게 `markers` 배열을 써야 한다면, 마커 텍스트를 **구체적이고 다양하게** 작성 (예: "커피잔 오버헤드 샷" > "커피")

- status: **fixed** (봇 재테스트 후 `closed`/`reopened` 처리 바람)

---

## 봇 재테스트 결과 (2026-04-10)

| 항목 | 결과 |
|------|------|
| 이미지 생성 | 3장 (썸네일 + 본문 2장) |
| 본문 이미지 크기 | 1.6MB/장 (Flux 대비 10배 이상) |
| 모델명 | nb2 일관 (fluxr 폴백 사라짐) ✅ |
| 에러 | 없음 ✅ |

**폴백 문제는 해결됨.** nb2는 뚝딱툴 내부 코드명이고 실제로는 Imagen 3 계열입니다 (파일 크기 및 Google C2PA 서명으로 확인).

**장 수 질문**: 3장만 나온 건 Parse 모드 특성입니다. Parse는 본문에 있는 `(사진: ...)` 마커 개수만큼 생성합니다. 8장 고정은 Direct 모드를 써야 합니다. (api-guide.md 5-1 섹션 보강 완료)

status: **closed**
