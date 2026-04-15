# Phase A-bis Worker Polling — launchd 설치

30분마다 worker worktree를 폴링하고 의존성 신호를 자동 전파합니다.

## 설치 (1회)

```sh
cp scripts/com.ddukddak.poll-workers.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.ddukddak.poll-workers.plist
```

`RunAtLoad: true`로 설정되어 있어 로드 즉시 1회 실행되고, 이후 30분 간격으로 반복.

## 상태 확인

```sh
launchctl list | grep ddukddak
tail -f .claude/polling.log
```

## 수동 실행 (테스트용)

```sh
python3 scripts/poll-workers.py
cat .claude/polling.log | tail -20
```

## 중지

```sh
launchctl unload ~/Library/LaunchAgents/com.ddukddak.poll-workers.plist
```

## 완전 제거

```sh
launchctl unload ~/Library/LaunchAgents/com.ddukddak.poll-workers.plist
rm ~/Library/LaunchAgents/com.ddukddak.poll-workers.plist
rm .claude/polling-state.json
rm .claude/polling.log
```

## 동작

### 매 30분마다
1. 4개 worker 브랜치 HEAD + 최근 commit 시각 조회
2. 이전 poll 결과(`.claude/polling-state.json`)와 비교
3. 신규 commit 각각에 대해 변경 파일 목록 확인
4. 파일명이 `FILE_DEPENDENCY_MAP`에 매칭되면 의존 worker의 `.claude/INBOX.md`에 신호 append

### 신호 형식

```
- [2026-04-16 03:45:12] 의존성 `lib/shortform/settings.js` (71a9334) ready — 다음 작업 진행 가능 (from phase-a-bis-lib)
```

### Worker 측 수신

각 worker Claude Code 세션은 프롬프트 시작 시 `.claude/INBOX.md` 확인. 신규 signal line이 있으면 읽고 해당 의존성 import 시작.

### 에스컬레이션 (macOS notification)

다음 조건 중 **하나 이상** 충족 시에만 사용자 깨움:
1. worker 한 명이 **30분 이상** commit 없음
2. 4명 전부 30분 이상 silent (deadlock 의심)
3. (미구현) deny rule 발동 — worker CLAUDE 세션 출력에서 감지되므로 사용자가 직접 확인
4. (미구현) spec 모호성 — worker가 자발적으로 INBOX에 flag 기록해야 감지

정상 진행은 `.claude/polling.log`에만 기록, 사용자 방해 없음.

## 파일 경로

| 파일 | 용도 |
|---|---|
| `scripts/poll-workers.py` | 폴링 로직 |
| `scripts/com.ddukddak.poll-workers.plist` | launchd schedule |
| `.claude/polling-state.json` | 이전 poll 결과 (자동 생성) |
| `.claude/polling.log` | 이벤트 로그 (자동 생성) |
| `.claude/polling.stdout.log` | launchd stdout (자동 생성) |
| `.claude/polling.stderr.log` | launchd stderr (자동 생성) |
| `.worktrees/<worker>/.claude/INBOX.md` | worker 수신함 (자동 생성) |
