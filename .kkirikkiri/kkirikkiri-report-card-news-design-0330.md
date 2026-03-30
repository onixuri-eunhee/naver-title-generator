# 카드뉴스 디자인 품질 향상 종합 리포트

> 팀: kkirikkiri-research-0330-card-news-design
> 목표: 현재 스택(Satori+Resvg) 유지하면서 전문 디자이너 수준의 비주얼 퀄리티 달성
> 관점: 비주얼 퀄리티 (타이포그래피, 색상, 레이아웃, 여백)

---

## 핵심 요약: 프로 vs 현재의 차이

| 구분 | 현재 | 프로 수준 |
|------|------|----------|
| 타이포그래피 | 2 weight (400/700), 고정 크기 | 3-4 weight, 시각적 위계 명확 |
| 색상 대비 | 일부 테마 가독성 부족 | WCAG AA 준수, 의도적 대비 |
| 여백 | 불규칙 (44/48/56/72px 혼재) | 8px 그리드 기반 일관된 리듬 |
| 장식 요소 | 단순 라인 (100x8px 고정) | 슬라이드별 특화된 장식 |
| 슬라이드 변화 | 6종 레이아웃 유사 구조 | 각 슬라이드가 시각적으로 구분됨 |

---

## 1. 타이포그래피 개선 (가장 임팩트 큼)

### 1.1 폰트 Weight 추가 (500 Medium)

현재 400(Regular)과 700(Bold)만 사용. **500(Medium)**을 추가하면 부제, 라벨 등에서 시각적 위계가 세분화됨.

**구현 방법:**
```javascript
// fonts/ 디렉토리에 NotoSansKR-Medium.ttf 추가
// api/card-news.js loadFonts()에 추가:
{ name: 'Noto Sans KR', data: fontMedium, weight: 500, style: 'normal' }
```

**적용 위치:**
- 부제(subtitle): 700→500 (제목과 위계 구분)
- 라벨(label): 700→500
- CTA 설명 텍스트: 400→500

### 1.2 제목/본문 크기 비율 최적화

**현재:**
- Cover 제목: 96px / 본문: 40px (비율 2.4:1)
- Content 제목: 56px / 본문: 40px (비율 1.4:1) ← 차이가 약함

**개선안 (황금비율 기반):**
- Cover 제목: 96px (유지)
- Content 제목: 52px → 강조 (유지 or 약간 축소)
- Content 본문: 36px (40→36, 제목과 대비 강화, 비율 1.44:1)
- 라벨: 28px (32→28, 존재감 낮추기)
- 브랜드: 24px (28→24)

### 1.3 자간/행간 세분화

**현재:** 대부분 기본값 (letterSpacing 미설정, lineHeight 1.4~1.75)

**개선안:**
| 요소 | letterSpacing | lineHeight |
|------|-------------|------------|
| Cover 제목 | -0.5px (밀착) | 1.2 |
| Content 제목 | 0px | 1.3 |
| 본문 | 0.3px (약간 벌림) | 1.7 |
| 라벨 | 3px (대문자 느낌) | 1.0 |
| 인용 | 0.5px | 1.8 (여유) |
| CTA 버튼 | 1px | 1.0 |

---

## 2. 색상 시스템 개선

### 2.1 가독성 문제 수정 (우선순위 높음)

**문제 테마:**
- Fitness: `#B0B0B0` on `#F5F5F5` → 대비 1.9:1 (WCAG AA 미달)
- Realty: `#6E9A88` on `#F7FBF9` → 대비 2.8:1 (미달)

**수정안:**
```javascript
// fitness 테마
textLight: '#B0B0B0' → '#787878'  // 대비 4.5:1 이상

// realty 테마
textLight: '#6E9A88' → '#4A7A62'  // 대비 4.5:1 이상
```

### 2.2 커버/CTA 배경 깊이감

현재 bgDark가 단색이라 밋밋함. Satori가 gradient를 지원하지 않으므로 **다중 레이어 기법**으로 깊이감 추가:

```javascript
// Cover 슬라이드에 배경 장식 요소 추가
h('div', { style: { position: 'absolute', top: 0, right: 0, width: 300, height: 300,
  background: theme.accent, opacity: 0.08, borderRadius: '50%' } }),
h('div', { style: { position: 'absolute', bottom: 0, left: 0, width: 200, height: 200,
  background: theme.primary, opacity: 0.06, borderRadius: '50%' } }),
```

