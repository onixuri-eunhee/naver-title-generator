# 텍스트 카드 1초 고정 + 자막 겹침 수정

**날짜**: 2026-04-08
**상태**: 승인됨

## 문제

1. 텍스트 카드와 B-roll이 동일 시간 균등 분할 → 텍스트 카드가 불필요하게 길거나 짧음
2. 첫 번째~세 번째 텍스트 카드 사이 자막이 모두 사라짐 (필터링 과도)
3. 텍스트 카드 fade-in/out이 1초 씬에서는 시간 대부분 차지

## 설계

### 1. `timeline.js` — `buildVisualSpans()` 수정

텍스트 카드는 1초 고정, 나머지 시간을 B-roll끼리 균등 분할.

```
TEXT_CARD_DURATION_SEC = 1.0

예) 30초, 7씬 (text 2 + broll 5):
  텍스트 카드 합계: 2초
  B-roll 합계: 28초 / 5 = 5.6초씩
  결과: [broll 5.6] [text 1.0] [broll 5.6] [broll 5.6] [text 1.0] [broll 5.6] [broll 5.6]
```

알고리즘:
1. 텍스트 카드 수 세기 → 총 텍스트 시간 = count * 1.0
2. B-roll 시간 = durationSec - 총 텍스트 시간
3. B-roll 씬당 시간 = B-roll 시간 / B-roll 수
4. 순서대로 startSec/endSec 누적 계산
5. B-roll 씬 간 오버랩 0.3초 유지 (텍스트 카드에는 오버랩 없음)

### 2. `ShortformComposition.jsx` — 자막 필터 수정

현재: `scene.endSec > span.startSec && scene.startSec < span.endSec` (양방향 겹침)
변경: `scene.startSec >= span.startSec && scene.startSec < span.endSec` (자막 시작점 기준)

자막의 시작점이 텍스트 카드 구간 안에 있을 때만 제거. 텍스트 카드 직전에 시작한 자막은 살림.

### 3. `TextCard.jsx` — 애니메이션 타이밍 단축

| 항목 | 현재 | 변경 |
|------|------|------|
| fade-in | 15프레임 (0.5초) | 8프레임 (0.27초) |
| fade-out | 10프레임 (0.33초) | 6프레임 (0.2초) |
| 텍스트 가독 시간 | ~0.17초 | ~0.53초 |

### 미변경

- `shortform-script.js` 대본 생성/씬 구조 (텍스트 카드 비율 20~40% 로직 유지)
- `shortform-broll-core.js` B-roll 생성 로직
- `TextCard.jsx` 템플릿 스타일 4종

## 수정 파일

| 파일 | 변경 내용 |
|------|----------|
| `remotion/shortform/timeline.js` | `buildVisualSpans()` — 텍스트 카드 1초 고정 분할 |
| `remotion/shortform/ShortformComposition.jsx` | 자막 필터를 시작점 기준으로 변경 |
| `remotion/shortform/TextCard.jsx` | fade-in/out 프레임 수 단축 |
