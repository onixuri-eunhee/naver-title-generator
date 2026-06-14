# 숏폼 트랙 B(실사+클론음성) 통합 설계서

작성일 2026-06-14 · 대상 저장소 `naver-title-generator` + `MoneyPrinterTurbo`(MPT) + 스킬 `shortform-production`

---

## 0. 한 줄 요약

기존 숏폼 렌더는 **job/콜백 계약**으로 렌더러와 소비자(웹·DB)가 분리돼 있다.
트랙 B(MPT 기반 Python 렌더러)를 **이 계약을 똑같이 구현하는 두 번째 렌더 백엔드**로 붙이면,
콜백·진행률·DB·화면 코드는 **하나도 안 바꾸고** 영상 품질만 갈아끼울 수 있다.
충돌 위험의 99%는 "계약을 안 지킬 때" 생긴다 → 이 문서는 그 계약을 고정한다.

**대상(2026-06-15 확정):** 사장님 본인 숏폼이 아니라 **고객용 제품 숏폼**이다.
고객이 영상·목소리를 올리면 실사+클론(고급), 안 올리면 스톡+기본TTS(중간). 공개는 점진적으로.

---

## 1. 목적과 범위

> **전제(2026-06-15 사장님 확정):** 사장님 **본인** 숏폼은 제품을 거치지 않고
> 스킬(`shortform-production`) + 조조팀으로 직접 제작한다. 이 문서의 통합 대상은
> **오직 고객용 제품 숏폼**이다. 사장님 개인 클립·클론음성은 제품에 넣지 않는다.

### 목표 — 고객용 숏폼 품질 업그레이드 (전체 고객 대상)
- 제품 숏폼 렌더를 트랙 B(실사/스톡 클립 + 음성) 엔진으로 전환. **대상은 전체 고객.**
- 품질은 고객의 입력에 따라 갈린다(하이브리드):
  - 고객이 **자기 영상·목소리를 올리면** → 실사 클립 + 클론 음성(고급).
  - **안 올리면** → 스톡 영상(공용 영상 라이브러리) + 기본 TTS(중간). 정지 이미지보다는 낫다.
- **공개는 점진적으로**(소수 베타 고객 → 전체). 대상이 전체라고 한 번에 켜지 않는다(§8-bis).

### 핵심 차이 (초기 설계 대비)
- "사장님 계정 전용 1단계"는 **폐기**. 사장님은 제품을 안 거치므로 불필요.
- "사장님 클립을 렌더 서비스에 동봉" **폐기**. 개인 영상이라 고객에 부적합. **고객은 각자 자기 자산.**
- 따라서 처음부터 **고객용 기능**을 만든다: ①고객 영상·목소리 업로드함 ②미업로드 시 스톡 폴백
  ③트랙 B 렌더 엔진. (초기 설계의 "2단계"가 사실상 전체 목표가 됨.)

### 현실 메모 (품질 기대치)
- 진짜 큰 품질 점프는 **고객이 자기 영상을 올릴 때** 발생. 미업로드 고객은 스톡이라 향상 폭이 작다.
- 따라서 "영상 올리면 훨씬 좋아진다"는 **업로드 유도 UX**가 품질만큼 중요한 제품 과제다.

---

## 2. 핵심 설계 원칙

1. **계약 재사용, 재작성 금지.** 트랙 B는 기존 `/render` 요청 계약을 받고, 기존
   `/api/shortform-render-callback` 콜백 계약을 똑같이 호출한다. 소비자 코드 불변.
2. **백엔드는 라우팅으로 고른다.** `/api/shortform-render` 한 곳에서 사용자·플래그를
   보고 트랙 A 또는 B URL로 보낸다. 분기 로직은 이 한 파일에만 존재.
