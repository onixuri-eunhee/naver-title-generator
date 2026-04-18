# 2026-04-18 숏폼 편집창 품질 정렬 plan

## 배경

`/shortform` Step 6 미리보기 Player가 my-video Remotion Studio 편집창의 `KineticType` composition 퀄리티와 동떨어진다. 대본 40자+ 내레이션이 화면 7줄로 쪼개져 가득 차고, 폰트가 시스템 폴백으로 나옴. 구조 조사 결과 4가지 원인 확인.

## 진단 결과 (4축)

### 1. 렌더 트리 — `SceneRouter` fallback 경로

```
ShortformComposition → SceneSequenceComposition → BackgroundLayer
 → TransitionSeries → Sequence×N → SceneRouter
   ├─ IF scene.layoutType → LAYOUT_REGISTRY 17종 ✨ (my-video 스타일)
   └─ ELSE → SceneCard → KineticText (scene.text 통문장 박힘 🚨)
```

- `SceneRouter.jsx:58-107` LAYOUT 경로 = `BigImpactText`/`BarGraph`/`PieChart` 등 17종 + EffectOverlay + LottieOverlay
- `SceneRouter.jsx:109-124` fallback = `SceneCard` → `KineticText` fontSize 48~88, `maxHeight:800 overflow:hidden`
- 현재 scriptToProps가 `layoutType`을 제대로 안 내려 **모든 씬이 fallback으로 감**

### 2. Props 스키마 — 화면용/음성용 미분리

`ShortformClient.js:199-289` `scriptToProps` scene-sequence mode:

```js
const base = {
  text: s.script,      // 내레이션 통째 (화면표시용 겸 음성용)
  section, durationInFrames, imageUrl, badge, ...
};
```

my-video `ShortForm`은 flat props(`hookTitle`/`bodyCards`/`ctaHeadline`)로 화면 텍스트가 짧은 라벨. 뚝딱툴은 내레이션을 그대로 온스크린.

### 3. 폰트 시스템 — 두 시스템 분열

| 경로 | 폰트 | 로딩 |
|---|---|---|
| LAYOUT (KineticType 컴포넌트 17종) | **Pretendard** 5 weight | `fonts.js` FontFace API + jsdelivr CDN + delayRender |
| Fallback (`SceneCard` + Hook/Body/CTA/Slideshow) | Noto Sans KR / Apple SD Gothic Neo | **로드 없음**, 시스템 폴백 |

`remotion/shortform/styles.js:5-13` 주석: `@remotion/google-fonts/NotoSansKR`가 404 에러로 제거됨. 대체 로드 안 깔림.

### 4. 스타일 토큰 — my-video `styles.ts` vs 뚝딱툴 `styles.js`

**동일**: SPACING, RADIUS, SPRING_CONFIG, kinetic-type/styles.js (그대로 이식됨)

**뚝딱툴 누락/차이**:

| 토큰 | my-video | 뚝딱툴 | 영향 |
|---|---|---|---|
| `FONTS.primary` | `PRETENDARD` (loadFont) | `"Noto Sans KR", ...` 시스템 폴백 | 🚨 폰트 |
| `FONTS.weight.extraBold` | 800 | **없음** | 중간 weight 부재 |
| `SIZES.bodyCaption` | 없음 | 40 (뚝딱툴만) | 호환성 OK |
| `BRAND_COLORS` | 전체 팔레트 (bg50~lavender700, accent, particle, glass, numberBadge 등 20+) | **없음** (프리셋에서 주입) | preset이 다 커버 |
| `SHADOW_TOKENS` (sm/md/lg/xl) | rgba(179,58,47,0.06~0.20) | **없음** | 🚨 그림자 누락 |
| `CARD_SHADOW` | 5층 멀티 쉐도우 (coral base) | **없음** | 🚨 카드 깊이감 없음 |
| `TITLE_SHADOW` | 2층 (sharp, 비블러) | **없음** | 🚨 타이틀 밋밋 |
| `ACCENT_TEXT_SHADOW` | 강조어 2층 shadow | **없음** | 🚨 강조 약함 |
| `GLASS_BACKDROP_STRONG` | `blur(30px) saturate(140%)` | **없음** | glass 효과 없음 |
| `GLASS_BACKDROP_SOFT` | `blur(20px) saturate(140%)` | **없음** | 〃 |
| `CARD_BG` | `rgba(255,255,255,0.7)` | **없음** | glass bg 없음 |
| `CARD_BORDER` | `1px solid rgba(255,111,97,0.15)` | **없음** | glass border 없음 |

