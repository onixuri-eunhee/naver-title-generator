# 카드뉴스 사용자 이미지 업로드 + 내 이미지 보관함 설계

**작성일:** 2026-04-14
**상태:** 설계 승인 완료 (구현 계획 작성 대기)
**연관 로드맵:** Variant Phase 3 (사용자 이미지 업로드)

---

## 1. 배경 및 목표

### 문제
현재 카드뉴스는 AI 생성 이미지와 Satori 템플릿만 사용하며, 사용자(특히 **매장을 운영하는 자영업자**)가 자신의 매장/메뉴/상품 사진을 카드뉴스에 삽입할 수 없다. 이는 다음 문제를 야기한다:

- 매장 사장님의 핵심 유스케이스(내 가게 홍보)를 지원하지 못함
- 사용자 다수가 같은 도구를 쓰면 결과물이 비슷해지는 문제(Variant 철학 위배)
- 숏폼/블로그 글 도구에서도 같은 요구가 존재(중복 개발 리스크)

### 목표
"사진을 한 번 올려두면 카드뉴스·숏폼·블로그 글 어디서든 재사용할 수 있는 **내 이미지 보관함**"을 구축하고, 그 첫 번째 소비자로 카드뉴스를 통합한다.

### 비목표 (이번 범위 밖)
- 숏폼/블로그 글 통합 (같은 모달 재사용만 준비, 실제 통합은 차기 스프린트)
- 이미지 편집(필터·밝기 등)
- AI 기반 태그 자동 분류
- 폴더/앨범 구조
- 다중 선택 일괄 작업
- 이미지 정렬/검색 기능(태그 필터만 제공)

---

## 2. 핵심 사용자 플로우

### 2.1 매장 사장님의 첫 사용
1. 마이페이지 → "내 이미지" 섹션으로 이동
2. 매장 내부 사진 3장, 메뉴 사진 5장 업로드 (각 태그 지정)
3. 카드뉴스 페이지에서 텍스트 작성 → 생성 클릭
4. AI 생성 결과 미리보기에서 1번 카드의 📷 아이콘 클릭
5. 이미지 선택 모달 → "내 이미지" 탭 → 매장 사진 선택
6. 사용 방식 "표지"로 선택 → 크롭 에디터로 구도 조정 → 적용
7. 2~3번 카드에는 메뉴 사진을 "콘텐츠" 모드로 추가
8. 최종 생성 → PNG 다운로드

### 2.2 바로 업로드 경로
- 카드뉴스 페이지에서 📷 아이콘 → 모달 → "새로 업로드" 탭
- 업로드한 사진은 자동으로 내 이미지 보관함에도 저장됨

---

## 3. 아키텍처

```
┌─────────────────────────────────────────────┐
│  내 이미지 보관함 (마이페이지 안 섹션)        │
│  /mypage#my-images                          │
└─────────────┬───────────────────────────────┘
              │
      ┌───────┴────────┐
      │                │
   R2 Storage      Neon DB
   (원본 + 썸네일)  user_images 테이블
                     (메타데이터)
              │
      ┌───────┴────────┬───────────┐
      │                │           │
  카드뉴스         숏폼(차기)    블로그글(차기)
  📷 아이콘 +      同 모달 재사용  同 모달 재사용
  ImagePickerModal
```

### 핵심 컴포넌트
1. **보관함 관리 화면** — 마이페이지 내 "내 이미지" 섹션 (업로드/썸네일 그리드/삭제/태그 수정)
2. **이미지 선택 모달** — 재사용 가능 React 컴포넌트 `<ImagePickerModal />`
3. **API 4종** — `POST/GET/PATCH/DELETE /api/my-images`

---

## 4. 데이터 모델

### 4.1 Neon DB 테이블

```sql
CREATE TABLE user_images (
  id            SERIAL PRIMARY KEY,
  user_email    TEXT NOT NULL,
  r2_key        TEXT NOT NULL,
  public_url    TEXT NOT NULL,
  thumb_url     TEXT NOT NULL,
  filename      TEXT NOT NULL,
  mime_type     TEXT NOT NULL,
  file_size     INTEGER NOT NULL,
  width         INTEGER,
  height        INTEGER,
  tag           TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_user_images_email
  ON user_images(user_email, created_at DESC);
```

### 4.2 R2 저장 구조