3. **트랙 A를 절대 깨지 않는다.** 트랙 B가 죽어도 트랙 A는 정상. 플래그 off면 전부 트랙 A.
4. **DB 스키마 변경 0.** 기존 `shortform_projects.video_r2_key` 등 그대로 사용.
5. **R2 키·jobId 체계 동일.** 충돌 없이 같은 저장 경로 사용(`shortform/{outputFilename}.mp4`).

---

## 3. 현재 구조 (트랙 A) — 통합 기준점

```
[클라이언트]                              [Vercel]                         [Railway 렌더 서비스(Node)]
ShortformClient.handleRender()
  └ POST /api/shortform-render ───────▶ app/api/shortform-render/route.js
        {jobId,parentJobId,inputProps}     ├ Redis 진행이벤트 publish(0%)
                                           └ POST $RAILWAY_RENDER_URL/render ──▶ services/server.mjs /render
                                              header x-render-secret               ├ runRenderJob()
                                              body {jobId,parentJobId,             │   ├ Remotion 렌더 → /tmp/*.mp4
                                                    userId,inputProps,             │   ├ R2 업로드 shortform/{outputFilename}.mp4
                                                    outputFilename:                │   └ 콜백 ──┐
                                                    'shortform-{jobId}'}           │           │
                                           ◀──────────────────────────────────────┼───────────┘
                                  POST /api/shortform-render-callback              progress/complete/error
[클라이언트]                       app/api/shortform-render-callback/route.js
  GET /api/shortform-progress  ◀── publishProgress → Redis job:history:{jobId}
  (SSE, useJobProgress 훅)
```

### 고정 계약 (트랙 B가 반드시 똑같이 지켜야 하는 것)

**(A) 요청: Vercel → 렌더 서비스 `POST /render`**
- 헤더: `x-render-secret: <RENDER_SECRET>` (timing-safe 비교)
- 바디: `{ jobId, parentJobId, userId, inputProps, outputFilename }`
- 응답: 즉시 `202` (fire-and-forget). 비202면 Vercel이 error 이벤트 publish + 502.
- 출처: `app/api/shortform-render/route.js:79-92`, `services/server.mjs:195-228`

**(B) 콜백: 렌더 서비스 → Vercel `POST /api/shortform-render-callback`**
- 헤더: `x-render-secret: <RENDER_SECRET>`
- 바디 3종(타입별 필수 필드 — 어기면 콜백 핸들러가 400으로 거부):
  - `{ type:'progress', jobId, progress }` — 검증은 `progress`가 **숫자**인지만 강제.
    0~1 범위는 트랙 A(Remotion) 관례이므로 트랙 B도 0~1로 보내야 진행바가 맞다(강제는 아님).
  - `{ type:'complete', jobId, url, durationSec, elapsedMs }` — url(문자열)·durationSec(숫자)·elapsedMs(숫자) 필수.
  - `{ type:'error', jobId, errorCode, errorMessage }` — errorCode(문자열) 필수, errorMessage는 로그용(선택).
- 시크릿 불일치/누락 → **401**. 콜백 핸들러는 이미 종료(complete/error)된 job은 무시(dedup).
- 출처: `lib/shortform/render-callback-handler.js`. **계약은 유닛테스트로 고정돼 있음**
  — `tests/unit/render-callback.test.js`(401·400·dedup·progress 중복허용),
  `tests/unit/render-request.test.js`(요청 바디 shape).

**(C) 산출물: R2**
- 키: `shortform/{outputFilename}.mp4` (= `shortform/shortform-{jobId}.mp4`)
- complete 콜백의 `url`은 R2 공개 CDN URL.
- 출처: `services/server.mjs:114,152`

이 3개(A·B·C)만 지키면 트랙 B는 트랙 A의 자리에 그대로 들어간다.

---

## 4. 신규 구성요소 — 트랙 B 렌더 서비스

### 4.1 런타임 결정: **별도 Railway Python 서비스**
- MPT는 Python 3.11~3.12 + moviepy + ffmpeg, 레포 2.5GB. Vercel 서버리스에 부적합
  (용량·콜드스타트·렌더 수분 소요).
