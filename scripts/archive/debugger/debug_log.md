# 뚝딱툴 디버그 로그

> 자동 생성 — 디버깅 에이전트가 기록합니다.

---

## [API_ERROR] 환경변수 누락 체크 없이 직접 사용
- **시간:** 2026-03-14 18:59:35
- **소스:** api/generate.js
- **메시지:** `url: process.env.KV_REST_API_URL,`
- **수정안:** [API_ERROR] 에러가 감지되었습니다. 로그를 확인하고 해당 파일을 점검하세요.
---

## [API_ERROR] 환경변수 누락 체크 없이 직접 사용
- **시간:** 2026-03-14 18:59:35
- **소스:** api/titles.js
- **메시지:** `url: process.env.KV_REST_API_URL,`
- **수정안:** [API_ERROR] 에러가 감지되었습니다. 로그를 확인하고 해당 파일을 점검하세요.
---

## [BUILD] 프로덕션 console.log 잔존
- **시간:** 2026-03-14 18:59:35
- **소스:** api/blog-image.js
- **메시지:** `console.log(`[IMAGE] Mode: parse | blogText: ${totalLen} chars | frontMarkers: ${frontMarkers?.lengt`
- **수정안:** [BUILD] 에러가 감지되었습니다. 로그를 확인하고 해당 파일을 점검하세요.
---

## [API_ERROR] 환경변수 누락 체크 없이 직접 사용
- **시간:** 2026-03-14 18:59:35
- **소스:** api/blog-image.js
- **메시지:** `url: process.env.KV_REST_API_URL,`
- **수정안:** [API_ERROR] 에러가 감지되었습니다. 로그를 확인하고 해당 파일을 점검하세요.
---

## [IMAGE_GEN] 마커 배열 8장 제한 미적용 가능성
- **시간:** 2026-03-14 18:59:35
- **소스:** api/blog-image.js
- **메시지:** `async function callHaikuMarkerAnalysis(blogText, markers, isRegenerate) {`
- **수정안:** 마커 수 제한 초과. markers.slice(0, 8) 적용 확인 (프론트+백엔드 모두)
---

## [BUILD] 프로덕션 console.log 잔존
- **시간:** 2026-03-14 18:59:35
- **소스:** api/blog-image-pro.js
- **메시지:** `console.log(`[IMAGE-PRO] Mode: parse | blogText: ${totalLen} chars | frontMarkers: ${frontMarkers?.l`
- **수정안:** [BUILD] 에러가 감지되었습니다. 로그를 확인하고 해당 파일을 점검하세요.
---

## [API_ERROR] 환경변수 누락 체크 없이 직접 사용
- **시간:** 2026-03-14 18:59:35
- **소스:** api/blog-image-pro.js
- **메시지:** `url: process.env.KV_REST_API_URL,`
- **수정안:** [API_ERROR] 에러가 감지되었습니다. 로그를 확인하고 해당 파일을 점검하세요.
---

## [IMAGE_GEN] 마커 배열 8장 제한 미적용 가능성
- **시간:** 2026-03-14 18:59:35
- **소스:** api/blog-image-pro.js
- **메시지:** `async function callHaikuMarkerAnalysis(blogText, markers, isRegenerate) {`
- **수정안:** 마커 수 제한 초과. markers.slice(0, 8) 적용 확인 (프론트+백엔드 모두)
---

## [BUILD] 프로덕션 console.log 잔존
- **시간:** 2026-03-14 18:59:35
- **소스:** api/threads.js
- **메시지:** `console.log(`[맞춤법 수정] 글${i+1}: "${wrong}" → "${correct}"`);`
- **수정안:** [BUILD] 에러가 감지되었습니다. 로그를 확인하고 해당 파일을 점검하세요.
---

## [API_ERROR] 환경변수 누락 체크 없이 직접 사용
- **시간:** 2026-03-14 18:59:35
- **소스:** api/threads.js
- **메시지:** `url: process.env.KV_REST_API_URL,`
- **수정안:** [API_ERROR] 에러가 감지되었습니다. 로그를 확인하고 해당 파일을 점검하세요.
---

## [API_ERROR] 환경변수 누락 체크 없이 직접 사용
- **시간:** 2026-03-14 18:59:35
- **소스:** api/auth.js
- **메시지:** `url: process.env.KV_REST_API_URL,`
- **수정안:** [API_ERROR] 에러가 감지되었습니다. 로그를 확인하고 해당 파일을 점검하세요.
---

## [IMAGE_GEN] 마커 배열 8장 제한 미적용 가능성
- **시간:** 2026-03-14 18:59:35
- **소스:** blog-image.html
- **메시지:** `.marker-preview {`
- **수정안:** 마커 수 제한 초과. markers.slice(0, 8) 적용 확인 (프론트+백엔드 모두)
---

## [API_ERROR] 환경변수 ANTHROPIC_API_KEY 미설정 (로컬 환경)
- **시간:** 2026-03-14 18:59:35
- **소스:** .env
- **메시지:** `ANTHROPIC_API_KEY이(가) 현재 환경에 설정되어 있지 않습니다`
- **수정안:** API 키 확인 필요. Vercel 환경변수(ANTHROPIC_API_KEY, FAL_KEY, OPENAI_API_KEY) 설정 확인
---
