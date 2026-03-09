# 진행 상황

## 2026-03-09 — 메인 세션
- 상태: 팀 초기화 완료
- 작업: 공유 메모리 초기화, 팀원 스폰 준비
- 다음: 팀장 스폰 → 태스크 배분

## 2026-03-09 — 팀장(lead) 분석 완료
- 상태: 태스크 1 완료 (현재 코드 분석 + 개선 계획 수립)
- 분석 대상:
  - `/Users/gong-eunhui/Desktop/naver-title-generator/api/blog-image.js` (436행, 핵심 API)
  - `/Users/gong-eunhui/Desktop/naver-title-generator/blog-image.html` (722행, 프론트엔드)
  - `/Users/gong-eunhui/Desktop/naver-title-generator/blog-writer.html` (마커 생성 규칙 확인)
- 발견한 핵심 이슈:
  1. Claude 프롬프트에 Few-shot 예시 부재 → 출력 품질 편차 큼
  2. 구글 SEO 마커 형식 `(이미지: ...)` 미지원 → 기능 누락
  3. 블로그 요약이 앞 300자 단순 절단 → 전체 흐름 미반영
  4. FLUX 프롬프트 suffix에 중복 negative 지시어 → 토큰 낭비
  5. 본문 이미지가 정사각형 고정 → 블로그 레이아웃과 부조화
- 산출물: TEAM_PLAN.md에 10개 개선안 + 우선순위 + 코드 변경 위치 기록 완료
- 다음: dev-prompt, dev-context, tester에게 태스크 배분

## 2026-03-09 — dev-prompt 작업 완료
- 상태: 태스크 2 + 태스크 4 완료
- 수정 파일: `/Users/gong-eunhui/Desktop/naver-title-generator/api/blog-image.js`
- 변경 내역:
  1. **A-2. Few-shot 예시 3개 추가** (행 331~355): 음식(봉골레 파스타/middle), 운동(필라테스 리포머/early), 뷰티(스킨케어 루틴/ending) 3가지 카테고리의 입력-출력 페어 예시를 claudeSystem에 추가. 각 예시에 마커+위치+컨텍스트→이상적 영어 프롬프트 변환 사례 포함.
  2. **A-1. 한국 문화 컨텍스트 변환 강화** (행 312~319): "Korean Cultural Context Translation" 섹션 신설. 음식/카페/운동/뷰티/거리/홈인테리어 6개 카테고리별 구체적 시각 디테일(소품, 공간 특성, 질감) 가이드 추가. Claude가 추상적 마커를 FLUX가 렌더링 가능한 구체적 장면 묘사로 변환하도록 유도.
  3. **A-4. 위치별 카메라 앵글 강화** (행 306~309): early/middle/ending 각 위치에 구체적 촬영 지시 추가. early=wide establishing shot(입구 시점, deep DoF), middle=close-up/macro(45도, shallow DoF), ending=atmospheric mood shot(soft focus, warm golden tones).
  4. **A-3. 네거티브 프롬프트 간결화** (행 384): suffix를 `"Korean lifestyle photography, no text, no watermark"`로 간결화. 기존 7개 중복 negative 지시어(no typography, no letters, no words, no signs, purely visual) 제거하여 FLUX 토큰 효율화. "Korean style, East Asian" 중복도 "Korean lifestyle photography" 하나로 통합.
  5. **C-3. 본문 이미지 가로 비율** (행 393~394): parse 모드에서 첫 번째 마커(markerIndex===0, 썸네일용)는 `square_hd` 유지, 나머지 본문 이미지는 `landscape_4_3` 적용. direct 모드와 regenerate 모드는 `square_hd` 유지.
- 참고: regenerate 모드와 direct 모드의 suffix는 이번 스코프 외 (기존 유지). 필요 시 후속 작업으로 간결화 가능.

## 2026-03-09 — dev-context 작업 완료
- 상태: 태스크 3 완료
- 수정 파일:
  - `/Users/gong-eunhui/Desktop/naver-title-generator/api/blog-image.js`
  - `/Users/gong-eunhui/Desktop/naver-title-generator/blog-image.html`
- 변경 내역:

  1. **B-1. 구글 SEO 마커 형식 호환 (api/blog-image.js 269행)**
     - `markerRegex`를 `/\(사진:\s*([^)]+)\)/g` → `/\((사진|이미지):\s*([^)]+)\)/g`로 확장
     - 구글SEO 형식 `(이미지: OO 사진, alt: 설명문)` 파싱 시 alt 텍스트 분리 로직 추가
     - alt 텍스트는 `altText` 필드로 별도 저장 → markersList에 "Alt text:" 필드로 Claude에 전달
     - 에러 메시지도 `(사진: ...) 또는 (이미지: ...)` 형식으로 업데이트

  2. **B-2. 소제목 추출 + 전체 흐름 파악 (api/blog-image.js 274~276행, 403~410행)**
     - `blogText.match(/【\d+\.?】[^\n]*/g)` 로 소제목 목록 추출
     - `blogStructure` 변수로 파이프 구분 연결 (예: "【01.】 제목1 | 【02.】 제목2")
     - `claudeUser`에 `Article structure: "..."` 필드 조건부 추가 (소제목이 있을 때만)

  3. **B-3. 컨텍스트 노이즈 제거 (api/blog-image.js 293~303행)**
     - `cleanContext()` 함수로 앞뒤 400자 컨텍스트 전처리:
       - 다른 마커 `(사진: ...)`, `(이미지: ...)` 제거
       - 해시태그 `#\S+` 제거
       - 소제목 기호 `【숫자.】` 제거
       - 연속 공백 정리

  4. **B-4. 마커 소속 섹션 정보 추가 (api/blog-image.js 308~313행, 331~339행)**
     - 마커 위치 이전의 텍스트에서 `matchAll(/【\d+\.?】[^\n]*/g)` 로 가장 가까운 소제목 탐지
     - `section` 필드로 마커 객체에 저장
     - `markersList` 포맷에 "Section:" 필드 조건부 추가

  5. **B-1 프론트엔드 (blog-image.html 302~313행, 394~399행)**
     - `detectMarkers()` 함수 regex: `/\(사진:\s*([^)]+)\)/g` → `/\((사진|이미지):\s*([^)]+)\)/g`
     - alt 텍스트 파싱 후 순수 마커 텍스트만 chip으로 표시
     - `generateParse()` 함수 내 유효성 검증 regex 동일하게 확장
     - 에러 메시지도 양쪽 형식 안내로 업데이트
