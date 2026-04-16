# Worker #5 Tests — Day 1 Progress

**Branch**: `feat/shortform-a-bis-tests`
**Worktree**: `.worktrees/phase-a-bis-tests`
**Base**: `1dded0d chore(worktree): Tests worker guardrail`

## Day 1 완료 (2026-04-16)

Worker #2가 `feat/shortform-a-bis-lib`에 commit한 4개 리프 모듈에 대한 unit test를 spec §7.2 / §7.5 / §4.4 / §7.6 기준으로 전부 작성 + 커밋.

### Merge 전략
- `feat/shortform-a-bis-lib` 을 `feat/shortform-a-bis-tests` 에 merge (`c450ba7`).
- 사유: `node --test` 로컬 실행을 위해 `lib/shortform/*.js` 모듈이 필요.
- CLAUDE.md 충돌은 HEAD(Tests 버전) 유지로 해소.
- Orchestrator가 최종 main merge 시 두 브랜치 병합으로 처리 가능 (lib 모듈은 Worker #2의 원본 커밋이 authoritative).

### 작성된 테스트 파일

| 파일 | spec | 케이스 | 커밋 |
|---|---|---|---|
| `tests/unit/settings.test.js` | §7.2 | 49 | `6ed489f` |
| `tests/unit/error-messages.test.js` | §7.5 | 22 | `aefaeb9` |
| `tests/unit/cta-variants.test.js` | §4.4 | 21 | `e7c48a1` |
| `tests/unit/parse-claude-json.test.js` | §7.6 | 20 | `7c71277` |

**총 112 테스트 모두 pass** (`npm test`).

### 커버 항목

**settings.test.js — 비타협 비용 회귀**
- 비용 고정값: `category=0.3` / `firstThreeSeconds=0.2` / `scriptType=0.5` / `ctaTone=0` / `voiceSpeed=0` — Q9 테이블 drift 감지
- `getTotalRefineCost`: 빈 배열, inline+refine 혼합, 전체 합 1.0 (refund 환산 기준)
- `CHIP_SCHEMA` Object.freeze 3단 (top / 각 chip / options 배열) + mutation TypeError
- `DEFAULT_SETTINGS` auto-derive 검증 (중복 정의 금지 규칙)
- `migrateSettings`: null / 레거시 / 비객체 입력 모두 `_version=1` 주입
- `validateSettings`: 키 존재 검증만, UI i18n 분리
- `formatCredit` edge cases (NaN/null/undefined → "0크레딧")
- `getFps` contentType 분기 + 폴백

**error-messages.test.js — 비타협 금지 용어 자동 검증**
- 10 필수 에러 코드 존재 + severity 4xx/5xx 검증
- 금지 용어 20개 스캔 (렌더/API/Claude/서버/에러/실패/오류 등)
- 비난조 패턴 3개 스캔 (잘못됐습니다/틀렸습니다/못했습니다)
- 5xx severity는 `{refunded}` 또는 `{balance}` 변수 의무
- 4xx는 refund 변수 금지 (환불 없음)
- `renderErrorMessage` formatCredit 자동 적용 + 미존재 코드 safe fallback
- "다음 동작 어미" (주세요/시도/돼요/보세요) 포함 검증

**cta-variants.test.js**
- `CTA_VARIANTS` 2종 (casual/professional) + freeze
- `componentName` 비노출 3 경로 검증 (내부 메타 유출 차단)
- spec Q2 공식 카피 정확 일치 (bit-for-bit)
- `getCTAVariant` dev NODE_ENV → throw / prod → fallback + `console.warn` 양 경로
- NODE_ENV undefined 도 prod 폴백 (안전한 기본값)
- `getDefaultCTAVariant` tone 분기 + 미지 tone 폴백
- 반환 객체 mutation TypeError

**parse-claude-json.test.js**
- 3/16 blog-writer "JSON 뒤 잡소리" 사고 회귀 방지
- trailing prose / markdown fence / prose before — 4단계 폴백 전부
- balanced brace: 문자열 내부 `{` / `}` 무시 (greedy regex 사고 재발 방지)
- escape 처리: `\"`, `\\` 체인, raw `\n` / `\t`
- 완전 실패 경로는 `null` 반환 (spec §7.6, throw 아님)
- top-level array / string 은 JSON.parse 1차로 통과 (edge 명시)
- 1000 items 대용량 100ms 내 처리

### 기타

- **Node 버전**: v25.6.1 (spec의 `node 20+` 충족)
- **확장자**: `.test.js` (spec §7.1의 `.mjs` 권장은 Worker #5 CLAUDE.md 기준 `.js` 로 통일 — `lib/shortform/*`가 `.js`)
- **package.json**: `"test": "node --test tests/unit/*.test.js"` / `"test:integration": "node --test tests/integration/*.test.js"`
  - Node 25에서 디렉토리 경로 단독 전달 미지원 → glob 패턴 필수
- **의존성 0**: `node:test` + `node:assert/strict` 만 사용 (Vitest/Jest 도입 X)

## Day 2 이후 대기 항목

Worker #3이 `prompt.js` / `scene-timing.js` 를 커밋하면:
- `tests/unit/prompt.test.js` — §7.4 (reasoningExamples 없이 / retryAttempt strict 블록 / story scriptType / env 없이)
- `tests/unit/scene-timing.test.js` — §7.3 (일반 lead / MIN guard / 씬 1개 / fallback)

Integration (별도 세션, Neon 브랜치 DB 필요):
- `tests/integration/idempotency.test.js` — §7.7
- `tests/integration/json-retry.test.js` — §7.8

Q6 fixture:
- `tests/fixtures/benchmark-wedding-60s.json` — §7.9 고정 회귀 입력 (수동 체크리스트용)

## Orchestrator 액션 요청 없음

merge 또는 rebase 시점만 알려주시면 됩니다. Worker #3 가 `scene-timing.js` / `prompt.js` 를 커밋한 직후 즉시 Day 2 테스트 착수 가능.