→ 투명도 낮은 원형 도형으로 배경에 은은한 깊이감 추가 (Satori opacity 지원)

### 2.3 트렌드 색상 팔레트 5종 추가 제안

| 테마명 | Primary | Accent | 키워드 |
|--------|---------|--------|--------|
| 소프트 세이지 | #7C9A8E | #D4B896 | 자연, 웰니스, 힐링 |
| 인디고 나이트 | #2C3E6B | #E8A87C | 프리미엄, 깊이감 |
| 코랄 블러시 | #E8836B | #F5C6AA | 따뜻함, 친근함 |
| 미드나잇 티얼 | #1A535C | #4ECDC4 | 테크, 혁신 |
| 라벤더 드림 | #9B8EC4 | #F0E6FF | 감성, 브랜딩 |

---

## 3. 레이아웃 & 여백 개선

### 3.1 여백 표준화 (8px 그리드)

**현재 문제:** marginTop이 44, 48, 56, 72px 등 불규칙

**개선안 — spacing 토큰:**
```javascript
const SP = {
  xs: 8,    // 라인, 작은 간격
  sm: 16,   // 라벨-제목 사이
  md: 24,   // 제목-본문 사이
  lg: 32,   // 섹션 간격
  xl: 48,   // 큰 섹션 분리
  xxl: 64,  // 커버/CTA 여백
};
```

### 3.2 슬라이드별 패딩 차등화

**현재:** 거의 모든 슬라이드 padding: 100px 또는 60px

**개선안:**
| 슬라이드 | padding | 이유 |
|----------|---------|------|
| Cover | 100px | 중앙 정렬, 넓은 여백 |
| Summary | 72px | 카드 안에 콘텐츠 |
| Content | 64px | 번호+제목+본문 |
| Quote | 80px | 인용문은 여유롭게 |
| Data | 60px | 큰 숫자 공간 확보 |
| CTA | 100px | 행동 유도에 집중 |

### 3.3 Content 슬라이드 레이아웃 변형

**현재:** 모든 Content 슬라이드가 동일 구조 (번호-제목-구분선-본문)

**개선안 — 2가지 변형 추가:**

**변형 A: 좌우 분할 (번호 좌측, 제목+본문 우측)**
```
┌──────────────────────┐
│  ┌──┐  ┌───────────┐ │
│  │01│  │ Title     │ │
│  └──┘  │ Body text │ │
│        │           │ │
│        └───────────┘ │
└──────────────────────┘
```

**변형 B: 상단 강조 바 + 전체폭 본문**
```
┌──────────────────────┐
│ ━━━━━━━━━━━━━━━━━━━ │  (전체폭 accent 바)
│                      │
│  01. Title           │
│                      │
│  Body text here      │
│  continues here      │
│                      │
└──────────────────────┘
```

→ AI가 슬라이드 내용에 따라 자동 선택하도록 프롬프트에 `layout_variant` 필드 추가

---

## 4. 장식 요소 개선

### 4.1 Accent 라인 다양화

**현재:** 모든 슬라이드에 동일한 100×8px 라인

**개선안:**
| 슬라이드 | 장식 | 크기 |
|----------|------|------|
| Cover | 상단 가로 라인 | 120×6px, borderRadius: 3 |
| Summary | 좌측 세로 바 (현재 유지) | 8×전체높이 |
| Content | 제목 아래 짧은 라인 | 60×4px |
| Quote | 큰 따옴표 (현재 유지) + 상하 가는 라인 | 전체폭×1px |
| Data | 값 위 점선 느낌의 짧은 바 | 40×3px |
| CTA | 없음 (버튼이 포인트) | - |

### 4.2 번호 디자인 강화

**현재:** 큰 숫자만 표시 (96px, primary 색상)

**개선안 — 배경 원형 추가:**
```javascript
// 번호에 반투명 배경 원 추가
h('div', { style: {
  width: 100, height: 100, borderRadius: 50,
  background: `${theme.primary}12`,  // 7% 투명도
  display: 'flex', alignItems: 'center', justifyContent: 'center',
}},
  h('div', { style: { fontSize: 64, fontWeight: 700, color: theme.primary } }, num)
)
```