**결론**: 뚝딱툴은 프리셋 주입 방식이라 컬러는 커버되지만, **그림자 5종 + glass 효과 4종이 통째로 누락**. my-video 편집창의 "카드가 떠 있는 듯한" 질감은 `CARD_SHADOW` 멀티층 덕분인데 뚝딱툴엔 없음.

## 수정 plan (원샷, 예상 2~3시간)

### Phase 1 — 스키마 분리 + 프롬프트 수정 (1h)

1.1. Claude 스크립트 생성 프롬프트에 2필드 필수화
   - `onScreenText`: 화면 표시용 짧은 구문 (8자 이내, 숫자/단위/핵심 키워드)
   - `layoutType`: 17종 중 선택 (big-impact-text/number-slam/bar-chart/…)
   - `layoutProps`: 레이아웃별 필요 데이터

1.2. `ShortformClient.js:199-289` `scriptToProps` scene-sequence mode 출력 변경
   ```js
   const base = {
     onScreenText: s.onScreenText || extractKeyPhrase(s.script),
     narration: s.script,
     section, durationInFrames, imageUrl, layoutType, layoutProps, ...
   };
   ```

1.3. `extractKeyPhrase(script)` 유틸 신설 — 정규식 숫자/단위(`/\d+(\.\d+)?(%|분|초|배|억|만)/`) + 따옴표 + 첫 어절 2개 fallback

### Phase 2 — 렌더러 분기 정리 (45m)

2.1. `SceneRouter.jsx:109-124` fallback `SceneCard`에 `narration` 기반 하단 자막 레이어 추가
   - `audioWordTimestamps` 연동 word-by-word subtitle
   - 상단 메인: `onScreenText` (큰 텍스트)
   - 하단 자막: `narration` (작게, word timing)

2.2. `SceneCard.jsx:197-215` `KineticText`에 `text={onScreenText}` 전달로 변경

2.3. 레거시 `EmphasisScene.jsx`/`HookScene.jsx`/`BodyScene.jsx`/`CTAScene.jsx` 사용처 확인 — kinetic 모드만 씀. scene-sequence 기본 모드는 SceneRouter만. 제거 가능하면 삭제, 보존 필요하면 그대로.

### Phase 3 — 폰트 통일 (20m)

3.1. `remotion/shortform/styles.js:13` notoSansKR 라인 제거, `FONTS.primary`를 Pretendard로 교체
   ```js
   import { PRETENDARD } from './kinetic-type/fonts.js';
   export const FONTS = {
     primary: PRETENDARD,
     weight: { regular: 400, medium: 500, bold: 700, extraBold: 800, black: 900 },
   };
   ```

3.2. `extraBold: 800` 추가

3.3. `fonts.js` 로드가 ShortformComposition 최초 진입 시 트리거되는지 확인. `SceneCard` import path에 font 로드 보장 필요하면 `remotion/Root.jsx`에서 한 번만 import.

3.4. Railway 렌더 서버에서 jsdelivr 접근 OK한지 로그 확인 (현재도 LAYOUT 경로가 쓰니 이미 검증됨)

### Phase 4 — 스타일 토큰 이식 (30m)

4.1. `remotion/shortform/styles.js`에 my-video `styles.ts`의 8개 상수 추가
   - `SHADOW_TOKENS` (sm/md/lg/xl, 프리셋 accent 기반 동적 생성으로)
   - `CARD_SHADOW` (5층 멀티)
   - `TITLE_SHADOW` (2층)
   - `ACCENT_TEXT_SHADOW` (강조어 2층)
   - `GLASS_BACKDROP_STRONG`/`SOFT` (blur + saturate)
   - `CARD_BG`/`CARD_BORDER`

