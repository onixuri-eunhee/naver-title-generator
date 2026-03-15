# 진행 상황

- [backend-dev] 2026-03-16 작업 시작: api/blog-image-pro.js에 suggest_markers 모드 구현
- [backend-dev] 2026-03-16 작업 완료: suggest_markers 모드 구현 완료
- [frontend-dev] 2026-03-16 작업 시작: blog-image-pro.html에 마커 추천 UI 구현
- [frontend-dev] 2026-03-16 작업 완료: 마커 추천 UI 구현 완료 (CSS + HTML + JS)
- [tester] 2026-03-16 리뷰 완료: 버그 3건 발견 및 직접 수정 완료
  - [백엔드] suggest_markers rate limit 롤백 누락 (smKey 스코프 버그 포함) → api/blog-image-pro.js 수정
  - [프론트] deleteMarker 마지막 1개 삭제 불가 → blog-image-pro.html 수정
  - [프론트] 마커 0개 시 AI 추천 버튼 재표시 누락 → blog-image-pro.html 수정
