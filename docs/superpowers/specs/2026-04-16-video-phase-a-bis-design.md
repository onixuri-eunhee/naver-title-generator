# Phase A-bis — Conversion Primitives Design

**Date**: 2026-04-16
**Scope**: 숏폼 영상 전환 최적화 1차 — Phase A 배포본(`d2a0b42`) 위에 얹는 전환(저장/팔로우/구매) primitives와 Step 3 AI 판정 칩 UX
**Out of scope**: 음성 업로드(Phase F), 벤치마크 마이닝(Phase C), 공간 연속성(Phase B), 롱폼 Lambda(Phase D)
**Estimated work**: 4~6 days (3~4 본 작업 + 0.5~1 에러 처리 + 0.5~1 테스트)

---

## 1. 배경과 목표

### 북극성
- **목표**: 전환 — 저장, 팔로우, 구매
- **제약**: 오픈톡방 초기 사용자 피드백 "영상 퀄리티 부족"에 대응. 4/25 정식 오픈 데드라인은 **무시** — 차별화·신뢰·반복 사용을 안전한 선택보다 우선
- **타겟**: 솔로프레너 / 1인 사업가 / 자영업자. 특히 웨딩플래너·변호사·세무사·식당 등 브랜드 민감 카테고리
- **경쟁 포지션**: Captions.ai, fingr 등과 달리 "Claude 대본 = 0원 마케팅 19년 노하우의 자동화"라는 뚝딱툴 고유 가치 보전

### Phase A 배포본 현황
커밋 `d2a0b42`에 `SceneSequenceComposition.jsx` + `SceneCard.jsx` 반영됨. TransitionSeries 1:1 매핑 + word timestamps 기반 duration + 글자수 폴백. 이 위에 A-bis가 **코드 교체가 아닌 증분**으로 얹힘.

---

## 2. Decision Log (Q1~Q9 + 보강)

브레인스토밍 세션(2026-04-15~16)에서 확정된 결정.

### Q1. 플랫폼 — OSMU (One Source Multi Use)
- 릴스·쇼츠·틱톡 + 유튜브 모두 9:16 단일 렌더로 커버
- 우선순위: 릴스·쇼츠 > 틱톡 > 유튜브
- **UI 노출 없음** — 사용자에게 플랫폼 선택 요구 X

### Q2. CTA Variant — 저장+팔로우 결합 1종, 2톤 변형
- 공식 카피: `"이 내용 저장해두시고, 비슷한 이야기 더 듣고 싶으시면 팔로우도 해주세요"`
- 2개 variant: `save_follow_casual` / `save_follow_professional`
- 시각 구성: 💾 저장 + ➕ 팔로우 아이콘 병렬 + 큰 텍스트 + TTS
- 마지막 씬 전용 `CTAVariantScene.jsx` 신규

### Q3. 카테고리 감지 — Optional Override 9종
- 사용자 명시 > Claude Haiku 자동 감지
- 9종 고정: `wedding / food / realestate / ai_education / beauty / fitness / lifestyle / business / other`
- Step 1에 드롭다운 1개, 기본값 "자동 감지"
- Haiku 프롬프트에 "반드시 9종 중 하나, 모르면 가장 가까운 것" 강제

### Q4. First 3 Seconds Engine — B+C 결합
- **대본 제약** (B): `scripts[0]` 14자 이내 강제. 카테고리별 dynamic(Phase C에서 확장)
  - 충격형 8~12 / 숫자형 10~14 / 스토리형 14~20
- **시각 boost** (C):
  - 텍스트 scale 1.12
  - 색 채도 `interpolate(frame, [0,5,10], [1, 1.18, 1])`
  - **5프레임 flash** (167ms) — 3프레임은 인지 경계라 거부
  - 카메라 zoom-in 강제
- **SYSTEM_PROMPT 추가 가이드**: "첫 씬은 14자 이내로 임팩트, 단 음성으로 1.0초 이상 발화되도록 작성" (MIN guard 발동 사전 예방)

### Q5. 음성 속도 — 숏폼 1.12 / 롱폼 1.05
- `/api/shortform-tts/route.js`에 `body.contentType` 기반 분기 1곳
- 한국어는 1.15+ 부터 발음 뭉개짐, 1.12가 안전권

### Q6. 자막 리드 — (C) Hybrid + MIN guard
**핵심 통찰**: Phase A 배포본의 TransitionSeries cross-fade가 이미 267~1000ms 자연 lead 생성 중. 따라서 "새 기능 추가"가 아니라 **(1) 예방적 transition overlap 보정 + (2) 첫 씬 강제 lead 6f + (3) 마지막 씬 보상**.

```js
const SUBTITLE_LEAD_FRAMES = 6;   // 200ms @ 30fps
const MIN_FIRST_SCENE_FRAMES = 30; // 1초 하한

if (durations.length >= 2) {
  const originalFirst = durations[0];
  durations[0] = Math.max(originalFirst - SUBTITLE_LEAD_FRAMES, MIN_FIRST_SCENE_FRAMES);
  const actualLead = originalFirst - durations[0];
  if (actualLead > 0) {
    durations[durations.length - 1] += actualLead;
  } else {
    // MIN guard 발동 시 총 길이 최대 6f 패딩 허용, 마지막 씬 축소 금지 (음성 잘림 방지)
    console.warn('[scene-timing] MIN guard engaged, first scene padded, total video +6f');
  }
}
```

