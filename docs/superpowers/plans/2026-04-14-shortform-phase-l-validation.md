# Phase L — Validation + Memory: 회귀 + 도그푸드 + 메모리 갱신

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. 12 Phase 중 **마지막** Phase L. 마스터 플랜: `2026-04-14-shortform-master-plan.md`. 스펙: `2026-04-14-shortform-benchmark-pipeline-design.md` §27 (성공 기준).

**Goal:** Phase A~K가 모두 머지된 상태에서 **최종 회귀 + 도그푸드 + 메모리/문서 갱신 + 태그**까지 수행해 v2.0.0-shortform으로 릴리스 가능한 상태를 만든다. 이 Phase는 코드 추가가 거의 없고, 문제 발견 시에는 해당 Phase의 후속 커밋으로 수정한다.

**Architecture:** 회귀 체크리스트 → 발견된 이슈는 해당 Phase 파일에 수정 task 추가 → 운영자 도그푸드 5편(웨딩플래너 사업 관점) → 실제 SNS 게시 → 반응 측정 → 메모리 파일 작성 → 마스터 플랜 완료 마킹 → 최종 태그.

**Tech Stack:** 신규 없음. 기존 모든 Phase가 통합된 상태.

**의존성:** Phase A, B, C, D, E, F, G, H, I, J, K 모두 머지 완료

**예상 작업량:** 6 task, 약 1 주 (운영자 도그푸드 포함)

---

## 파일 구조

### 신규 파일

```
docs/test-results/2026-04-XX-shortform-v2-regression.md       회귀 결과 문서
~/.claude/projects/.../memory/project_shortform_v2.md         v2 전체 요약
```

### 수정 파일

```
~/.claude/projects/.../memory/MEMORY.md                       세션 entry 추가
~/.claude/projects/.../memory/project_shortform_voice.md      음성 정책 TODO 마감 표시
~/.claude/projects/.../memory/project_shortform_todo.md       완료 항목 체크
docs/superpowers/plans/2026-04-14-shortform-master-plan.md    전체 완료 상태 마킹
```

---

## Task L1: 회귀 체크리스트 수동 실행

**Files:**
- Create: `docs/test-results/2026-04-XX-shortform-v2-regression.md`

스펙 §27 성공 기준을 모두 체크리스트로 만들어 하나씩 수동 검증. 각 항목 옆에 결과(✅/❌/⚠️) + 메모를 기록.

- [ ] **Step 1: 회귀 결과 문서 초안 작성**

```markdown
# 숏폼 v2 회귀 테스트 결과

**테스트일:** 2026-04-XX
**테스터:** 운영자
**대상 커밋:** <HEAD SHA>
**환경:** Vercel Preview (feature/shortform-v2 브랜치)

## 1. 핵심 기능 (P0)

- [ ] 자영업자가 키워드/블로그 글 + 정체성 입력 → 60초 내에 대본+영상+캡션 패키지 받음
  - 시작 시각: ??:??
  - 완료 시각: ??:??
  - 소요: ??초
  - 결과: ✅/❌
- [ ] 키워드 5개 병렬 검색으로 벤치마킹 영상 5개 이상 (95% 케이스)
  - 테스트 키워드 5종: ['신랑 정장', '카페 창업', '웨딩홀 비용', '학원 마케팅', '펫시터']
  - 각 케이스별 결과: ...
- [ ] Gemini 패턴 추출 JSON schema 검증 99% 통과
  - 20회 테스트 중 통과: ??/20
- [ ] 생성된 대본에 이모지 0개
  - regex /[\u{1F300}-\u{1FAFF}]/u 로 검사
- [ ] 일반론 표현 ≤ 2회
  - '많은', '일반적으로', '보통', '대부분' 카운트
- [ ] 캡션 해시태그 수 ±2 (벤치마킹 기준)
- [ ] Step 6 미리보기 모든 커스터마이징 실시간 반영
- [ ] 폴백 모드 (벤치마킹 없이) 단독 대본 생성 가능

## 2. Retention (P0 추가)

- [ ] 브랜드 킷 한 번 저장 → 모든 영상에 자동 적용
- [ ] 프로젝트 히스토리 draft 이어서 작업 가능
- [ ] SSE 단계별 진행 상태 실시간 표시
- [ ] 취소 버튼 + 크레딧 환불 적용
- [ ] 마이페이지 "내 영상" 재다운로드 가능

## 3. 마지막 1마일 (P1)

- [ ] YouTube 계정 연결 → 한 클릭 업로드 (feature flag ON 시)
- [ ] 신규 사용자 샘플 4종 중 하나로 60초 첫 영상 완성

## 4. 회귀 시나리오 (스펙 외)

- [ ] 기존 숏폼 사용자 흐름 영향 0
- [ ] 폴백 모드 정상
- [ ] 새 사용자 온보딩 → 60초 첫 영상
- [ ] 브랜드 킷 + 프로젝트 히스토리 + SSE + (옵션) YouTube 업로드 연쇄 작동
- [ ] EXIF 검증, 이모지 0, 일반론 ≤2회, 캡션 해시태그 ±2

## 5. 발견된 이슈

| # | 항목 | 심각도 | 조치 |
|---|---|---|---|
| 1 | | | |

## 6. 요약

- 통과: ??/??
- 차단 이슈: ??
- 비차단 이슈: ??
- 릴리스 가능 여부: ✅/❌
```