- 기존 Node 렌더 서비스(`services/server.mjs`)와 **별개 서비스**로 띄운다.
  같은 패턴(HTTP 받고 콜백 쏘기), 다른 런타임.
- 신규 파일(MPT 레포 안): `MoneyPrinterTurbo/server_trackb.py` (FastAPI/uvicorn 얇은 래퍼).

### 4.2 트랙 B 서비스가 하는 일
```
POST /render (x-render-secret 검증)
  202 즉시 반환
  백그라운드:
    1. inputProps → scenes JSON 변환 수신 (4.3 참조)
    2. make_short.py 파이프라인 호출 (이미 존재):
       - 음성 합성(with-timestamps) — 고객 클론음성 있으면 그것, 없으면 기본 TTS
       - 자막 세그먼트·씬 경계 정렬
       - 클립 확보 고객업로드→stock→폴백
       - ffmpeg 컷+concat+자막번인+1.12배속
       - 출력 /tmp/{outputFilename}.mp4
    3. R2 업로드 shortform/{outputFilename}.mp4  (트랙 A와 동일 키·동일 R2 자격증명)
    4. 콜백 POST /api/shortform-render-callback
       진행 중: {type:'progress', jobId, progress:0~1}  ← MPT 단계 진행률을 0~1로 매핑
       완료:    {type:'complete', jobId, url, durationSec, elapsedMs}
       실패:    {type:'error', jobId, errorCode, errorMessage}
GET /health → {status:'ok'}
```
- **핵심**: make_short.py의 렌더 로직은 그대로 재사용. 서비스는 "HTTP↔make_short" 어댑터일 뿐.
- 음성은 트랙 B가 **자체 생성**. 고객이 음성 클론을 등록했으면 그 voiceId, 아니면 기본 TTS.
  트랙 A처럼 inputProps에 음성을 미리 넣지 않는다.

### 4.3 데이터 변환: script-payload → MPT scenes JSON
기존 대본 산출물(`lib/shortform/script-payload.js`)의 `scenes[]`는 이미 `script`·`section`을
갖고 있어 변환이 작다. **추가로 필요한 건 `clip` 매칭 한 가지.**

| MPT scenes 필드 | 출처 | 비고 |
|---|---|---|
| `script` | scenes[].script | 그대로 |
| `section` | scenes[].section (hook/point/cta) | 그대로 |
| `clip.source` / `clip.local` / `clip.query` | **신규 매칭 단계** | 고객 업로드 클립 우선, 없으면 스톡 |

- 변환 위치(확정): **트랙 B 서비스 내부**에서 변환 — Vercel은 기존 inputProps + 고객 자산
  참조(클립 R2 경로·voiceId)만 보내고, 서비스가 scenes로 풀어 clip 매칭. Vercel 코드 변경 최소.
- clip 매칭 규칙: **고객 업로드 클립 > 스톡(pixabay/pexels) > 폴백**.
  자동 매칭(섹션·키워드) 후, 화면에서 **고객이 틀린 클립만 교체**(자동+수동 보정 — §9 결정).

### 4.4 고객 자산 전략 (영상·음성)
**핵심 전환**: 사장님 개인 클립을 동봉하지 않는다. **각 고객이 자기 자산을 쓴다.**

- **영상 클립**: 고객이 업로드 → R2 `user-clips/{emailHash}/`에 저장 → 렌더 시 다운로드.
  기존 `lib/user-images.js`(이미지 보관함)·SSRF 가드(`assertAllowedImageUrl`)·쿼터(`user-quota.js`)
  패턴을 **영상으로 확장**. 미업로드 고객은 이 단계 건너뛰고 스톡으로.
- **음성**: (선택) 고객 음성 클론 등록 — 일레븐랩스 voice 생성 + 동의·샘플 업로드 온보딩.
  미등록 고객은 기본 TTS. 클론은 친절도 높은 기능이라 후순위 가능(스톡+기본TTS로 먼저 출시 OK).
