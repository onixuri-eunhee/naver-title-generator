# 발견 사항 & 공유 자료

## 핵심 파일
- `/Users/gong-eunhui/Desktop/naver-title-generator/api/blog-image.js` — Claude Haiku → FLUX Schnell 이미지 생성 파이프라인
- `/Users/gong-eunhui/Desktop/naver-title-generator/blog-image.html` — 프론트엔드 (탭 시스템, Canvas 썸네일 합성)
- `/Users/gong-eunhui/Desktop/naver-title-generator/blog-writer.html` — 블로그 글 생성기 (마커 형식 정의 포함)

## 현재 프롬프트 구조 (api/blog-image.js)
- Claude 시스템 프롬프트: 구조화된 템플릿 (Subject/Scene, details, setting, lighting, camera angle)
- 컨텍스트: 블로그 제목 + 요약 300자 + 마커당 앞뒤 400자 + 위치(early/middle/ending)
- FLUX suffix: Korean style, East Asian, no text, no typography, purely visual 등 (중복 다수)
- FLUX: square_hd, num_images: 2, num_inference_steps: 4

## 이전 서브에이전트 제안 (적용 완료)
- 컨텍스트 200자 → 400자
- 블로그 제목 + 요약 300자
- 전체 마커 목록 전달
- 위치 정보(early/middle/ending)
- 프롬프트 구조 템플릿
- 구체성 예시 ("NOT X but Y")

## 팀장 분석에서 발견한 주요 약점

### 1. 마커 형식 호환성 문제
- 홈피드/네이버SEO 모드: `(사진: OO 이미지 추천)` → 정상 인식
- 구글SEO 모드: `(이미지: OO 사진, alt: 설명문)` → **인식 실패**
- blog-image.js 268행의 regex가 `(사진: ...)` 패턴만 매칭
- blog-image.html 304행의 프론트엔드 regex도 동일 문제

### 2. Claude 프롬프트 구체성 부족
- "be hyper-specific" 지시가 있지만 기준이 모호
- Few-shot 예시 없이 규칙만 나열 → Claude 출력 편차 큼
- 마커 텍스트가 "XX 이미지 추천"처럼 추상적일 때 변환 품질 저하
- 한국 문화 컨텍스트 변환 지시가 일반적 ("Korean/East Asian context" 수준)

### 3. 블로그 전체 흐름 미반영
- blogSummary = blogText.substring(0, 300) → 도입부(훅)만 반영
- 소제목(【01.】 제목, 【02.】 제목...) 추출 없음 → 글의 골격 모름
- 마커가 어떤 섹션에 속하는지 정보 없음

### 4. FLUX 프롬프트 토큰 낭비
- suffix에 "no text, no typography, no letters, no words, no signs, no watermark, purely visual" → 7개 negative 지시어가 중복
- FLUX Schnell의 토큰 한도를 고려하면 핵심만 유지해야 함
- "Korean style, East Asian" 도 중복 → "Korean" 하나로 충분

### 5. 이미지 비율 고정
- 모든 이미지가 square_hd (1024x1024)
- 네이버 블로그 본문에는 가로형(4:3 또는 16:9)이 더 자연스러움
- 썸네일은 정사각형이 적합 (네이버 블로그 목록 노출용)

## FLUX Schnell 기술 메모
- Distilled 모델: classifier-free guidance 불필요 (guidance_scale 무효)
- 최적 steps: 4 (이미 최대 활용 중)
- 지원 image_size: square_hd, square, portrait_4_3, portrait_16_9, landscape_4_3, landscape_16_9
- fal.ai 엔드포인트: https://fal.run/fal-ai/flux/schnell

## 블로그 글 마커 형식 정리 (blog-writer.html에서 확인)
| 프롬프트 유형 | 마커 형식 | 마커 수 |
|-------------|----------|---------|
| 홈피드 | `(사진: OO 이미지 추천)` | 5~8개 |
| 네이버 SEO | `(사진: OO 이미지 추천)` | 2~3개 |
| 구글 SEO | `(이미지: OO 사진, alt: 설명문)` | 2~3개 |

---

## dev-prompt 구현 메모

### Few-shot 예시 설계 원칙
- 3개 예시는 의도적으로 서로 다른 카테고리(음식/운동/뷰티)와 다른 위치(middle/early/ending)를 조합함
- 각 예시가 해당 position의 카메라 앵글 규칙을 자연스럽게 시연하도록 구성
- 예시 프롬프트 길이는 약 40~50단어로 통일 — FLUX Schnell의 토큰 처리 한계를 고려

### 네거티브 프롬프트 간결화 근거
- FLUX Schnell은 프롬프트 뒷부분을 무시하는 경향이 있어, suffix는 짧을수록 좋음
- "no text, no typography, no letters, no words, no signs"는 모두 같은 의미의 반복 — "no text"만으로 충분
- "Korean style, East Asian"은 중복 — "Korean lifestyle photography"로 통합하면 스타일 톤도 함께 지정
- 단, regenerate 모드와 direct 모드의 suffix는 이번에 미수정 (스코프 외). 후속 작업 시 동일 패턴 적용 권장

### landscape_4_3 적용 시 주의사항
- parse 모드에서만 적용 (direct 모드는 용도 불명확하여 square_hd 유지)
- 첫 번째 마커(index 0)만 square_hd — 네이버 블로그 목록에서 썸네일로 사용될 가능성이 높음
- 프론트엔드(blog-image.html)에서 landscape 이미지 렌더링이 제대로 되는지 tester가 확인 필요

---

# DEAD_ENDS (시도했으나 실패한 접근)

(아직 없음)