**상태**: Phase A 배포본에서 유저가 desync 체감 여부 미검증. 배포 후 (가/나/다) 피드백으로 수치 재조정 가능. spec에 "실측 필요" 플래그.

### Q7. 음성 파일 업로드 — **별도 Phase F로 분리**
A-bis 범위 밖. 오픈 후 "프리미엄 차별화 기능"으로 출시 예정. 결정 사항은 Phase F spec에서 다룸. 요약:
- (A) Claude 대본 + 녹음 기본 / (B) 자기 대본 + 녹음 옵션 / (C) STT 자동 배제
- (B) 모드에도 Claude 후처리 1회 권장 (후킹/CTA/First 3 Sec 보강안 사용자 수락제)
- STT 엔진: ElevenLabs `scribe_v1` 우선 + Whisper fallback 5%
- 저장: 30일 자동 삭제 + 보관함 옵션 (무료 3개/유료 무제한)
- 작업량: 7~10일

### Q8. 루프 훅 — 2유형 지원
- `scriptType: 'question' | 'list' | 'story'` Claude 자가 판별
- **question**: 마지막 씬 `scripts[N-1]`을 `scripts[0]`과 동일 질문으로 마무리 → "그래서 다시 물어볼게요, {질문}"
- **list**: 마지막 씬에 핵심 키워드 3개 flash 요약 + "처음부터 다시 보실까요?"
- **story**: 루프 훅 미적용, CTA Variant로 바로 연결
- **Q4와의 충돌 해소**: question형은 `scripts[0]` 14자를 그대로 재사용, list형은 키워드라 본래 짧음 → 자연스러운 호환
- 폴백: scriptType 판별 실패 시 story로 분류, CTA만 적용

### Q9. Step 3 AI 판정 칩 + 인라인 수정 "(D)"
**"차별화 + 전환 + 신뢰 + 반복 사용" > "안전"** — 초기 권고안 (A) 최소 노출 철회.

#### 칩 순서 (사용자 의사결정 중요도 = 스캔 순서)
1. 🏷️ **카테고리** (9종 드롭다운) — 잘못되면 전부 무의미
2. ⚡ **첫 3초 스타일** (자동/충격/숫자/스토리) — 시각 임팩트 결정
3. 💬 **스크립트 유형** (자동/question/list/story) — 루프 훅 적용 여부
4. 🤝 **CTA 톤** (casual/professional) — 전환 직결
5. 🎙️ **음성 속도** (1.05~1.20 slider, 기본 1.12) — 미세 조정

#### 부분 재생성 비용 테이블 (정정 후 최종)
| 칩 | refineRoute | 비용 | 근거 |
|---|---|---|---|
| `cta_tone` | inline | **무료** | componentProps 교체만, API 호출 0 |
| `voice_speed` | inline | **무료** | TTS 재호출 시스템 비용 흡수 |
| `first_three_seconds` | `first-three-refine` | **0.2 크레딧** | scripts[0] 1씬 재생성 (14자 재생성 필수, inline 아님) |
| `category` | `category-refine` | **0.3 크레딧** | 씬별 메타 재계산, 본문 유지 |
| `script_type` | `script-type-refine` | **0.5 크레딧** | 마지막 씬 루프 훅 재생성 |

비교 카피: `[카테고리 변경] 0.3 크레딧 (vs 전체 재생성 1.0)` — "재생성 대신 수정" 행동 유도

#### reasoning 툴팁 카피 규칙 (Claude 프롬프트에 강제)
- 30~50자, 모바일 툴팁 최적
- 타겟 구체 행동/심리 1개 + 결과 1개
- 추상어 금지 ("효과적", "최적화")
- 숫자 가산점 ("리플레이 확률 ~30% ↑")
- ❌ "이 카테고리에 가장 적합한 톤입니다"
- ✅ "예비부부는 '진짜 그럴까?' 의심형에 댓글 다는 비율이 2배 높음"
- 카테고리별 5~10개 수동 큐레이션 후 few-shot example로 프롬프트 주입

#### "수정 = 학습 데이터" 가시화
- **100건 이하**: 정확도 배지 숨김 (표본 부족)
- **100건 이후**: 칩 옆 "87% 정확도" 배지 노출
- **이후 영상 생성**: "지난번 웨딩 카테고리에서 CTA 톤을 '친근형'으로 바꾸셨어요. 이번에도 적용할까요?" — "내 스타일 기억" 친근 카피 ("AI 학습" 사생활 우려 회피)

---

## 3. Architecture

### 파일 레이아웃
```
lib/shortform/
├── settings.mjs        # SSOT: CHIP_SCHEMA + 비용 + refineRoute + migrate + fps 파생
├── prompt.mjs          # Claude SYSTEM_PROMPT 빌더 (5개 섹션 함수 + assembler)
├── scene-timing.mjs    # Q6 (C) Hybrid + transition overlap + MIN guard
├── cta-variants.mjs    # 레지스트리, Remotion 컴포넌트 1:1
├── reasoning-copy.mjs  # 서버 전용, `import 'server-only'`, 9카테고리 few-shot
├── error-messages.mjs  # 에러 코드 → toast/severity 매핑 + formatCredit 헬퍼
└── parse-claude-json.mjs  # safeParseJson 포팅 (blog-writer.html에서 분리)

app/api/shortform-script/route.js                  # settings + prompt + parse 조합
app/api/shortform-script/refine/route.js  신규     # field 분기 부분 재생성
app/api/shortform-tts/route.js                     # body.contentType 기반 speed 분기
app/api/internal/scene-timing-stats/route.js 신규  # MIN guard 빈도 집계

remotion/shortform/SceneCard.jsx                    # First 3 Sec 시각 boost 인라인
remotion/shortform/CTAVariantScene.jsx   신규       # cta-variants 레지스트리 consumer
remotion/shortform/SceneSequenceComposition.jsx     # scene-timing import

app/shortform/ShortformClient.js                    # settings.CHIP_SCHEMA 그대로 렌더
lib/credit-service.js                               # refundCredit/chargeCredit idempotency 확장
```

