# 코드 수준 일관성 검증 요청

## 대상 파일
/Users/gong-eunhui/Desktop/naver-title-generator/blog-writer.html

## 분석 항목

### 1. JSON 출력 형식 일관성
- SYSTEM_PROMPT_A, SYSTEM_PROMPT_B, SYSTEM_PROMPT_C의 JSON 출력 템플릿을 비교
- 필드명이 3종 간 동일한지 확인 (title, hook, body, cta, tags, internal_links)
- 각 프롬프트의 JSON 템플릿에서 tags 개수가 규칙과 일치하는지:
  - PROMPT_A (홈피드): 20개
  - PROMPT_B (네이버SEO): 20개
  - PROMPT_C (구글SEO): 10개
- FAQ 필드: PROMPT_C에만 있어야 함

### 2. 프롬프트 간 규칙 동기화
- AI탐지방지 규칙이 3종 모두에 존재하는지
- 키워드 철자 규칙(★★)이 3종 모두에 존재하는지
- 내부링크 규칙이 3종 모두에 존재하는지
- 글자수 규칙이 각 프롬프트 유형에 맞게 설정되어 있는지
- 쉼표 규칙이 3종 모두에 동일하게 적용되는지

### 3. JavaScript 코드에서 프롬프트 참조 일관성
- getSystemPrompt() 함수가 올바르게 3종을 반환하는지
- JSON 파싱 로직이 모든 필드를 처리하는지 (tags, internal_links, faq)
- 결과 표시 로직이 모든 프롬프트 유형의 출력을 처리하는지
- 에러 처리가 있는지

### 4. 출력 형식
각 항목에 대해:
- ✅ 일관됨 / ❌ 불일치 + 구체적 차이점
- 불일치가 있으면 어떤 프롬프트의 어떤 부분이 다른지 명시

결과를 요약 테이블로 정리해주세요.