- [ ] **Step 2: 체크리스트 실행**

운영자가 직접 브라우저에서 하나씩 검증. 각 항목의 결과를 문서에 기록.

체크 방법:
- **60초 목표:** 첫 Step 1 클릭 → Step 7 완료까지 스톱워치
- **schema 검증 99%:** 20회 반복 요청 → Gemini 응답 파싱 실패 카운트
- **이모지 0:** 대본 출력 JSON을 파일로 저장 후 regex grep
- **일반론 ≤2:** 동일하게 grep
- **해시태그 ±2:** 벤치마킹 결과의 평균 태그 수와 비교

- [ ] **Step 3: 발견 이슈는 해당 Phase에 후속 수정 커밋**

발견 이슈가 있으면:
1. 심각도 분류 (차단 / 비차단)
2. 차단 이슈는 해당 Phase 플랜 파일에 "Task X+1: 회귀 수정" 추가 후 fix
3. 비차단 이슈는 docs/superpowers/plans/2026-04-XX-shortform-v2-post-release-todo.md 로 이관

- [ ] **Step 4: 커밋**

```bash
cd /Users/gong-eunhui/Desktop/naver-title-generator
git add docs/test-results/2026-04-XX-shortform-v2-regression.md
git commit -m "$(cat <<'EOF'
docs(test): 숏폼 v2 회귀 결과 — Phase A~K 통합

스펙 §27 성공 기준 + 회귀 시나리오 모두 수동 확인.
발견된 이슈는 해당 Phase 후속 커밋으로 반영.
EOF
)"
```

---

## Task L2: 운영자 도그푸드 — 웨딩플래너 사업으로 5편

**Files:**
- 없음 (운영자 수동 작업)

스펙 §27 도그푸드 항목:
- 운영자가 직접 자기 사업(웨딩플래너)으로 도그푸드 → "이거 진짜 내가 쓴 것 같아" 만족도 도달
- 운영자 본인이 만든 영상 5편을 실제 SNS에 게시 → 반응 측정

- [ ] **Step 1: 주제 5개 선정**

운영자 본인의 웨딩플래너 19년 경력 + 웨딩컨설팅 14년 관점에서 진짜 쓸 법한 주제 5개:

1. "신랑 정장 고를 때 절대 하지 말아야 할 실수"
2. "웨딩홀 계약 전 꼭 물어봐야 할 5가지"
3. "19년차 플래너가 말하는 예산 줄이는 팁 3개"
4. "웨딩 포토 앨범 고를 때 가장 많이 후회하는 선택"
5. "결혼 준비 100일 전, 지금 반드시 해야 할 일"

- [ ] **Step 2: 각 주제 → 숏폼 생성**