### 층 규칙 (L1~L6)

| # | 규칙 | 이유 |
|---|---|---|
| **L1** | `lib/shortform/*`는 React/Remotion에 의존 금지 | 순수 JS로 API·Remotion 양쪽 재사용, Node 환경 단독 테스트 |
| **L2** | `settings.mjs`는 다른 모듈 import 금지 (리프 노드) | SSOT, 의존성 순환 방지 |
| **L3** | `reasoning-copy.mjs`는 서버 전용 (`import 'server-only'`) | 50KB 데이터 클라이언트 번들 유출 차단, Next.js tree-shake 신뢰 금지, **빌드 시점 강제** |
| **L4** | Remotion 컴포넌트는 `lib/shortform/*` import 가능하지만 props로 내려받는 값만 렌더 | Lambda 환경 재실행 시 외부 호출 실패 방지 |
| **L5** | API 라우트는 얇게 유지, 비즈니스 로직 금지 | refine 라우트 비대화 차단 |
| **L6** | `lib/shortform/*`는 `process.env` 직접 접근 금지, 인자로 주입 | Remotion Lambda에서 env 비어있을 수 있음 + 단위 테스트 mock 불필요 + API 라우트가 어떤 env 필요한지 한눈에 파악 |

### Phase 확장 호환성
- **Phase C (벤치마크 마이닝)**: `lib/shortform/benchmark.mjs` 신규 → `prompt.mjs`가 조건부 import
- **Phase B (Visual Continuity)**: `lib/shortform/visual-continuity.mjs` 신규 → `SceneSequenceComposition`에서 import
- **Phase D (롱폼 + Lambda)**: `contentType === 'long'` 분기 + `LongformSequenceComposition.jsx` 추가
- **Phase F (음성 업로드)**: `lib/shortform/voice-upload.mjs` 신규 + `CHIP_SCHEMA`에 `voice_mode` 칩 추가

---

## 4. Components — 공개 인터페이스

### 4.1 `lib/shortform/settings.mjs`

```js
export const SETTINGS_SCHEMA_VERSION = 1;
export const CHIP_SCHEMA;       // Object.freeze 적용
export const REFINE_ROUTES;
export const DEFAULT_SETTINGS;  // CHIP_SCHEMA에서 자동 파생
export const FPS_BY_CONTENT_TYPE = { short: 30, long: 24 };

export function getChipCost(chipId, optionId): number
export function getTotalRefineCost(changedChips): number
export function getRefineRoute(chipId): string | null
export function migrateSettings(saved): object
export function validateSettings(settings): { ok, errors }
export function getFps(contentType): number
export function formatCredit(n): string  // "0.3크레딧" / "1크레딧"
```

**제약**:
- `CHIP_SCHEMA`는 `Object.freeze` — 런타임 변경 금지
- `DEFAULT_SETTINGS`는 schema에서 자동 파생, 중복 정의 금지
- `validateSettings` 에러는 키만 반환, i18n은 UI 책임

### 4.2 `lib/shortform/prompt.mjs`

```js
export function buildSystemPrompt({
  category, scriptType, firstThreeStyle,
  reasoningExamples,  // undefined 허용, 없으면 해당 섹션 스킵 + 콘솔 경고 1회
  contentType,
  retryAttempt = 0,   // > 0 이면 JSON strict 블록 맨 앞 unshift
}): string

export function buildUserPrompt({ topic, tone, targetSceneCount }): string
```

**제약**:
- 내부 섹션 함수(`buildFirstThreeSecondsBlock` 등)는 export 하지 않음
- 600줄 임계 도달 시 최대 섹션 별도 파일 추출 검토 (조기 분리 금지)
- `scriptType === 'story'` 시 루프 훅 블록 빈 문자열 반환 (consumer는 몰라도 됨)
- `retryAttempt > 0` 시 `buildJsonStrictnessBlock()` 삽입: "시도 N/3, 순수 JSON만, 코드블록 금지, 첫 글자 { 마지막 }"

### 4.3 `lib/shortform/scene-timing.mjs`

```js
export const SUBTITLE_LEAD_FRAMES = 6;
export const MIN_FIRST_SCENE_FRAMES = 30;

export function deriveSceneDurationsFromWordTimestamps(
  words, scenes, { fps, transitionMode = 'auto' }
): number[]

export function getTransitionOverlapFrames(transitionType, fps): number
export function fallbackDurationsFromCharCount(scenes, totalTargetFrames): number[]
```

**제약**:
- `words` 정렬은 호출자 책임
- MIN guard 발동 시 `console.warn` + Neon `scene_timing_events` 테이블 기록
- `fps` 파라미터 필수, 하드코딩 금지 (호출자가 `getFps(contentType)` 주입)