4.2. 그림자 색상은 `rgba(179,58,47,…)` 고정 대신 `preset.colors.accentDeep` 기반 동적 생성
   ```js
   export function buildCardShadow(accentDeep) {
     return [
       `0 1px 1px ${accentDeep}08`,
       `0 4px 8px ${accentDeep}0F`,
       ...
     ].join(', ');
   }
   ```

4.3. `SceneCard`/`BackgroundLayer`/`LayoutComponent`들에 필요 시 적용

### Phase 5 — 체크마크 원인 확정 + 제거 (15m)

5.1. 현재 심어둔 `[shortform:inputProps]` Console 로그로 `scenes[0].layoutType` / `layoutProps.variant` 확인
5.2. Image #5의 큰 중앙 체크마크는 코드 grep 결과 어디에도 없음 → 추정: `EmphasisScene.jsx:67-77` radial glow 1200×1200 circle이 prop 매핑 실수로 쓰였을 가능성. 검증 후 제거 또는 차단.
5.3. 디버그 로그 제거 (`ShortformClient.js:1210-1215`)

## 검증 체크리스트

- [ ] Step 6 미리보기에서 내레이션 통문장 대신 짧은 `onScreenText`만 화면
- [ ] `narration` 전체가 하단 자막으로 word-by-word
- [ ] Pretendard Black(900) 렌더 확인 (DevTools > Computed font-family)
- [ ] `CARD_SHADOW` 적용 씬에서 깊이감 생김
- [ ] Railway 렌더 결과물에서도 동일하게 나옴 (jsdelivr 접근 OK)
- [ ] 기존 runAll 경로 회귀 없음 (kinetic 모드/slideshow 모드)

## DEAD ENDS 주의

- `@remotion/google-fonts/NotoSansKR` 재도입 금지 — 404 에러 이력
- my-video `KineticType` composition을 뚝딱툴 Player에 통째로 스왑 금지 — scene-sequence 기능 상실
- `layoutType` 값을 `VALID_LAYOUT_TYPES`에 없는 걸로 보내면 `ShortformClient.js:268-271`에서 null 폴백 → 다시 SceneCard로 감. Claude 프롬프트 예제에 정확한 17종 나열 필수.

## 보강 6 — onScreenText 3중 방어

Claude가 8자 제한을 안 지킬 가능성이 있어 3중 방어막 필요.

### 6.1. 프롬프트 레벨 (1차 방어)

- Claude 시스템 프롬프트에 **"8자 이내" + 좋은 예/나쁜 예**를 명시
- JSON 스키마 description에 `maxLength: 8` 힌트 (hard constraint는 아니지만 가이드 역할)

### 6.2. `extractKeyPhrase` fallback (2차 방어)

`ShortformClient.js`에 유틸 추가:
```js
function extractKeyPhrase(narration, hardLimit = 15) {
  if (!narration) return '';
  // 1순위: 숫자+단위 (%, 분, 초, 배, 억, 만, 원, 명)
  const numMatch = narration.match(/\d+(?:\.\d+)?(?:%|분|초|배|억|만|원|명|시간)/);
  if (numMatch) return numMatch[0];
  // 2순위: 따옴표/괄호 안 키워드
  const quoteMatch = narration.match(/["'「『]([^"'」』]{1,12})["'」』]/);
  if (quoteMatch) return quoteMatch[1];
  // 3순위: 첫 어절 2개
  const words = narration.trim().split(/\s+/).slice(0, 2).join(' ');
  if (words.length <= hardLimit) return words;
  // 4순위(최후): hard truncate + ellipsis
  return words.slice(0, hardLimit - 1) + '…';
}
```

### 6.3. 컴포넌트 레벨 fitText (3차 방어)

`scriptToProps`에서 onScreenText 생성 후 즉시 적용:
```js
const onScreen = (s.onScreenText || extractKeyPhrase(s.script)).slice(0, 20);
// 20자를 hard ceiling으로 (그 이상은 무조건 자름)
```

