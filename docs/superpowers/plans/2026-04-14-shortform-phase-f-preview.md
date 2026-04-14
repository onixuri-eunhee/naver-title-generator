# Phase F — Preview + Customization: Step 6 미리보기 + 프리셋 6종 + 자막 커스터마이징

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. 12 Phase 중 Phase F. 마스터 플랜: `2026-04-14-shortform-master-plan.md`. 스펙: `2026-04-14-shortform-benchmark-pipeline-design.md` (§4 Step 6, §16 Phase 2 효과, §24 프리셋 정의).

**Goal:** Step 6 "미리보기 + 커스터마이징"을 구현한다. Remotion Player로 실시간 미리보기 + 프리셋 6종 선택 + 세부 조정(자막 폰트/색/크기/위치/배경, 텍스트 위치, 카메라 모션, 씬 전환) + 벤치마킹 결과에 따른 프리셋 자동 추천.

**Architecture:**
- **2-layer 프리셋 구조**: Phase F의 프리셋 6종(전문가/친근/임팩트/차분/트렌디/비즈니스)은 **상위 레벨 프리셋**이며, 기존 `remotion/shortform/presets.js`의 10종 키네틱 프리셋은 **컬러+키네틱 변형**으로 존재. 상위 프리셋이 선택되면 → 해당하는 하위 컬러 프리셋 + 텍스트 위치/카메라 모션/씬 전환/자막 스타일 값으로 매핑.
- **State shape**: `step6Value = { presetKey, subtitle: {font, color, size, position, bgColor, bgOpacity}, textPosition, cameraMotion, sceneTransition, sceneImageOrder }`
- **자동 추천**: Step 6 첫 진입 시 `step2Value?.benchmarkAggregated?.recommendedPreset` (Phase B가 남긴 값)을 읽고 해당 프리셋을 기본값으로 세팅. 배너에 "벤치마킹 분석 결과 → 추천 프리셋: {preset} ⭐" 표시 + "추천대로 갈게" / "세부 조정" 토글.
- **Remotion Composition 확장**: `ShortformComposition.jsx`가 현재 preset/hook/body/cta만 받음. 여기에 `subtitle`, `textPosition`, `cameraMotion`, `sceneTransition` props를 추가로 받아 각 Scene 컴포넌트에 전달.
- **Genkit (선택)**: §8 스펙에 따르면 Genkit은 Phase B/D/F/I에 사용. Phase F에서는 "사용자가 세부 조정 모드에서 AI 추천 받기" 옵션 버튼으로 제한적 활용(벤치마킹 결과 + 대본 내용 → 추천 subtitle 설정). P0 아닌 P1.

**Tech Stack:** Next.js 15 App Router, React useState/useEffect/useMemo, `@remotion/player`, 기존 Remotion Composition 확장, zod (Genkit 선택 경로)

**의존성:** Phase D (대본 완성 — playerProps.hook/body/cta 값이 있어야 미리보기 가능) + Phase E (이미지 — 선택사항, 없어도 동작). Phase D가 아직 없으면 `runAll()` 경로의 script state로 대체.

**예상 작업량:** 14 task, 약 2 주

---

## 파일 구조

### 신규 파일

```
lib/shortform-presets.js                                상위 프리셋 6종 + 헬퍼
app/shortform/components/PresetPicker.js                프리셋 6종 카드 선택 UI
app/shortform/components/PresetPicker.module.css
app/shortform/components/SubtitleCustomizer.js          자막 폰트/색/크기/위치/배경
app/shortform/components/SubtitleCustomizer.module.css
app/shortform/components/Step6Preview.js               Step 6 메인 컨테이너 + Remotion Player
app/shortform/components/Step6Preview.module.css
app/shortform/components/RecommendationBanner.js       "추천 프리셋" 배너
```

### 수정 파일

```
remotion/shortform/ShortformComposition.jsx            subtitle/textPosition/cameraMotion/sceneTransition props 추가
remotion/shortform/HookScene.jsx                       subtitle + textPosition + cameraMotion 수용
remotion/shortform/BodyScene.jsx                        상동
remotion/shortform/CTAScene.jsx                         상동
remotion/shortform/KenBurnsImage.jsx                    cameraMotion 파라미터 반영 (static/ken-burns/zoom/pan)
app/shortform/ShortformClient.js                        step6Value state + Step 6 conditional render
```

### 재사용 파일 (읽기만)

```
remotion/shortform/presets.js                          하위 컬러 프리셋 10종
@remotion/player                                       기존 ShortformClient에서 이미 사용 중
```

---

## Task F1: 상위 프리셋 6종 정의

스펙 §24 테이블을 `lib/shortform-presets.js`에 객체로 옮긴다. 각 프리셋은 하위 컬러 프리셋 키(기존 10종 중 하나)를 참조한다.

**Files:**
- Create: `lib/shortform-presets.js`

- [ ] **Step 1: 프리셋 객체 작성**