```
user-images/
  {email_hash}/
    {timestamp}_{random}.jpg          ← 원본 (EXIF 제거됨)
    {timestamp}_{random}_thumb.jpg    ← 썸네일 400x400
```

- **email_hash:** SHA-256(user_email). R2 URL에서 이메일 직접 노출 방지.
- **썸네일:** 목록 로딩 속도 확보를 위해 업로드 시 400x400 정사각형으로 별도 생성 (sharp 사용).

### 4.3 용량 제한

| 구분 | 조건 | 총 용량 | 장당 크기 | 포맷 |
|------|------|---------|-----------|------|
| 무료 회원 | 크레딧 구매 이력 없음 | 50MB | 5MB | JPG, PNG |
| 유료 회원 | 누적 크레딧 구매 이력 있음 | 500MB | 5MB | JPG, PNG |

- 유료 승격 조건: `users` 테이블에 **누적 구매 금액 > 0** 또는 별도 `has_purchased` 플래그 (추후 마이그레이션 단계에서 결정)
- 초과 시 업로드 API는 **409 Conflict** 응답, UI는 "용량이 초과됐습니다. 오래된 이미지를 삭제해 주세요" 안내. **자동 삭제 없음.**

---

## 5. API 설계

### 5.1 엔드포인트 목록

```
POST   /api/my-images        업로드 (multipart/form-data)
GET    /api/my-images        목록 조회 (자기 것만, 최신순)
PATCH  /api/my-images/[id]   태그 수정
DELETE /api/my-images/[id]   삭제 (R2 + DB 둘 다 제거)
```

### 5.2 업로드 처리 순서 (`POST /api/my-images`)

1. 세션 검증 (기존 `requireAuth()` 재사용)
2. 용량 체크: 유료 여부 확인 → 500MB / 50MB 한도 계산 → 초과 시 **409**
3. 파일 검증: mime 타입 JPG/PNG, 크기 < 5MB → 위반 시 **400**
4. EXIF 제거 + 원본 재인코딩 (sharp `.rotate().jpeg({ quality: 90 })`)
5. 썸네일 생성 (sharp, 400x400 cover crop)
6. R2 업로드: `user-images/{email_hash}/{timestamp}_{random}.jpg` + `_thumb.jpg`
7. DB insert (`user_images`)
8. 응답:
   ```json
   {
     "id": 123,
     "public_url": "https://cdn.ddukddaktool.co.kr/...",
     "thumb_url": "https://cdn.ddukddaktool.co.kr/..._thumb.jpg",
     "tag": "매장내부",
     "width": 4032,
     "height": 3024,
     "created_at": "2026-04-14T12:34:56Z"
   }
   ```

### 5.3 직접 업로드 vs API 경유 결정

**결정: API 경유 (클라이언트 → Vercel 함수 → R2)**

- 5MB 파일은 Vercel 함수 payload로 충분 처리 가능
- sharp로 썸네일/EXIF 처리를 서버에서 단일 지점에서 수행해야 안전
- 기존 `blog-image-pro.js`가 이미 같은 패턴이라 일관성 유지
- presigned URL 방식은 3단계 복잡도가 커 YAGNI 판단

### 5.4 보안 체크리스트

- 모든 엔드포인트 `requireAuth()` 필수
- 삭제/수정은 **소유자 확인** (`row.user_email === session.email`, 미일치 시 403)
- R2 경로에 `email_hash` 포함 → 남의 URL 추측 불가
- EXIF 완전 제거 → GPS 좌표 등 메타데이터 누출 차단
- mime 타입 + 매직 넘버 이중 검증 (확장자 위조 방지)

---

## 6. UI/UX 설계

### 6.1 마이페이지 내 "내 이미지" 섹션

```
마이페이지
├ 크레딧 현황
├ 내 이미지                    ← 신규
└ 결제 내역

[내 이미지 클릭]
┌─────────────────────────────────────────┐
│ 내 이미지                    사용 12/50MB │
│ [+ 사진 업로드] [태그 필터 ▾]             │
│ ┌───┬───┬───┬───┐                      │
│ │🖼️ │🖼️ │🖼️ │🖼️ │  ← 썸네일 그리드(4열)  │
│ │매장│메뉴│메뉴│상품│                    │
│ └───┴───┴───┴───┘                      │
└─────────────────────────────────────────┘
```