그리고 **화면 텍스트 렌더 주 컴포넌트들**에 fitText 패턴 이미 있는지 감사:
- ✅ `BigImpactText` — len≤8→120, ≤15→96, ≤25→80, else 64 (이미 있음)
- ✅ `SceneCard` fallback — hook/point/cta 분기별 축소 (이미 있음)
- ❌ `NumberSlam` — `KT_SIZES.giant=220` 고정, overflow 위험 → **len>4면 0.7배 축소** 추가 필요
- ❌ `VerticalBarText` — fontSize 80 고정, len>12 위험 → **len>10이면 56** 추가 필요
- ❌ `ProgressBarBlock` — label fontSize 52 고정, 길면 줄바꿈만. 18자+면 잘림 우려 → 검증 샘플 필요

### 6.4. Phase 1 완료 후 샘플 검증

- **샘플 10개 확보**: `/shortform`에서 서로 다른 주제/길이 대본 10개 생성
- **기록 항목**: 씬별 `onScreenText` 원본 vs 최종값, 길이 분포 히스토그램
- **합격 기준**:
  - 평균 길이 ≤ 8자 (목표)
  - 최대 길이 ≤ 15자 (hard limit)
  - 15자 초과 발생률 < 5% (초과 시 truncate 발동 확인)
- **불합격 시**: Claude 프롬프트 예제 추가 or extractKeyPhrase 우선순위 조정

## 보강 7 — 17 레이아웃 safe area 검증

프레임 1080×1920, `SceneRouter.jsx:92` 외부 padding `${topPadding}px 72px 120px` 기준.
- **좌우 가용**: 936px (72×2 padding)
- **상하 가용**: 1920 - topPadding(default ~500) - 120 = **~1300px**
- **사용자 요구**: 좌우 ≥60px, 상하 ≥100px → **SceneRouter padding은 통과** (72/120)

### 7.1. 컴포넌트별 safe area 매트릭스

| # | layoutType | maxWidth | 권장 데이터 수 | 경계 위험 | 조치 |
|---|---|---|---|---|---|
| 1 | `big-impact-text` | 900 ✅ | text 1줄 | 없음 | — |
| 2 | `bullet-list` | 800 ✅ | items 2~5개 | 6개+ 세로 넘침 | **max 5개 clamp** |
| 3 | `comparison` | 100% ⚠️ | leftPoints/rightPoints 2~4개 | 5개+ 세로 넘침 | **max 4개 clamp + flex:1 gap:20 검증** |
| 4 | `emphasis-box` | 800 ✅ | text 1~2줄 | text 30자+ 줄바꿈 6줄 | fitText로 축소 |
| 5 | `counter` | 800 ✅ | value + suffix | label 긴 경우 | label 20자 clamp |
| 6 | `progress-bar` | 800 ✅ | label + percent 1건 | label 18자+ | label 15자 clamp |
| 7 | `small-label` | inline ⚠️ | text 1줄 | 25자+ 넘침 가능 | padding 보장 (SmallLabel wrapper 추가) |
| 8 | `subtitle-bar` | bottom 15% ✅ | text 1줄 | 자체 padding 60px 확보 | — |
| 9 | `vertical-bar` | 800 ✅ | text 1줄 | **fontSize 80 고정, 10자+ 위험** | **fontSize 자동 축소 추가** |
| 10 | `venn-diagram` | size 500 ✅ | circles 2~3개 | 3개 고정 구조 | circles.length==3 강제 |
| 11 | `bar-chart` | 800, bar max 120 | bars 2~6개 | **7개+에서 bar 폭 < 100** | **max 6개 clamp 권장** |
| 12 | `pie-chart` | size 480 ✅ | slices 3~5개 | 2개 이하면 의미 없음, 6개+ 식별 어려움 | **3~5개 강제** |
| 13 | `flow-diagram` | 700 ✅ | steps 3~5개 | **6개+ 세로 1060px 초과 위험** | **max 5단계 clamp** |
| 14 | `comparison-chart` | 800 ✅ | rows 3~6개 | **7행+ 세로 넘침** | **max 6행 clamp** |
| 15 | `network` | width/height props ⚠️ | nodes 자유 | 부모 크기 지정 안하면 0×0 | **defaultProps: width=800, height=800 추가** |
| 16 | `strikethrough` | AbsoluteFill ⚠️ | text 1줄 | `KT_SIZES.title=110` 고정, 20자+ 넘침 | **fontSize 자동 축소 추가** |
| 17 | `number-slam` | AbsoluteFill + maxWidth 900 | text 1~4자 | **5자+ 넘침 위험 (fontSize 220)** | **len>4면 fontSize × 0.7** |

