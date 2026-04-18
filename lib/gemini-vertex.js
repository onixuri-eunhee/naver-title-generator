/**
 * Firebase Genkit + Vertex AI 싱글톤
 *
 * Vercel Serverless 환경에서 cold start 시 1회 초기화 후 재사용.
 * 서비스 계정 인증은 GOOGLE_VERTEX_SERVICE_ACCOUNT_JSON (raw JSON) 사용.
 * 로컬 개발에서는 ADC(Application Default Credentials) 자동 fallback.
 */
import fs from 'fs';
import path from 'path';
import { genkit } from 'genkit';
import { vertexAI, gemini } from '@genkit-ai/vertexai';

let _ai = null;

// Genkit @genkit-ai/vertexai v1.32는 gemini25Pro/Flash 심볼을 직접 export하지
// 않고 gemini(modelId) 팩토리를 제공. 모델 ID는 환경변수 override 가능하도록
// resolveProModel/resolveFlashModel에서 동적으로 생성.
const DEFAULT_PRO_MODEL = 'gemini-2.5-pro';
const DEFAULT_FLASH_MODEL = 'gemini-2.5-flash';

/**
 * 서비스 계정 키를 런타임 임시 파일로 기록.
 * GOOGLE_VERTEX_SERVICE_ACCOUNT_JSON (raw JSON) 또는 GOOGLE_SERVICE_ACCOUNT_KEY (base64) 지원.
 */
function setupCredentials() {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) return; // 이미 설정됨

  const raw = process.env.GOOGLE_VERTEX_SERVICE_ACCOUNT_JSON
    || process.env.GOOGLE_SERVICE_ACCOUNT_JSON
    || '';
  const b64 = process.env.GOOGLE_SERVICE_ACCOUNT_KEY || '';

  if (!raw && !b64) return; // ADC fallback (로컬 gcloud)

  try {
    const tmpPath = path.join('/tmp', 'gcp-sa-key.json');
    if (!fs.existsSync(tmpPath)) {
      let json = raw || Buffer.from(b64, 'base64').toString('utf-8');
      // `.replace(/\\n/g, '\n')` 제거: 프로덕션의 process.env 값은 이미 valid JSON
      // (private_key 필드의 \n은 JSON escape sequence — JSON.parse가 처리).
      // 변환하면 "raw newline inside string literal" 에러로 파싱 실패 → ADC fallback
      // → Vercel 런타임에 ADC 없음 → 인증 실패. (e809c7c 에서 잘못 들어간 줄)
      // 로컬 dev에서 `vercel env pull` 파일 사용 시 base64 변형(GOOGLE_SERVICE_ACCOUNT_KEY)을 권장.
      JSON.parse(json); // 유효성 검증만 — 실패 시 ADC fallback
      fs.writeFileSync(tmpPath, json, 'utf-8');
    }
    process.env.GOOGLE_APPLICATION_CREDENTIALS = tmpPath;
  } catch (err) {
    console.warn('[gemini-vertex] SA key 파싱 실패, ADC fallback:', err.message?.slice(0, 60));
    // ADC fallback — gcloud auth application-default login 상태면 자동 인증
  }
}

/**
 * Genkit 싱글톤 획득. 최초 호출 시 Vertex AI 플러그인 초기화.
 */
export function getGenkit() {
  if (_ai) return _ai;

  setupCredentials();

  const projectId = process.env.GOOGLE_CLOUD_PROJECT;
  const location = process.env.VERTEX_AI_LOCATION || 'us-central1';

  if (!projectId) {
    throw new Error('GOOGLE_CLOUD_PROJECT 환경 변수가 설정되지 않았습니다.');
  }

  _ai = genkit({
    plugins: [
      vertexAI({ projectId, location }),
    ],
  });

  return _ai;
}

/**
 * 공용 참조 — Task B2/B5에서 import 해서 사용.
 */
export { gemini };

/**
 * 모델 ID 환경변수 override — 스펙 §11 "모델 ID는 구현 단계에서 확정"에 대응.
 * gemini(modelId) 팩토리로 ModelReference를 생성한다.
 * GEMINI_VERTEX_MODEL 환경변수로 향후 gemini-3.0-pro 등 신모델 전환 가능.
 */
export function resolveProModel() {
  const modelId = process.env.GEMINI_VERTEX_MODEL || DEFAULT_PRO_MODEL;
  return gemini(modelId);
}

export function resolveFlashModel() {
  const modelId = process.env.GEMINI_VERTEX_FLASH_MODEL || DEFAULT_FLASH_MODEL;
  return gemini(modelId);
}