```javascript
// lib/shortform-presets.js
/**
 * 숏폼 상위 프리셋 6종 — Step 6 사용자 선택용.
 *
 * 각 상위 프리셋은 다음을 정의한다:
 * - colorPreset: 기존 remotion/shortform/presets.js의 10종 컬러 프리셋 키
 * - kinetic: 정적 | light | heavy | word-by-word
 * - textPosition: top | center | center-large | bottom | free
 * - cameraMotion: static | ken-burns | zoom-in | pan
 * - sceneTransition: fade | fade-long | slide | slide-fast | cut
 * - subtitle: { color, font, size, position, bgColor, bgOpacity }
 * - bgmCategory: calm | energetic | impact | emotional | trend
 * - personas: 해당 프리셋을 추천할 페르소나 id
 *
 * 스펙 §24 참조. lib/shortform-personas.js의 id와 연결.
 */

export const SHORTFORM_PRESETS = {
  professional: {
    id: 'professional',
    label: '전문가',
    description: '신뢰감 있는 전문 콘텐츠 톤',
    colorPreset: 'midnight',
    kinetic: 'static',
    textPosition: 'bottom',
    cameraMotion: 'static',
    sceneTransition: 'fade',
    subtitle: {
      color: '#ffffff',
      font: 'Pretendard',
      size: 56,
      position: 'bottom',
      bgColor: '#000000',
      bgOpacity: 0.5,
    },
    bgmCategory: 'calm',
    personas: ['consultant', 'instructor'],
  },

  friendly: {
    id: 'friendly',
    label: '친근',
    description: '따뜻하고 다가가기 편한 톤',
    colorPreset: 'cream',
    kinetic: 'light',
    textPosition: 'center',
    cameraMotion: 'ken-burns',
    sceneTransition: 'slide',
    subtitle: {
      color: '#FFD233',
      font: 'Noto Sans KR',
      size: 64,
      position: 'center',
      bgColor: '#1A1A1A',
      bgOpacity: 0.4,
    },
    bgmCategory: 'energetic',
    personas: ['store-owner', 'blogger'],
  },

  impact: {
    id: 'impact',
    label: '임팩트',
    description: '강렬하고 시선을 사로잡는 톤',
    colorPreset: 'midnight',
    kinetic: 'heavy',
    textPosition: 'center-large',
    cameraMotion: 'zoom-in',
    sceneTransition: 'cut',
    subtitle: {
      color: '#FF3333',
      font: 'Pretendard',
      size: 80,
      position: 'center',
      bgColor: '#ffffff',
      bgOpacity: 0.9,
    },
    bgmCategory: 'impact',
    personas: ['store-owner', 'freelancer'],
  },

  calm: {
    id: 'calm',
    label: '차분',
    description: '감성적이고 여유로운 톤',
    colorPreset: 'champagne',
    kinetic: 'static',
    textPosition: 'bottom',
    cameraMotion: 'static',
    sceneTransition: 'fade-long',
    subtitle: {
      color: '#F5E8D0',
      font: 'Spoqa Han Sans Neo',
      size: 56,
      position: 'bottom',
      bgColor: '#000000',
      bgOpacity: 0.35,
    },
    bgmCategory: 'emotional',
    personas: ['instructor', 'consultant'],
  },

  trendy: {
    id: 'trendy',
    label: '트렌디',
    description: '젊고 역동적인 트렌드 감각',
    colorPreset: 'rose',
    kinetic: 'word-by-word',
    textPosition: 'free',
    cameraMotion: 'pan',
    sceneTransition: 'slide-fast',
    subtitle: {
      color: '#39FF14',
      font: 'Suit',
      size: 72,
      position: 'center',
      bgColor: '#000000',
      bgOpacity: 0.6,
    },
    bgmCategory: 'trend',
    personas: ['freelancer', 'blogger'],
  },

  business: {
    id: 'business',
    label: '비즈니스',
    description: '정제된 비즈니스 프레젠테이션 톤',
    colorPreset: 'midnight',
    kinetic: 'static',
    textPosition: 'top',
    cameraMotion: 'static',
    sceneTransition: 'cut',
    subtitle: {
      color: '#1D3A80',
      font: 'IBM Plex Sans KR',
      size: 56,
      position: 'top',
      bgColor: '#ffffff',
      bgOpacity: 0.9,
    },
    bgmCategory: 'calm',
    personas: ['consultant', 'store-owner'],
  },
};

export const SHORTFORM_PRESET_KEYS = Object.keys(SHORTFORM_PRESETS);
export const DEFAULT_SHORTFORM_PRESET = 'friendly';

/**
 * id로 프리셋 조회. 없으면 기본값 반환.
 */
export function getShortformPreset(id) {
  return SHORTFORM_PRESETS[id] || SHORTFORM_PRESETS[DEFAULT_SHORTFORM_PRESET];
}

/**
 * 벤치마킹 결과 recommendedPreset 문자열 → 프리셋 id로 정규화.
 * Gemini 응답이 한글 label을 돌려주는 경우가 많아 label 매칭도 지원.
 */
export function resolveRecommendedPreset(raw) {
  if (!raw) return DEFAULT_SHORTFORM_PRESET;
  const trimmed = String(raw).trim().toLowerCase();
  // id 직접 매칭
  if (SHORTFORM_PRESETS[trimmed]) return trimmed;
  // 한글 label 매칭
  const byLabel = Object.values(SHORTFORM_PRESETS).find(
    (p) => p.label === raw || p.label === String(raw).trim(),
  );
  return byLabel?.id || DEFAULT_SHORTFORM_PRESET;
}

/**
 * Step 6 초기값 — 프리셋 id 하나에서 전체 step6Value 구성
 */
export function buildStep6ValueFromPreset(presetId) {
  const p = getShortformPreset(presetId);
  return {
    presetKey: p.id,
    subtitle: { ...p.subtitle },
    textPosition: p.textPosition,
    cameraMotion: p.cameraMotion,
    sceneTransition: p.sceneTransition,
    sceneImageOrder: [], // [{sceneId, imageUrl}] — 빈 상태는 자동 배치
    mode: 'recommended', // 'recommended' | 'custom'
  };
}

/**
 * 자막 폰트 옵션 — 세부 조정 UI에서 사용
 */
export const SUBTITLE_FONTS = [
  { id: 'Pretendard', label: 'Pretendard' },
  { id: 'Noto Sans KR', label: 'Noto Sans KR' },
  { id: 'Spoqa Han Sans Neo', label: 'Spoqa Han Sans Neo' },
  { id: 'IBM Plex Sans KR', label: 'IBM Plex Sans KR' },
  { id: 'Suit', label: 'SUIT' },
];

/**
 * 자막 색 8종 + 커스텀 HEX 지원
 */
export const SUBTITLE_COLORS = [
  { id: 'white', hex: '#FFFFFF', label: '흰색' },
  { id: 'yellow', hex: '#FFD233', label: '옐로우' },
  { id: 'red', hex: '#FF3333', label: '빨강' },
  { id: 'beige', hex: '#F5E8D0', label: '베이지' },
  { id: 'neon', hex: '#39FF14', label: '형광' },
  { id: 'navy', hex: '#1D3A80', label: '네이비' },
  { id: 'black', hex: '#000000', label: '검정' },
  { id: 'coral', hex: '#FF5F1F', label: '코랄' },
];

/**
 * 자막 배경색 8종
 */
export const SUBTITLE_BG_COLORS = [
  { id: 'black', hex: '#000000' },
  { id: 'white', hex: '#FFFFFF' },
  { id: 'dark', hex: '#1A1A1A' },
  { id: 'cream', hex: '#FDF8F6' },
  { id: 'navy', hex: '#0F3460' },
  { id: 'coral', hex: '#FF5F1F' },
  { id: 'yellow', hex: '#FFD233' },
  { id: 'gray', hex: '#6B7280' },
];

export const TEXT_POSITIONS = [
  { id: 'top', label: '상단' },
  { id: 'center', label: '중앙' },
  { id: 'center-large', label: '중앙 (큰 글씨)' },
  { id: 'bottom', label: '하단' },
  { id: 'free', label: '자유 배치' },
];

export const CAMERA_MOTIONS = [
  { id: 'static', label: '정적' },
  { id: 'ken-burns', label: 'Ken Burns' },
  { id: 'zoom-in', label: '줌 인' },
  { id: 'pan', label: '패닝' },
];

export const SCENE_TRANSITIONS = [
  { id: 'cut', label: '컷' },
  { id: 'fade', label: '페이드' },
  { id: 'fade-long', label: '페이드 (긴)' },
  { id: 'slide', label: '슬라이드' },
  { id: 'slide-fast', label: '슬라이드 (빠름)' },
];
```

- [ ] **Step 2: 빌드**

```bash
cd /Users/gong-eunhui/Desktop/naver-title-generator
npx next build 2>&1 | grep -iE "error|✓ Compiled" | head -5
```

Expected: 컴파일 성공.

- [ ] **Step 3: 커밋**

```bash
git add lib/shortform-presets.js
git commit -m "$(cat <<'EOF'
feat(lib): 숏폼 상위 프리셋 6종 정의 (Step 6용)

전문가/친근/임팩트/차분/트렌디/비즈니스 + 각 프리셋별
컬러/키네틱/텍스트 위치/카메라 모션/씬 전환/자막 스타일/BGM 카테고리.

벤치마킹 recommendedPreset 문자열 → 프리셋 id 정규화 헬퍼 포함.
자막 폰트 5종 + 색 8종 + 배경색 8종 + 위치/모션/전환 옵션 상수도 정의.
스펙 §24 참조.
EOF
)"
```

---

## Task F2: Remotion Composition 확장 — subtitle/textPosition/cameraMotion/sceneTransition

기존 `ShortformComposition.jsx`에 4개 props를 추가하고, 각 Scene에 전달한다. 이 task가 Phase F의 핵심. 기존 props는 무변경 (하위 호환).

**Files:**
- Modify: `remotion/shortform/ShortformComposition.jsx`

- [ ] **Step 1: props 시그니처 확장**

기존 47~53줄 (`ShortformComposition`) 블록:

```javascript
/**
 * ShortformComposition — 3씬 (Hook → Body → CTA)
 *
 * Props:
 * - preset: 컬러 프리셋 키 (기존 10종)
 * - hook/body/cta: 기존
 * - audio: 기존
 * - subtitle?: { color, font, size, position, bgColor, bgOpacity }  (Phase F 신규)
 * - textPosition?: 'top'|'center'|'center-large'|'bottom'|'free'    (Phase F 신규)
 * - cameraMotion?: 'static'|'ken-burns'|'zoom-in'|'pan'              (Phase F 신규)
 * - sceneTransition?: 'cut'|'fade'|'fade-long'|'slide'|'slide-fast'  (Phase F 신규)
 */
export const ShortformComposition = ({
  preset: presetKey = DEFAULT_PRESET_KEY,
  hook,
  body,
  cta,
  audio,
  subtitle,
  textPosition = 'bottom',
  cameraMotion = 'ken-burns',
  sceneTransition = 'slide',
}) => {
  const preset = getPreset(presetKey);
  const hookFrames = hook?.durationInFrames || 90;
  const bodyFrames = body?.durationInFrames || 270;
  const ctaFrames = cta?.durationInFrames || 90;

  // Phase F: sceneTransition 값에 따라 transition 프리셋/시간 결정
  const { transitionFrames, transitionPresentation } = resolveTransition(sceneTransition);

  return (
    <BackgroundLayer colors={preset.colors} meshCircles={preset.mesh}>
      <TransitionSeries>
        <TransitionSeries.Sequence durationInFrames={hookFrames}>
          <HookScene
            badge={hook?.badge}
            title={hook?.title}
            underlineText={hook?.underlineText}
            imageUrl={hook?.imageUrl}
            preset={preset}
            subtitle={subtitle}
            textPosition={textPosition}
            cameraMotion={cameraMotion}
          />
        </TransitionSeries.Sequence>

        <TransitionSeries.Transition
          presentation={transitionPresentation}
          timing={linearTiming({ durationInFrames: transitionFrames })}
        />

        <TransitionSeries.Sequence durationInFrames={bodyFrames}>
          <BodyScene
            header={body?.header}
            cards={body?.cards}
            caption={body?.caption}
            imageUrl={body?.imageUrl}
            preset={preset}
            subtitle={subtitle}
            textPosition={textPosition}
            cameraMotion={cameraMotion}
          />
        </TransitionSeries.Sequence>

        <TransitionSeries.Transition
          presentation={transitionPresentation}
          timing={linearTiming({ durationInFrames: transitionFrames })}
        />

        <TransitionSeries.Sequence durationInFrames={ctaFrames}>
          <CTAScene
            headline={cta?.headline}
            buttonText={cta?.buttonText}
            subtext={cta?.subtext}
            preset={preset}
            subtitle={subtitle}
            textPosition={textPosition}
          />
        </TransitionSeries.Sequence>
      </TransitionSeries>
      <ProgressBar color={preset.colors.accent} />
      {audio?.url && (
        <Sequence from={0}>
          <Audio src={audio.url} />
        </Sequence>
      )}
    </BackgroundLayer>
  );
};
```