- **신규 제품 과제(이 범위에 포함)**: 업로드함 UI, 용량·결제 연동, 업로드 유도 UX, (선택)음성클론 온보딩.

---

## 5. 백엔드 선택 로직 (Vercel `/api/shortform-render`)

분기 코드는 **이 파일 한 곳에만** 둔다. 의사코드:

```js
// app/api/shortform-render/route.js (분기 추가)
import { resolveRenderBackend } from '@/lib/shortform/render-backend';

const backend = resolveRenderBackend(email);   // 'A' | 'B'
const RENDER_URL = backend === 'B'
  ? process.env.TRACKB_RENDER_URL
  : process.env.RAILWAY_RENDER_URL;
// 이후 POST $RENDER_URL/render — 바디·헤더·계약 100% 동일
```

```js
// lib/shortform/render-backend.js (신규, 단일 진실원천)
// 점진 공개: allowlist(베타 코호트) → 비율 롤아웃 → 전체.
export function resolveRenderBackend(email) {
  if (process.env.TRACKB_ENABLED !== 'true') return 'A';
  if (!process.env.TRACKB_RENDER_URL) return 'A';        // 미설정 시 안전 폴백

  // 1) 베타 코호트 명시 허용
  const allow = (process.env.TRACKB_ALLOWED_EMAILS || '')
    .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  if (allow.includes((email || '').toLowerCase())) return 'B';

  // 2) 비율 롤아웃(0~100). 이메일 해시 기반 안정적 분배(같은 고객은 항상 같은 트랙)
  const pct = Number(process.env.TRACKB_ROLLOUT_PCT || 0);
  if (pct > 0 && email) {
    const bucket = hashToBucket(email);   // 0~99 결정적
    if (bucket < pct) return 'B';
  }
  return 'A';
}
```

- 플래그 off / URL 미설정 / 코호트·비율 밖 → **무조건 트랙 A**. 안전 기본값.
- 공개 순서: allowlist(소수 베타 고객) → `TRACKB_ROLLOUT_PCT` 10→30→100 단계 상향 → 전체.
- 비율은 **이메일 해시**로 안정 분배 — 같은 고객이 새로고침마다 트랙이 바뀌지 않음.

> ⚠️ **주의(검증됨)**: `RAILWAY_RENDER_URL`은 숏폼뿐 아니라 **카드뉴스도 공유**한다
> (`app/api/card-news/route.js:1038`, 엔드포인트 `/render-cardnews`). 따라서 분기는 반드시
> **`app/api/shortform-render/route.js` 안에서만** `TRACKB_RENDER_URL`로 바꾼다.
> 카드뉴스는 손대지 않으므로 영향 0. `RAILWAY_RENDER_URL` 자체를 바꾸면 카드뉴스까지 깨진다 — 금지.

---

## 6. 충돌·오류 방지 체크리스트 (대표님 우려 지점)

