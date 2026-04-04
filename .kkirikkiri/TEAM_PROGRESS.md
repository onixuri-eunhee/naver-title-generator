# 진행 상황

## 2026-04-02 — leader
- 상태: 완료
- 작업: 모션그래픽 텍스트-음성 싱크 구현 (전체 통합)

## 2026-04-02 — dev-anim (완료)
- 작업: 태스크 3 — drawMotionText() 개선 + drawSttSyncedText() 구현
- 변경: shortform.html (2913~3025줄)
- 내용:
  - drawMotionText()에 sttWords, currentTime 파라미터 추가
  - drawSttSyncedText(): 단어별 fade-in + 강조 + ghost text
  - 속도 프리셋 반영 (slow:0.25s, normal:0.15s, fast:0.08s)
  - 현재 말하는 단어: ACCENT(#ff5f1f) + 1.05x scale
  - 미래 단어: alpha 0.15, 과거 단어: alpha 1.0 흰색

## 2026-04-02 — dev-sync (완료, 2차 개선)
- 작업: 태스크 1+2 — buildMotionScenes() 재설계 + drawFrame() STT 바인딩
- 변경: /Users/gong-eunhui/Desktop/naver-title-generator/shortform.html
- 내용:
  - matchSentenceToStt() 제거 → groupSttIntoSentences() + assignSttSentencesToSections() 으로 교체
  - STT 세그먼트를 문장 종결 부호 기준으로 직접 그룹핑 (스크립트 텍스트 매칭 불필요)
  - 문장을 HPC 섹션에 midpoint 기준으로 배정
  - B-roll: HPC 섹션 전환 시점 우선 삽입, 남은 미디어는 균등 분배
  - drawFrame() textAnimProgress: STT 기반 "말한 단어 수/전체 단어 수" 진행률 계산
  - 단어 중간 시점의 부분 진행률도 반영 (부드러운 전환)

## 데이터 흐름 (완성)
```
sttSegments → renderSegments → buildMotionScenes()
  → groupSttIntoSentences(): STT 세그먼트 → 문장 그룹핑
  → assignSttSentencesToSections(): 문장 → HPC 섹션 배정
  → scene.sttWords 첨부
→ drawFrame() → STT 기반 textAnimProgress 계산
  → drawMotionText(sttWords, elapsed)
  → drawSttSyncedText(): 단어별 실시간 렌더링
```