### 7.2. 구현 작업 (Phase 2에 추가)

- **`VennDiagram`에 `circles` length 검증** — 2 또는 3만 허용, 외 → SceneCard로 폴백
- **`BarGraph`/`FlowDiagram`/`ComparisonChart`/`BulletList`/`ComparisonColumns`**: 렌더 상단에 `items.slice(0, MAX)` 삽입
- **`NumberSlam`/`VerticalBarText`/`StrikethroughText`**: text.length 기반 fontSize 조정 로직 삽입 (BigImpactText 패턴 복사)
- **`ConnectingNetwork`**: defaultProps에 width=800, height=800 — 부모가 생략해도 동작

### 7.3. 렌더 테스트 (Phase 2 끝에 실행)

각 17종 × (최소/권장/최대) 데이터 3건 = **51건 Player 스냅샷** 캡쳐
- 좌우 60px safe area 박스를 개발 모드 오버레이로 표시 (전환 switch 추가)
- 통과 기준: 전 텍스트/엘리먼트가 safe area 내부, 잘림/넘침 없음

## 보강 8 — Claude 프롬프트용 layoutType 17종 가이드

scene 생성 프롬프트 시스템 섹션에 **정확히 이 블록 삽입**.

### 8.1. layoutType 선택 규칙 (Claude 프롬프트에 그대로 붙여넣기)

```
각 씬의 layoutType은 반드시 다음 17종 중 하나여야 한다.
단위/숫자/데이터가 명확하면 시각화 타입을 우선 선택하고,
내러티브만 있을 때 텍스트 타입을 사용한다.

[데이터 시각화 — 숫자/수치가 있을 때 우선]
- big-impact-text: 단일 숫자 또는 2~3 단어 강조 (예: "1.3억", "95%")
  layoutProps: { text: string, highlight?: string }
- counter: 0부터 목표값으로 증가하는 숫자 애니메이션 (예: 매출/회원 수)
  layoutProps: { from?: 0, to: number, suffix?: string, label?: string, decimals?: 0 }
- number-slam: 큰 숫자 임팩트 + 서브텍스트 (예: "3,500쌍" + "누적 상담")
  layoutProps: { text: string (1~4자 권장), subtitle?: string }
- progress-bar: 단일 퍼센트/비율 (예: "완료율 87%")
  layoutProps: { label: string, percent: 0~100 }
- bar-chart: 2~6개 항목 막대 비교 (예: 연도별 매출, 채널별 유입)
  layoutProps: { bars: [{label, value, displayValue?, highlight?}], maxValue? }
- pie-chart: 3~5개 조각 비율 (예: 시간 분배, 예산 구성)
  layoutProps: { slices: [{label, value}], centerLabel?, centerValue? }

[관계/프로세스 시각화]
- flow-diagram: 3~5단계 순차 프로세스 (예: 판매 퍼널, 가입 절차)
  layoutProps: { steps: [{label, title, description?}], activeIndex? }
- comparison: 2열 비교 (A vs B, 아이콘+제목+3~4개 포인트)
  layoutProps: { leftIcon, leftTitle, leftPoints, rightIcon, rightTitle, rightPoints, rightHighlight? }
- comparison-chart: 다행 비교표 (feature 3~6행 × A/B)
  layoutProps: { leftLabel, rightLabel, rows: [{feature, left, right}], highlightRight? }
- venn-diagram: 2 또는 3 원의 교집합 (예: 기술 × 경험 × 교육)
  layoutProps: { circles: [{label, color?}] (2~3개), intersectionLabel? }
- network: 노드 관계도 (추상적 연결, 자유로운 배치)
  layoutProps: { nodes: [{x, y}], edges: [[idx, idx]], width?, height? }

[텍스트 임팩트]
- bullet-list: 2~5개 항목 나열 (예: 특징, 장점)
  layoutProps: { items: string[] (최대 5), highlight?: boolean, stagger?: number }
- emphasis-box: 강조 박스 (check/warning/info 아이콘)
  layoutProps: { text: string, variant?: "check"|"warning"|"info" }
- strikethrough: 부정→긍정 전환 (예: "광고비 절감")의 "광고비"만 취소선
  layoutProps: { text: string, strikeWord: string }
- vertical-bar: 세로 바 + 짧은 단일 텍스트 (섹션 시작 강조)
  layoutProps: { text: string (10자 이내) }

[보조/레이블]
- small-label: 상단 섹션 태그 (대문자, 추적자 간격, 예: "DATA")
  layoutProps: { text: string (10자 이내) }
- subtitle-bar: 하단 자막 바 (이미지 상단 씬용)
  layoutProps: { text: string }
```

