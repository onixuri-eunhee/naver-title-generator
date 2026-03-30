# 이미지 생성 버그 수정 검수 리포트

팀: kkirikkiri-analysis-0310-review
날짜: 2026-03-10

---

## 검수 대상

블로그 이미지 생성 시 맥락 무시 버그 수정 작업 전체
- `api/blog-image.js` — Haiku 프롬프트 강화, fallback 재설계, FLUX 접미사 변경, 로그 추가
- `blog-image.html` — 썸네일 텍스트 필수화

## 검수 결과 요약

| 구분 | Critical | Warning | Info |
|------|----------|---------|------|
| API (blog-image.js) | 0 | 4 | 5 |
| 프론트엔드 (blog-image.html) | 0 | 2 | 2 |
| **합계** | **0** | **6** | **7** |

**Critical 이슈 없음. Warning 6건 모두 수정 완료.**

---

## Warning 수정 내역

### 1. Fallback에서 dalle 맹목 배정 → 전부 flux 통일
- **문제**: Haiku 실패 시 1차 fallback에서 처음 2개 마커를 무조건 dalle로 배정. 풍경/음식 마커면 비용 낭비 + 품질 저하.
- **수정**: 전부 flux로 통일 (fallback에서는 dalle/flux 판단 불가)

### 2. FLUX 프롬프트에서 Korean 컨텍스트 누락
- **문제**: "Korean lifestyle photography" 접미사 제거 후, Haiku에 Korean 컨텍스트 포함 규칙이 없어 서양 스타일 이미지 생성 가능.
- **수정**: Haiku 시스템 프롬프트에 "MUST include Korean or East Asian context in every prompt" 규칙 추가

### 3. 8개 미만 마커 개수 불일치 시 즉시 에러 → 영어 generic fallback
- **문제**: Claude가 가끔 마커 수와 다른 프롬프트를 반환하면 사용자가 500 에러를 받음.
- **수정**: 순수 영어 generic 프롬프트로 대체하여 이미지 생성 계속

### 4. generic fallback "product photography" → Korean 범용 프롬프트
- **문제**: "product photography"는 여행/음식/일상 블로그에 부적합 + Korean 컨텍스트 누락.
- **수정**: "high quality Korean lifestyle blog photography" 로 변경

### 5. regenerateAll() catch 블록 빈 상태
- **문제**: 네트워크 오류 시 사용자에게 아무 피드백 없이 조용히 실패.
- **수정**: showError()로 에러 메시지 표시 추가

### 6. 에러 메시지 문구 불일치
- **문제**: 라벨은 "대표이미지에 합성"인데 에러는 "대표이미지 선정에 필요"로 표현 충돌.
- **수정**: 4곳 모두 "대표이미지에 텍스트가 합성됩니다."로 통일

---

## 긍정적 확인사항

- Haiku 시스템 프롬프트: blogSummary 300자 + blogTitle + blogStructure + 마커 200자 context → 맥락 파악 충분
- Fallback 이중 안전장치: 1차(번역 재시도) → 2차(에러 반환) → 한글 FLUX 직접 전달 완전 차단
- 썸네일 필수 검증: generateParse/generateDirect/regenerateAll 3곳 모두 정상 동작
- 디버깅 로그: [IMAGE] 태그 일관적, 민감정보 노출 없음
- rateLimitKey 크레딧 복원: 모든 에러 경로에서 정상 처리
