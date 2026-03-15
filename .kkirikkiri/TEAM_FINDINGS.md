# 발견 사항 & 공유 자료

(팀원들이 유용한 발견 시 여기에 기록)

## [backend-dev] suggest_markers 구현 노트
- handler() 최상단(인증 체크 전)에 suggest_markers 분기 배치 → 비회원도 사용 가능
- callHaikuSuggestMarkers()는 blogText를 최대 6000자까지 Haiku에 전달 (토큰 비용 절약)
- rate limit key: `ratelimit:suggest-markers:{ip}:{date}` (기존 이미지 생성 rate limit과 완전 분리)
- 프론트에서 호출 시 token 없이 mode와 blogText만 보내면 됨
- 응답 형식: `{ markers: [{ text, position }, ...] }`

## [frontend-dev] 프론트엔드 구현 노트
- detectMarkers()에서 마커 0개 + 글 있음 → suggestMarkersWrap.show 토글
- detectMarkers()에서 마커 1개 이상 → suggestMarkersWrap 숨김 (기존 동작 유지)
- suggestMarkers() 함수: POST /api/blog-image-pro { mode: 'suggest_markers', blogText }
- 응답의 markers[].text를 editableMarkers에 설정 후 renderMarkerEditor() 호출
- 추천 완료 후 기존 편집 UI 그대로 활용 (수정/삭제/추가 가능)
- 로딩 중 버튼에 인라인 loading-spinner 표시 (기존 CSS 클래스 재활용)
- 에러 시 버튼 복원 + errorBox1에 메시지 표시

---

## [tester] 코드 리뷰 결과 (2026-03-16)

### 발견 및 수정한 버그

#### Bug 1 [백엔드 — 중요]: suggest_markers rate limit 롤백 누락 → 수정 완료
- **파일**: `/api/blog-image-pro.js` (suggest_markers 분기)
- **문제 1**: `incr` 후 `count > 10`이면 `decr` 없이 429 반환 → 초과 시도마다 카운터가 계속 증가
- **문제 2**: `callHaikuSuggestMarkers()` 실패(500 에러) 시 이미 증가한 카운터를 롤백하지 않음 → 서버 오류임에도 사용 횟수 차감
- **추가 문제**: `smKey`가 `try` 블록 안에 `let`으로 선언되어 `catch`에서 접근 불가 → 롤백 자체가 구조적으로 불가능했음
- **수정**: `smKey`를 `try` 바깥 스코프에 `let smKey = null`로 선언, 429 시 `decr` 후 `smKey = null`(중복 방지), catch에서 `if (smKey) decr(smKey)` 처리

#### Bug 2 [프론트엔드 — 중요]: deleteMarker()에서 마지막 1개 삭제 불가 → 수정 완료
- **파일**: `/blog-image-pro.html` (deleteMarker 함수)
- **문제**: `if (editableMarkers.length <= 1) return` 가드로 마지막 마커 삭제가 막혀 있음. AI 추천 마커를 받은 후 전부 마음에 안 들어도 1개는 남아버림
- **수정**: 가드 제거 — 0개가 될 수 있게 허용

#### Bug 3 [프론트엔드 — 중요]: 마커 0개가 될 때 AI 추천 버튼 재표시 없음 → 수정 완료
- **파일**: `/blog-image-pro.html` (renderMarkerEditor 함수)
- **문제**: `editableMarkers.length === 0`일 때 `markerPreview`만 숨기고 `suggestMarkersWrap`를 다시 표시하지 않음. AI 추천 마커를 전부 삭제한 후 다시 추천받을 방법이 없어짐
- **수정**: 0개 분기에서 `blogText`가 있으면 `suggestMarkersWrap.show` 토글 추가. 또한 마커가 1개 이상일 때도 `renderMarkerEditor()` 상단에서 `suggestMarkersWrap` 숨김 처리를 통일

### 이상 없는 항목 (통과)

- `ip` 변수 선언: `const ip = getClientIp(req)` 479번 라인에 정상 선언 ✅ (이전 버그 패턴 없음)
- `extractJsonArray()`: suggest_markers와 marker_analysis 모두에서 사용, 균형 대괄호 파싱으로 후행 텍스트에 안전 ✅
- 크레딧 차감 없음: suggest_markers 분기가 인증 블록 이전에 위치하여 rate limit만 적용 ✅
- 기존 parse/direct/regenerate_single 흐름 간섭 없음: suggest_markers 분기에서 `return` 처리 ✅
- XSS: `textContent` 사용, `input.value` 직접 할당 — 안전 ✅
- request/response 형식 일치: `{ mode, blogText }` → `{ markers: [{text, position}] }` ✅
- 추천 마커 → generateParse 흐름: `editableMarkers` → `markersToSend` → `markers` 배열로 전달 ✅
- CSS 충돌 없음: `.suggest-markers-wrap`, `.suggest-markers-btn` 등 신규 클래스 독립 ✅

---

# DEAD_ENDS (시도했으나 실패한 접근)

(없음)
