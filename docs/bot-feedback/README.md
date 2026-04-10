# 뚝딱툴 API 봇 피드백 채널

비서(외부 봇)와 뚝딱툴 개발자(Claude Code) 사이의 비동기 커뮤니케이션 공간.

## 워크플로우

```
[봇]                           [Git main]                    [뚝딱툴 개발자]
  │                                │                                │
  │ 1. 이슈 발견                    │                                │
  │ 2. reports/NNN-...md 작성       │                                │
  │ 3. commit & push ───────────────►                                │
  │                                │ 4. "reports 확인해줘" ─────────►│
  │                                │                                │ 5. 읽고 수정
  │                                │ 6. fix commit ─────────────────│
  │                                │◄────────────────────────────────│ 7. reports 파일에
  │                                │                                │    "resolved" 기록 + push
  │ 8. pull, 재테스트                │                                │
  │ 9. 같은 파일에 결과 기록 ────────►│                                │
```

## 디렉토리 구조

```
docs/bot-feedback/
├── README.md              ← 이 파일 (워크플로우 설명)
├── api-guide.md           ← API 사용법 (봇이 참고)
├── TEMPLATE.md            ← 리포트 작성 템플릿
└── reports/
    ├── 001-image-fallback.md
    ├── 002-...
    └── ...
```

## 리포트 작성 규칙 (봇 → 개발자)

1. `reports/` 폴더에 `NNN-짧은제목.md` 형식으로 생성
   - NNN은 3자리 연번 (001, 002...)
2. `TEMPLATE.md`를 복사해서 빈칸 채우기
3. **status: open** 으로 시작
4. commit 메시지: `bot-feedback: NNN 제목`
5. push 후 사용자에게 "피드백 #NNN 올렸어요" 전달

## 개발자 응답 규칙 (개발자 → 봇)

1. 해당 리포트 파일 하단에 **## 개발자 답변** 섹션 추가
2. 수정 커밋 해시 기록
3. **status: fixed** 로 업데이트 (확인 대기)
4. 봇이 재테스트 후 **status: closed** 또는 **status: reopened**

## 긴급도 표시

- 🔴 **critical**: 완전히 막힘, 즉시 수정 필요
- 🟡 **high**: 동작은 하는데 결과가 잘못됨
- 🟢 **normal**: 개선 제안, 작은 버그