**상호작용:**
- 업로드 버튼 → 드래그 앤 드롭 또는 파일 선택 (다중 선택 가능)
- 업로드 진행 시 각 파일마다 프로그레스 표시
- 이미지 호버 → 삭제 아이콘(×) + 태그 수정 아이콘(✎) 노출
- 용량 바 상단 노출, 80% 초과 시 빨강
- 태그 필터: 업로드된 태그 목록을 드롭다운으로 제공, 선택 시 해당 태그만 필터링

### 6.2 카드뉴스 통합

```
[카드뉴스 생성 페이지]
 ↓ 텍스트 입력 → "생성" 클릭
 ↓ AI 생성 완료, 카드 미리보기 그리드
[각 카드 우하단에 📷 아이콘]
 ↓ 클릭
[이미지 선택 모달]
 ├ 탭: "내 이미지" / "새로 업로드"
 ├ 상단 드롭다운: 사용 방식 [배경 / 콘텐츠 / 표지]
 ├ 썸네일 그리드 (내 이미지 탭)
 ├ 선택 → 크롭 에디터 자동 실행
 └ 크롭 완료 → 해당 카드에 적용
```

**사용 방식 3종:**
- **배경:** 카드 전체 배경에 `object-fit: cover`, 텍스트 가독성 위해 자동 overlay(rgba 0,0,0,0.4)
- **콘텐츠:** 기존 Content 레이아웃 C 계열의 이미지 영역에 삽입, 텍스트는 그대로
- **표지:** 카드 전체를 사용자 이미지로 교체, 텍스트 오버레이만 유지

### 6.3 ImagePickerModal 컴포넌트

**위치:** `components/ImagePickerModal.js` (전 도구에서 재사용)

**Props:**
```js
<ImagePickerModal
  open={boolean}
  onClose={() => void}
  onSelect={(image, cropData, mode) => void}
  showModeSelector={true}           // 배경/콘텐츠/표지 선택 드롭다운
  modeOptions={['background', 'content', 'cover']}
  aspectRatio={4/5}                 // 크롭 대상 비율
/>
```

**내부 구조:**
- 상단: 탭(내 이미지 / 새로 업로드) + 모드 드롭다운
- 중앙: 그리드 또는 업로드 dropzone
- 선택 시: `react-easy-crop`로 크롭 에디터 오버레이
- 하단: [취소] [적용]

---

## 7. 크롭 에디터

### 7.1 라이브러리 결정
**`react-easy-crop`** 사용. 이유:
- Next.js 호환 확인됨
- 번들 크기 작음 (~20KB)
- 드래그/줌/회전 기본 지원
- Next.js 13+ App Router와 호환

### 7.2 크롭 결과 처리
- 클라이언트에서 크롭 좌표(px 단위)만 계산
- 서버(카드뉴스 렌더링)에 `{ x, y, width, height }` 전달
- Satori가 CSS `object-position` + `object-fit: none` + `transform: scale()`로 크롭 반영
- **이유:** 이미지 자체를 잘라 새로 R2에 저장하지 않음 → 원본 재사용성 보존

---

## 8. 카드뉴스 서버 통합 (`api/card-news`)

### 8.1 요청 payload 확장

```json
{
  "text": "...",
  "theme": "sage",
  "variant": { ... },
  "userImages": [
    {
      "cardIndex": 0,
      "mode": "cover",
      "url": "https://cdn.ddukddaktool.co.kr/...",
      "crop": { "x": 0, "y": 120, "width": 1080, "height": 1350 }
    }
  ]
}
```

### 8.2 Satori 렌더링 분기

- `userImages` 배열을 순회해 해당 `cardIndex` 카드에 사용자 이미지 노드 삽입
- `mode === "background"`: 최하단 레이어 `<img>` + 검정 반투명 overlay
- `mode === "content"`: Content C 레이아웃의 이미지 슬롯을 사용자 이미지로 치환
- `mode === "cover"`: 카드 전체를 사용자 이미지로 채우고 기존 텍스트 오버레이 유지

### 8.3 소유권 검증
- 서버에서 `userImages[].url` 중 `cdn.ddukddaktool.co.kr/user-images/...` 경로인 것은 DB 조회로 **요청자 소유 확인**
- 타인의 R2 URL을 넣어 렌더링 시도하는 공격 차단

