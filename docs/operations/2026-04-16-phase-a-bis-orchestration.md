# Phase A-bis Orchestration

## 4-에이전트 운영 현황

| 세션 | Worktree | 브랜치 | 상태 |
|---|---|---|---|
| #1 Orchestrator | `~/Desktop/naver-title-generator` | main | 운영 중 |
| #2 Lib-Leaf | `.worktrees/phase-a-bis-lib` | feat/shortform-a-bis-lib | 대기 |
| #3 API+Prompt | `.worktrees/phase-a-bis-api` | feat/shortform-a-bis-api | 대기 |
| #4 Remotion+UI | `.worktrees/phase-a-bis-remotion` | feat/shortform-a-bis-remotion | 대기 |
| #5 Tests | `.worktrees/phase-a-bis-tests` | feat/shortform-a-bis-tests | 대기 |

## 시작 순서 (의존성 그래프)

```
Day 0 (ESM 셋업): 완료 (commit 5c5d25b). 4개 worker 동시 출발 가능.

Day 1:
  #2 Lib-Leaf 시작
    ├─ settings.js 빈 껍데기 + 시그니처 commit → #3, #5 대기 해제
    └─ cta-variants.js commit → #4 대기 해제 (부분)

Day 1~2:
  #3 API+Prompt 시작 (#2 settings.js 이후)
    ├─ prompt.js 5 섹션 함수 헤더 commit
    ├─ scene-timing.js export 시그니처 commit → #4 대기 완전 해제
    └─ credit-service idempotency 보강

Day 2~3:
  #4 Remotion+UI 시작 (#2 cta-variants + #3 scene-timing 둘 다 commit 후)
    ├─ CTAVariantScene.jsx 신규
    ├─ SceneCard.jsx 수정
    ├─ SceneSequenceComposition.jsx 수정
    └─ ShortformClient.js (가장 큼, 마지막)

Day 1~3 병렬:
  #5 Tests — 해당 모듈 commit 직후 각각 테스트 작성
    ├─ settings.test.mjs (#2 commit 직후)
    ├─ error-messages/parse/cta-variants (#2 commit 직후)
    ├─ scene-timing/prompt (#3 commit 직후)
    └─ idempotency/json-retry (integration, Neon 브랜치 DB 필요)

Day 4:
  통합 검증 (Orchestrator가 순차 merge: #2 → #3 → #4 → #5)

Day 5~6:
  Q6 desync 체크리스트 + Smoke + Regression + 배포
```

## Orchestrator 책임

1. 각 worker 세션 진행 보고 수집
2. 파일 충돌 방지 (worker가 영역 외 수정 시도 시 차단)
3. 의존성 잠금 해제 알림 ("settings.js commit 됐으니 #3 시작 가능")
4. 4시간마다 worker 세션에 main rebase 권고
5. 범위 외 발견 시 spec 대조 + 개정 여부 판단
6. 컨텍스트 핸드오프 시 새 세션 컨텍스트 전달
7. 최종 PR merge 책임

## 충돌 방지 룰

- worker는 자기 영역만 수정
- 영역 외 수정 필요 시 Orchestrator 경유
- 직접 다른 worktree 건드리는 거 금지
- 인터페이스 변경 시 Orchestrator가 모든 의존 세션에 알림

## 머지 전략

각 worker가 작업 완료 시:
1. worker가 자기 브랜치에 commit + push
2. Orchestrator가 main worktree에서 PR 생성 (또는 직접 merge)
3. main rebase 후 다른 worker 브랜치들에 전파
4. 최종 통합 검증 후 main push

## 체크포인트

- [ ] Day 1 종료: #2 settings.js + cta-variants.js commit
- [ ] Day 2 종료: #3 prompt.js + scene-timing.js commit
- [ ] Day 3 종료: #4 CTAVariantScene + SceneCard commit
- [ ] Day 4 종료: ShortformClient.js + 통합 검증
- [ ] Day 5: Q6 desync 6항목 체크리스트 (수동)
- [ ] Day 5: 검토자 1차 review
- [ ] Day 6: Smoke 10단계 + Regression 9항목
- [ ] Day 6: 배포

## 롤백 시나리오

각 worker 브랜치는 독립이므로 문제 발생 시 해당 브랜치만 reset.
main은 spec commit(0099959)에서 안전하게 분기됨.
my-video는 영구 분리, 통합 시도 없음.
