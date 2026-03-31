# 팀 작업 계획

- 팀명: kkirikkiri-analysis-0331-shortform-debug
- 목표: 숏폼 제작기 4개 파일 전체 점검 + STT 502 원인 분석 + 발견 즉시 수정
- 생성 시각: 2026-03-31

## 팀 구성
| 이름 | 역할 | 모델 | 담당 업무 |
|------|------|------|----------|
| leader | 팀장 | Opus | 분석 계획/결과 통합/수정 실행 |
| api-reviewer | 코드 분석가 1 | Opus | API 3개 파일 코드 품질/보안/패턴 점검 |
| ui-reviewer | 코드 분석가 2 | Opus | UI 파일 + API 인터페이스 일치 점검 |
| codex-stt | Codex 전문가 | Codex CLI | STT 502 원인 집중 분석 |
| codex-api | Codex 전문가 | Codex CLI | B-roll/Script API 독립 검증 |

## 대상 파일
- api/shortform-script.js — HPC 대본 생성 API
- api/shortform-stt.js — Whisper STT API (502 에러 발생)
- api/shortform-broll.js — B-roll 생성 API
- shortform.html — 4단계 워크플로우 UI

## 점검 관점
1. 코드 품질 (중복, 패턴 일관성, 에러 핸들링)
2. 인터페이스 일치 (API 요청/응답 스키마 ↔ UI 호출)
3. 보안 (인증, rate limit, 입력 검증)
4. STT 502 원인 (Whisper API 호출 방식, FormData/Blob 처리)

## 태스크 목록
- [ ] 태스크 1: API 3개 파일 코드 리뷰 → api-reviewer
- [ ] 태스크 2: UI + 인터페이스 일치 리뷰 → ui-reviewer
- [ ] 태스크 3: STT 502 원인 분석 → codex-stt
- [ ] 태스크 4: B-roll/Script API 검증 → codex-api
- [ ] 태스크 5: 결과 통합 + 수정 실행 → leader