- [ ] **Step 2: resolveTransition 헬퍼 추가**

ShortformComposition.jsx 상단 (import 아래):

```javascript
import { slide } from '@remotion/transitions/slide';
import { fade } from '@remotion/transitions/fade';
// (기존 import 유지)

/**
 * sceneTransition 값을 Remotion transition 프리셋으로 변환
 */
function resolveTransition(kind) {
  switch (kind) {
    case 'cut':
      return { transitionFrames: 1, transitionPresentation: fade() };
    case 'fade':
      return { transitionFrames: 15, transitionPresentation: fade() };
    case 'fade-long':
      return { transitionFrames: 30, transitionPresentation: fade() };
    case 'slide-fast':
      return { transitionFrames: 8, transitionPresentation: slide({ direction: 'from-right' }) };
    case 'slide':
    default:
      return { transitionFrames: 15, transitionPresentation: slide({ direction: 'from-right' }) };
  }
}
```

- [ ] **Step 3: buildShortformTimeline 업데이트**

transition 길이가 동적이므로 buildShortformTimeline도 `sceneTransition` 파라미터를 받도록 확장:

```javascript
export function buildShortformTimeline(props) {
  const hookFrames = props?.hook?.durationInFrames || 90;
  const bodyFrames = props?.body?.durationInFrames || 270;
  const ctaFrames = props?.cta?.durationInFrames || 90;
  const { transitionFrames } = resolveTransition(props?.sceneTransition || 'slide');
  const durationInFrames = hookFrames + bodyFrames + ctaFrames - 2 * transitionFrames;
  return {
    durationInFrames: Math.max(durationInFrames, SHORTFORM_FPS),
  };
}
```

- [ ] **Step 4: 빌드**

```bash
npx next build 2>&1 | grep -iE "error|✓ Compiled" | head -10
```

Expected: 컴파일 성공. Remotion studio는 `npm run remotion:studio`로 별도 확인 가능하지만 이 단계에선 빌드만.

- [ ] **Step 5: 커밋**

```bash
git add remotion/shortform/ShortformComposition.jsx
git commit -m "$(cat <<'EOF'
feat(remotion): ShortformComposition subtitle/textPosition/cameraMotion/sceneTransition props 추가

Phase F Step 6 커스터마이징 값을 각 Scene에 전달.
resolveTransition()으로 sceneTransition 값 → Remotion transition 프리셋 매핑.
buildShortformTimeline도 transitionFrames를 동적으로 계산.
기존 props는 모두 무변경 (하위 호환).
EOF
)"
```

---

## Task F3: Scene 컴포넌트 수정 — subtitle/textPosition/cameraMotion 수용

HookScene / BodyScene / CTAScene이 새 props를 받아 스타일에 반영한다.

**Files:**
- Modify: `remotion/shortform/HookScene.jsx`
- Modify: `remotion/shortform/BodyScene.jsx`
- Modify: `remotion/shortform/CTAScene.jsx`

- [ ] **Step 1: 자막 스타일 헬퍼 추가**

`remotion/shortform/styles.js` (기존 파일) 말미에:

```javascript
/**
 * Phase F — Step 6에서 커스터마이즈된 subtitle 값을 CSS로 변환
 *
 * subtitle: { color, font, size, position, bgColor, bgOpacity }
 * textPosition: 'top'|'center'|'center-large'|'bottom'|'free'
 */
export function buildSubtitleStyle(subtitle, textPosition) {
  if (!subtitle) return {};
  const alignMap = {
    top: 'flex-start',
    center: 'center',
    'center-large': 'center',
    bottom: 'flex-end',
    free: 'center',
  };
  const sizeBoost = textPosition === 'center-large' ? 1.25 : 1;
  return {
    color: subtitle.color || '#ffffff',
    fontFamily: subtitle.font || 'Pretendard',
    fontSize: Math.round((subtitle.size || 56) * sizeBoost),
    backgroundColor: subtitle.bgColor
      ? hexToRgba(subtitle.bgColor, subtitle.bgOpacity ?? 0.5)
      : 'transparent',
    padding: subtitle.bgColor ? '8px 16px' : 0,
    borderRadius: 8,
    alignSelf: alignMap[textPosition] || 'flex-end',
  };
}

function hexToRgba(hex, alpha) {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
```

- [ ] **Step 2: HookScene에 subtitle overlay 추가**

`remotion/shortform/HookScene.jsx` — 기존 렌더 구조를 유지하되, 자막이 넘어오면 해당 값으로 타이틀 스타일을 override:

```javascript
import { buildSubtitleStyle } from './styles';

export default function HookScene({
  badge, title, underlineText, imageUrl,
  preset, subtitle, textPosition, cameraMotion,
}) {
  const titleStyle = buildSubtitleStyle(subtitle, textPosition);
  // cameraMotion은 이미지 레이어의 KenBurnsImage로 전달 (Task F4)
  return (
    <div style={{
      width: '100%', height: '100%',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: textPosition === 'top' ? 'flex-start' : textPosition === 'center' ? 'center' : 'flex-end',
      padding: '80px 60px',
    }}>
      {imageUrl && (
        <KenBurnsImage src={imageUrl} cameraMotion={cameraMotion} />
      )}
      {/* 기존 badge / kineticText 유지 */}
      <div style={{ ...titleStyle, zIndex: 2 }}>
        {title}
      </div>
    </div>
  );
}
```

**참고:** 기존 HookScene 구조(badge + kineticText + underlineText)는 프리셋의 `kinetic` 값에 따라 분기. 이번 task에서는 subtitle override 경로만 추가하고 기존 키네틱은 그대로 유지. 세부 마이그레이션은 Task F5에서 매핑 테이블로 정리.

- [ ] **Step 3: BodyScene 동일 패턴 적용**

BodyScene도 `subtitle`, `textPosition`, `cameraMotion` 수신. body header + caption에 `titleStyle` 반영.

- [ ] **Step 4: CTAScene 동일 패턴 적용 (cameraMotion 제외)**

CTA는 이미지 레이어 없이 headline만 있으므로 `subtitle` + `textPosition`만.

- [ ] **Step 5: 빌드**

```bash
npx next build 2>&1 | grep -iE "error|✓ Compiled" | head -5
```

- [ ] **Step 6: 커밋**

```bash
git add remotion/shortform/HookScene.jsx remotion/shortform/BodyScene.jsx remotion/shortform/CTAScene.jsx remotion/shortform/styles.js
git commit -m "$(cat <<'EOF'
feat(remotion): Scene 컴포넌트 — subtitle/textPosition/cameraMotion props 수용

buildSubtitleStyle() 헬퍼로 subtitle 객체 → React style 변환.
HookScene/BodyScene/CTAScene 모두 새 props를 받아 타이틀/캡션 스타일에 반영.
기존 프리셋 기반 kinetic 렌더링은 유지 (subtitle은 override 성격).
EOF
)"
```

---

## Task F4: KenBurnsImage cameraMotion 파라미터 반영

기존 KenBurnsImage는 Ken Burns(확대 + 패닝) 고정. Phase F에서 `cameraMotion` 값에 따라 static/ken-burns/zoom-in/pan 4종을 분기.

**Files:**
- Modify: `remotion/shortform/KenBurnsImage.jsx`

- [ ] **Step 1: 컴포넌트 시그니처 확장**

