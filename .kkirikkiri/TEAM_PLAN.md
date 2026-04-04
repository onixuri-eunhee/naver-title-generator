# 팀 작업 계획

- 팀명: kkirikkiri-dev-0402-motion-sync
- 목표: 숏폼 모션그래픽 텍스트를 STT 타임스탬프에 직접 바인딩하여 음성-텍스트 싱크 구현
- 생성 시각: 2026-04-02
- 대상 파일: shortform.html (3169줄)

## 현재 문제
- buildMotionScenes()가 대본 글자 수 비율로 씬 타이밍을 균등 분배 → 실제 음성과 무관
- drawFrame()에서 textAnimProgress = (sceneProgress - 0.1) / textWindow → 씬 시작 기준 상대 시간
- 결과: 모션그래픽 텍스트가 음성과 싱크 안 됨. 영상/이미지/글자가 따로 움직임

## 해결 방향
- STT word-level 타임스탬프를 모션그래픽 씬에 직접 바인딩
- 문장 시작 시점 = 해당 문장 첫 STT 단어의 start
- 단어별 등장/하이라이트 = 각 word의 start~end에 맞춰 애니메이션
- 말 안 하는 구간 = 텍스트 멈춤/사라짐

## 팀 구성
| 이름 | 역할 | 모델 | 담당 업무 |
|------|------|------|----------|
| leader | 팀장 | Opus | 계획/배분/검증/통합 |
| dev-sync | 개발자 1 | Opus | buildMotionScenes() 재설계 + drawFrame() STT 바인딩 |
| dev-anim | 개발자 2 | Opus | drawMotionText() 개선 + 단어 등장/강조 애니메이션 |

## 상세 구현 설계

### 변경 1: buildMotionScenes() 재설계 (2987~3058줄)

**핵심 아이디어**: STT 세그먼트가 있을 때, 각 문장(sentenceEntry)의 start/duration을 글자 수 비율이 아닌 STT 타임스탬프에서 직접 매칭

**구현**:
1. `findSectionBoundaries()`는 이미 STT 기반으로 섹션(hook/point/cta) 경계를 잡아줌 → 그대로 활용
2. 문장별 타이밍 계산 변경:
   - 섹션 내 문장들을 `splitNarrationSentences()`로 분리한 후
   - 각 문장의 정규화 텍스트를 STT 세그먼트의 정규화 텍스트와 매칭
   - 매칭된 STT 세그먼트들의 `start`~`end`를 해당 문장의 타이밍으로 사용
3. STT가 없으면(폴백) 기존 글자 수 비율 분배 유지

**새 헬퍼 함수**: `matchSentenceToStt(sentence, sttSegments, searchStart)`
- sentence의 정규화 텍스트를 STT 연결 텍스트에서 찾아 해당 구간의 세그먼트 인덱스 범위 반환
- 반환: `{ startTime, endTime, nextSearchStart }`

**sentenceEntry에 STT 정보 추가**:
- `sttStart`: 해당 문장이 시작되는 절대 시간
- `sttEnd`: 해당 문장이 끝나는 절대 시간
- `sttWords`: 해당 문장에 매핑된 STT 세그먼트 배열 (단어별 타이밍)

### 변경 2: drawFrame() STT 바인딩 (3100줄 부근)

**현재**: `textAnimProgress = clamp01((sceneProgress - 0.1) / motionSettings.textWindow)`
**변경**: STT 데이터가 씬에 있으면 → `elapsed` 기준으로 STT 단어 진행률 계산

```
if (currentScene.sttWords && currentScene.sttWords.length) {
  // STT 기반: elapsed 기준으로 현재 어디까지 말했는지 계산
  textAnimProgress = getSttTextProgress(currentScene.sttWords, elapsed, currentScene.sttStart, currentScene.sttEnd);
} else {
  // 폴백: 기존 방식
  textAnimProgress = clamp01((sceneProgress - 0.1) / motionSettings.textWindow);
}
```

### 변경 3: drawMotionText() 개선 (2913~2922줄)

**현재**: line delay 기반 순차 등장 (STT 무관)
**변경**: 
- 씬에 `sttWords`가 있으면 → 각 줄(line)에 해당하는 STT 구간을 찾아 줄별 진행률 계산
- 단어별 하이라이트는 복잡도 대비 효과가 낮으므로, **줄 단위 등장**을 STT에 바인딩
- 각 줄의 첫 단어 start 시점에 해당 줄이 등장 시작

**새 시그니처**: `drawMotionText(ctx, textLines, cx, startY, fontSize, lineHeight, color, animProgress, sttLineTimings, elapsed)`
- `sttLineTimings`: 각 줄의 `{start, end}` 배열 (없으면 null → 기존 방식)

### 변경 4: STT-줄 매핑 헬퍼

**새 함수**: `getSttLineTimings(textLines, sttWords, sceneStart)`
- wrapText()로 분리된 textLines와 sttWords를 매칭
- 각 줄에 해당하는 STT 세그먼트의 시작/끝 시간 반환

**새 함수**: `getSttTextProgress(sttWords, elapsed, sttStart, sttEnd)`
- elapsed 기준으로 전체 문장의 단어 진행률 (0~1) 반환
- 아직 시작 안 했으면 0, 끝났으면 1

## 태스크 목록
- [x] 태스크 0: 코드 분석 및 상세 설계 → leader
- [x] 태스크 1: matchSentenceToStt() 헬퍼 + buildMotionScenes() 내 STT 매핑 적용 → leader (dev-sync 대행)
- [x] 태스크 2: drawFrame() STT 바인딩 (sttWords + elapsed 전달) → leader (dev-sync 대행)
- [x] 태스크 3: drawMotionText() + drawSttSyncedText() 구현 → dev-anim (사전 완료)
- [x] 태스크 4: 통합 검증 → leader

## 주요 결정사항
1. 단어별 하이라이트(글자 색상 변경)는 이번 범위에서 제외 — 줄 단위 등장 싱크로 충분한 효과
2. B-roll 씬의 자막 싱크(getActiveSubtitle)는 건드리지 않음
3. getMotionSettings() 속도 프리셋은 STT 없을 때 폴백에서만 사용
4. STT 있을 때도 motionSettings.lineDuration을 fade-in 시간으로 활용 (자연스러운 등장 효과)

## 핵심 코드 위치 (shortform.html)
- buildMotionScenes(): 2987~3058줄 — 씬 구성 (재설계 대상)
- findSectionBoundaries(): 2931~2985줄 — HPC 섹션 경계 (STT 활용 중)
- drawFrame(): 3061~3121줄 — 렌더링 루프 (싱크 바인딩 대상)
- drawMotionText(): 2913~2922줄 — 텍스트 애니메이션 (개선 대상)
- getMotionSettings(): 2742~2752줄 — 속도 프리셋
- getActiveSubtitle(): 2644~2654줄 — B-roll 자막 싱크 (참고: 이미 STT 활용 중)
- state.sttSegments: STT 결과 저장 (word-level timestamps)
