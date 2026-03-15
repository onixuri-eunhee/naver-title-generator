# 팀 작업 계획

- 팀명: kkirikkiri-dev-0316-suggest-markers
- 목표: 프리미엄 이미지 생성기에 "마커 없는 글에서 AI가 이미지 위치를 자동 추천" 기능 구현
- 생성 시각: 2026-03-16

## 기능 요구사항
- 사용자가 (사진: ...) 마커 없이 블로그 글을 붙여넣으면
- Haiku가 글을 분석해서 이미지 삽입 최적 위치 4~8곳을 추천
- 프론트에서 편집 가능한 마커로 표시
- 사용자 확인 후 기존 이미지 생성 흐름 진행

## 제약사항
- 마커 추천은 크레딧 차감 없이 무료 (Haiku 비용 미미)
- rate limit: IP당 일 10회 (기존과 별도)
- 추천된 마커는 사용자가 수정/삭제/추가 가능
- 기존 마커 있는 글의 동작은 변경 없음

## 팀 구성
| 이름 | 역할 | 모델 | 담당 업무 |
|------|------|------|----------|
| lead | 팀장 | Opus | 계획/배분/검증/통합 |
| backend-dev | 백엔드 개발자 | Opus | api/blog-image-pro.js에 suggest_markers 모드 추가 |
| frontend-dev | 프론트 개발자 | Opus | blog-image-pro.html에 마커 자동 추천 UI 구현 |
| tester | 테스터 | Sonnet | 구현 코드 리뷰 + 버그 검증 |

## 태스크 목록
- [ ] 태스크 1: api/blog-image-pro.js에 suggest_markers 모드 구현 → backend-dev
- [ ] 태스크 2: blog-image-pro.html에 마커 추천 UI 구현 → frontend-dev
- [ ] 태스크 3: 구현 코드 리뷰 + 버그 검증 → tester

## 주요 결정사항
(팀장이 결정할 때마다 여기에 기록)
