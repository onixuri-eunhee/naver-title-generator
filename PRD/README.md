# 뚝딱툴 숏폼 v2 -- 디자인 문서

> Show Me The PRD + Deep Research로 생성됨 (2026-04-09)

## 문서 구성

| 문서 | 내용 | 언제 읽나 |
|------|------|----------|
| [01_PRD.md](./01_PRD.md) | 뭘 만드는지, 누가 쓰는지, 전체 파이프라인 | 프로젝트 시작 전 |
| [02_DATA_MODEL.md](./02_DATA_MODEL.md) | 데이터 구조 (5개 엔티티) | API 설계할 때 |
| [03_PHASES.md](./03_PHASES.md) | Phase 1~3 단계별 계획 | 개발 순서 정할 때 |
| [04_PROJECT_SPEC.md](./04_PROJECT_SPEC.md) | AI 규칙, 기술 스택, 환경변수 | AI에게 코드 시킬 때마다 |

## 리서치 기반

이 기획서는 딥리서치 결과를 반영했습니다:
- `RESEARCH/shortform-automation-pipeline_20260409/` — 경쟁사 7사 + 기술 스택 비교 + 47개 소스

## 다음 단계

Phase 1을 시작하려면 [03_PHASES.md](./03_PHASES.md)의 **"Phase 1 시작 프롬프트"**를 복사해서 AI에게 주세요.

## 미결 사항

- [ ] YouTube Data API 쿼터 관리 정책
- [ ] Supertone Play API 키 발급 + OBT 가격 확인
- [ ] Kling 3.0 fal.ai I2V 지원 여부 확인
- [ ] 벤치마킹 실패 시 폴백 전략 세부 설계
- [ ] 크레딧 과금 조정 여부 (v2 원가 $0.44 반영)
- [ ] BenchmarkResult 캐시 TTL 적정값
- [ ] ProductionPlan DB 저장 여부 (기획서 재사용)
