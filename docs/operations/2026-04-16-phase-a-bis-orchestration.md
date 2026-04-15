# Phase A-bis Orchestration

## 4-에이전트 운영 현황

| 세션 | Worktree | 브랜치 | 상태 |
|---|---|---|---|
| #1 Orchestrator | `~/Desktop/naver-title-generator` | main | 운영 중 |
| #2 Lib-Leaf | `.worktrees/phase-a-bis-lib` | feat/shortform-a-bis-lib | **5 모듈 완료** (settings, cta-variants, error-messages, parse-claude-json, reasoning-copy + server-only deps) — **대기 or 지원 모드** |
| #3 API+Prompt | `.worktrees/phase-a-bis-api` | feat/shortform-a-bis-api | **prompt.js 본 구현 완료** + scene-timing + credit-service + shortform-tts contentType + scene-timing-stats route. **#2 self-merge**. refine route + shortform-script route 수정 남음 |
| #4 Remotion+UI | `.worktrees/phase-a-bis-remotion` | feat/shortform-a-bis-remotion | **CTAVariantScene + SceneCard First 3 Sec boost + SceneSequenceComposition scene-timing 연동** 완료. **#2 + #3 self-merge**. ShortformClient.js 수정 남음 |
| #5 Tests | `.worktrees/phase-a-bis-tests` | feat/shortform-a-bis-tests | **112 unit tests passing** — settings(49) + error-messages(22) + cta-variants(21) + parse-claude-json(20). **#2 self-merge**. scene-timing/prompt/idempotency/json-retry 남음 |

**Self-Integration Pattern** (Day 1 자발적 채택):
Worker들이 서로의 브랜치를 로컬 merge해 자기 브랜치에서 통합 검증 실행. Orchestrator 수동 개입 없이 의존성 해소.

**다음 동기화 포인트**:
- #3 refine route + shortform-script route 수정 완료 → #4 ShortformClient.js 최종 통합 블로커
- #4 ShortformClient.js 완료 → Day 4 merge 진입 가능
- #5 scene-timing/prompt/idempotency 테스트 → 비타협 회귀 커버리지

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

## 자동 폴링 시스템 (2026-04-16 도입)

### 개요
30분 간격으로 worker worktree의 commit 변화를 감지해 의존 worker의 `.claude/INBOX.md`에 신호를 append. Orchestrator 개입 없이 의존성 잠금 해제 자동화.

### 파일 구성
| 파일 | 역할 |
|---|---|
| `scripts/poll-workers.py` | 폴링 로직 (Python 3.14) |
| `scripts/com.ddukddak.poll-workers.plist` | launchd schedule (30분 `StartInterval: 1800`) |
| `scripts/LAUNCHD_INSTALL.md` | 설치 가이드 |
| `.claude/polling-state.json` | 이전 poll HEAD 기록 (자동 생성) |
| `.claude/polling.log` | 이벤트 로그 (자동 생성) |
| `.worktrees/<worker>/.claude/INBOX.md` | worker 수신함 (자동 생성) |

### 설치 (사용자 1회)
```sh
cp scripts/com.ddukddak.poll-workers.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.ddukddak.poll-workers.plist
```

### 신호 매핑 (`FILE_DEPENDENCY_MAP`)
| 파일 | 신호 대상 worker |
|---|---|
| `lib/shortform/settings.js` | #3 API, #4 Remotion, #5 Tests |
| `lib/shortform/cta-variants.js` | #4 Remotion, #5 Tests |
| `lib/shortform/scene-timing.js` | #4 Remotion |
| `lib/shortform/prompt.js` | #5 Tests |
| `lib/shortform/error-messages.js` | #4 Remotion, #5 Tests |
| `lib/shortform/parse-claude-json.js` | #5 Tests |
| `lib/shortform/reasoning-copy.js` | #3 API, #5 Tests |
| `lib/credit-service.js` | #5 Tests |
| `app/api/**` | 없음 (다른 worker 의존 X) |

### 신호 형식 (`.claude/INBOX.md` 끝에 append)
```
- [YYYY-MM-DD HH:MM:SS] 의존성 `<파일>` (<7자해시>) ready — 다음 작업 진행 가능 (from <source-worker>)
```

### 에스컬레이션 조건 (macOS notification 발동)
**사용자 휴면 유지 원칙**. 아래 조건 중 1개 이상 충족 시만 깨움:
1. worker 한 명이 **30분 이상** commit 없음
2. 4명 전부 30분 이상 silent = deadlock 의심
3. deny rule 발동 (현재 worker CLAUDE 세션 출력에 표시됨, 자동 감지는 미구현)
4. spec 모호성 worker 자가 결정 불가 (worker가 INBOX에 flag 기록 시 수동 감지 가능, 자동 감지 미구현)

정상 진행은 `.claude/polling.log`에만 기록됨.

### Worker 측 수신 방법
각 worker Claude Code 세션은 프롬프트 시작 시 `.claude/INBOX.md` 확인. 신규 signal 라인이 있으면 읽고 해당 의존성 import 시작. (worker CLAUDE.md에 inbox check 지침을 다음 사이클에 추가 예정)
