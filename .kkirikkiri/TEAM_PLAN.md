# 팀 작업 계획

- 팀명: kkirikkiri-dev-image-quality
- 목표: 블로그 이미지 생성기의 맥락 적합도와 이미지 품질 개선
- 생성 시각: 2026-03-09
- 분석 완료: 2026-03-09

## 현재 상황

### 파이프라인 구조
```
블로그 글 입력 → (사진: ...) 마커 regex 추출 → 마커별 앞뒤 400자 컨텍스트 수집
→ Claude Haiku 4.5 (한 번에 모든 마커 처리) → 영어 FLUX 프롬프트 JSON 배열
→ FLUX Schnell (마커당 2장, 4개씩 병렬 배치) → 결과 렌더링
```

### 모드별 정리
| 모드 | 입력 | Claude 호출 | FLUX 호출 | 비고 |
|------|------|------------|-----------|------|
| parse | 블로그 전문 | 1회 (모든 마커 일괄) | 마커당 1회(2장) | 핵심 모드 |
| direct | 주제+분위기 | 1회 (topic→영어) | 1~2회(총 8장) | 간편 모드 |
| regenerate | 기존 프롬프트 | 1회 (리파인) | 고유프롬프트당 1회(2장) | 재생성 |

### 최근 적용된 개선 (이전 라운드)
- 컨텍스트 200자 → 400자
- 블로그 제목 + 요약 300자 추가
- 전체 마커 목록 전달 (시각적 차별화용)
- 위치 정보 (early/middle/ending)
- 프롬프트 구조 템플릿화
- 구체성 예시 ("NOT X but Y")

---

## 팀 구성
| 이름 | 역할 | 모델 | 담당 업무 |
|------|------|------|----------|
| lead | 팀장/PM | Opus | 코드 분석, 개선 계획, 결과 검증, 통합 |
| dev-prompt | 개발자 1 | Opus | Claude 시스템 프롬프트 + FLUX 파라미터 최적화 |
| dev-context | 개발자 2 | Sonnet | 마커 추출/컨텍스트 전달 로직 + 프론트엔드 UX |
| tester | 테스터 | Sonnet | 실제 이미지 생성 API 테스트 + 품질 검증 |

---

## 태스크 목록
- [x] 태스크 1: 현재 코드 분석 + 개선 계획 수립 → lead
- [ ] 태스크 2: Claude 시스템 프롬프트 최적화 → dev-prompt
- [ ] 태스크 3: 마커 컨텍스트 전달 로직 개선 → dev-context
- [ ] 태스크 4: FLUX 파라미터 최적화 → dev-prompt
- [ ] 태스크 5: 이미지 생성 테스트 + 품질 검증 → tester
- [ ] 태스크 6: 결과 통합 + 최종 리포트 → lead

---

## 주요 결정사항

### ===== A. Claude 프롬프트 개선 (dev-prompt 담당) =====

#### A-1. 마커 텍스트의 한국어 의미를 FLUX가 이해하도록 변환 강화
- **무엇을**: Claude 시스템 프롬프트에서 마커 텍스트(예: "리포머 기구 운동 이미지 추천")를 FLUX가 이해할 수 있는 구체적 영어 설명으로 변환할 때, 한국 문화 컨텍스트를 명시적으로 풀어쓰도록 지시 추가
- **왜 효과적인지**: 현재 프롬프트는 "Korean/East Asian context" 정도의 일반 지시만 있음. 마커 텍스트가 "체형 분석 비교 이미지 추천"처럼 추상적일 때, Claude가 FLUX에게 전달할 구체적 장면 묘사가 부족함. 예시: "리포머 기구 운동" → "A Korean woman's hands gripping a Pilates reformer machine's handles, spring tension visible, bright studio with wooden floor"
- **예상 코드 변경 위치**: `/Users/gong-eunhui/Desktop/naver-title-generator/api/blog-image.js` 298~323행 (claudeSystem 변수)
- **우선순위**: **High**

#### A-2. Few-shot 예시 추가
- **무엇을**: Claude 시스템 프롬프트에 입력-출력 페어 2~3개를 Few-shot 예시로 추가. 마커 텍스트 + 컨텍스트 → 이상적인 영어 프롬프트 변환 사례를 보여줌
- **왜 효과적인지**: 현재 프롬프트는 규칙 기반이라 Claude가 규칙을 해석하는 방식에 편차가 크다. Few-shot 예시가 있으면 출력 형식과 구체성 수준이 안정적으로 수렴함. 특히 "hyper-specific" 지시가 있지만 실제로 어느 수준의 구체성인지 모호한 상태
- **예상 코드 변경 위치**: `/Users/gong-eunhui/Desktop/naver-title-generator/api/blog-image.js` 298~323행 (claudeSystem 변수)
- **우선순위**: **High**
- **구체적 제안**: 아래와 같은 Few-shot 포맷:
```
## Examples

Input:
  Marker: "봉골레 파스타 이미지 추천"
  Position: middle
  Before: "...마늘 향이 확 올라오는 순간 '아 여기다' 싶었어요. 바지락이 통통하고..."

Output:
  "A steaming bowl of vongole pasta with plump clams on a warm wooden table in a small Korean restaurant, garlic oil glistening on al dente spaghetti, brass chopstick rest beside the plate, soft warm pendant lighting from above, close-up shot at 45-degree angle, shallow depth of field, Korean food photography style"
```