---

## 9. 구현 순서 (Phase)

### Phase A — 보관함 백엔드
1. Neon DB 마이그레이션: `user_images` 테이블 + 인덱스
2. R2 헬퍼 확장: sharp 기반 썸네일 생성 + EXIF 제거 + `email_hash` 경로
3. API 4종 구현
4. 용량 체크 로직 (유료/무료 판정)

### Phase B — 보관함 UI
5. `app/mypage/` 안 "내 이미지" 섹션 추가
6. 썸네일 그리드 + 업로드 dropzone + 용량 바
7. 호버 시 삭제/태그 수정
8. 태그 필터 드롭다운

### Phase C — 공용 이미지 선택 모달
9. `components/ImagePickerModal.js` 신설
10. `react-easy-crop` 통합, 크롭 에디터 구현
11. 탭 전환, 모드 드롭다운, 업로드 dropzone

### Phase D — 카드뉴스 통합
12. `CardNewsClient.js` — 카드 우하단 📷 아이콘 추가
13. 모달 연결, 적용 후 state 반영
14. `api/card-news` payload에 `userImages[]` 수용
15. Satori 렌더러에 사용자 이미지 분기 추가
16. 서버 측 소유권 검증

### Phase E — 숏폼/블로그 확장 (이번 범위 밖)
- `<ImagePickerModal />` 재사용, 📷 아이콘만 각 도구에 붙임
- 별도 스프린트에서 진행

---

## 10. 예상 작업량

| Phase | 내용 | 예상 LoC |
|-------|------|----------|
| A | 테이블 + API 4종 + R2 확장 | ~500 |
| B | 마이페이지 UI + 태그 필터 | ~300 |
| C | ImagePickerModal + 크롭 | ~300 |
| D | 카드뉴스 통합 + Satori 분기 | ~200 |
| **합계** | | **~1,300 LoC** |

**의존성 추가:**
- `sharp` (서버 사이드 이미지 처리, Vercel에서 지원)
- `react-easy-crop` (클라이언트 크롭)

---

## 11. YAGNI 제외 목록 (명시적으로 안 할 것)

- ❌ 이미지 정렬/검색 기능 (태그 필터만)
- ❌ 폴더/앨범 구조
- ❌ 다중 선택 후 일괄 삭제/태그
- ❌ 이미지 편집(필터·밝기·대비 등)
- ❌ AI 기반 태그 자동 분류
- ❌ 공유 링크 / 타인 공개 기능
- ❌ 숏폼/블로그 도구 통합 (Phase E, 차기)
- ❌ Presigned URL 업로드
- ❌ 이미지 버전 히스토리

---

## 12. 리스크 및 완화

| 리스크 | 영향 | 완화책 |
|--------|------|--------|
| sharp Vercel 빌드 실패 | 배포 불가 | Vercel 공식 지원 확인됨, 배포 전 스테이징 테스트 |
| 5MB 이상 파일 업로드 시도 | UX 혼란 | 클라이언트에서 선제 검증 + 서버 이중 검증 |
| 크롭 결과가 Satori에서 깨짐 | 카드 품질 저하 | Phase D에서 Satori 렌더링 샘플 10건 수동 검수 |
| R2 공개 URL로 남의 이미지 추측 | 프라이버시 | `email_hash` + 서버 소유권 검증 |
| 용량 초과 경고 무시 | 업로드 실패 | UI에서 80% 넘으면 빨강, 100% 업로드 버튼 비활성화 |

---

## 13. 성공 기준

- [ ] 마이페이지에서 사진 업로드 → 썸네일 그리드 표시 → 삭제까지 동작
- [ ] 카드뉴스 생성 후 내 사진을 배경/콘텐츠/표지 3가지 모드로 적용 가능
- [ ] 크롭 에디터로 구도 조정 후 Satori 렌더링에 정확히 반영
- [ ] 유료/무료 용량 분기 정상 작동 (50MB / 500MB)
- [ ] EXIF 위치 정보가 업로드된 파일에서 제거됨 (exiftool로 검증)
- [ ] 타인의 R2 URL을 payload에 넣어도 서버가 거부

---

## 14. 다음 단계

이 설계가 승인되면 `writing-plans` 스킬을 통해 Phase A~D를 TDD 기반의 상세 구현 계획으로 전개한다.
