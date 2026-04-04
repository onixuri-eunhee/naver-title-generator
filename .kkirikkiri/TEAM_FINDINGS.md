# 발견 사항 & 공유 자료

(팀원들이 발견한 내용을 여기에 기록)

## dev-anim — drawMotionText() + drawSttSyncedText() 구현 (2026-04-02)

### 변경 위치
- `/Users/gong-eunhui/Desktop/naver-title-generator/shortform.html` 2913~3025줄

### drawMotionText() 시그니처 변경
```
기존: drawMotionText(ctx, textLines, cx, startY, fontSize, lineHeight, color, animProgress)
변경: drawMotionText(ctx, textLines, cx, startY, fontSize, lineHeight, color, animProgress, sttWords, currentTime)
```
- sttWords가 없거나 빈 배열이면 기존 방식 그대로 동작 (완전 하위 호환)
- dev-sync가 drawFrame()에서 호출 시 sttWords, currentTime을 넘기면 STT 모드 활성화

### drawSttSyncedText() 세부사항
- sttWords 각 항목에서 `text` 또는 `word` 필드 참조 (방어 코드)
- `end`가 없는 경우 `start + 0.3` 폴백
- ctx.measureText로 단어별 줄바꿈 (maxW = CANVAS_W * 0.78)
- 단어 상태 4단계: ghost(0.15) → fade-in → highlight(ACCENT+scale) → done(white)
- scale 적용 시 translate-scale-translate 패턴으로 단어 중심 기준 확대
- CANVAS_W 변수를 직접 참조 (drawFrame 스코프 내부에 있으므로 접근 가능)

## dev-sync — buildMotionScenes() 재설계 + drawFrame() STT 바인딩 (2026-04-02, 2차)

### 이전 접근 (matchSentenceToStt) 교체 이유
- matchSentenceToStt()는 스크립트 텍스트를 STT 텍스트에서 indexOf 검색하는 방식
- 한국어에서 STT 결과와 원본 스크립트가 미묘하게 다를 수 있음 (어미, 조사 등)
- 매칭 실패 시 전체 문장이 폴백으로 빠져서 STT 싱크가 부분적으로만 동작

### 새 접근: groupSttIntoSentences() + assignSttSentencesToSections()
- STT 세그먼트 자체를 문장 종결 부호(.!?。！？) 기준으로 그룹핑
- 스크립트 텍스트 매칭이 아니라 STT 데이터만으로 문장 구성 → 매칭 실패 없음
- 각 문장의 midpoint를 HPC 섹션 경계와 비교하여 배정
- 빈 섹션 방지: 인접 섹션에서 문장을 빌려옴
- 시간순 정렬 + 겹침 보정 포함

### drawFrame() STT 기반 textAnimProgress
- 기존: `(sceneProgress - 0.1) / textWindow` — 씬 시작 기준 고정 비율
- 변경: `spokenCount / totalWords` — elapsed 시간 대비 말한 단어 수 비율
- 단어 중간 시점(start < elapsed < end)은 부분 진행률로 부드럽게 처리
- sttWords가 없으면 기존 시간 기반 폴백 유지

### B-roll 삽입 전략 변경
- 이전: groupSize 기반 균등 삽입
- 변경: HPC 섹션 전환 시점 우선 삽입 → 남은 미디어는 텍스트 씬 사이 균등 배치
- 자연스러운 전환 효과 (hook→point, point→cta 사이에 B-roll)

### 주의사항
- broll 씬의 duration이 다음 text 씬 시작을 침범하지 않도록 제한
- 마지막 씬이 totalDur에 미달/초과 시 보정 로직 포함
- sectionIndex 필드가 각 씬에 추가됨 (B-roll 삽입 판단용)

---

# DEAD_ENDS (시도했으나 실패한 접근)

(실패한 접근을 여기에 기록하여 같은 실수 반복 방지)
