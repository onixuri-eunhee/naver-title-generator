# 카드뉴스 기능 개발 — 실패 기록 (DEAD ENDS)

## 1. 별도 파일 ESM export → Vercel 번들링 실패
- **시도**: `_card-news-themes.js`, `_card-news-layouts.js`를 별도 파일로 분리 + `export { themes }`
- **결과**: Vercel 번들러가 `package.json`에 `"type": "module"` 없는 프로젝트에서 ESM export를 제대로 처리하지 못함
- **교훈**: Vercel API 라우트에서 `_` 접두사 헬퍼 파일은 ESM export 피하거나, 메인 파일에 인라인

## 2. createRequire로 CJS import → Vercel 번들 누락
- **시도**: `createRequire(import.meta.url)`로 CJS 모듈 로딩
- **결과**: Vercel 번들러가 동적 require를 트레이스하지 못해 파일이 번들에 누락
- **교훈**: Vercel Serverless에서 동적 require는 피할 것. 정적 import만 사용

## 3. import.meta.url 사용 → CJS 모드에서 크래시
- **시도**: `dirname(fileURLToPath(import.meta.url))`로 __dirname 대체
- **결과**: package.json에 `"type": "module"` 없으면 Vercel이 CJS로 처리 → `import.meta.url` 미정의 → 함수 로드 자체 실패
- **교훈**: 다른 API 파일(titles.js, hooks.js 등)은 import.meta.url을 사용하지 않음. process.cwd() 사용

## 4. @resvg/resvg-js (네이티브 바이너리) → 플랫폼 불일치
- **시도**: @resvg/resvg-js는 네이티브 바이너리(darwin-arm64)를 사용
- **결과**: Vercel은 linux-x64 런타임이라 바이너리 불일치 → FUNCTION_INVOCATION_FAILED
- **교훈**: @resvg/resvg-wasm (WASM 버전)으로 전환 필요. WASM은 플랫폼 무관

## 5. vercel.json functions.includeFiles 배열 → 빌드 자체 실패
- **시도**: `"includeFiles": ["fonts/**", "node_modules/@resvg/resvg-wasm/index_bg.wasm"]`
- **결과**: includeFiles 배열 형식이 Vercel 빌드를 완전히 실패시킴. 최근 3개 배포 모두 Error
- **교훈**: vercel.json의 functions 섹션은 매우 신중하게 사용. 잘못된 형식은 전체 프로젝트 빌드를 중단시킴

## 6. process.cwd() + fonts/ 또는 api/_fonts/ → ENOENT
- **시도**: `readFileSync(join(process.cwd(), 'fonts', ...))` 또는 `api/_fonts/`
- **결과**: Vercel 번들에 fonts/ 디렉토리가 포함되지 않음. api/ 안의 `_` 접두사 바이너리도 미포함
- **교훈**: Vercel은 `api/` 안의 JS 파일만 번들링. 바이너리 파일은 자동 포함 안 됨

## 7. vercel.json includeFiles: ["배열"] → 빌드 에러
- **시도**: `"includeFiles": ["fonts/**", "node_modules/..."]` 배열 형식
- **결과**: 전체 프로젝트 빌드 실패 (● Error). 3개 연속 배포 실패
- **교훈**: includeFiles는 문자열만 지원. 배열 형식은 빌드 자체를 중단시킴

## 8. VERCEL_URL로 self-fetch → 프리뷰 인증 401
- **시도**: `const BASE = \`https://${process.env.VERCEL_URL}\`` + fetch
- **결과**: VERCEL_URL은 프리뷰 URL을 가리키고, 프리뷰에 Deployment Protection이 걸려 401
- **교훈**: self-fetch 시 프로덕션 도메인 하드코딩 필요

## 최종 해결: public/assets/ + fetch()
- 폰트 TTF와 WASM 파일을 `public/assets/`에 배치
- Vercel의 public/ 디렉토리는 CDN에 자동 업로드
- Serverless 함수에서 `fetch('https://ddukddaktool.co.kr/assets/...')`로 로딩
- 프로덕션 도메인 하드코딩 (VERCEL_URL 사용 금지)

## 9. public/ 디렉토리 생성 → 전체 사이트 404
- **시도**: 폰트/WASM을 `public/assets/`에 배치
- **결과**: Vercel은 `public/` 폴더가 존재하면 정적 파일을 루트가 아닌 `public/`에서만 서빙. 기존 HTML 파일(index.html, blog-writer.html 등) 전부 404
- **교훈**: **Vercel 프로젝트에서 public/ 디렉토리 절대 생성 금지** (프레임워크 없는 정적 사이트의 경우). 루트의 assets/로 이동하여 해결

## 10. satori/@resvg/resvg-wasm 정적 import → 모듈 로드 크래시 (근본 원인)
- **시도**: `import satori from 'satori'; import { Resvg, initWasm } from '@resvg/resvg-wasm';` (최상위 정적 import)
- **결과**: 모듈 로드 시점에 WASM 초기화가 실행되어 Vercel에서 크래시. GET도 POST도 전부 FUNCTION_INVOCATION_FAILED
- **증거**: card-news-test.js(동적 import `await import(...)`)는 성공, card-news.js(정적 import)는 실패
- **해결**: `getSatori()`, `getResvg()` lazy loader 함수로 전환 — 핸들러 실행 시에만 동적 import
- **교훈**: **Vercel Serverless에서 WASM 관련 패키지는 반드시 동적 import 사용**. 정적 import는 모듈 평가 시 WASM 초기화가 실행되어 크래시

## 핵심 교훈
1. **Vercel Serverless에서 네이티브 바이너리 사용은 위험** → WASM 우선
2. **package.json에 type:module 없으면 import.meta.url 사용 금지**
3. **vercel.json functions.includeFiles 배열 형식은 빌드 실패 유발**
4. **바이너리 파일은 public/에 넣고 fetch()로 로딩이 가장 안전**
5. **VERCEL_URL은 프리뷰 URL → 프로덕션 도메인 하드코딩 필요**
6. **배포 전 `npx vercel ls`로 빌드 성공 여부 반드시 확인**
7. **진단용 테스트 함수(card-news-test.js)를 만들어 격리 테스트**