### 4.3 CTA 버튼 개선

**현재:** 단순 직사각형 버튼

**개선안:**
```javascript
// 버튼에 시각적 무게감 추가
h('div', { style: {
  background: theme.accent,
  borderRadius: theme.radius + 4,  // 약간 더 둥글게
  padding: '24px 64px',  // 넉넉한 패딩
  // 아래에 subtle한 하단 라인 추가
}},
  h('div', { style: { fontSize: 36, fontWeight: 700, letterSpacing: 1 } }, buttonText)
),
// 버튼 아래 보조 텍스트
h('div', { style: { marginTop: 20, fontSize: 28, opacity: 0.5 } }, subText)
```

---

## 5. 프로 vs 아마추어 결정적 차이 5가지

### 차이 1: 시각적 위계 (Visual Hierarchy)
- **아마추어:** 모든 텍스트가 비슷한 크기/굵기
- **프로:** 제목-부제-본문-캡션이 명확히 구분됨
- **적용:** 폰트 크기 비율 1.4:1 이상, weight 3단계 (400/500/700)

### 차이 2: 일관된 여백 리듬 (Consistent Spacing)
- **아마추어:** 여백이 느낌대로, 슬라이드마다 다름
- **프로:** 8px 그리드 기반, 예측 가능한 리듬
- **적용:** spacing 토큰 시스템 도입

### 차이 3: 색상 의도성 (Color Intent)
- **아마추어:** 예쁜 색상 나열
- **프로:** 정보 전달 목적에 맞는 색상 배정 (강조, 보조, 배경)
- **적용:** WCAG AA 대비 준수 + 역할별 색상 분리

### 차이 4: 슬라이드 간 연결감 (Flow)
- **아마추어:** 각 슬라이드가 독립적
- **프로:** 시작→전개→절정→마무리의 시각적 흐름
- **적용:** Cover(어둡고 강렬) → Content(밝고 정보적) → CTA(어둡고 행동 유도)

### 차이 5: 디테일 마감 (Finishing Touch)
- **아마추어:** 기본 도형, 기본 정렬
- **프로:** 미세한 borderRadius, 정교한 opacity, 의도된 자간
- **적용:** 번호 배경 원, accent 라인 변형, letterSpacing 세분화

---

## 6. 구현 우선순위 (Satori 제약 내 실현 가능)

### P0 (즉시 적용 — 코드 변경만으로 큰 효과)
1. **색상 대비 수정** — Fitness, Realty 테마 textLight 수정
2. **letterSpacing/lineHeight 세분화** — 각 요소별 최적값 적용
3. **여백 표준화** — spacing 토큰 도입

### P1 (1일 작업 — 눈에 띄는 품질 향상)
4. **폰트 500 weight 추가** — Medium 폰트 파일 추가 + 적용
5. **번호 디자인 강화** — 반투명 배경 원 추가
6. **accent 라인 슬라이드별 차등화**

### P2 (2-3일 작업 — 프로 수준 도달)
7. **Cover/CTA 배경 장식 요소** — 투명 원형 도형으로 깊이감
8. **Content 레이아웃 변형** — 2-3가지 변형 + AI 자동 선택
9. **새 트렌드 테마 5종 추가**

### P3 (선택사항)
10. **CTA 버튼 리디자인**
11. **Quote 슬라이드 인용부호 스타일 개선**
12. **Data 슬라이드 숫자 크기 동적 조정**

---

## 7. Satori에서 불가능한 것 (시도하지 말 것)

| 기능 | 불가 이유 | 대안 |
|------|----------|------|
| 그래디언트 배경 | Satori 미지원 | 반투명 도형 레이어링 |
| 그림자 효과 | box-shadow 미지원 | 반투명 배경 요소로 깊이감 |
| 배경 이미지 | background-image 미지원 | 기하학적 도형으로 장식 |
| 애니메이션 | 정적 렌더러 | 해당없음 (PNG 출력) |
| italic 한글 | 한글 italic 폰트 없음 | fontWeight로 강조 |
| 다중 폰트 | 추가 폰트 로드 비용 | Noto Sans KR weight 다양화로 대체 |