### 4.4 `lib/shortform/cta-variants.mjs`

```js
export const CTA_VARIANTS;  // { save_follow_casual: {...}, save_follow_professional: {...} }

export function getCTAVariant(id): variant | throws(dev) | fallback(prod)
export function listCTAVariants(): variant[]
export function getDefaultCTAVariant(tone): variant
```

**제약 (섹션 2 정정)**:
- `componentName` 필드는 레지스트리 내부 메타, 공개 API가 반환하는 객체에는 제외
- **`NODE_ENV === 'development'`에서만 unknown ID에 throw**, production은 `save_follow_casual` 폴백 + `console.warn` (Remotion 렌더 전체 실패 방지)

### 4.5 `lib/shortform/reasoning-copy.mjs`

```js
import 'server-only';  // L3 빌드 시점 강제

export function getReasoningExamples(category): { copies: string[], fewShots: Example[] }
export function getTooltipCopy(chipId, optionId, category): string
```

**제약**:
- `// @server-only` 주석 + `server-only` 패키지로 빌드 시 클라이언트 import 차단
- 50KB 임계 도달 시 `lib/shortform/data/reasoning/{category}.json`으로 분리 후 동적 로드 (시그니처 유지 시 consumer 수정 최소)

### 4.6 `lib/shortform/error-messages.mjs`

```js
export const ERROR_MESSAGES = {
  claude_5xx: { toast: "잠시 문제가 있었어요. {formatCredit(refunded)}를 돌려드렸고, 잔액은 {formatCredit(balance)}예요. 다시 시도해도 되고, 1~2분 후가 안전해요.", severity: '5xx' },
  tts_5xx: { ... },
  timeout: { ... },
  asset_404: { toast: "이미지 한 장을 찾을 수 없어요. Step 5에서 다시 선택해 주세요.", severity: '5xx' },
  asset_fetch: { ... },
  oom: { toast: "영상이 조금 길어서 만들기 어려웠어요. Step 3에서 대본을 줄이거나, 60초 이내로 조정해 주세요.", severity: '5xx' },
  composition_id: { ... },
  script_generation_failed: { ... },
  refine_failed: { ... },
  claude_4xx: { ... },
};

export function renderErrorMessage(code, vars): string
```

**제약**:
- 모든 메시지는 **금지 용어 테스트**와 **비난조 패턴 테스트** 통과 필수 (섹션 7.1 참조)
- 5xx severity는 `{refunded}` 또는 `{balance}` 변수 포함 의무
- UI는 코드만 참조, 문자열 중앙화로 톤 조정 시 1곳만 수정

### 4.7 신규 API: `POST /api/shortform-script/refine`

```
headers: { X-Request-Id: <UUID> }  // idempotency
body: {
  originalScript,
  field,       // 'category' | 'scriptType' | 'firstThreeSeconds'  (inline 필드 거부)
  newValue,
  settings,    // validateSettings 통과 필수
}

response 200: { updatedScript, costCharged, updatedSections, reasoning }
response 422: inline 필드 요청 또는 validateSettings 실패
response 502: Claude 5xx + 자동 환불 + refundReason 로깅
```

**제약**:
- inline 필드 요청 거부 (크레딧 0 API 왕복 방지)
- 4xx는 환불 없음, 5xx는 자동 환불
- 클라이언트 측 동시 호출 방지: 칩 비활성화 + 스피너 (서버 lock은 Phase F로 연기)

### 4.8 신규 API: `GET /api/internal/scene-timing-stats?days=7`

```
response: {
  total_scripts: 142,
  min_guard_engaged_count: 18,
  min_guard_rate: 0.127,
  threshold: 0.10,
  alert: boolean,
  suggested_action: 'Reduce SUBTITLE_LEAD_FRAMES to 4f or strengthen 1.0초 guidance' | null
}
```

매주 수요일 본인이 캘린더 알림으로 호출. Phase F 진입 시 슬랙/이메일 자동화로 진화.

### 4.9 신규 컴포넌트: `remotion/shortform/CTAVariantScene.jsx`

```jsx
<CTAVariantScene
  variantProps={{ variant: 'casual' | 'professional' }}
  durationInFrames={number}
  copy={string}
  brandKit={{ logoUrl?, primaryColor?, handle? } | null}
/>
```

**폴백 4단계 (production 필수, throw 금지)**:
1. `variantProps` 없음 → `{ variant: 'casual' }`
2. `copy` 빈 문자열 → 하드코딩 "저장해두고 나중에 보세요 · 팔로우하면 더 많은 팁"
3. `brandKit` 없음 → `DEFAULT_BRAND_KIT` (`#ff5f1f` 팔레트)
4. `copy` 80자 초과 → 78자 + "…"

### 4.10 기존 수정: `remotion/shortform/SceneCard.jsx`

First 3 Seconds 시각 boost를 씬 인덱스 0일 때만 조건부 적용:
- 텍스트 scale 1.12
- 채도 `interpolate(frame, [0,5,10], [1, 1.18, 1])`
- 5프레임 flash (167ms)
- zoom-in 강제

상수는 파일 최상단 `localConst`, `lib/shortform/*`로 뽑지 않음 (애니메이션 프레임 값은 컴포넌트 내부 구현).

### 4.11 기존 수정: `app/shortform/ShortformClient.js`

