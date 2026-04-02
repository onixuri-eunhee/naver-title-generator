# 결제 동선 디자인 리뉴얼 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 결제 승인 전 핵심 동선 3페이지(index, blog-writer, pricing)의 "AI 템플릿 느낌"을 탈피하고 프로 서비스 인상을 줌

**Architecture:** 각 페이지의 인라인 CSS만 수정. JS 로직/API 연동은 건드리지 않음. `/frontend-design` 스킬로 디자인 생성 후 CSS를 교체하는 방식. 페이지별 독립 작업이므로 병렬 실행 가능.

**Tech Stack:** 바닐라 HTML/CSS (인라인 `<style>`), Noto Sans KR, 기존 JS 보존

---

## 파일 맵

| 파일 | 작업 | 비고 |
|------|------|------|
| `index.html` | 히어로 + 도구 쇼케이스 + CTA 디자인 리뉴얼 | 1,223줄, CSS 114~577줄 |
| `blog-writer.html` | 히어로 + 입력 UI + 검수기 배치 리디자인 | 3,775줄, CSS 81~1316줄 |
| `pricing.html` | 가격 카드 + 신뢰 요소 + CTA 리디자인 | 356줄, CSS 25~196줄 |
| `login.html` | Phase 2: 디자인 톤 통일 | 268줄 |
| `signup.html` | Phase 2: 디자인 톤 통일 | 303줄 |
| `guide.html` | Phase 2: 탭/아코디언 정리 | |
| `navbar-mobile.css` | Phase 2: 리뉴얼 톤 맞춰 업데이트 | 40줄, 전 페이지 공통 |

**건드리지 않는 파일:**
- `shortform.html` — Codex Remotion 전환 중
- `card-news.html`, `blog-image*.html` — 결제 동선 아님
- `api/*.js` — 서버 로직 보존 (Phase 2 프롬프트 튜닝 제외)
- `auth-ui.js`, `admin-mode.js` — 인증/관리자 로직 보존

---

## Phase 1: 핵심 3페이지 (병렬 실행 가능)

### Task 1: index.html 디자인 리뉴얼

**Files:**
- Modify: `index.html:114-577` (인라인 CSS)
- Modify: `index.html:608-940` (히어로 + 콘텐츠 HTML 구조)

**목표:** 3초 안에 "블로거를 위한 AI 도구 모음"이 와닿는 랜딩

**현재 문제:**
- 히어로: `linear-gradient(135deg, #1A1A2E, #16213E, #0F3460)` + 초록/파랑 방사형 오버레이 = ChatGPT 클리셰
- Chapter 1/2/3 색상 코딩 카드 = 전형적 AI 템플릿
- 이모지 남발 (뱃지에 ✅ ⚠️ 🔥 등)
- 도구 8개 가치 전달 약함

- [ ] **Step 1: `/frontend-design` 스킬로 index.html 리디자인 생성**

지시사항:
- 히어로: 라이트 톤 배경으로 전환. "뚝딱툴 — 블로거를 위한 AI 도구"가 3초 안에 와닿게
- 도구 쇼케이스: 8개 도구를 무료(제목/후킹/스레드) vs PRO(블로그 글/이미지/프리미엄/카드뉴스/숏폼) 그리드로 재배치
- 이모지 대폭 축소, 뱃지 단순화
- CTA: "무료로 시작하기" 버튼, 적절한 너비
- 색상: 오렌지 #ff5f1f 메인 액센트 유지, 배경은 라이트
- 폰트: Noto Sans KR 유지, 웨이트 위계 강화 (h1: 900, body: 400)
- **반드시 보존:** `.navbar` 구조, `.input-section` 폼 로직, `#results` 영역 구조, `<footer>` 사업자 정보, 모든 `<script>` 태그

- [ ] **Step 2: 생성된 CSS를 index.html:114-577에 교체**

기존 `<style>` 블록 내용을 새 디자인 CSS로 교체. HTML 구조 변경이 필요하면 히어로/콘텐츠 섹션만 수정.

- [ ] **Step 3: 브라우저 확인**

로컬에서 `index.html` 열어서 확인:
- 히어로가 라이트 톤인지
- 도구 그리드가 정상 표시되는지
- 네비바/푸터가 깨지지 않았는지
- 제목 생성 기능이 정상 동작하는지 (JS 보존 확인)

- [ ] **Step 4: 모바일 확인**

브라우저 개발자 도구에서 375px 너비로 확인:
- 네비바 스크롤 정상
- 히어로 텍스트 읽기 가능
- 입력 폼 사용 가능

- [ ] **Step 5: 커밋**

```bash
git add index.html
git commit -m "design: index.html 랜딩 디자인 리뉴얼 — AI 템플릿 탈피"
```

---

### Task 2: blog-writer.html 디자인 리뉴얼