### 8.2. 선택 우선순위 플로우 (Claude가 따를 규칙)

```
씬 내러티브 분석 →
  ① 숫자·퍼센트·금액·수량이 있다 → [데이터 시각화 그룹]
     - 단일 값 강조 → big-impact-text / number-slam / counter / progress-bar
     - 여러 값 비교 → bar-chart / pie-chart
  ② 순서·절차·단계가 있다 → flow-diagram
  ③ 두 대상의 대립·비교 → comparison (간단) / comparison-chart (표 필요) / venn-diagram (교집합)
  ④ 관계·연결 표현 → network
  ⑤ 항목 나열 → bullet-list
  ⑥ 부정→긍정 전환 → strikethrough
  ⑦ 단일 강조 메시지 → emphasis-box / big-impact-text
  ⑧ 섹션 구분자 → small-label / vertical-bar
  ⑨ 이미지+하단 자막 → subtitle-bar
```

### 8.3. JSON 출력 예제 (프롬프트에 포함할 것)

```json
{
  "scenes": [
    {
      "section": "hook",
      "script": "19년 웨딩 경력으로 AI 자동화를 시작했어요",
      "onScreenText": "19년 경력",
      "layoutType": "big-impact-text",
      "layoutProps": { "text": "19년 경력", "highlight": "19년" }
    },
    {
      "section": "point",
      "script": "블로그 인스타그램 이메일 세 채널에서 고객이 옵니다",
      "onScreenText": "3채널 유입",
      "layoutType": "bar-chart",
      "layoutProps": {
        "bars": [
          { "label": "블로그", "value": 45, "displayValue": "45%" },
          { "label": "인스타", "value": 35, "displayValue": "35%" },
          { "label": "이메일", "value": 20, "displayValue": "20%" }
        ]
      }
    },
    {
      "section": "cta",
      "script": "지금 바로 어나더핸즈와 시작하세요",
      "onScreenText": "지금 시작",
      "layoutType": "emphasis-box",
      "layoutProps": { "text": "지금 시작", "variant": "check" }
    }
  ]
}
```

### 8.4. DEAD ENDS (Claude 프롬프트에 명시)

- layoutType 값이 17종 중 하나가 **아닌** 경우 — `scriptToProps`에서 null fallback → SceneCard로 감(품질 낮음). 반드시 정확한 값 사용.
- `onScreenText` **공백/빈 문자열/8자 초과** — extractKeyPhrase가 narration에서 재추출하지만 원치 않는 단어 뽑힐 수 있음. Claude가 직접 8자 이내로 주는 게 최선.
- `layoutProps`에 필수 필드 누락 — 컴포넌트가 undefined 참조로 런타임 크래시 가능 (특히 bar-chart의 `bars`, comparison의 `leftPoints` 등).

## 관련 자산

- 메모리: `project_shortform_render_tree.md` (렌더 트리 상세)
- my-video 레퍼런스: `~/Desktop/my-video/src/styles.ts`, `src/kinetic-type/styles.ts`, `src/fonts.ts`, `src/kinetic-type/KineticType.tsx`
- 본 레포: `remotion/shortform/{styles.js,SceneRouter.jsx,SceneCard.jsx,SceneSequenceComposition.jsx,kinetic-type/fonts.js,kinetic-type/styles.js}`
- 디버그 로그: `app/shortform/ShortformClient.js:1203-1216` (Console `[shortform:inputProps]`)