**원칙**: **로직 증가 금지, 마크업만 증가**. 모든 의사결정은 `settings.mjs` 경유. if/switch + 비용 계산 조합이 추가되면 적신호 — `settings.mjs`로 밀어내야 함. if/switch + 시각 표시(배지 색, 툴팁 문구)만 허용.

**변경 범위**:
- Step 1: 카테고리 드롭다운 (`CHIP_SCHEMA.category.options` 렌더)
- Step 3: 대본 하단 칩 5개 + 툴팁 + 드롭다운 + 비용 배지 (`formatCredit` 호출)
- refine 호출: `getRefineRoute(chipId)` 분기 (inline → 로컬 상태만 / 그외 → API 호출)
- 클라이언트 측 동시성 가드: refine 진행 중 칩 비활성화 + 스피너

---

## 5. Data Flow

### 5.1 Happy Path — 대본 생성 → 칩 렌더 → 최종 렌더

```
Step 1 (topic + optional category)
    │ POST /api/shortform-script  (X-Request-Id)
    ▼
shortform-script/route.js
    1. inferCategory() — category 없으면 Haiku
    2. classifyScriptType() — Sonnet이 question/list/story
    3. buildSystemPrompt({ reasoningExamples: getReasoningExamples(category) })
    4. Claude Sonnet
    5. Neon INSERT shortform_scripts { script, settings: {..., _version: 1} }
    │
    ▼
response: { script, settings, reasoning }
    │
    ▼
Step 3 렌더 — 칩 5개 (CHIP_SCHEMA.map → <Chip>)
    │ 사용자 [다음]
    ▼
Step 4: POST /api/shortform-tts  { settings: { voiceSpeed }, contentType }
    speed = contentType === 'short' ? settings.voiceSpeed : 1.05
    ElevenLabs → words + mp3
    │
    ▼
Step 5 (Visual Accent, 기존)
    │
    ▼
Step 6 (최종 확인, 칩 읽기 전용 요약만)
    │
    ▼
Remotion 렌더
    fps = getFps(contentType)
    durations = deriveSceneDurationsFromWordTimestamps(words, scenes, { fps })
    scenes.map((scene, i) =>
      i === last ? <CTAVariantScene .../> : <SceneCard isFirst={i===0} .../>
    )
```

**핵심**: `settings` 객체가 Step 3 → Remotion까지 props 없이 상태로 유지. `reasoning`은 서버 응답에만 포함, Remotion까지 안 내려감.

### 5.2 칩 변경 — inline vs refine-route 분기

```
<Chip onClick> → handleChipChange(chipId, newValue)
    │
    ▼
route = getRefineRoute(chipId)
    │
    ├─ null (cta_tone, voice_speed)
    │     setLocalSettings({...settings, [chipId]: newValue})
    │     API 호출 0, 크레딧 차감 0
    │     "무료 ✨" 토스트
    │
    ├─ 'first-three-refine'
    │     칩 비활성화 + 스피너
    │     POST /api/shortform-script/refine?field=firstThreeSeconds
    │     scripts[0] 1씬만 Claude 재생성 (14자 강제)
    │     0.2 크레딧
    │
    ├─ 'category-refine'
    │     0.3 크레딧, 씬 메타 재계산
    │
    └─ 'script-type-refine'
          0.5 크레딧, 마지막 씬 루프 훅 재생성
```

**주의**: `first_three_seconds`는 프롬프트 제약만 바꾼다고 생각하면 inline 같지만, 14자 dynamic 첫 씬 대본 문자열이 Claude 재생성 필요 → `first-three-refine` 경로 필수.

### 5.3 MIN guard 발동 시 영상 길이 일관성

```
originalFirst = 24 frames (0.8초 — 너무 짧음)
newFirst = Math.max(24 - 6, 30) = 30  ← MIN guard 발동
actualLead = 24 - 30 = -6  ← 음수
→ 마지막 씬 조정 SKIP (음수 더하면 축소 → 음성 잘림 위험)
→ 총 영상 +6f 패딩 감수
→ console.warn + Neon scene_timing_events 기록
```

**Remotion 특성**: `<Composition durationInFrames={...}>` 가 mp3 길이보다 길면 마지막 프레임 정지 패딩, 짧으면 음성 잘림. 따라서 "길어지는 건 안전, 짧아지는 건 금지" 정책.

### 5.4 에러 경로 — Claude 5xx → 환불 → 로깅 → 알림

```
/api/shortform-script
  try {
    result = await withRetry(() => claude.messages.create(...), { ctx: 'script_gen' });
  } catch (err) {
    errCode = classifyError(err);  // 'claude_5xx' | 'timeout'
    
    await logError({ phase: 'script_generation', refundReason: errCode, raw: err.message.slice(0, 500) });
    await refundCredit(userId, 1.0, { requestId, refundReason: errCode, phase: 'script_generation' });
    
    return NextResponse.json({
      error: 'script_generation_failed',
      refunded: 1.0,
      retryable: true,
      message: renderErrorMessage('claude_5xx', { refunded: 1.0, balance: newBalance }),
    }, { status: 502 });
  }
```

**TTS 후차감 정책**: TTS 크레딧(숏폼 7~18)은 ElevenLabs 성공 후 차감. 실패 시 "차감이 애초에 없었음"이 되어 환불 불필요. refundReason='tts_5xx'는 리소스 소비 로그용.

### 5.5 버전 마이그레이션 발동 시점