**Files:**
- Modify: `blog-writer.html:81-1316` (인라인 CSS)
- Modify: `blog-writer.html:1338-1380` (히어로 HTML)

**목표:** "돈 내고 쓸 만한 프로 도구" 느낌

**현재 문제:**
- 히어로가 index와 동일한 다크 네이비 = 차별감 없음
- AI 검수기(핵심 유료 가치)가 스크롤 하단에 묻힘
- 결제 가치 명시 없음

- [ ] **Step 1: `/frontend-design` 스킬로 blog-writer.html 리디자인 생성**

지시사항:
- 히어로: index와 차별화. "PRO 도구"임을 드러내는 디자인. AI 검수기 + 자동수정 기능을 히어로에서 바로 언급
- 입력 UI: `.type-grid` + `.type-btn` 카드 구조 유지, 디자인만 정돈 (그림자 최소화, 미세 보더)
- 결과 영역: `.result-card` 구조 유지, 카드 디자인 개선
- AI 검수기: `.review-card`를 결과 최상단에 배치 (현재 하단 → 상단)
- 가격 힌트: 입력 영역 근처에 "1크레딧으로 고품질 블로그 글" 문구 추가
- 색상: 오렌지 #ff5f1f + 퍼플 #8B5CF6(PRO 뱃지) 유지
- **반드시 보존:** 모든 `id` 속성 (JS가 참조), `.type-btn` 클릭 로직, `generate()` / `improveContent()` 함수, 인라인 `<script>` 전체 (1735~3771줄)

- [ ] **Step 2: 생성된 CSS를 blog-writer.html:81-1316에 교체**

CSS 블록 교체. 히어로 HTML 구조 변경 시 1338~1380줄 수정. AI 검수기 배치 변경 시 HTML 순서 조정.

**주의:** blog-writer.html은 3,775줄. CSS 교체 시 줄 번호가 밀릴 수 있으므로 CSS 블록만 정확히 교체.

- [ ] **Step 3: 기능 테스트**

로컬에서 확인:
- 글 유형/톤/CTA 선택이 정상 동작하는지
- "생성하기" 버튼 클릭 시 UI가 깨지지 않는지 (실제 API 호출은 로컬에서 안 될 수 있으니 UI만 확인)
- AI 검수기 게이지 SVG가 정상 표시되는지
- 결과 카드 복사 버튼이 보이는지

- [ ] **Step 4: 커밋**

```bash
git add blog-writer.html
git commit -m "design: blog-writer.html PRO 도구 디자인 리뉴얼"
```

---

### Task 3: pricing.html 디자인 리뉴얼

**Files:**
- Modify: `pricing.html:25-196` (인라인 CSS)
- Modify: `pricing.html:218-350` (HTML 구조)

**목표:** 신뢰감 + 결제 전환율

**현재 문제:**
- 단일 상품만 존재, 가성비 비교 기준 없음
- 소셜 프루프 전무
- "무료 체험 3회"가 FAQ 하단에 묻힘
- 결제 버튼 → "준비 중" 모달 (승인 후 교체 필요)

- [ ] **Step 1: `/frontend-design` 스킬로 pricing.html 리디자인 생성**

지시사항:
- 상단 배너: "회원가입만 하면 블로그 글 3회 + 이미지 3회 무료" 강조
- 가격 카드: 현재 구조 유지 (단일 상품 30cr/9,900원), "1크레딧당 330원" 단가 명시
- 크레딧 사용처: 도구별 차감표를 아이콘 + 간결한 표로 시각화 (글 1cr, 기본이미지 1cr, 프리미엄이미지 5cr)
- 오픈톡방 보너스: 현재 배너 유지, 디자인 개선
- FAQ: 3개 유지, 아코디언 스타일로 변경
- 색상: index 리뉴얼 톤과 일관되게
- **반드시 보존:** `handleBuy()`, `changeQty()`, `closeModal()` JS 함수, `#buyBtn`, `#comingSoonModal` 요소

- [ ] **Step 2: CSS + HTML 교체**

- [ ] **Step 3: 기능 테스트**

- 수량 +/- 버튼 동작 확인
- 총금액 계산 정상
- 결제 버튼 → 모달 표시 정상
- 모바일 레이아웃 확인

- [ ] **Step 4: 커밋**

```bash
git add pricing.html
git commit -m "design: pricing.html 결제 페이지 디자인 리뉴얼"
```

---

## Phase 2: 전환 흐름 + 품질

### Task 4: login.html / signup.html 디자인 통일

**Files:**
- Modify: `login.html` (268줄, 인라인 CSS)
- Modify: `signup.html` (303줄, 인라인 CSS)

- [ ] **Step 1: Phase 1 디자인 톤(라이트 배경, 그림자 최소화, 오렌지 액센트)에 맞춰 CSS 교체**
- [ ] **Step 2: 가입 폼 UI 정돈 — 불필요한 시각 요소 제거, 깔끔한 입력 필드**
- [ ] **Step 3: 약관 동의 체크박스 UI 개선**
- [ ] **Step 4: 기능 테스트 — 로그인/가입 플로우 동작 확인**
- [ ] **Step 5: 커밋**