```javascript
import { AbsoluteFill, Img, useCurrentFrame, useVideoConfig, interpolate } from 'remotion';

/**
 * Props:
 * - src: string
 * - cameraMotion?: 'static'|'ken-burns'|'zoom-in'|'pan'  (기본 ken-burns — 하위 호환)
 */
export default function KenBurnsImage({ src, cameraMotion = 'ken-burns' }) {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();

  let scale = 1;
  let translateX = 0;
  let translateY = 0;

  switch (cameraMotion) {
    case 'static':
      scale = 1;
      break;
    case 'zoom-in':
      scale = interpolate(frame, [0, durationInFrames], [1.0, 1.25], {
        extrapolateRight: 'clamp',
      });
      break;
    case 'pan':
      translateX = interpolate(frame, [0, durationInFrames], [-40, 40], {
        extrapolateRight: 'clamp',
      });
      scale = 1.1;
      break;
    case 'ken-burns':
    default:
      scale = interpolate(frame, [0, durationInFrames], [1.0, 1.15]);
      translateX = interpolate(frame, [0, durationInFrames], [-20, 20]);
      translateY = interpolate(frame, [0, durationInFrames], [-10, 10]);
      break;
  }

  return (
    <AbsoluteFill>
      <Img
        src={src}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          transform: `scale(${scale}) translate(${translateX}px, ${translateY}px)`,
        }}
      />
    </AbsoluteFill>
  );
}
```

- [ ] **Step 2: 빌드**

```bash
npx next build 2>&1 | grep -iE "error|✓ Compiled" | head -5
```

- [ ] **Step 3: 커밋**

```bash
git add remotion/shortform/KenBurnsImage.jsx
git commit -m "$(cat <<'EOF'
feat(remotion): KenBurnsImage cameraMotion 파라미터 분기

static / ken-burns / zoom-in / pan 4종 지원. 기본값 ken-burns로
하위 호환 유지. 기존 Ken Burns 효과는 ken-burns 케이스에 그대로.
EOF
)"
```

---

## Task F5: PresetPicker 컴포넌트 — 6종 카드 선택 UI

**Files:**
- Create: `app/shortform/components/PresetPicker.js`
- Create: `app/shortform/components/PresetPicker.module.css`

- [ ] **Step 1: PresetPicker 작성**

```javascript
// app/shortform/components/PresetPicker.js
'use client';

import { SHORTFORM_PRESETS, SHORTFORM_PRESET_KEYS } from '@/lib/shortform-presets';
import styles from './PresetPicker.module.css';

/**
 * Props:
 * - value: string (프리셋 id)
 * - recommendedId?: string
 * - onChange: (id) => void
 */
export default function PresetPicker({ value, recommendedId, onChange }) {
  return (
    <div className={styles.grid}>
      {SHORTFORM_PRESET_KEYS.map((id) => {
        const p = SHORTFORM_PRESETS[id];
        const active = value === id;
        const recommended = recommendedId === id;
        return (
          <button
            key={id}
            type="button"
            className={`${styles.card} ${active ? styles.cardActive : ''}`}
            onClick={() => onChange(id)}
          >
            {recommended && <span className={styles.badge}>⭐ 추천</span>}
            <div className={styles.cardLabel}>{p.label}</div>
            <div className={styles.cardDesc}>{p.description}</div>
            <div className={styles.cardMeta}>
              <span>{p.kinetic}</span>
              <span>·</span>
              <span>{p.cameraMotion}</span>
            </div>
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: CSS 작성**

```css
/* app/shortform/components/PresetPicker.module.css */
.grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
}

