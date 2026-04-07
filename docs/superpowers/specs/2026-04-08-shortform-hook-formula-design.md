# 숏폼 후킹 공식 + 첫 씬 HookOverlay + B-roll 프롬프트 개선

**날짜**: 2026-04-08
**상태**: 승인됨

## 문제

1. SYSTEM_PROMPT의 HPC 법칙이 "질문 또는 충격적 사실" 2가지만 제시 → 매번 밋밋한 후킹
2. 첫 씬 비주얼이 scroll-stopping이 아님 (일반 B-roll과 동일 프롬프트)
3. 첫 씬에서 후킹 텍스트를 강조할 방법이 없음 (85%가 무음 시청)

## 설계

### 1. `shortform-script.js` — SYSTEM_PROMPT 개선

#### 후킹 공식 6종 추가

```
[후킹 공식 — 첫 씬에 반드시 적용]
아래 6가지 중 주제에 가장 적합한 후킹 유형을 선택하세요:
1. 질문형: 답을 모르면 불편한 구체적 질문 ("왜 ~일까요?")
2. 충격/대담형: 통념을 뒤집는 주장 ("~은(는) 틀렸습니다")
3. 비밀/배타형: 희소한 정보 암시 ("상위 1%만 아는 ~")
4. 증거형: 구체적 숫자로 결과 제시 ("30일 만에 ~ 달성")
5. 공감형: 시청자의 고통에 동일시 ("~ 저도 그랬습니다")
6. 경고형: 손실을 경고 ("이것 모르면 ~ 낭비입니다")
```

#### 대본 구조 개선 (HPC → 확장)

```
[대본 구조]
- Hook(첫 1~2씬): 후킹 공식 적용. 첫 문장이 스크롤을 멈춰야 합니다.
- Point(핵심): 하나의 핵심 메시지에 집중. 포인트 나열 금지.
- CTA(행동 유도): 강요가 아닌 자연스러운 대화체.
- 구어체 사용, 문어체 금지. 한 문장에 하나의 정보만.
- 숫자는 구체적으로 (많이→87%, 대부분→10명 중 8명)
```

#### 첫 씬 규칙 강제

```
[첫 씬 규칙]
- scenes[0]은 반드시 type: "broll"
- scenes[0]의 script는 후킹 공식을 적용한 강렬한 첫 문장
- scenes[0]의 visual에 "scroll-stopping, dramatic, high contrast" 포함
- scenes[0]에 hookText 필드 추가: 화면에 크게 표시할 후킹 문구 (한국어, 12자 이내)
```

#### postProcessScenes() 수정

- 첫 씬이 `type: "text"`이면 강제로 `type: "broll"`로 변환
- 첫 씬에 `hookText` 없으면 script에서 자동 추출 (12자 이내)

### 2. `ShortformComposition.jsx` — HookOverlay 컴포넌트

#### 새 컴포넌트: HookOverlay

```jsx
const HookOverlay = ({ text, durationInFrames }) => {
  // TextCard와 유사한 스타일, 배경은 투명
  // fade-in 6프레임 + hold + fade-out 6프레임
  // 큰 글씨 (88~108px), 볼드, 텍스트 섀도우
  // 화면 중앙 배치
};
```

#### 렌더링 로직

```jsx
{timeline.visualSpans.map((visual, index) => {
  const isFirstScene = index === 0;
  const hookText = isFirstScene ? props.hookText : null;

  return (
    <Sequence ...>
      <BackgroundLayer visual={visual} />
      {isFirstScene && hookText ? (
        <HookOverlay text={hookText} durationInFrames={visual.durationInFrames} />
      ) : !isTextCard ? (
        <AbsoluteFill style={overlayStyle} />
      ) : null}
      {isTextCard && <TextCard ... />}
    </Sequence>
  );
})}
```

#### 자막 필터 수정

첫 씬(hookText 있는 경우) 구간의 자막도 숨김:

```javascript
.filter((scene) => {
  // 기존: 텍스트 카드 구간 자막 제거
  // 추가: 첫 씬(hook overlay) 구간 자막 제거
  const firstSpan = timeline.visualSpans[0];
  if (firstSpan && props.hookText && 
      scene.startSec >= firstSpan.startSec && scene.startSec < firstSpan.endSec) {
    return false;
  }
  return !timeline.visualSpans.some((span) => {
    if (span.sceneType !== 'text') return false;
    return scene.startSec >= span.startSec && scene.startSec < span.endSec;
  });
})
```

### 3. `shortform-broll-core.js` — 첫 씬 B-roll 프롬프트 강화

`buildVisualPrompt()` 수정:

```javascript
function buildVisualPrompt(visual, visualStyle, kind, isFirstScene) {
  const scrollStopping = isFirstScene 
    ? 'Scroll-stopping, dramatic composition, high contrast, cinematic impact. ' 
    : '';
  
  if (kind === 'video') {
    return [
      scrollStopping + visual.trim(),
      'Cinematic vertical 9:16 ...',
    ].filter(Boolean).join('\n');
  }
  return [
    scrollStopping + visual.trim(),
    'Vertical 9:16 still image ...',
  ].filter(Boolean).join('\n');
}
```

### 4. 데이터 흐름

```
[shortform-script.js]
  Claude 대본 생성 → scenes[0] = {
    type: "broll",
    script: "후킹 문장",
    visual: "scroll-stopping dramatic ...",
    hookText: "12자 이내 후킹 문구"  ← 새 필드
  }
      ↓
[shortform.html] 
  state.hookText = script.scenes[0].hookText
  → 렌더 요청에 hookText 포함
      ↓
[shortform-broll-core.js]
  첫 씬 B-roll에 "scroll-stopping" 프롬프트 추가
      ↓
[Remotion render]
  ShortformComposition → 첫 씬: BackgroundLayer + HookOverlay
  → 첫 씬 구간 자막 숨김
```

## 수정 파일

| 파일 | 변경 내용 |
|------|----------|
| `api/shortform-script.js` | SYSTEM_PROMPT 후킹 공식 6종 + 대본 구조 개선 + 첫 씬 규칙 + hookText 필드 |
| `remotion/shortform/ShortformComposition.jsx` | HookOverlay 컴포넌트 + 첫 씬 자막 숨김 |
| `services/shortform-broll-core.js` | buildVisualPrompt에 isFirstScene 파라미터 추가 |
| `shortform.html` | hookText를 렌더 요청에 전달 |
| `remotion/shortform/timeline.js` | hookText를 timeline에 전달 (inputProps) |