| 위험 | 원인 | 방지책 | 검증 |
|---|---|---|---|
| 콜백 거부 | 트랙 B가 콜백 바디 모양을 다르게 보냄 | §3(B) 계약 고정. `render-callback-handler.js` 테스트로 모양 유지 | 기존 콜백 핸들러 유닛테스트가 양 트랙 페이로드 검증 |
| R2 키 충돌 | 두 트랙이 같은 파일에 씀 | jobId 유니크 → `shortform/shortform-{jobId}.mp4` 고유. 키 체계 동일 유지 | jobId UUID 확인 |
| 트랙 A 회귀 | 분기 코드가 A 경로 변경 | 분기는 URL 선택만, 바디·헤더 불변. 플래그 off=완전 동일 | off 상태에서 기존 동작 동일 회귀 테스트 |
| 진행률 깨짐 | ffmpeg 진행률이 프레임 기반 아님 | MPT 단계(음성20%·자막30%·클립50%·합성80%·배속100%)를 0~1로 매핑 | progress 0~1 범위 단조증가 확인 |
| 음성 이중생성 | 트랙 B가 inputProps 음성+자체음성 둘 다 | 트랙 B는 inputProps 음성 무시, scenes로만 합성 | 변환 단계에서 음성필드 미사용 |
| 시크릿 누출/위조 | 콜백 위조 | 기존 `x-render-secret` timing-safe 비교 그대로. 트랙 B도 동일 시크릿 | 잘못된 시크릿 콜백 401 확인 |
| 서비스 다운 | 트랙 B Railway 죽음 | `/render` 비202 시 Vercel이 error 이벤트 publish(기존 로직). 사용자에 명확 실패 | 트랙 B 정지 상태 테스트 |
| 타임아웃 | 실사 렌더가 김 | 트랙 B도 자체 타임아웃 + error 콜백. Vercel `maxDuration` 무관(fire-and-forget) | 장시간 렌더 error 콜백 확인 |
| 금지어 누출 | 대본 검증 우회 | make_short.py 검증 게이트(BANNED_ROOTS 어근 2종) 유지. 변환 후에도 재검증 | validate_scenes 통과 확인 |
| 크레딧 불일치 | 향후 과금 시 트랙별 차감 다름 | **현재 차감 0**. 과금 도입 시 트랙 무관 동일 차감 — 별도 PR 명시 | (1단계 범위 밖, 메모만) |

---

## 7. 환경변수 (신규)

트랙 A 변수와 **분리**해서 관리:

```bash
# Vercel
TRACKB_ENABLED=false                 # 기본 off. true여야 트랙 B 활성
TRACKB_RENDER_URL=                   # 트랙 B Railway 서비스 URL (미설정=트랙 A 폴백)
TRACKB_ALLOWED_EMAILS=               # 베타 코호트(콤마구분). 초기 소수 고객
TRACKB_ROLLOUT_PCT=0                 # 비율 롤아웃 0~100. 이메일 해시 안정 분배

# 트랙 B Railway 서비스 (기존 R2·RENDER_SECRET 재사용 + 일레븐랩스)
RENDER_SECRET=                       # 트랙 A와 동일 값
WEBHOOK_BASE_URL=                    # https://ddukddaktool.co.kr (콜백 라우팅)
R2_*                                 # 트랙 A와 동일 자격증명·버킷
ELEVENLABS_API_KEY=                  # 고객 음성 클론(선택 기능)
ELEVENLABS_MODEL_ID=eleven_multilingual_v2
# 고객 voiceId는 고정 env가 아니라 고객별 DB/요청값으로 전달 (미등록 시 기본 TTS)
```

---

## 8. 단계별 실행 계획 (고객용)

> 대상은 전체 고객이지만 **공개는 점진**(§8-bis). 아래는 만들기 순서.

**그룹 1 — 렌더 엔진(스톡 모드 먼저, 가장 빠른 가치)**
| # | 작업 | 산출물 | 의존 |
|---|---|---|---|
| 1 | 트랙 B HTTP 래퍼 | `MoneyPrinterTurbo/server_trackb.py` (FastAPI, /render·/health) | make_short.py |
| 2 | inputProps→scenes 변환 + clip 매칭(스톡 우선) | 래퍼 안 변환 함수 | §4.3 |
| 3 | 콜백 클라이언트(progress/complete/error) | 래퍼 안 (`webhook-client.mjs` 동등) | §3(B) |
| 4 | R2 업로드(동일 키) | 래퍼 안 (boto3 등) | §3(C) |
| 5 | 트랙 B Railway 배포 (Python Docker) | 새 Railway 서비스 | 1~4 |
| 6 | Vercel 분기 추가 | `lib/shortform/render-backend.js` + `/api/shortform-render` | §5 |
| 7 | 환경변수 (off→베타 코호트 on) | Vercel·Railway env | §7 |
| 8 | 베타 고객 E2E + 검수 | 완성 mp4 | 사장님 시청 게이트 |

