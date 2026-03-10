# 팀 작업 계획

- 팀명: kkirikkiri-dev-0311-claude-api
- 목표: 블로그 제목 생성기 + 후킹문구 생성기에 Claude API 연동 (Haiku vs Sonnet 비교 후 최적 모델 선정)
- 생성 시각: 2026-03-11

## 현재 상태 분석
- index.html (블로그 제목): JS 템플릿 12패턴 x 2 = 24개 제목. API 호출 없음.
- hook-generator.html (후킹문구): JS 템플릿 ~100개 중 15개 셔플. API 호출 없음.
- api/generate.js: 범용 Claude API 프록시 (system/messages 전달). 기본 모델 Sonnet.
- api/threads.js: 스레드 글 생성기. Haiku 사용 중.

## 팀 구성
| 이름 | 역할 | 모델 | 담당 업무 |
|------|------|------|----------|
| lead | 팀장 | Opus | 계획/배분/검증/통합 |
| analyst | 분석가 | Opus | 프롬프트/규칙 분석 + Haiku vs Sonnet 비교 |
| developer | 개발자 | Opus | API 연동 구현 |
| tester | 테스터 | Sonnet | 구현 결과 검증 |

## 태스크 목록
- [ ] 태스크 1: 두 도구의 프롬프트/규칙 구조 분석 + Haiku vs Sonnet 비교 → analyst
- [ ] 태스크 2: 분석 결과 기반 API 연동 구현 → developer
- [ ] 태스크 3: 구현 결과 검증 + API 응답 품질 확인 → tester

## 주요 결정사항
(팀장이 결정할 때마다 여기에 기록)