```
"이전 영상 다시 렌더링" 클릭
    │ GET /api/shortform-script/{id}
    ▼
raw = { settings: {...}, _version: 0 }  (레거시)
migrated = migrateSettings(raw.settings)
    ├─ A-bis 1차: 빈 껍데기, _version=1 주입만
    ├─ console.info('[settings-migration] would migrate', { from, to, missingFields })
    │    — Phase F 진입 전 1주일치 로그로 실 마이그레이션 필요 필드 파악
    └─ Phase F 이후: if (version < 2) { voice_mode: 'ai_voice' ... }

if (migrated._version !== raw._version) {
  await db.update(...);  // 마이그레이션 발생 시에만 UPDATE
}
    │
    ▼
Step 3 렌더: validateSettings(migrated) → ok
```

---

## 6. Error Handling

### 6.1 Idempotency — `refund_log` + `charge_log` 테이블

```sql
CREATE TABLE refund_log (
  request_id UUID PRIMARY KEY,
  user_id TEXT NOT NULL,
  amount NUMERIC(6, 2) NOT NULL,
  refund_reason TEXT NOT NULL,
  phase TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE charge_log (
  request_id UUID PRIMARY KEY,
  user_id TEXT NOT NULL,
  amount NUMERIC(6, 2) NOT NULL,
  phase TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

**전략**: PRIMARY KEY 충돌로 중복 요청 자동 차단. `UNIQUE_VIOLATION` 캐치 시 no-op 반환.

**requestId 규칙**:
- 클라이언트: `crypto.randomUUID()` → `X-Request-Id` 헤더
- 서버: 헤더 없으면 서버 생성 (레거시 호환)
- retry는 같은 ID, UI "재시도" 버튼은 새 ID

**왜 optimistic credit lock이 아닌가**: A-bis 범위 확장 차단. A-bis = Conversion Primitives, lock 인프라는 Phase F(음성 업로드 다단계 리소스)와 함께 도입. 환불 패턴도 사용자 체감은 거의 동일.

### 6.2 Retry 정책

```js
const MAX_RETRIES = 2;
const BASE_DELAY_MS = 1000;
const JITTER_MAX_MS = 300;

async function withRetry(fn, ctx) {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try { return await fn(); }
    catch (err) {
      if (!classifyError(err).retriable || attempt === MAX_RETRIES) throw err;
      const delay = BASE_DELAY_MS * Math.pow(2, attempt) + Math.random() * JITTER_MAX_MS;
      console.warn(`[retry] ${ctx} attempt ${attempt + 1}`, err.message);
      await sleep(delay);
    }
  }
}
```

총 3.3초 예산. UX 허용선(15초 '멈췄다' 인지) 이내.

| 에러 | retriable |
|---|---|
| HTTP 5xx / 429 | ✅ |
| ECONNRESET / ETIMEDOUT | ✅ |
| HTTP 4xx (401/403/422) | ❌ |
| Claude JSON 파싱 실패 | ✅ 1회만, `retryAttempt` 증가 후 재호출 |
| ElevenLabs voice not found | ❌ |

### 6.3 CTAVariantScene 폴백 (production)

섹션 4.9 참조. 4단계 폴백 + `console.warn` + production에서 절대 throw 금지.

### 6.4 Remotion 렌더 에러 분류

```js
const browserErrors = [];
onBrowserLog: ({ type, text }) => {
  if (type === 'error') browserErrors.push(text);
}