**그룹 2 — 고객 자산(품질 점프, 그룹 1 검증 후)**
| # | 작업 | 산출물 | 의존 |
|---|---|---|---|
| 9 | 고객 영상 업로드함 | R2 `user-clips/{emailHash}/` + UI + 쿼터·SSRF 가드 확장 | `lib/user-images.js` 패턴 |
| 10 | scenes 변환에 고객 클립 우선 매칭 | 래퍼 변환 함수 확장 | 9 |
| 11 | (선택) 고객 음성 클론 온보딩 | 일레븐랩스 voice 생성 + 동의·voiceId 저장 | 9 |
| 12 | 업로드 유도 UX("올리면 훨씬 좋아져요") | 화면 안내 | 9 |

롤백: `TRACKB_ENABLED=false` 한 줄. 즉시 전부 트랙 A로 복귀.

---

## 8-bis. 안전 이행 절차 (Expand–Migrate–Contract)

> 목표: **옛것(트랙 A)을 지우는 일과 새것(트랙 B)을 넣는 일을 절대 같은 단계에 두지 않는다.**
> 동시에 하면 충돌이 난다(이 저장소의 과거 사고 — 크레딧 계산 2벌·가격표 3곳 — 가 정확히 이 원인이었다).
> 아래 절차의 핵심 주장은 모두 현재 코드로 교차검증된 것만 담았다.

### 절차 (5단계 — 각 단계 되돌리기 가능)

**1단계 · 경계(계약) 고정 — 이미 충족됨(검증).**
바꾸는 것은 렌더러 내부, 안 바뀌는 것은 계약(§3 A·B·C). 이 계약은 이미 유닛테스트로 잠겨 있다
(`tests/unit/render-callback.test.js`, `tests/unit/render-request.test.js`). 트랙 B는 이 **같은 그린
테스트**를 통과하는 페이로드만 보내면 된다. 새 계약을 만들지 않는다.

**2단계 · 새것을 옆에 세운다 (더하기만, 빼기 없음).**
트랙 B를 `TRACKB_ENABLED` 플래그 뒤에 추가. 이 단계에서 트랙 A 코드·`services/server.mjs`·콜백
핸들러는 **한 줄도 지우지 않는다**. 플래그 off면 동작이 현재와 100% 동일.
- 검증 게이트: `npm test`(현재 329개) 전부 통과 + `next build` 성공 + off 상태 회귀 동일.

**3단계 · 좁게 흘려보고 검증 (카나리).**
`TRACKB_ALLOWED_EMAILS`에 **소수 베타 고객(또는 사장님 테스트 계정)만**. 같은 대본을 트랙 A·B
양쪽으로 렌더해 비교 + **사장님 1배속 풀시청 게이트**(영상 자가검증 금지룰).
문제 시 `TRACKB_ENABLED=false` 한 줄로 즉시 복귀.

**4단계 · 점진 전환.**
검증되면 `TRACKB_ROLLOUT_PCT`를 천천히 올린다(베타 → 10% → 30% → 100%). 한 번에 전체 전환 금지.
각 확대마다 게이트 반복. 비율은 이메일 해시 안정 분배라 켰다 줄여도 같은 고객은 같은 트랙.

**5단계 · 옛것을 별도 정리 커밋으로 수축(삭제).**
트랙 B가 트래픽을 충분히 받은 뒤에야 트랙 A(불필요해진 Remotion 경로·코드)를 **독립된 커밋**으로 삭제.
한 커밋에 한 가지만 → 회귀 시 그 커밋만 되돌려 원인을 바로 찾는다.
- 단, 트랙 A를 전부 지울지 "폴백으로 남길지"는 4단계 결과를 보고 결정(트랙 B 실패 시 자동 폴백 가치).