#### A-3. 프롬프트 구조 개선: Negative 프롬프트 분리
- **무엇을**: 현재 프롬프트 후처리에서 "no text, no typography, no letters, no words, no signs, no watermark, purely visual"을 모든 프롬프트 끝에 붙이고 있음. 이를 Claude가 생성하는 프롬프트와 분리하여 관리
- **왜 효과적인지**: FLUX Schnell에서는 negative prompt를 별도 파라미터로 지원하지 않으므로 현재 방식(프롬프트 끝에 추가)이 맞지만, 프롬프트가 지나치게 길어지면 FLUX가 뒷부분을 무시하는 경향이 있음. negative 지시어를 프롬프트 앞부분에 배치하거나, 핵심 지시만 남기고 중복을 제거해야 함
- **예상 코드 변경 위치**: `/Users/gong-eunhui/Desktop/naver-title-generator/api/blog-image.js` 348~349행 (프롬프트 후처리)
- **우선순위**: **Medium**
- **구체적 제안**: suffix를 `"no text no watermark, Korean lifestyle blog photo, high quality"` 수준으로 간결화. "no typography, no letters, no words, no signs"는 중복이며 오히려 FLUX 토큰을 낭비

#### A-4. 위치(position)에 따른 카메라 앵글/구도 지시 강화
- **무엇을**: 현재 early/middle/ending 위치 정보를 Claude에 전달하지만, 이것이 구체적인 촬영 지시(wide shot vs close-up vs mood shot)로 변환되는 규칙이 약함. 위치별 촬영 가이드를 강화
- **왜 효과적인지**: 블로그 글의 이미지 흐름이 전체 와이드 → 디테일 → 분위기/결론 으로 자연스럽게 전개되면 글의 완성도가 올라감. 현재는 모든 이미지가 비슷한 구도로 생성될 가능성이 높음
- **예상 코드 변경 위치**: `/Users/gong-eunhui/Desktop/naver-title-generator/api/blog-image.js` 306~310행 (position 규칙)
- **우선순위**: **Medium**
- **구체적 제안**:
  - early: "wide establishing shot, showing the overall environment, shot from entrance or doorway"
  - middle: "close-up or detail shot, showing specific object or texture, shallow depth of field"
  - ending: "atmospheric mood shot, soft focus, warm tones, conveying satisfaction or conclusion"

---

### ===== B. 컨텍스트 전달 개선 (dev-context 담당) =====

#### B-1. 구글 SEO 마커 형식 호환
- **무엇을**: 현재 마커 regex가 `(사진: ...)` 패턴만 인식하지만, 구글 SEO 프롬프트는 `(이미지: OO 사진, alt: 설명문)` 형식을 사용함. 두 형식 모두 인식하도록 regex 확장
- **왜 효과적인지**: 구글 SEO 모드로 작성된 블로그 글을 이미지 생성기에 붙여넣었을 때 마커를 찾지 못하는 문제 해결. 특히 alt 텍스트가 포함되면 이미지 생성에 더 좋은 컨텍스트를 제공함
- **예상 코드 변경 위치**: `/Users/gong-eunhui/Desktop/naver-title-generator/api/blog-image.js` 268행 (markerRegex), `/Users/gong-eunhui/Desktop/naver-title-generator/blog-image.html` 304행 (프론트 regex)
- **우선순위**: **High**
- **구체적 제안**: regex를 `/\((사진|이미지):\s*([^)]+)\)/g`로 변경하고, alt 텍스트가 있으면 추가 컨텍스트로 활용

#### B-2. 블로그 글 전체 주제(토픽) 요약 강화
- **무엇을**: 현재 블로그 요약은 단순히 앞 300자를 자르는 방식. 이를 Claude를 한 번 더 호출하여 3줄 요약을 생성하거나, 적어도 제목 + 모든 소제목을 추출하여 전체 흐름 맥락 제공
- **왜 효과적인지**: 앞 300자가 대부분 도입부(훅)이므로 글의 전체 구조를 반영하지 못함. 소제목 목록(【01.】, 【02.】 등)을 추출하면 추가 API 호출 없이도 글의 전체 골격을 파악 가능
- **예상 코드 변경 위치**: `/Users/gong-eunhui/Desktop/naver-title-generator/api/blog-image.js` 287~291행 (blogTitle, blogSummary 추출 부분)
- **우선순위**: **High**
- **구체적 제안**: 소제목 추출 로직 추가:
  ```javascript
  const headings = blogText.match(/【\d+\.?】[^\n]*/g) || [];
  const blogStructure = headings.join(' | ');
  ```
  이것을 Claude에 전달하면 글 전체 흐름을 이해하고, 각 마커가 어떤 섹션에 속하는지 판단 가능

