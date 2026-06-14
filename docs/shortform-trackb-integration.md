# 숏폼 트랙 B(실사+클론음성) 통합 설계서

작성일 2026-06-14 · 대상 저장소 `naver-title-generator` + `MoneyPrinterTurbo`(MPT) + 스킬 `shortform-production`

---

## 0. 한 줄 요약

기존 숏폼 렌더는 **job/콜백 계약**으로 렌더러와 소비자(웹·DB)가 분리돼 있다.
트랙 B(MPT 기반 Python 렌더러)를 **이 계약을 똑같이 구현하는 두 번째 렌더 백엔드**로 붙이면,
콜백·진행률·DB·화면 코드는 **하나도 안 바꾸고** 영상 품질만 갈아끼울 수 있다.
충돌 위험의 99%는 "계약을 안 지킬 때" 생긴다 → 이 문서는 그 계약을 고정한다.

---

## 1. 목적과 범위

### 1단계 (이 문서의 실행 대상 — 사장님 계정 전용)
- 사장님 계정으로 숏폼 렌더 시 트랙 B(실사 클립 + 일레븐랩스 클론 음성)로 렌더.
- 다른 사용자는 기존 트랙 A(Remotion 이미지+클라우드 음성) 그대로 → **영향 0**.
- local_clips·클론음성이 이미 사장님 자산으로 존재 → 신규 사용자 기능 없이 즉시 품질 향상.

### 2단계 (별도 기획 — 제품화, 이 문서 범위 밖)
- 사용자별 영상 클립 업로드함, 스톡 폴백, (선택) 사용자 음성 클론, 결제 연동.
- 1단계 계약을 그대로 확장하므로 1단계 설계가 2단계의 토대가 된다.

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
       - 일레븐랩스 클론음성 합성(with-timestamps)
       - 자막 세그먼트·씬 경계 정렬
       - 클립 확보 local→stock→폴백
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
- 음성은 트랙 B가 **자체 생성**(클론 보이스). 트랙 A처럼 inputProps에 음성을 미리 넣지 않는다.

### 4.3 데이터 변환: script-payload → MPT scenes JSON
기존 대본 산출물(`lib/shortform/script-payload.js`)의 `scenes[]`는 이미 `script`·`section`을
갖고 있어 변환이 작다. **추가로 필요한 건 `clip` 매칭 한 가지.**

| MPT scenes 필드 | 출처 | 비고 |
|---|---|---|
| `script` | scenes[].script | 그대로 |
| `section` | scenes[].section (hook/point/cta) | 그대로 |
| `clip.source` / `clip.local` / `clip.query` | **신규 매칭 단계** | 1단계는 트랙 B 서비스 안에서 결정 |

- 변환 위치(택1):
  - **(권장) 트랙 B 서비스 내부**에서 변환 — Vercel은 기존 inputProps만 보내고, 서비스가
    scenes로 풀어 clip 매칭. Vercel 코드 변경 최소.
  - 또는 Vercel `/api/shortform-render`에서 변환 후 scenes로 전송 — 분기 코드가 커짐. 비권장.
- clip 매칭 1단계 규칙: 스킬 `shortform-production`의 우선순위 그대로
  `local(실사) > stock(pixabay) > 폴백`. 사장님 local_clips를 섹션·키워드로 매칭.

### 4.4 자산(local_clips) 전략
- **1단계**: 사장님 10종 클립을 트랙 B 서비스에 **동봉**(Railway 볼륨 또는 이미지에 포함).
  사장님 1인 사용이라 이 방식으로 충분.
- **2단계**: 사용자별 클립을 R2(`user-clips/{emailHash}/`)에 업로드 → 렌더 시 다운로드.
  기존 `lib/user-images.js`(이미지 보관함) 패턴을 영상으로 확장.

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
export function resolveRenderBackend(email) {
  if (process.env.TRACKB_ENABLED !== 'true') return 'A';
  if (!process.env.TRACKB_RENDER_URL) return 'A';        // 미설정 시 안전 폴백
  const allow = (process.env.TRACKB_ALLOWED_EMAILS || '')
    .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  return allow.includes((email || '').toLowerCase()) ? 'B' : 'A';
}
```

- 플래그 off / URL 미설정 / allowlist 밖 → **무조건 트랙 A**. 안전 기본값.
- 1단계 allowlist = 사장님 이메일 1개.

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
TRACKB_ALLOWED_EMAILS=               # 트랙 B 허용 이메일(콤마구분). 1단계=사장님 1개

# 트랙 B Railway 서비스 (기존 R2·RENDER_SECRET 재사용 + 일레븐랩스)
RENDER_SECRET=                       # 트랙 A와 동일 값
WEBHOOK_BASE_URL=                    # https://ddukddaktool.co.kr (콜백 라우팅)
R2_*                                 # 트랙 A와 동일 자격증명·버킷
ELEVENLABS_API_KEY=                  # 클론 음성
ELEVENLABS_VOICE_ID=                 # 사장님 클론 보이스 ID
ELEVENLABS_MODEL_ID=eleven_multilingual_v2
```

---

## 8. 단계별 실행 계획 (1단계)

| # | 작업 | 산출물 | 의존 |
|---|---|---|---|
| 1 | 트랙 B HTTP 래퍼 작성 | `MoneyPrinterTurbo/server_trackb.py` (FastAPI, /render·/health) | make_short.py |
| 2 | inputProps→scenes 변환 + clip 매칭 | 래퍼 안 변환 함수 | §4.3 |
| 3 | 콜백 클라이언트(progress/complete/error) | 래퍼 안 (트랙 A `webhook-client.mjs` 동등 로직) | §3(B) |
| 4 | R2 업로드(동일 키) | 래퍼 안 (boto3 등) | §3(C) |
| 5 | 트랙 B Railway 배포 (Python Docker) | 새 Railway 서비스 + local_clips 동봉 | 1~4 |
| 6 | Vercel 분기 추가 | `lib/shortform/render-backend.js` + `/api/shortform-render` 수정 | §5 |
| 7 | 환경변수 설정 (off→사장님만 on) | Vercel·Railway env | §7 |
| 8 | 사장님 계정 E2E 1건 + 풀시청 검수 | 완성 mp4 | 영상 자가검증 금지룰 — 사장님 시청 게이트 |

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
`TRACKB_ALLOWED_EMAILS`에 사장님 1명만. 같은 대본을 트랙 A·B 양쪽으로 렌더해 비교 +
**사장님 1배속 풀시청 게이트**(영상 자가검증 금지룰). 문제 시 `TRACKB_ENABLED=false` 한 줄로 즉시 복귀.

**4단계 · 점진 전환.**
검증되면 allowlist를 천천히 넓힌다(사장님 → 베타 → 전체). 한 번에 전체 전환 금지. 각 확대마다 게이트 반복.

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

## 9. 결정 필요 사항 (착수 전 확인)

1. **트랙 B 서비스 호스팅**: 기존 Railway 프로젝트에 서비스 추가 vs 새 프로젝트? (비용·관리)
2. **변환 위치**: §4.3 권장(서비스 내부)으로 확정? Vercel은 inputProps만 그대로 보냄.
3. **clip 매칭 자동화 수준**: 1단계에서 섹션→클립 자동매칭만? 아니면 scenes JSON에
   사장님이 클립을 수동 지정?
4. **숏폼 페이지 재오픈 시점**: 트랙 B 검증 완료 후 `SHORTFORM_PAGE_ENABLED=true`와
   `TRACKB_ENABLED=true`를 동시에 켤지, 트랙 B는 더 뒤로 뺄지.

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