각 주제마다:
1. /shortform Step 1 입력 (블로그 글 또는 키워드)
2. 페르소나: 직접 입력 "웨딩플래너" / 톤: 전문가 / 길이: 60초
3. 경험·느낌: 본인 19년 경력에서 진짜 있었던 사례 50자 이상
4. 벤치마킹 → 대본 → 이미지 → 미리보기 → 렌더까지 완주
5. 생성 후 대본 품질 체크: "이거 내가 직접 쓴 것 같아?" 기준 평가

- [ ] **Step 3: SNS 게시**

5편 모두 실제 운영자 SNS 계정(인스타 릴스 / 유튜브 숏츠 / 스레드)에 업로드:
- 캡션은 도구가 생성한 것 그대로 사용
- 해시태그 ±2 이내
- 썸네일은 도구 자동 생성

- [ ] **Step 4: 반응 측정 (7일 후)**

```
영상 | 플랫폼 | 조회수 | 좋아요 | 댓글 | 저장 | 노트
1 | IG Reels | ?? | ?? | ?? | ?? | 
2 | IG Reels | ?? | ?? | ?? | ?? | 
...
```

- [ ] **Step 5: 도그푸드 결과 메모리 파일로 저장**

`~/.claude/projects/.../memory/project_shortform_v2_dogfood.md`:

```markdown
# 숏폼 v2 도그푸드 결과 (운영자 웨딩플래너 5편)

**기간:** 2026-04-XX ~ 2026-04-XX
**플랫폼:** 인스타 릴스 / 유튜브 숏츠 / 스레드

## 만족도

- [ ] "이거 진짜 내가 쓴 것 같아" 감각 도달 — ✅/❌ (영상별)

## 반응 (7일 기준)

| 영상 | 플랫폼 | 조회수 | 좋아요 | 댓글 | 저장 |
|---|---|---|---|---|---|
| ... | ... | ... | ... | ... | ... |

## 인사이트

- 잘 된 점:
- 개선 필요:
- 스펙에 반영할 포인트:
```

- [ ] **Step 6: 도그푸드 결과가 기준 미달이면 플랜 보강**

만약 5편 모두 "내 말 같지 않다"면:
1. Phase D(Script) 프롬프트 재튜닝 task 추가
2. Phase B(벤치마킹) 5x 비율 기준 재검토
3. 도그푸드 재실행

5편 중 3편 이상이 "내가 쓴 것 같다" 수준이면 통과.

- [ ] **Step 7: 커밋 없음**

운영자 수동 작업이라 커밋 대상 아님. 메모리 파일만 작성.

---

## Task L3: MEMORY.md + 세션 entry 업데이트

**Files:**
- Modify: `~/.claude/projects/-Users-gong-eunhui-Desktop-naver-title-generator/memory/MEMORY.md`

- [ ] **Step 1: 최근 세션 섹션 최상단에 v2 릴리스 entry 추가**

```markdown
- [4/XX 숏폼 v2 릴리스](project_shortform_v2.md) — **v2.0.0-shortform 프로덕션 머지 완료**. 벤치마킹 파이프라인 + 브랜드 킷 + 프로젝트 히스토리 + SSE + 온보딩 완료. YouTube 업로드는 v1.1 feature flag OFF 대기.
```

- [ ] **Step 2: 과제/로드맵 섹션 업데이트**

기존 "과제4: 숏폼 영상" 아래에:

```markdown
- 과제4: 숏폼 영상 — Round 1+2+**v2 완료 (4/XX)**. Gemini 벤치마킹 + Claude 페르소나 대본 + 브랜드 킷 + 프로젝트 히스토리 + SSE + 온보딩
```

- [ ] **Step 3: "전환 후 재개 예정" 섹션 정리**

v2에서 완료된 항목은 제거:
- ~~숏폼 품질(hierarchical)~~ → v2 완료
- ~~자막 편집기(fingr 벤치마크)~~ → Phase F 완료
- ~~후킹 테스트~~ → Phase D 완료
- ~~B-roll 개선~~ → Phase E 완료