// 렌더 후
const TRIVIAL_PATTERNS = [
  /React DevTools/,
  /validateDOMNesting/,
  // 운영 중 발견되는 무해한 경고 추가
];
const meaningfulErrors = browserErrors.filter(
  err => !TRIVIAL_PATTERNS.some(p => p.test(err))
);
if (meaningfulErrors.length > 0) {
  await logBrowserErrors({ scriptId, errors: meaningfulErrors });
}
```

| err 패턴 | errCode | retryable | 사용자 메시지 |
|---|---|---|---|
| `Cannot find element with id` | `composition_id` | ❌ | "잠시 문제가 있었어요..." |
| `net::ERR_` asset fetch | `asset_fetch` | ✅ (1회) | "이미지 불러오기 실패..." |
| 404 in asset URL | `asset_404` | ❌ | "Step 5에서 다시 선택..." |
| OOM / heap limit | `oom` | ❌ | "Step 3에서 대본 줄이기..." |

### 6.5 사용자 알림 톤 가이드

**원칙**: 무엇이 + 왜(비난 없이) + 다음 동작 3요소. 기술 용어·스택트레이스·비난조 금지.

**4xx — 환불 없음, toast 3초**:
> "입력을 확인해 주세요. {구체 상황}"

**5xx — 자동 환불, toast 5초**:
> "잠시 문제가 있었어요. {formatCredit(refunded)}를 돌려드렸고, 잔액은 {formatCredit(balance)}예요. 다시 시도해도 되고, 1~2분 후가 안전해요."

**타임아웃**:
> "AI가 평소보다 오래 걸리네요. 같은 주제로 다시 시도해보시거나, 주제를 조금 다르게 써 보세요."

**Remotion 렌더 실패 (모달)**: 각 errCode별 카피는 섹션 4.6 참조. 동선 차단 유도.

### 6.6 하지 말 것

- ❌ try/catch로 에러 삼키고 성공 응답
- ❌ 4xx 환불 (악용 여지)
- ❌ 에러 메시지에 기술 용어 (섹션 7.1이 자동 검증)
- ❌ "다시 시도" 반복만 제시 (2회 이상 실패 시 대안 필수)
- ❌ retry 3회 이상
- ❌ 5xx에도 환불 안 함 (CS 폭주)

---

## 7. Testing

### 7.1 테스트 레이어와 프레임워크

| 레이어 | 프레임워크 | 파일 |
|---|---|---|
| Unit | `node --test` (Node 20 내장) | `tests/unit/*.test.mjs` |
| Integration | `node --test` + Neon 브랜치 DB | `tests/integration/*.test.mjs` |
| Visual (수동) | 체크리스트 | `docs/testing/phase-a-bis-visual-checklist.md` |
| Smoke (수동) | production 1회 | `docs/testing/phase-a-bis-smoke.md` |

**ESM 전략**: `lib/shortform/*.mjs` + `tests/**/*.test.mjs` 확장자. `package.json`의 `"type": "module"` 추가 없이 파일 단위 ESM 선언. 기존 CommonJS 스크립트 영향 0.

### 7.2 Unit — `tests/unit/settings.test.mjs`

비용 고정값 회귀 / 총비용 / refine 라우트 매핑 / CHIP_SCHEMA freeze / fps 파생 / migrateSettings / validateSettings / formatCredit. **비타협**.

### 7.3 Unit — `tests/unit/scene-timing.test.mjs`

일반 lead + 마지막 씬 보상 / MIN guard 발동 / 씬 1개 / fallback.

### 7.4 Unit — `tests/unit/prompt.test.mjs`

`reasoningExamples` 없이 실행 / `retryAttempt > 0` strict 블록 위치 / scriptType='story' 루프 훅 빈 문자열 / `process.env` 비워도 실행 (L6 규칙).

### 7.5 Unit — `tests/unit/error-messages.test.mjs`

**금지 용어 테스트** (이 테스트가 저자의 자가 위반 탐지):

```js
const FORBIDDEN_WORDS = [
  // 기술 용어
  '렌더', 'render', 'API', 'DB', 'Claude', 'ElevenLabs',
  'null', 'undefined', 'stack', '스택트레이스',
  '서버', '버그', '예외',
  '500', '502', '4xx', '5xx',
  // 부정어 (대안 제공)
  '에러',  // → "문제"
  '실패',  // → "어려웠어요"
  '오류',  // → "문제"
];
```

**비난조 패턴**:
```js
const BLAME_PATTERNS = [
  /잘못됐습니다/,
  /틀렸습니다/,
  /못했습니다/,
];
```

**필수 에러 코드**: `claude_5xx / claude_4xx / tts_5xx / timeout / asset_404 / asset_fetch / oom / composition_id / script_generation_failed / refine_failed` 누락 없음.

**5xx 변수 포함 의무**: severity='5xx' 메시지는 `{refunded}` 또는 `{balance}` 변수 포함.

### 7.6 Unit — `tests/unit/parse-claude-json.test.mjs`

Claude가 JSON 뒤 잡소리 추가해도 파싱 / 문자열 내 `}` 무시 / 완전 깨진 JSON은 `null`.

### 7.7 Integration — `tests/integration/idempotency.test.mjs`

같은 requestId로 차감 2번 → 1번만 / 환불 2번 → 1번만 / 차감-환불 requestId 라이프사이클 조회.

**DB 전략**: Neon 브랜치(dev 전용) `before`/`after` 훅으로 TRUNCATE. production DB 오염 없음.

### 7.8 Integration — `tests/integration/json-retry.test.mjs`

첫 시도 의도적 깨진 JSON mock → 재시도 시 system 프롬프트에 strict 블록 + "시도 2/3" 명시 확인.

### 7.9 Visual — Q6 desync 60초 체크리스트

**고정 입력** (회귀 비교 기준):
- 주제: `"웨딩플래너 19년차가 말하는 첫 미팅 3대 실수"`
- 카테고리: `wedding`
- scriptType: `question`
- firstThreeStyle: `shock`
- voiceSpeed: `1.12`
- 벤치마크: `tests/fixtures/benchmark-wedding-60s.json`

**6개 체크**:
- [ ] 무음 재생: 자막만 보고 스토리 이해 가능
- [ ] 자막 끄고 재생: TTS만으로 말 잘림·뭉개짐 없음
- [ ] 자막 + TTS 동시: 각 씬에서 자막이 TTS 직전 또는 동시에 뜸 (자막 지연이 가장 큰 결함)
- [ ] 마지막 씬: CTA 음성 잘리지 않음, 500ms 이내 여유
- [ ] 첫 씬: zoom-in + flash + scale 1.12 체감
- [ ] 총 길이: 60±3초 범위

**합격**: 6개 전부 OK → 배포. 1개라도 NG → `SUBTITLE_LEAD_FRAMES` 5~8 bisect 또는 Q4 수치 재조정.

### 7.10 Visual — CTA 폴백 4단계

| 조작 | 예상 |
|---|---|
| `settings.ctaVariantId = 'does_not_exist'` | 경고 + `save_follow_casual` 폴백 |
| `copy = ''` | 하드코딩 폴백 |
| `brandKit = null` | 오렌지 기본 팔레트 |
| `copy = 'x'.repeat(200)` | 78자 + "…" |

4개 모두 영상이 끝까지 렌더되면 합격.

### 7.11 MIN guard 빈도 측정

`GET /api/internal/scene-timing-stats?days=7` 매주 수요일 호출.

**합격**: `min_guard_rate <= 0.10`. 초과 시 SYSTEM_PROMPT "1.0초 이상 발화" 강화 또는 `SUBTITLE_LEAD_FRAMES` 4f로 축소.

### 7.12 Smoke — Step 1→6 production 10단계

1. 테스트 계정 로그인
2. Step 1: 주제 입력 + 카테고리 자동
3. Step 2: 벤치마킹 실행
4. Step 3: 대본 생성 → 칩 5개 노출 확인 → 카테고리 한 번 변경 → 0.3 크레딧 차감 확인
5. Step 4: TTS 생성
6. Step 5: 비주얼 액센트 스킵
7. Step 6: 최종 렌더
8. 결과 영상 다운로드 확인
9. Neon `shortform_scripts`에 `_version: 1` 기록 확인
10. `charge_log` entry 있고 requestId 일치 확인

### 7.13 Regression 체크리스트 (배포 전 최종 9항목)

- [ ] 기존 Phase A 배포본 영상이 "이전 영상 다시 렌더링"으로 로드됨
- [ ] 로드된 settings에 `_version: 1` 자동 주입
- [ ] `migrateSettings` 검증 로그 `console.info` 출력
- [ ] Q6 desync 체크리스트 (7.9) 합격
- [ ] CTA 폴백 체크리스트 (7.10) 합격
- [ ] `node --test tests/unit/` 모두 pass
- [ ] `node --test tests/integration/` 모두 pass
- [ ] 에러 메시지 금지 용어 + 비난조 테스트 pass
- [ ] Smoke (7.12) 합격

### 7.14 테스트하지 않는 것 (YAGNI)

- ❌ React 컴포넌트 snapshot
- ❌ Claude/ElevenLabs 실제 호출 E2E
- ❌ 모든 카테고리 × scriptType × CTA 조합 fuzzing
- ❌ Playwright 자동화
- ❌ Lambda 렌더 (Phase D 범위)

### 7.15 테스트 작업량

| 항목 | 시간 |
|---|---|
| 7.2 settings unit | 1h |
| 7.3 scene-timing unit | 1.5h |
| 7.4 prompt unit | 1h |
| 7.5 error-messages unit | 0.5h |
| 7.6 parse-claude-json unit | 0.5h |
| 7.7 idempotency integration | 2h |
| 7.8 JSON retry integration | 1h |
| 7.9~7.11 체크리스트 문서화 | 0.5h |
| 7.12 Smoke 실행 | 0.5h |
| Neon 브랜치 DB 설정 | 1h |
| **총** | **~1일** |

---

## 8. Phase F 분리 (범위 외 명시)

다음 항목은 **명백히 A-bis 범위 밖**. 작업 중 범위 확장 시 이 목록과 대조:

- 음성 파일 업로드 (MP3/M4A/WAV)
- STT (ElevenLabs scribe_v1 + Whisper fallback)
- (B) 모드 Claude 후처리 (후킹/CTA/First 3 Sec 보강안)
- R2 `user-voice/{emailHash}/{ts}.mp3` 저장
- 30일 자동 삭제 + 보관함 옵션
- 녹음 품질 가드 (RMS dB + 무음 비율)
- 90초 길이 가이드 + 자동 트림
- Optimistic credit lock 풀 도입
- `voice_mode` 칩 CHIP_SCHEMA 추가
- STT/렌더링/저장 다단계 트랜잭션

---

## 9. 작업량 견적 (총)

| 영역 | 시간 |
|---|---|
| Conversion Primitives 본 작업 (Q1~Q9) | 3~4일 |
| Error Handling (idempotency + retry + 폴백 + 카피 중앙화) | 0.5~1일 |
| Testing (unit + integration + 체크리스트) | 0.5~1일 |
| **총** | **4~6일** |

---

## 10. Open Questions (구현 착수 전 결정 필요)

- [ ] **ESM 파일 확장자 확정**: `lib/shortform/*.mjs` 전제로 작성됐음. `package.json` `"type": "module"` 추가는 기존 CommonJS 스크립트(`scripts/obfuscate.mjs`, `services/shortform-stt-service/server.js` 등) 영향 없는지 교차 확인 필요. **권고: `.mjs` 확장자 유지**
- [ ] **Neon 브랜치 DB 설정**: 통합 테스트용 dev 브랜치 생성 여부. 기존 개발 DB 재사용 시 TRUNCATE 범위 주의
- [ ] **reasoning-copy 9카테고리 × 5~10개 큐레이션 주체**: 개발자 본인이 1차 초안 작성 후 Claude로 개선? 전체 작성량 30~50개 문장
- [ ] **Q6 desync 실측**: Phase A 배포본(`d2a0b42`)으로 60초 샘플 1개 렌더 후 체크리스트 선행. (가/나/다) 결과에 따라 Q6 (C) 파라미터 재조정 가능

---

## 11. 관련 문서

- 브레인스토밍 메모리: `~/.claude/projects/-Users-gong-eunhui-Desktop-naver-title-generator/memory/project_video_redesign_phases.md`
- 직전 Phase A 커밋: `d2a0b42` (Scene Sequence Renderer)
- 숏폼 Phase B/C/D/F/J 순서: A-bis → C(Flash) → A′ → B → [오픈] → D → F → J
- Phase F spec: 작성 예정 (오픈 후)