#### B-3. 마커 주변 컨텍스트의 노이즈 제거
- **무엇을**: 현재 앞뒤 400자를 그대로 전달하는데, 여기에 다른 마커 텍스트, 해시태그, 소제목 기호 등이 포함될 수 있음. 이런 노이즈를 제거하여 순수 본문 텍스트만 전달
- **왜 효과적인지**: Claude가 컨텍스트를 읽을 때 다른 마커나 해시태그가 섞이면 해당 마커의 실제 문맥을 오해할 수 있음. 깨끗한 텍스트가 더 정확한 프롬프트 생성으로 이어짐
- **예상 코드 변경 위치**: `/Users/gong-eunhui/Desktop/naver-title-generator/api/blog-image.js` 272~279행 (마커 추출 루프 내)
- **우선순위**: **Low**
- **구체적 제안**: 컨텍스트에서 `(사진: ...)`, `#해시태그`, `【숫자.】` 패턴 제거 후 전달

#### B-4. 마커가 속한 소제목(섹션) 정보 추가 전달
- **무엇을**: 각 마커가 어떤 소제목 아래에 위치하는지 파악하여 Claude에 전달. 예: "이 이미지는 '【02.】 3개월 교정 프로그램, 실제 과정과 수치 변화' 섹션에 위치"
- **왜 효과적인지**: 앞뒤 400자보다 해당 섹션의 소제목 한 줄이 훨씬 압축적으로 맥락을 전달함. Claude가 "이 이미지가 무엇에 관한 것인지"를 더 정확히 판단 가능
- **예상 코드 변경 위치**: `/Users/gong-eunhui/Desktop/naver-title-generator/api/blog-image.js` 268~279행 (마커 추출 로직에 섹션 탐지 추가)
- **우선순위**: **Medium**
- **구체적 제안**: 마커 위치 이전의 가장 가까운 소제목(【XX.】 패턴)을 찾아서 `section` 필드로 추가

---

### ===== C. FLUX 파라미터 최적화 (dev-prompt 담당) =====

#### C-1. FLUX Schnell의 num_inference_steps 조정
- **무엇을**: 현재 `num_inference_steps: 4`로 고정. FLUX Schnell의 권장 범위(1~4) 내에서 이미 최대값이지만, fal.ai가 더 높은 값을 허용하는지 확인 필요
- **왜 효과적인지**: FLUX Schnell은 distilled 모델로 4 steps가 이미 최적. 단, 더 높은 steps가 허용되면 품질이 소폭 개선될 가능성 있음
- **예상 코드 변경 위치**: `/Users/gong-eunhui/Desktop/naver-title-generator/api/blog-image.js` 84행, 104행, 210행, 366행 (모든 FLUX 호출)
- **우선순위**: **Low**
- **결정**: 현재 4가 Schnell의 최적값. 변경 불필요. 단, FLUX Pro로 업그레이드 시 28~50 steps 고려 가능

#### C-2. guidance_scale 파라미터 추가
- **무엇을**: 현재 FLUX 호출에 `guidance_scale`이 설정되어 있지 않아 기본값 사용 중. FLUX Schnell은 guidance-free 모델이라 이 파라미터가 효과 없음을 확인
- **왜 효과적인지**: FLUX Schnell은 classifier-free guidance 없이 작동하도록 학습됨. guidance_scale을 추가해도 효과가 없거나 오히려 품질 저하 가능. 따라서 현재 상태 유지가 올바름
- **예상 코드 변경 위치**: 변경 없음
- **우선순위**: **Low (변경 불필요)**
- **결정**: FLUX Schnell은 guidance-free. 파라미터 추가하지 않음

#### C-3. 이미지 크기/비율 옵션 추가
- **무엇을**: 현재 `square_hd` (1024x1024) 고정. 블로그 본문 이미지는 가로형(landscape_16_9 또는 landscape_4_3)이 더 적합한 경우가 많음. 썸네일은 정사각형 유지
- **왜 효과적인지**: 네이버 블로그에서 본문 이미지는 가로로 넓은 형태가 자연스러움. 정사각형은 인스타그램 스타일이라 블로그와 맞지 않을 수 있음. 단, 현재 사용자 피드백 없이 일괄 변경은 위험
- **예상 코드 변경 위치**: `/Users/gong-eunhui/Desktop/naver-title-generator/api/blog-image.js` 모든 FLUX 호출의 `image_size` 파라미터
- **우선순위**: **Medium**
- **구체적 제안**:
  - parse 모드: 첫 번째 이미지(썸네일)는 `square_hd` 유지, 나머지 본문 이미지는 `landscape_4_3` 적용
  - direct 모드: 전부 `square_hd` 유지 (용도 불명확하므로)
  - 프론트엔드에 비율 선택 드롭다운 추가 고려 (향후)