남는 항목은 v2.1 TODO로 이관.

- [ ] **Step 4: 커밋 없음 (메모리 파일은 로컬)**

메모리 파일 수정은 리포지터리 커밋 대상 아님. 변경 확인만.

---

## Task L4: project_shortform_v2.md — 전체 기능 요약 문서

**Files:**
- Create: `~/.claude/projects/-Users-gong-eunhui-Desktop-naver-title-generator/memory/project_shortform_v2.md`

- [ ] **Step 1: 전체 요약 작성**

```markdown
---
name: 숏폼 v2 릴리스
description: 벤치마킹 + 페르소나 대본 + 브랜드킷 + SSE + 온보딩 + YouTube 업로드(v1.1)
type: project
---

# 숏폼 v2 릴리스

**릴리스일:** 2026-04-XX
**태그:** v2.0.0-shortform
**브랜치:** main (12 Phase 모두 머지)
**스펙:** docs/superpowers/specs/2026-04-14-shortform-benchmark-pipeline-design.md
**마스터 플랜:** docs/superpowers/plans/2026-04-14-shortform-master-plan.md

## 12 Phase 요약

| Phase | 범위 | 상태 |
|---|---|---|
| A | Foundation: UI 동선 + Step 1 입력 | ✅ |
| B | Benchmarking: 키워드 확장 + 5쿼리 + Gemini 2.5 Pro | ✅ |
| C | Project Model: shortform_projects DB + auto-save | ✅ |
| D | Script: Claude 페르소나 대본 + 캡션 | ✅ |
| E | Image Library: Step 5 사진 액센트 | ✅ |
| F | Preview: Step 6 미리보기 + 프리셋 6종 + 자막 커스텀 | ✅ |
| G | Brand Kit: 마이페이지 + 자동 적용 | ✅ |
| H | Project History: drafts + published UI | ✅ |
| I | SSE Progress + Cancel | ✅ |
| J | YouTube Direct Upload (v1.1) | ✅ 코드 / feature flag OFF |
| K | Onboarding Wizard: 샘플 4종 + 첫 영상 무료 | ✅ |
| L | Validation + 도그푸드 + 메모리 | ✅ |

## 핵심 기술 결정

1. **Gemini 2.5 Pro thinking 모드**로 YouTube URL 직접 분석 (Vertex AI)
2. **키워드 확장 5개 + 병렬 검색 + 5x 비율 필터**로 "터진 구조" 자동 추출
3. **페르소나 5종 + 직접 입력**으로 1인칭 대본 + 이모지 금지 hard rule
4. **브라우저 resumable YouTube 업로드** (Vercel 60s 제한 회피)
5. **Upstash Redis SSE short-polling** (REST API 제약)
6. **Lazy schema migration** 패턴 유지 (카드뉴스 Phase 3 재활용)

## 재사용 자산

- ImagePickerModal + my-images API (카드뉴스 Phase 3)
- Threads OAuth 패턴 → YouTube OAuth
- Remotion 키네틱 프리셋 10종 (4/14 리브랜딩)
- TTS (Google/Supertone/ElevenLabs)
- StepProgress 공용 컴포넌트 (카드뉴스와 공유 가능)

## 환경 변수 추가

- GOOGLE_CLOUD_PROJECT
- VERTEX_AI_LOCATION
- GEMINI_VERTEX_MODEL (gemini-2.5-pro)
- GOOGLE_OAUTH_CLIENT_ID / SECRET / REDIRECT_URI
- YOUTUBE_UPLOAD_ENCRYPTION_KEY (base64 32byte)
- YOUTUBE_UPLOAD_FEATURE_FLAG (v1.1 전까지 false)

## DB 변경

- `shortform_projects` 테이블 신설 (Phase C)
- `brand_kits` 테이블 신설 (Phase G)
- `youtube_connections` 테이블 신설 (Phase J)
- `users` 에 onboarding_completed / first_shortform_at 컬럼 추가 (Phase K)

## 운영자 대기 항목

- [ ] YouTube OAuth verification 승인 (4~6주, 4/14 신청)
- [ ] YouTube Data API 쿼터 상향 10K → 100K
- [ ] 승인 후 YOUTUBE_UPLOAD_FEATURE_FLAG=true

## v2.1 / v3 후보

- 멀티플랫폼 캡션 변환 (Instagram/Threads/TikTok/샤오홍슈)
- Supertone Voice Clone (한국어 우위 확인 후)
- 모듈 업셀 / 구독 티어 (4/25 출시 후 데이터 보고 결정)
- 모바일 앱 (1년 후 검토)
- 숏폼 프로젝트 복제 / 템플릿 저장
- A/B 테스트 기능 (대본 2가지 자동 생성)

## 알려진 제약

- YouTube 업로드는 verification 전 test user 한정
- 일일 YouTube 검색 쿼터 ~17 fresh (캐시 80% 가정 ~85)
- 60초 목표는 벤치마킹 캐시 HIT 시점 기준 (MISS 시 90초)
```

