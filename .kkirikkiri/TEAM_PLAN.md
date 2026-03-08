# 팀 작업 계획

- 팀명: kkirikkiri-development-0309
- 목표: 상위노출 목적 블로그 글 작성기 (blog-writer.html) 구현 — 네이버 홈피드/SEO + 구글 SEO 선택 가능
- 생성 시각: 2026-03-09

## 프로젝트 컨텍스트
- 기존 사이트: 뚝딱툴 (ddukddaktool.co.kr) — 정적 HTML 사이트
- 기존 도구: 블로그 제목 생성기(index.html), 후킹문구(hook-generator.html), 스레드 글(threads-writer.html), 기존 블로그작성기(blog-writer.html)
- API: /api/generate 엔드포인트 (Claude API 프록시, 하루 5회 제한)
- 디자인 패턴: threads-writer.html 스타일 (다크모드, 오렌지 액센트)
- 기존 blog-writer.html: 라이트모드로 이미 존재 → 플랜대로 다크모드로 완전 재작성

## 팀 구성
| 이름 | 역할 | 모델 | 담당 업무 |
|------|------|------|----------|
| Lead | 팀장 | Opus | 기획/배분/검증/통합 |
| SEO-Expert | SEO/키워드 전문가 | Opus | 네이버+구글 SEO 전략, 키워드 배치 규칙, 프롬프트 설계 |
| Writing-Expert | 글쓰기 전문가 | Opus | 상위노출 제목/첫문장 원칙, 글쓰기 가이드라인 |
| Dev-HTML | 개발자 1 (HTML/CSS) | Opus | blog-writer.html 페이지 구조, 스타일, 폼 레이아웃 |
| Dev-JS | 개발자 2 (JavaScript) | Opus | API 호출, 프롬프트 조립, 결과 렌더링 |
| Dev-Navbar | 개발자 3 (네비바) | Opus | 30+ 페이지 네비바 업데이트 + sitemap.xml |

## 태스크 목록
- [ ] 태스크 1: SEO 전략 + 프롬프트 설계 → SEO-Expert + Writing-Expert
- [ ] 태스크 2: blog-writer.html HTML/CSS 구조 생성 → Dev-HTML
- [ ] 태스크 3: blog-writer.html JavaScript 로직 → Dev-JS
- [ ] 태스크 4: 전체 페이지 네비바 업데이트 + sitemap → Dev-Navbar
- [ ] 태스크 5: 전체 통합 + 검증 → Lead

## 의존성
- 태스크 2는 태스크 1 완료 후 시작 (SEO 전략이 UI 구조에 반영되어야)
- 태스크 3은 태스크 1, 2 완료 후 시작 (프롬프트 + HTML 구조 필요)
- 태스크 4는 독립 — 즉시 병렬 실행 가능

## 주요 결정사항
(팀장이 결정할 때마다 여기에 기록)
