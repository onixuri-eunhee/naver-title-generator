# 발견 사항 & 공유 자료

## 배경 정보
- 대상 파일: /Users/gong-eunhui/Desktop/naver-title-generator/blog-writer.html
- PROMPT_A (홈피드): 네이버 홈피드 최적화, 본문 1300자+, 합계 1800자+
- PROMPT_B (네이버SEO): 네이버 VIEW 탭 SEO, 본문 1000자+
- PROMPT_C (구글SEO): 구글 E-E-A-T, 본문 2000자+, FAQ 포함
- 이전 팀(0309) 작업으로 AI탐지방지 규칙 전면 강화 완료
- 이후 추가: 키워드 철자 규칙, 내부링크 3개 생성, 해시태그 규칙(네이버 20개/구글 8-10개)

---

# DEAD_ENDS (시도했으나 실패한 접근)

(이전 팀에서 인계 — 새 팀원은 반드시 참고)
- 이전 팀 PROMPT_B, PROMPT_C: AI 패턴 방지 규칙이 톤 가이드에만 있고 프롬프트 본문에 없었음 → 수정 완료
- 단순 "~하지 마세요" 지시는 효과 없음 → 구체적 금지 단어/패턴 목록 + 대체 표현 필요

---

# prompt-auditor 분석 결과 (기준 1,3,4,5)

## 요약: 12개 항목 중 PASS 10개, FAIL 2개

### FAIL 항목:
1. PROMPT_A x 기준 1(키워드 적합도): 키워드 밀도/빈도 수치 목표 미지정
2. PROMPT_A x 기준 3(제목 품질): 나쁜 제목의 구체적 이유 설명 부재 + SEO적 제목 최적화 요소 미흡

### 상세 분석은 아래 전문 참조 (prompt-auditor 최종 리포트)

---

# ai-detection-expert 분석 결과 (기준 2, 기준 6)

## 요약: 6개 항목 중 PASS 4개, FAIL 2개

### FAIL 항목:
1. PROMPT_A x 기준 2(AI 탐지 회피): 금지 단어 17개로 20개 미만, "~적인/~성" 접미사 금지 미명시, 대체 표현 미제공
2. PROMPT_A x 기준 6(사람이 쓴 느낌 검수): 톤 가이드 어미가 5개(8개 미만), 좋은 예시 vs 나쁜 예시 쌍 부재

### PASS 항목:
- PROMPT_B x 기준 2, PROMPT_B x 기준 6
- PROMPT_C x 기준 2, PROMPT_C x 기준 6

### 상세 분석은 아래 전문 참조 (ai-detection-expert 최종 리포트)