- [ ] **Step 2: 커밋 없음**

메모리 파일.

---

## Task L5: voice / todo 메모리 파일 마감 표시

**Files:**
- Modify: `~/.claude/projects/-Users-gong-eunhui-Desktop-naver-title-generator/memory/project_shortform_voice.md`
- Modify: `~/.claude/projects/-Users-gong-eunhui-Desktop-naver-title-generator/memory/project_shortform_todo.md`

- [ ] **Step 1: project_shortform_voice.md 업데이트**

기존 "TTS 금지 / 실제 음성만" 정책은 v2에서도 유지. 상단에 "v2.0.0-shortform 에서도 동일 정책 유지" 한 줄만 추가:

```markdown
> v2.0.0-shortform (2026-04-XX) 에서도 동일 정책 유지. Supertone/Google 합성 음성은 OK. 임의 TTS 금지.
```

- [ ] **Step 2: project_shortform_todo.md 업데이트**

v2에서 완료된 항목에 ✅ 마킹:

```markdown
- [x] 벤치마킹 파이프라인 (Phase B) ✅
- [x] 페르소나 대본 (Phase D) ✅
- [x] 브랜드 킷 (Phase G) ✅
- [x] 프로젝트 히스토리 (Phase H) ✅
- [x] SSE 진행 표시 (Phase I) ✅
- [x] 온보딩 샘플 (Phase K) ✅
- [ ] YouTube 업로드 (Phase J — verification 대기)
- [ ] 자막 편집기 정밀 조정 (v2.1)
- [ ] 후킹 공식 확장 (v2.1)
- [ ] B-roll 자동 선택 고도화 (v2.1)
```

- [ ] **Step 3: 커밋 없음**

---

## Task L6: 최종 커밋 + 태그

**Files:**
- Modify: `docs/superpowers/plans/2026-04-14-shortform-master-plan.md`

- [ ] **Step 1: 마스터 플랜 헤더에 완료 배지 추가**

```markdown
# 숏폼 벤치마킹 파이프라인 — 마스터 플랜

> ✅ **v2.0.0-shortform 완료 (2026-04-XX)** — 12 Phase 전부 머지, 도그푸드 통과.
>
> **For agentic workers:** ...
```

각 Phase 요약 섹션 끝에 `**상태:** ✅ 완료 (커밋 SHA: XXXXXXX)` 추가.

- [ ] **Step 2: 머지 커밋 (현재 브랜치 main 가정)**

이미 각 Phase가 main에 머지돼 있으면 최종 docs 커밋만 남김:

```bash
git add docs/superpowers/plans/2026-04-14-shortform-master-plan.md docs/test-results/2026-04-XX-shortform-v2-regression.md
git commit -m "$(cat <<'EOF'
docs: 숏폼 v2 완료 마킹 + 회귀 결과

12 Phase 전부 완료 (Phase J 는 feature flag OFF 상태로 v1.1 대기).
운영자 도그푸드 5편 통과. MEMORY.md + project_shortform_v2.md
갱신. 릴리스 태그 부착 직전.
EOF
)"
```