```bash
git add login.html signup.html
git commit -m "design: login/signup 디자인 톤 통일"
```

---

### Task 5: guide.html 사용법 페이지 정리

**Files:**
- Modify: `guide.html`

- [ ] **Step 1: 도구별 사용법을 탭 또는 아코디언으로 재구성**
- [ ] **Step 2: Phase 1 디자인 톤에 맞춰 CSS 업데이트**
- [ ] **Step 3: 기능 확인 — 모든 도구 설명이 접근 가능한지**
- [ ] **Step 4: 커밋**

```bash
git add guide.html
git commit -m "design: guide.html 사용법 페이지 정리"
```

---

### Task 6: 블로그 글 생성기 퀄리티 튜닝

**Files:**
- Modify: `api/generate.js` (프롬프트 점검)
- Modify: `blog-writer.html` (replaceAIVocabulary 매핑 점검)

- [ ] **Step 1: api/generate.js 시스템 프롬프트 읽고 개선 포인트 파악**

현재 temperature 0.5. 프롬프트 구조, 톤 가이드, 금지 규칙 점검.

- [ ] **Step 2: replaceAIVocabulary() 17개 매핑 검토 — 추가 필요한 AI 어휘 파악**

blog-writer.html 인라인 JS에서 `replaceAIVocabulary` 함수 찾아 현재 매핑 확인.

- [ ] **Step 3: AI 검수기 7개 기준 가중치 검토**

현재 90점 만점 배분이 적절한지 확인.

- [ ] **Step 4: 필요한 수정 적용 + 테스트**
- [ ] **Step 5: 커밋**

```bash
git add api/generate.js blog-writer.html
git commit -m "tune: 블로그 글 생성기 프롬프트 + 검수기 정밀 조정"
```

---

### Task 7: 공통 네비바/푸터 톤 통일

**Files:**
- Modify: `navbar-mobile.css` (40줄)
- Modify: 각 페이지의 `.navbar`, `footer` 인라인 CSS

- [ ] **Step 1: Phase 1에서 적용한 네비바 스타일을 다른 주요 페이지에도 적용**

대상: `hook-generator.html`, `threads.html`, `blog-image.html`, `card-news.html`, `keyword-finder.html`

- [ ] **Step 2: 푸터 디자인 통일 — 사업자 정보 유지, 레이아웃만 정돈**
- [ ] **Step 3: navbar-mobile.css 업데이트 — 리뉴얼 톤에 맞춰**
- [ ] **Step 4: 전 페이지 네비바/푸터 깨짐 없는지 확인**
- [ ] **Step 5: 커밋**

```bash
git add navbar-mobile.css hook-generator.html threads.html blog-image.html card-news.html keyword-finder.html
git commit -m "design: 공통 네비바/푸터 디자인 톤 통일"
```

---

## Phase 3: 디테일 패스

### Task 8: 에러/로딩 상태 UX 개선

**Files:**
- Modify: `blog-writer.html` (로딩 인디케이터)
- Modify: `index.html` (에러 메시지)

- [ ] **Step 1: 생성 중 로딩 표시 개선 — 스피너 → 단계별 진행 메시지**
- [ ] **Step 2: API 에러 시 사용자 친화적 메시지 (현재 에러 핸들링 확인 후 개선)**
- [ ] **Step 3: 커밋**

```bash
git add blog-writer.html index.html
git commit -m "ux: 에러/로딩 상태 개선"
```

---

### Task 9: 반응형 최종 점검

- [ ] **Step 1: 핵심 3페이지(index, blog-writer, pricing) 모바일 375px 점검**
- [ ] **Step 2: 태블릿 768px 점검**
- [ ] **Step 3: 문제 발견 시 수정 + 커밋**

---

### Task 10: 전체 일관성 마무리 + 코드 리뷰

- [ ] **Step 1: `/simplify` 스킬로 변경된 파일 코드 정리**
- [ ] **Step 2: `superpowers:requesting-code-review`로 전체 변경 사항 리뷰**
- [ ] **Step 3: 최종 커밋 + 푸시**

---

## 실행 전략

| Phase | Task | 실행 방식 | 병렬 가능 |
|-------|------|----------|----------|
| 1 | Task 1,2,3 | `/kkirikkiri` 개발 팀 또는 `/frontend-design` 병렬 | Yes (3페이지 독립) |
| 2 | Task 4,5 | 서브에이전트 병렬 | Yes |
| 2 | Task 6 | 단독 (프롬프트 튜닝은 신중하게) | No |
| 2 | Task 7 | `/pumasi` Codex 외주 가능 | Yes |
| 3 | Task 8,9,10 | 순차 실행 | No |