### 모든 단계 공통 안전장치 (검증된 패턴)

1. **단일 스위치.** 숏폼 렌더 디스패치는 `app/api/shortform-render/route.js:79`의 한 지점뿐(검증).
   옛↔새 선택은 여기서만. 분기를 여러 파일에 흩뿌리지 않는다.
2. **한 커밋 = 한 변경 = 되돌리기 가능.** 큰 덩어리 커밋 금지.
3. **구현이 아니라 계약을 테스트.** 위 계약 테스트가 렌더러 교체와 무관하게 페이로드 모양을 지킨다.
4. **단계마다 게이트.** 테스트 통과 + 빌드 성공 + (전환 단계) 사장님 실시청. 통과 못 하면 다음 단계 금지.

### "이행 후 수축" 원칙 — 이 저장소의 검증된 선례
크레딧 통일 때 쓴 방식이 바로 이 패턴이다(이번 세션에서 적용·검증):
옛 함수(`lib/db.js::chargeCredits`/`refundCredits`)를 **삭제하지 않고** 새 단일 경로
(`lib/credit-service.js`)를 호출하는 **호환 래퍼로 전환** → 모든 호출부가 한 경로를 지나게 만든 뒤
→ 검증 → (옛 직접 구현은 나중에 정리). 트랙 B도 동일하게: 먼저 새 경로로 트래픽을 모으고, 마지막에 옛것을 뗀다.

---

## 9. 결정 사항 (2026-06-15 사장님 확정)

| # | 항목 | 결정 |
|---|---|---|
| D1 | 적용 대상 | **전체 고객**. 사장님 본인 숏폼은 제품 밖(스킬+조조팀 직접 제작). |
| D2 | 고객 영상 소스 | **하이브리드** — 올리면 실사 고급, 안 올리면 스톡+기본TTS. |
| D3 | 공개 방식 | 대상은 전체, **공개는 점진**(베타 코호트 → 비율 롤아웃 → 100%). |
| D4 | 서비스 호스팅 | 기존 Railway 프로젝트에 **서비스 추가**(같은 건물·다른 방). 관리·비용 한곳. |
| D5 | 변환 위치 | **트랙 B 서비스 내부**. Vercel은 inputProps + 고객자산 참조만 전달. |
| D6 | clip 매칭 | **자동 매칭 + 고객 수동 보정**(틀린 클립만 교체). |
| D7 | 페이지 재오픈 | 트랙 B(스톡 모드) 검증 완료 후 `SHORTFORM_PAGE_ENABLED`·`TRACKB` **함께** 켬. |

### 남은 미결(그룹 2 착수 전 결정)
- 음성 클론을 **언제** 붙일지 — 스톡+기본TTS로 먼저 출시하고 후속? (권장: 후속)
- 고객 영상 업로드 **용량·결제** 정책 — 기존 이미지 쿼터(`user-quota.js`) 기준 재사용 vs 영상 별도.
- 스톡 영상 **소스·라이선스** — pixabay/pexels 무료 라이선스 범위·상업적 사용 확인.

---

## 10. 참조 (정확한 좌표)

- 분기 추가 지점: `app/api/shortform-render/route.js:79-92`
- 콜백 계약 고정: `lib/shortform/render-callback-handler.js:35-96`
- R2 키 체계: `services/server.mjs:114,152`
- 대본 scenes 산출: `lib/shortform/script-payload.js:204-219`, `lib/shortform/prompt.js:236-256`
- 기존 Node 렌더 서비스(패턴 참고): `services/server.mjs`, `services/webhook-client.mjs`
- 트랙 B 렌더러: `~/Documents/MoneyPrinterTurbo/make_short.py`
- 트랙 B 스킬: `~/.claude/skills/shortform-production/SKILL.md`
- 숏폼 비공개 플래그: `lib/feature-flags.js`