- [ ] **Step 3: 태그 부착**

```bash
git tag -a v2.0.0-shortform -m "$(cat <<'EOF'
숏폼 v2.0.0 — 벤치마킹 + 페르소나 대본 + 브랜드 킷 + SSE + 온보딩

12 Phase 전부 완료:
- Phase A: UI 동선 + Step 1 입력
- Phase B: YouTube 키워드 확장 + 5쿼리 병렬 + Gemini 2.5 Pro 분석
- Phase C: shortform_projects DB + auto-save
- Phase D: Claude 페르소나 대본 + 캡션
- Phase E: Step 5 사진 액센트
- Phase F: Step 6 미리보기 + 프리셋 + 자막 커스텀
- Phase G: 브랜드 킷 마이페이지 + 자동 적용
- Phase H: 프로젝트 히스토리 UI
- Phase I: SSE 진행 표시 + 취소
- Phase J: YouTube 직접 업로드 (v1.1 feature flag)
- Phase K: 온보딩 샘플 4종 + 첫 영상 무료
- Phase L: 회귀 + 도그푸드 + 메모리

YouTube 업로드는 OAuth verification 승인 후 별도 릴리스.
EOF
)"
```

- [ ] **Step 4: push (운영자 승인 후)**

```bash
# 실제 푸시는 운영자가 최종 확인 후 실행
# git push origin main
# git push origin v2.0.0-shortform
```

> **주의:** 자동 push 금지. 태그와 최종 커밋이 생성된 후 운영자가 승인하면 수동으로 push.

- [ ] **Step 5: Vercel 배포 확인**

1. Vercel 대시보드에서 main 배포 상태 확인
2. 프로덕션 https://ddukddaktool.co.kr/shortform 직접 접속
3. 새 탭 incognito 로 비회원 / 회원 / 신규 가입 시나리오 마지막 한 번 더 확인

- [ ] **Step 6: 릴리스 노트 (선택)**

GitHub Releases 에 v2.0.0-shortform 릴리스 노트 작성 (운영자 수동):
- 주요 기능 5~7개 bullet
- 마이그레이션 필요 사항 (환경 변수 추가)
- 알려진 제약 (YouTube feature flag OFF)

---

## Phase L 자기 검토

### Spec coverage

| 스펙 섹션 | 커버 task |
|---|---|
| §27 핵심 기능 (P0) | L1 체크리스트 |
| §27 Retention (P0) | L1 체크리스트 |
| §27 마지막 1마일 (P1) | L1 체크리스트 |
| §27 도그푸드 | L2 |

### 알려진 미완

- YouTube 업로드 feature flag OFF (verification 승인 후 별도 릴리스)
- v2.1 후보(멀티플랫폼 캡션 / 음성 복제 / 구독 티어)는 이 Phase 범위 아님

### 회귀 안전성

- L1 체크리스트에서 "기존 사용자 영향 0" 항목 반드시 ✅ 되어야 릴리스 가능
- 실패 시: 해당 Phase 후속 수정 커밋 + 재검증

### 릴리스 조건 (Go/No-Go)

- L1 차단 이슈 0건
- L2 도그푸드 5편 중 3편 이상이 "내가 쓴 것 같다" 품질
- /me + /shortform 기존 사용자 케이스 정상
- 첫 영상 무료 배너 및 시스템 동작 확인
- 크레딧 차감 시점 검증 (Step 7 렌더 시작에서만)

이 조건을 모두 만족하면 v2.0.0-shortform 태그 부착 + 운영자 승인 후 push.

---

## 숏폼 v2 완료 후 다음 단계

1. 4~6주 YouTube OAuth verification 결과 대기
2. 승인 후 YOUTUBE_UPLOAD_FEATURE_FLAG=true + v2.0.1-shortform 소규모 릴리스
3. 4/25 정식 오픈 후 DAU / 생성수 / 크레딧 소진 / 도그푸드 반응 측정
4. 데이터 보고 v2.1 우선순위 결정 (멀티플랫폼 캡션 / 음성 복제 / 모바일 / 구독 티어)