@media (max-width: 640px) {
  .grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

.card {
  position: relative;
  padding: 16px 14px;
  background: #fff;
  border: 1.5px solid var(--ds-border, #e5e7eb);
  border-radius: 12px;
  cursor: pointer;
  text-align: left;
  display: flex;
  flex-direction: column;
  gap: 6px;
  transition: all 0.15s;
}

.card:hover {
  border-color: var(--ds-accent, #ff5f1f);
}

.cardActive {
  border-color: var(--ds-accent, #ff5f1f);
  background: rgba(255, 95, 31, 0.04);
  box-shadow: 0 0 0 3px rgba(255, 95, 31, 0.1);
}

.badge {
  position: absolute;
  top: 8px;
  right: 8px;
  padding: 2px 8px;
  background: #FFF3E0;
  color: #E65100;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 700;
}

.cardLabel {
  font-size: 16px;
  font-weight: 700;
  color: var(--ds-text-primary, #111);
}

.cardDesc {
  font-size: 12px;
  color: var(--ds-text-secondary, #6b7280);
  line-height: 1.5;
}

.cardMeta {
  font-size: 11px;
  color: var(--ds-text-muted, #9ca3af);
  display: flex;
  gap: 4px;
  margin-top: 4px;
}
```

- [ ] **Step 3: 빌드 + 커밋**

```bash
npx next build 2>&1 | grep -iE "error|✓ Compiled" | head -5
git add app/shortform/components/PresetPicker.js app/shortform/components/PresetPicker.module.css
git commit -m "$(cat <<'EOF'
feat(shortform): PresetPicker 컴포넌트 — 6종 카드 선택 UI

3열 그리드. 추천 프리셋에 ⭐ 배지. 활성 카드는 코랄 보더 + shadow.
모바일 2열 반응형.
EOF
)"
```

---

## Task F6: SubtitleCustomizer 컴포넌트 — 폰트/색/크기/위치/배경

**Files:**
- Create: `app/shortform/components/SubtitleCustomizer.js`
- Create: `app/shortform/components/SubtitleCustomizer.module.css`

- [ ] **Step 1: SubtitleCustomizer 작성**

```javascript
// app/shortform/components/SubtitleCustomizer.js
'use client';

import {
  SUBTITLE_FONTS,
  SUBTITLE_COLORS,
  SUBTITLE_BG_COLORS,
  TEXT_POSITIONS,
  CAMERA_MOTIONS,
  SCENE_TRANSITIONS,
} from '@/lib/shortform-presets';
import styles from './SubtitleCustomizer.module.css';

/**
 * Props:
 * - value: step6Value (전체 객체. subtitle/textPosition/cameraMotion/sceneTransition 사용)
 * - onChange: (nextValue) => void
 */
export default function SubtitleCustomizer({ value, onChange }) {
  const subtitle = value?.subtitle || {};

  function updateSubtitle(patch) {
    onChange({ ...value, subtitle: { ...subtitle, ...patch } });
  }

  function updateTop(key, v) {
    onChange({ ...value, [key]: v });
  }

  return (
    <div className={styles.root}>
      {/* 자막 폰트 */}
      <div className={styles.field}>
        <label className={styles.label}>자막 폰트</label>
        <div className={styles.chipRow}>
          {SUBTITLE_FONTS.map((f) => (
            <button
              key={f.id}
              type="button"
              className={`${styles.chip} ${subtitle.font === f.id ? styles.chipActive : ''}`}
              onClick={() => updateSubtitle({ font: f.id })}
              style={{ fontFamily: f.id }}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* 자막 색 */}
      <div className={styles.field}>
        <label className={styles.label}>자막 색</label>
        <div className={styles.colorRow}>
          {SUBTITLE_COLORS.map((c) => (
            <button
              key={c.id}
              type="button"
              className={`${styles.colorSwatch} ${subtitle.color === c.hex ? styles.colorSwatchActive : ''}`}
              style={{ background: c.hex }}
              onClick={() => updateSubtitle({ color: c.hex })}
              title={c.label}
            />
          ))}
          <input
            type="color"
            className={styles.colorPicker}
            value={subtitle.color || '#ffffff'}
            onChange={(e) => updateSubtitle({ color: e.target.value })}
            title="직접 입력"
          />
        </div>
      </div>

      {/* 자막 크기 */}
      <div className={styles.field}>
        <label className={styles.label}>
          자막 크기 <span className={styles.value}>{subtitle.size || 56}px</span>
        </label>
        <input
          type="range"
          min="24"
          max="96"
          step="2"
          value={subtitle.size || 56}
          onChange={(e) => updateSubtitle({ size: Number(e.target.value) })}
          className={styles.slider}
        />
      </div>

      {/* 자막 배경색 + 투명도 */}
      <div className={styles.field}>
        <label className={styles.label}>자막 배경색</label>
        <div className={styles.colorRow}>
          {SUBTITLE_BG_COLORS.map((c) => (
            <button
              key={c.id}
              type="button"
              className={`${styles.colorSwatch} ${subtitle.bgColor === c.hex ? styles.colorSwatchActive : ''}`}
              style={{ background: c.hex }}
              onClick={() => updateSubtitle({ bgColor: c.hex })}
            />
          ))}
        </div>
        <label className={styles.sliderLabel}>
          배경 투명도 <span className={styles.value}>{Math.round((subtitle.bgOpacity ?? 0.5) * 100)}%</span>
        </label>
        <input
          type="range"
          min="0"
          max="100"
          step="5"
          value={Math.round((subtitle.bgOpacity ?? 0.5) * 100)}
          onChange={(e) => updateSubtitle({ bgOpacity: Number(e.target.value) / 100 })}
          className={styles.slider}
        />
      </div>

      {/* 텍스트 위치 */}
      <div className={styles.field}>
        <label className={styles.label}>텍스트 위치</label>
        <div className={styles.chipRow}>
          {TEXT_POSITIONS.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`${styles.chip} ${value?.textPosition === p.id ? styles.chipActive : ''}`}
              onClick={() => updateTop('textPosition', p.id)}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* 카메라 모션 */}
      <div className={styles.field}>
        <label className={styles.label}>카메라 모션</label>
        <div className={styles.chipRow}>
          {CAMERA_MOTIONS.map((m) => (
            <button
              key={m.id}
              type="button"
              className={`${styles.chip} ${value?.cameraMotion === m.id ? styles.chipActive : ''}`}
              onClick={() => updateTop('cameraMotion', m.id)}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {/* 씬 전환 */}
      <div className={styles.field}>
        <label className={styles.label}>씬 전환</label>
        <div className={styles.chipRow}>
          {SCENE_TRANSITIONS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`${styles.chip} ${value?.sceneTransition === t.id ? styles.chipActive : ''}`}
              onClick={() => updateTop('sceneTransition', t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: CSS 작성**

```css
/* app/shortform/components/SubtitleCustomizer.module.css */
.root {
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding: 20px;
  background: #fff;
  border: 1px solid var(--ds-border, #e5e7eb);
  border-radius: 12px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.label {
  font-size: 13px;
  font-weight: 600;
  color: var(--ds-text-primary, #111);
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.value {
  font-weight: 500;
  color: var(--ds-text-secondary, #6b7280);
  font-size: 12px;
}

.chipRow {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.chip {
  padding: 8px 12px;
  background: #fff;
  border: 1px solid var(--ds-border, #e5e7eb);
  border-radius: 8px;
  font-size: 13px;
  color: var(--ds-text-secondary, #6b7280);
  cursor: pointer;
  transition: all 0.15s;
}

.chip:hover {
  border-color: var(--ds-accent, #ff5f1f);
}

.chipActive {
  background: var(--ds-accent, #ff5f1f);
  border-color: var(--ds-accent, #ff5f1f);
  color: #fff;
}

.colorRow {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.colorSwatch {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: 2px solid #fff;
  box-shadow: 0 0 0 1px var(--ds-border, #d1d5db);
  cursor: pointer;
  padding: 0;
}

.colorSwatchActive {
  box-shadow: 0 0 0 2px var(--ds-accent, #ff5f1f);
  transform: scale(1.1);
}

.colorPicker {
  width: 28px;
  height: 28px;
  padding: 0;
  border: 1px dashed var(--ds-border, #d1d5db);
  border-radius: 50%;
  cursor: pointer;
  background: transparent;
}

.sliderLabel {
  font-size: 12px;
  font-weight: 500;
  color: var(--ds-text-secondary, #6b7280);
  margin-top: 4px;
  display: flex;
  justify-content: space-between;
}

.slider {
  width: 100%;
  accent-color: var(--ds-accent, #ff5f1f);
}
```

- [ ] **Step 3: 빌드 + 커밋**

```bash
npx next build 2>&1 | grep -iE "error|✓ Compiled" | head -5
git add app/shortform/components/SubtitleCustomizer.js app/shortform/components/SubtitleCustomizer.module.css
git commit -m "$(cat <<'EOF'
feat(shortform): SubtitleCustomizer — 자막 + 텍스트 위치 + 카메라 모션 + 씬 전환

폰트 5종 / 색 8종 + 커스텀 HEX / 크기 슬라이더 (24~96px) /
배경색 8종 + 투명도 슬라이더 / 텍스트 위치 5종 / 카메라 모션 4종 /
씬 전환 5종 — 총 7개 필드. 모두 실시간 onChange 전파.
EOF
)"
```

---

## Task F7: RecommendationBanner — 자동 추천 배너 + 모드 토글

**Files:**
- Create: `app/shortform/components/RecommendationBanner.js`

- [ ] **Step 1: 컴포넌트 작성**

```javascript
// app/shortform/components/RecommendationBanner.js
'use client';

import { getShortformPreset } from '@/lib/shortform-presets';

/**
 * Props:
 * - recommendedId: string (프리셋 id)
 * - currentId: string (현재 선택된 프리셋 id)
 * - mode: 'recommended' | 'custom'
 * - onAcceptRecommendation: () => void  ("추천대로 갈게")
 * - onEnterCustom: () => void  ("세부 조정")
 * - benchmarkAdvice?: string (Phase B가 남긴 advice 1줄)
 */
export default function RecommendationBanner({
  recommendedId,
  currentId,
  mode,
  onAcceptRecommendation,
  onEnterCustom,
  benchmarkAdvice,
}) {
  const preset = getShortformPreset(recommendedId);
  const isAccepted = mode === 'recommended' && currentId === recommendedId;

  return (
    <div style={{
      background: 'linear-gradient(135deg, #FFF8F0 0%, #FFF3E0 100%)',
      border: '1px solid #FFE0B2',
      borderRadius: 12,
      padding: 20,
      marginBottom: 24,
      display: 'flex',
      flexDirection: 'column',
      gap: 12,
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <span style={{ fontSize: 20 }}>⭐</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, color: '#6B4A00', fontWeight: 500 }}>
            벤치마킹 영상 패턴 분석 결과
          </div>
          <div style={{ fontSize: 17, fontWeight: 700, color: '#1A1A1A', marginTop: 2 }}>
            추천 프리셋: <span style={{ color: '#E65100' }}>{preset.label}</span>
          </div>
          {benchmarkAdvice && (
            <div style={{ fontSize: 13, color: '#6B6B6B', marginTop: 6, lineHeight: 1.5 }}>
              {benchmarkAdvice}
            </div>
          )}
        </div>
      </div>

      {!isAccepted && (
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            onClick={onAcceptRecommendation}
            style={{
              flex: 1,
              padding: '12px 16px',
              background: '#FF5F1F',
              color: '#fff',
              border: 'none',
              borderRadius: 10,
              fontSize: 14,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            추천대로 갈게
          </button>
          <button
            type="button"
            onClick={onEnterCustom}
            style={{
              flex: 1,
              padding: '12px 16px',
              background: '#fff',
              color: '#1A1A1A',
              border: '1px solid #E5E7EB',
              borderRadius: 10,
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            세부 조정
          </button>
        </div>
      )}
      {isAccepted && (
        <div style={{ fontSize: 13, color: '#6B4A00', fontStyle: 'italic' }}>
          추천 프리셋이 적용됐어요. 아래 미리보기로 확인해보세요.
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: 빌드 + 커밋**

```bash
npx next build 2>&1 | grep -iE "error|✓ Compiled" | head -5
git add app/shortform/components/RecommendationBanner.js
git commit -m "$(cat <<'EOF'
feat(shortform): RecommendationBanner — 벤치마킹 추천 프리셋 배너

⭐ 아이콘 + 추천 프리셋 label + benchmark advice 1줄.
"추천대로 갈게" / "세부 조정" 2버튼 토글. 추천 수용 후엔 안내 메시지.
EOF
)"
```

---

## Task F8: Step6Preview 메인 컨테이너 + Remotion Player

**Files:**
- Create: `app/shortform/components/Step6Preview.js`
- Create: `app/shortform/components/Step6Preview.module.css`

- [ ] **Step 1: Step6Preview 작성**

```javascript
// app/shortform/components/Step6Preview.js
'use client';

import { useMemo, useState, useEffect } from 'react';
import { Player } from '@remotion/player';
import { ShortformComposition, buildShortformTimeline } from '@/remotion/shortform/ShortformComposition.jsx';
import { SHORTFORM_FPS, SHORTFORM_WIDTH, SHORTFORM_HEIGHT } from '@/remotion/shortform/styles';
import {
  getShortformPreset,
  buildStep6ValueFromPreset,
  resolveRecommendedPreset,
  DEFAULT_SHORTFORM_PRESET,
} from '@/lib/shortform-presets';
import PresetPicker from './PresetPicker';
import SubtitleCustomizer from './SubtitleCustomizer';
import RecommendationBanner from './RecommendationBanner';
import styles from './Step6Preview.module.css';

/**
 * Props:
 * - value: step6Value
 * - onChange: (nextValue) => void
 * - playerProps: scriptToProps 결과 (hook/body/cta + audio)
 * - benchmarkAggregated?: { recommendedPreset, advice }  (Phase B 출력)
 * - onBack: () => void
 * - onNext: () => void  (Step 7 다운로드로)
 */
export default function Step6Preview({
  value,
  onChange,
  playerProps,
  benchmarkAggregated,
  onBack,
  onNext,
}) {
  const recommendedId = useMemo(
    () => resolveRecommendedPreset(benchmarkAggregated?.recommendedPreset),
    [benchmarkAggregated?.recommendedPreset],
  );

  // 첫 진입 시 자동 추천 주입
  useEffect(() => {
    if (!value || !value.presetKey) {
      onChange(buildStep6ValueFromPreset(recommendedId));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recommendedId]);

  // 프리셋 변경 핸들러
  function handlePresetChange(presetId) {
    const fresh = buildStep6ValueFromPreset(presetId);
    // custom 모드에서는 사용자가 이미 손댄 값 보존 없이 프리셋 기본값으로 초기화 (명시적 reset 효과)
    onChange({ ...fresh, mode: value?.mode || 'recommended' });
  }

  function acceptRecommendation() {
    onChange({ ...buildStep6ValueFromPreset(recommendedId), mode: 'recommended' });
  }

  function enterCustom() {
    onChange({ ...(value || {}), mode: 'custom' });
  }

  // Remotion Player용 합성 props
  const compositionProps = useMemo(() => {
    if (!playerProps || !value) return null;
    const preset = getShortformPreset(value.presetKey);
    return {
      ...playerProps,
      preset: preset.colorPreset,
      subtitle: value.subtitle,
      textPosition: value.textPosition,
      cameraMotion: value.cameraMotion,
      sceneTransition: value.sceneTransition,
    };
  }, [playerProps, value]);

  const durationInFrames = useMemo(() => {
    if (!compositionProps) return SHORTFORM_FPS;
    const { durationInFrames } = buildShortformTimeline(compositionProps);
    return durationInFrames;
  }, [compositionProps]);

  if (!playerProps) {
    return (
      <div className={styles.empty}>
        <p>대본이 아직 생성되지 않았어요.</p>
        <p className={styles.emptySub}>이전 단계에서 대본을 먼저 완성해주세요.</p>
        {onBack && (
          <button type="button" className={styles.backBtn} onClick={onBack}>
            ← 이전 단계로
          </button>
        )}
      </div>
    );
  }

  return (
    <div className={styles.root}>
      <div className={styles.intro}>
        <h2 className={styles.title}>미리보기 + 커스터마이징</h2>
        <p className={styles.description}>
          프리셋을 선택하거나 세부 옵션을 조정하세요. 모든 변경은 즉시 미리보기에 반영돼요.
        </p>
      </div>

      {/* 추천 배너 */}
      {benchmarkAggregated?.recommendedPreset && (
        <RecommendationBanner
          recommendedId={recommendedId}
          currentId={value?.presetKey}
          mode={value?.mode}
          onAcceptRecommendation={acceptRecommendation}
          onEnterCustom={enterCustom}
          benchmarkAdvice={benchmarkAggregated?.advice}
        />
      )}

      <div className={styles.layout}>
        {/* 왼쪽: 플레이어 */}
        <div className={styles.playerCol}>
          <div className={styles.playerFrame}>
            {compositionProps && (
              <Player
                component={ShortformComposition}
                inputProps={compositionProps}
                durationInFrames={durationInFrames}
                compositionWidth={SHORTFORM_WIDTH}
                compositionHeight={SHORTFORM_HEIGHT}
                fps={SHORTFORM_FPS}
                controls
                loop
                style={{ width: '100%', height: '100%' }}
              />
            )}
          </div>
          <div className={styles.playerHint}>
            ▶ 재생 / 구간 반복으로 확인 가능
          </div>
        </div>

        {/* 오른쪽: 프리셋 + 세부 조정 */}
        <div className={styles.controlCol}>
          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>프리셋</h3>
            <PresetPicker
              value={value?.presetKey}
              recommendedId={recommendedId}
              onChange={handlePresetChange}
            />
          </section>

          {value?.mode === 'custom' && (
            <section className={styles.section}>
              <h3 className={styles.sectionTitle}>세부 조정</h3>
              <SubtitleCustomizer value={value} onChange={onChange} />
            </section>
          )}
        </div>
      </div>

      <div className={styles.navRow}>
        {onBack && (
          <button type="button" className={styles.backBtn} onClick={onBack}>
            ← 이전
          </button>
        )}
        <button type="button" className={styles.nextBtn} onClick={onNext}>
          다음: 다운로드 →
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: CSS 작성**

```css
/* app/shortform/components/Step6Preview.module.css */
.root {
  max-width: 1200px;
  margin: 0 auto;
  padding: 24px 16px 80px;
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.intro {
  text-align: center;
}

.title {
  font-size: 24px;
  font-weight: 700;
  color: var(--ds-text-primary, #111);
  margin: 0 0 8px;
}

.description {
  font-size: 14px;
  line-height: 1.6;
  color: var(--ds-text-secondary, #6b7280);
  margin: 0;
}

.layout {
  display: grid;
  grid-template-columns: 360px 1fr;
  gap: 24px;
  align-items: flex-start;
}

@media (max-width: 960px) {
  .layout {
    grid-template-columns: 1fr;
  }
}

.playerCol {
  position: sticky;
  top: 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.playerFrame {
  width: 100%;
  aspect-ratio: 9 / 16;
  background: #000;
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12);
}

.playerHint {
  font-size: 12px;
  color: var(--ds-text-muted, #9ca3af);
  text-align: center;
}

.controlCol {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.section {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.sectionTitle {
  font-size: 15px;
  font-weight: 700;
  color: var(--ds-text-primary, #111);
  margin: 0;
}

.empty {
  max-width: 480px;
  margin: 80px auto;
  padding: 32px;
  text-align: center;
  background: #f9fafb;
  border-radius: 16px;
  color: var(--ds-text-secondary, #6b7280);
}

.emptySub {
  font-size: 13px;
  color: var(--ds-text-muted, #9ca3af);
  margin-top: 8px;
}

.navRow {
  display: flex;
  gap: 12px;
  margin-top: 16px;
  max-width: 720px;
  width: 100%;
  align-self: center;
}

.backBtn {
  padding: 14px 24px;
  background: #fff;
  border: 1px solid var(--ds-border, #e5e7eb);
  border-radius: 10px;
  font-size: 14px;
  font-weight: 500;
  color: var(--ds-text-primary, #111);
  cursor: pointer;
}

.nextBtn {
  flex: 1;
  padding: 14px 24px;
  background: var(--ds-accent, #ff5f1f);
  color: #fff;
  border: none;
  border-radius: 10px;
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
}
```

- [ ] **Step 3: 빌드 + 커밋**

```bash
npx next build 2>&1 | grep -iE "error|✓ Compiled" | head -10
git add app/shortform/components/Step6Preview.js app/shortform/components/Step6Preview.module.css
git commit -m "$(cat <<'EOF'
feat(shortform): Step6Preview — Remotion Player 실시간 미리보기 + 프리셋/커스터마이저 통합

2-컬럼 레이아웃 (sticky 플레이어 + 프리셋/세부 조정 컨트롤).
자동 추천 로직: benchmarkAggregated.recommendedPreset → 첫 진입 시 주입.
"추천대로 갈게" / "세부 조정" 토글 → custom 모드에서만 SubtitleCustomizer 노출.
모든 값 변경 시 compositionProps 재계산 → Player 즉시 반영.
모바일 1열 반응형.
EOF
)"
```

---

## Task F9: ShortformClient에 step6Value state + Step 6 render 통합

**Files:**
- Modify: `app/shortform/ShortformClient.js`

- [ ] **Step 1: state 추가**

```javascript
import Step6Preview from './components/Step6Preview';
import { resolveRecommendedPreset, buildStep6ValueFromPreset, DEFAULT_SHORTFORM_PRESET } from '@/lib/shortform-presets';

// ... 컴포넌트 내부
const [step6Value, setStep6Value] = useState(() => buildStep6ValueFromPreset(DEFAULT_SHORTFORM_PRESET));
```

- [ ] **Step 2: playerProps를 Step 6에 전달**

기존 `playerProps`는 Phase E에서 이미 `scriptToProps()` 결과를 계산. Step6Preview는 그 값을 그대로 받는다. 단, `presetKey` 덮어쓰기는 Step6Preview 내부에서 처리하므로 ShortformClient에서 색 프리셋은 기본값 유지.

```javascript
{currentStep === 6 && (
  <Step6Preview
    value={step6Value}
    onChange={setStep6Value}
    playerProps={playerProps}
    benchmarkAggregated={step2Value?.benchmarkAggregated}
    onBack={() => setCurrentStep(5)}
    onNext={() => setCurrentStep(7)}
  />
)}
```

- [ ] **Step 3: 기존 최상위 Player 호출부 정리**

ShortformClient에는 이미 기존 runAll 경로에서 작은 Player 미리보기가 있을 가능성. Step 6 진입 시에는 Step6Preview 내부 Player를 사용하므로 중복 렌더를 방지하기 위해 조건 분기:

```javascript
{currentStep !== 6 && hasPreview && (
  /* 기존 미리보기 블록 */
)}
```

- [ ] **Step 4: 빌드**

```bash
npx next build 2>&1 | grep -iE "error|✓ Compiled" | head -10
```

- [ ] **Step 5: 커밋**

```bash
git add app/shortform/ShortformClient.js
git commit -m "$(cat <<'EOF'
feat(shortform): Step 6 step-machine 통합

step6Value state + Step6Preview render. currentStep === 6일 때
기존 최상위 Player 블록은 숨겨 중복 방지. playerProps/benchmarkAggregated는
기존 state를 그대로 전달.
EOF
)"
```

---

## Task F10: Genkit 기반 AI 자막 추천 (선택, P1)

벤치마킹 분석 결과 + 대본 내용 → Genkit flow가 "이 사장님에게 맞는 자막 설정" 제안. 사용자는 "AI 추천 적용" 버튼 1개로 수락. P0 아님. 이 task는 시간이 남으면 구현, 아니면 skip.

**Files:**
- Create: `lib/genkit/shortform-subtitle-advice.js`
- Modify: `app/shortform/components/Step6Preview.js` (버튼 + 호출)
- Create: `app/api/shortform-subtitle-advice/route.js`

- [ ] **Step 1: Genkit flow 스켈레톤**

```javascript
// lib/genkit/shortform-subtitle-advice.js
import { genkit } from 'genkit';
import { vertexAI, gemini15Flash } from '@genkit-ai/vertexai';
import { z } from 'zod';

const ai = genkit({
  plugins: [vertexAI({ location: process.env.VERTEX_AI_LOCATION || 'us-central1' })],
});

const InputSchema = z.object({
  script: z.string(),
  benchmarkAdvice: z.string().optional(),
  persona: z.string().optional(),
});

const OutputSchema = z.object({
  subtitle: z.object({
    color: z.string(),
    font: z.string(),
    size: z.number(),
    bgColor: z.string(),
    bgOpacity: z.number(),
  }),
  textPosition: z.enum(['top', 'center', 'center-large', 'bottom', 'free']),
  reasoning: z.string(),
});

export const suggestSubtitleFlow = ai.defineFlow(
  {
    name: 'suggestSubtitleFlow',
    inputSchema: InputSchema,
    outputSchema: OutputSchema,
  },
  async ({ script, benchmarkAdvice, persona }) => {
    const { output } = await ai.generate({
      model: gemini15Flash,
      output: { schema: OutputSchema },
      prompt: `
숏폼 대본: ${script}
벤치마킹 조언: ${benchmarkAdvice || '(없음)'}
페르소나: ${persona || '(없음)'}

위 정보를 바탕으로 이 영상에 어울리는 자막 스타일을 제안해주세요.
- color: HEX 문자열
- font: Pretendard / Noto Sans KR / Spoqa Han Sans Neo / IBM Plex Sans KR / Suit 중 1
- size: 24~96 정수
- bgColor: HEX
- bgOpacity: 0~1 실수
- textPosition: top / center / center-large / bottom / free 중 1
- reasoning: 1~2 문장 한국어 설명
      `,
    });
    return output;
  },
);
```

- [ ] **Step 2: API route**

```javascript
// app/api/shortform-subtitle-advice/route.js
import { NextResponse } from 'next/server';
import { suggestSubtitleFlow } from '@/lib/genkit/shortform-subtitle-advice';
import { resolveAdmin } from '@/lib/api-helpers'; // 기존 헬퍼 사용 (있는 경우)

export const maxDuration = 30;

export async function POST(req) {
  try {
    const body = await req.json();
    const result = await suggestSubtitleFlow(body);
    return NextResponse.json({ advice: result });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
```

- [ ] **Step 3: Step6Preview에 버튼 추가**

세부 조정 섹션 상단에 "AI가 자막 추천해줘" 버튼 1개. 응답 받으면 `onChange` 1회 호출.

- [ ] **Step 4: 빌드 + 수동 테스트 + 커밋**

이 task는 P1이므로 실패 시 skip (커밋 생략). 성공 시:

```bash
git add lib/genkit/shortform-subtitle-advice.js app/api/shortform-subtitle-advice/route.js app/shortform/components/Step6Preview.js
git commit -m "$(cat <<'EOF'
feat(shortform): Genkit 기반 AI 자막 추천 (P1, 선택)

Gemini 1.5 Flash로 대본 + 벤치마킹 조언 + 페르소나 → 자막 스타일 추천.
Step 6 세부 조정 모드에서 "AI 추천" 버튼 1회 호출 후 자동 반영.
failure 시 사용자에게 에러 표시, 기존 값 유지.
EOF
)"
```

---

## Task F11: 사진 액센트 → 씬별 배치 조정

Step 5에서 선택한 사진/AI 이미지를 hook / body / cta 중 어디에 배치할지 사용자가 조정. 기본은 scriptToProps의 `[0] → hook, [1] → body` 고정이지만, Step 6에서 드래그 없이 드롭다운으로 간단히 선택.

**Files:**
- Modify: `app/shortform/components/Step6Preview.js` (섹션 추가)
- Modify: `app/shortform/ShortformClient.js` (scriptToProps 확장)

- [ ] **Step 1: sceneImageOrder state 형태**

```javascript
// step6Value.sceneImageOrder: [{ sceneId: 'hook'|'body', imageUrl: string }]
```

- [ ] **Step 2: Step6Preview에 섹션 추가**

`controlCol` 아래쪽 section 추가:

```javascript
{mergedImages.length > 0 && (
  <section className={styles.section}>
    <h3 className={styles.sectionTitle}>사진 배치</h3>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div>
        <label>Hook 씬: </label>
        <select
          value={value?.sceneImageOrder?.find((s) => s.sceneId === 'hook')?.imageUrl || ''}
          onChange={(e) => updateSceneImage('hook', e.target.value)}
        >
          <option value="">(없음)</option>
          {mergedImages.map((url) => (
            <option key={url} value={url}>{url.split('/').pop()}</option>
          ))}
        </select>
      </div>
      <div>
        <label>Body 씬: </label>
        <select
          value={value?.sceneImageOrder?.find((s) => s.sceneId === 'body')?.imageUrl || ''}
          onChange={(e) => updateSceneImage('body', e.target.value)}
        >
          <option value="">(없음)</option>
          {mergedImages.map((url) => (
            <option key={url} value={url}>{url.split('/').pop()}</option>
          ))}
        </select>
      </div>
    </div>
  </section>
)}
```

`mergedImages`는 ShortformClient에서 props로 내려줌.

- [ ] **Step 3: scriptToProps에서 sceneImageOrder 우선 적용**

```javascript
function scriptToProps(script, presetKey, totalDurationSec, bodyImages, sceneImageOrder) {
  // ... 기존 로직
  const hookImage = sceneImageOrder?.find((s) => s.sceneId === 'hook')?.imageUrl
    || bodyImages?.[0];
  const bodyImage = sceneImageOrder?.find((s) => s.sceneId === 'body')?.imageUrl
    || bodyImages?.[1]
    || bodyImages?.[0];

  return {
    // ...
    hook: { ..., imageUrl: hookImage, ... },
    body: { ..., imageUrl: bodyImage, ... },
    // ...
  };
}
```

- [ ] **Step 4: ShortformClient playerProps 의존성에 sceneImageOrder 추가**

```javascript
const playerProps = useMemo(() => {
  if (!script) return null;
  const bodyImages = mergedImages.length > 0 ? mergedImages : images;
  return scriptToProps(script, presetKey, totalDurationSec, bodyImages, step6Value?.sceneImageOrder);
}, [script, presetKey, totalDurationSec, images, mergedImages, step6Value?.sceneImageOrder]);
```

- [ ] **Step 5: 빌드 + 커밋**

```bash
npx next build 2>&1 | grep -iE "error|✓ Compiled" | head -5
git add app/shortform/ShortformClient.js app/shortform/components/Step6Preview.js
git commit -m "$(cat <<'EOF'
feat(shortform): Step 6 사진 배치 조정 — hook/body 씬별 이미지 선택

step6Value.sceneImageOrder로 사용자가 어떤 사진을 어느 씬에 쓸지
드롭다운으로 선택. scriptToProps가 우선순위: sceneImageOrder →
bodyImages 순으로 hook/body imageUrl 결정.
EOF
)"
```

---

## Task F12: 실시간 미리보기 반영 검증

**Files:** (수동 검증만)

- [ ] **Step 1: 기본 흐름**

브라우저 `/shortform`:

- [ ] Step 1~5를 거친 후 Step 6 진입
- [ ] benchmarkAggregated가 없어도 (Phase B 미완 상태) 기본 프리셋(friendly)로 Player 렌더
- [ ] 자동 추천 배너가 benchmarkAggregated가 있을 때만 표시
- [ ] "추천대로 갈게" 클릭 → 프리셋이 recommendedId로 변경 + Player 즉시 재생 상태 반영
- [ ] "세부 조정" 클릭 → SubtitleCustomizer 노출
- [ ] 자막 크기 슬라이더 드래그 → Player 내 자막 크기 실시간 변화
- [ ] 자막 색 변경 → Player 즉시 반영
- [ ] 카메라 모션 변경 (static → zoom-in) → Player 재생 시 카메라 효과 변화 확인
- [ ] 씬 전환 변경 (slide → cut) → 씬 경계에서 전환 효과 변화 확인
- [ ] 프리셋 변경 (친근 → 임팩트) → 모든 값이 새 프리셋 기본값으로 리셋
- [ ] 이전 단계로 갔다가 돌아오면 step6Value 상태 보존

- [ ] **Step 2: Performance 체크**

- [ ] 슬라이더를 빠르게 드래그해도 Player가 멈추지 않는지 (useMemo 의존성 올바른지)
- [ ] React DevTools에서 Step6Preview가 불필요하게 리렌더되지 않는지
- [ ] DevTools Console 에러/warning 0건

- [ ] **Step 3: 회귀 체크**

- [ ] Step 6에 진입하지 않아도 runAll 경로(페이지 맨 아래 빠른 모드 버튼)가 기존대로 동작
- [ ] Remotion render (CLI 또는 서버 경로)가 새 props를 받아도 깨지지 않는지 `npm run remotion:render` 또는 관련 스크립트로 체크

- [ ] **Step 4: 결과 기록**

발견한 이슈 있으면 기록.

---

## Task F13: Phase F 자기 검토

### Spec coverage

| 스펙 섹션 | 커버 task |
|---|---|
| §4 Step 6 — 자동 추천 배너 | F7, F8 |
| §4 Step 6 — 프리셋 6종 선택 | F1, F5 |
| §4 Step 6 — 자막 폰트/색/크기/배경 | F6 |
| §4 Step 6 — 텍스트 위치/카메라/전환 | F6, F2, F3, F4 |
| §4 Step 6 — Remotion Player 실시간 | F8 |
| §4 Step 6 — 액센트 위치 조정 | F11 |
| §16 Phase 2 효과 (카메라/전환) | F2, F3, F4 |
| §24 프리셋 정의 | F1 |

### 알려진 미완 / 한계

- **프리셋별 BGM 자동 적용**: Phase F는 미리보기까지만. BGM 선택은 Step 7 (Phase H) 또는 별도 Phase. Phase F에서는 `bgmCategory` 메타데이터만 정의.
- **액센트 위치 드래그**: 스펙에는 "드래그"로 명시됐으나 Phase F에서는 드롭다운 UI로 단순화 (F11). 드래그는 v2 개선 사항.
- **프리셋 ↔ 컬러 프리셋 매핑 재검토**: 현재 F1에서 정의한 colorPreset 매핑(midnight/cream/champagne/rose)은 기존 10종 중 선택. 실제 시각 품질 검증 후 다른 프리셋으로 교체 가능.
- **Genkit AI 자막 추천 (F10)**: P1, 선택 구현.
- **사용자가 세부 조정 후 프리셋 변경 시 현재 값 덮어쓰기**: F8의 `handlePresetChange`는 프리셋 기본값으로 초기화함. 사용자 경고 모달(변경 유실 안내)은 추후 개선.

### 통합 지점

- **Phase B**: `step2Value.benchmarkAggregated.recommendedPreset` + `advice` 문자열 제공. resolveRecommendedPreset()가 label/id 모두 수용.
- **Phase D**: `script` + `playerProps`가 준비된 상태에서 Step 6 렌더. script 없으면 empty state 표시.
- **Phase E**: `mergedImages` (step5Value에서 파생) 배열을 Step 6에 prop으로 전달 → 사진 배치 UI.
- **Phase G (브랜드 킷)**: primary_color를 subtitle.color 기본값으로 제안 (Phase G에서 구현).
- **Phase H (렌더)**: 최종 렌더링 시 step6Value 전체를 Remotion 서버 렌더 props로 전달.

### 회귀 안전성

- ShortformComposition은 새 props가 선택적이라 기존 ShortformClient runAll 경로 영향 없음
- KenBurnsImage 기본값 `ken-burns` → 하위 호환
- Step 6 진입 전에는 기존 Player 표시, 진입 시에만 Step6Preview 내부 Player 사용
- Phase E의 step5Value 무관 (사진 없어도 동작)

---

## Task F14: 메모리 + 마스터 플랜 상태 업데이트

**Files:**
- Modify: `~/.claude/projects/-Users-gong-eunhui-Desktop-naver-title-generator/memory/MEMORY.md`
- Create: `~/.claude/projects/-Users-gong-eunhui-Desktop-naver-title-generator/memory/project_shortform_phase_f_complete.md`
- Modify: `docs/superpowers/plans/2026-04-14-shortform-master-plan.md`

- [ ] **Step 1: 메모리 파일**

```markdown
---
name: 숏폼 Phase F 완료
description: Step 6 미리보기 + 프리셋 6종 + 자막 커스터마이징
type: project
---

# 숏폼 Phase F 완료

**완료일:** 2026-04-XX
**스펙:** §4 Step 6, §16 Phase 2 효과, §24 프리셋 정의
**플랜:** docs/superpowers/plans/2026-04-14-shortform-phase-f-preview.md

## 핵심 변경

- lib/shortform-presets.js — 상위 프리셋 6종 (전문가/친근/임팩트/차분/트렌디/비즈니스)
- Remotion Composition 확장 — subtitle/textPosition/cameraMotion/sceneTransition props
- Scene 컴포넌트 (Hook/Body/CTA) 새 props 수용
- KenBurnsImage 4종 카메라 모션 (static/ken-burns/zoom-in/pan)
- PresetPicker + SubtitleCustomizer + RecommendationBanner 컴포넌트
- Step6Preview — 2-컬럼 Remotion Player 실시간 미리보기
- 벤치마킹 결과 `recommendedPreset` 자동 추천 배너
- 사진 액센트 씬별 배치 조정 (드롭다운)
- Genkit AI 자막 추천 (P1, 선택)

## 신규 파일

- lib/shortform-presets.js
- app/shortform/components/PresetPicker.js + .module.css
- app/shortform/components/SubtitleCustomizer.js + .module.css
- app/shortform/components/Step6Preview.js + .module.css
- app/shortform/components/RecommendationBanner.js
- lib/genkit/shortform-subtitle-advice.js (P1)
- app/api/shortform-subtitle-advice/route.js (P1)

## 수정 파일

- remotion/shortform/ShortformComposition.jsx
- remotion/shortform/HookScene.jsx
- remotion/shortform/BodyScene.jsx
- remotion/shortform/CTAScene.jsx
- remotion/shortform/KenBurnsImage.jsx
- remotion/shortform/styles.js (buildSubtitleStyle 추가)
- app/shortform/ShortformClient.js

## 다음 Phase

Phase G (브랜드 킷) — primary_color를 자막·키네틱에 자동 반영
Phase H (Step 7 다운로드 + 최종 렌더)
```

- [ ] **Step 2: MEMORY.md 한 줄 추가**

```markdown
- [4/XX 숏폼 Phase F 완료](project_shortform_phase_f_complete.md) — Step 6 미리보기 + 프리셋 6종 + 자막 커스터마이징
```

- [ ] **Step 3: 마스터 플랜 상태 표시**

```markdown
**상태:** ✅ 완료 (커밋 SHA: XXXXXXX)
```

- [ ] **Step 4: 최종 커밋**

```bash
git add docs/superpowers/plans/2026-04-14-shortform-master-plan.md
git commit -m "$(cat <<'EOF'
docs: Phase F 완료 마킹 + 메모리 기록

Phase F (Step 6 미리보기 + 프리셋 6종 + 자막 커스터마이징) 완료.
Phase G / H 진입 가능.
EOF
)"
```

---

## Phase F 완료 후 다음 단계

Phase G (Brand Kit) 상세 플랜 작성으로 진행. Phase G는 Step 3(대본) + Step 6(미리보기) + Step 7(캡션) 세 지점에 브랜드 킷을 주입하는 작업이며, Phase F에서 정의한 `step6Value.subtitle.color` 필드에 `primary_color` 기본값을 덮어쓰는 통합이 핵심.