#### C-4. FLUX Pro 모델 업그레이드 검토
- **무엇을**: FLUX Schnell에서 FLUX Pro (fal-ai/flux-pro)로 모델 변경 검토
- **왜 효과적인지**: FLUX Pro는 더 높은 품질, 더 나은 프롬프트 이해력, 더 디테일한 이미지 생성. 단, 비용이 Schnell의 약 10배이고 생성 시간도 2~3배 느림
- **예상 코드 변경 위치**: URL 변경 + steps/guidance 파라미터 조정
- **우선순위**: **Low (비용/속도 트레이드오프 검토 필요)**
- **결정**: 현재는 무료 서비스이므로 Schnell 유지. 유료 플랜 도입 시 Pro 옵션 제공 고려

---

## 우선순위 정리

| 순위 | 개선안 | 담당 | 우선순위 | 예상 효과 |
|------|--------|------|---------|----------|
| 1 | A-2. Few-shot 예시 추가 | dev-prompt | High | 프롬프트 품질 안정화, 구체성 수준 통일 |
| 2 | A-1. 한국 문화 컨텍스트 변환 강화 | dev-prompt | High | 문화적 정확도 향상 |
| 3 | B-1. 구글 SEO 마커 호환 | dev-context | High | 기능 커버리지 확대 |
| 4 | B-2. 소제목 추출로 전체 흐름 파악 | dev-context | High | 맥락 이해도 대폭 향상 |
| 5 | A-4. 위치별 카메라 앵글 강화 | dev-prompt | Medium | 이미지 시각적 다양성 향상 |
| 6 | B-4. 마커 소속 섹션 정보 전달 | dev-context | Medium | 마커별 정확도 향상 |
| 7 | C-3. 본문 이미지 가로 비율 적용 | dev-prompt | Medium | 블로그 레이아웃 적합도 향상 |
| 8 | A-3. 네거티브 프롬프트 간결화 | dev-prompt | Medium | 토큰 효율화, FLUX 이해도 향상 |
| 9 | B-3. 컨텍스트 노이즈 제거 | dev-context | Low | 소폭 정확도 향상 |
| 10 | C-1/C-2. steps/guidance 조정 | dev-prompt | Low | 변경 불필요 (이미 최적) |

---

## 코드 변경 지침 (팀원용)

### dev-prompt가 변경할 파일:
- `/Users/gong-eunhui/Desktop/naver-title-generator/api/blog-image.js`
  - 298~323행: claudeSystem 변수 (Few-shot 추가, 위치별 가이드 강화, 한국 문화 변환 지시)
  - 348~349행: 프롬프트 suffix 간결화
  - 모든 FLUX 호출: image_size 파라미터 조건부 변경 (parse 모드 본문용)

### dev-context가 변경할 파일:
- `/Users/gong-eunhui/Desktop/naver-title-generator/api/blog-image.js`
  - 268행: markerRegex 확장 (사진/이미지 양쪽 지원)
  - 287~291행: 소제목 추출 + blogStructure 생성
  - 272~279행: 컨텍스트 노이즈 제거 (선택)
  - 마커별 section 필드 추가 (선택)
- `/Users/gong-eunhui/Desktop/naver-title-generator/blog-image.html`
  - 304행: 프론트엔드 마커 감지 regex도 동일하게 확장

---

## 검증 계획 (tester 담당)

### 테스트 시나리오:
1. **홈피드 모드 블로그 글** (마커 5~8개) → parse 모드 생성 → 이미지-마커 정합성 확인
2. **네이버 SEO 모드 블로그 글** (마커 2~3개) → parse 모드 생성 → 이미지-마커 정합성 확인
3. **구글 SEO 모드 블로그 글** (이미지: 형식, alt 포함) → 마커 인식 여부 확인
4. **direct 모드** → 8장 일관성 확인
5. **전체 재생성** → 이전 대비 구체성 향상 여부

### 품질 평가 기준:
- 마커 텍스트와 이미지의 주제 일치도 (1~5점)
- 한국적 맥락 반영도 (1~5점)
- 이미지 간 시각적 다양성 (1~5점)
- 텍스트/워터마크 포함 여부 (Pass/Fail)
- 전체적 완성도/블로그 적합도 (1~5점)
