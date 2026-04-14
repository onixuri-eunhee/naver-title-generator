/**
 * Firebase Genkit + Vertex AI 싱글톤
 *
 * Vercel Serverless 환경에서 cold start 시 1회 초기화 후 재사용.
 * 서비스 계정 인증은 GOOGLE_SERVICE_ACCOUNT_KEY (base64 인코딩된 JSON) 사용.
 * 로컬 개발에서는 ADC(Application Default Credentials) 자동 fallback.
 */
import { genkit } from 'genkit';
import { vertexAI, gemini25Pro, gemini25Flash } from '@genkit-ai/vertexai';

let _ai = null;

/**
 * 서비스 계정 키를 런타임 임시 파일로 디코드.
 * GOOGLE_APPLICATION_CREDENTIALS 대신 환경변수로 키를 주입할 때 사용.
 */
function setupCredentials() {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) return; // 이미 설정됨
  const b64 = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!b64) return; // ADC fallback (로컬 gcloud)

  // Vercel 서버리스는 /tmp 쓰기 가능
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('fs');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require('path');
    const tmpPath = path.join('/tmp', 'gcp-sa-key.json');
    if (!fs.existsSync(tmpPath)) {
      const json = Buffer.from(b64, 'base64').toString('utf-8');
      fs.writeFileSync(tmpPath, json, 'utf-8');
    }
    process.env.GOOGLE_APPLICATION_CREDENTIALS = tmpPath;
  } catch (err) {
    console.error('[gemini-vertex] Failed to set credentials:', err.message);
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
export { gemini25Pro, gemini25Flash };

/**
 * 모델 ID 환경변수 override — 스펙 §11 "모델 ID는 구현 단계에서 확정"에 대응.
 * 실제로는 gemini25Pro / gemini25Flash 참조를 사용하지만, 향후 gemini-3.0-pro 출시 시
 * 코드 변경 없이 환경변수로 전환 가능하도록 헬퍼 제공.
 */
export function resolveProModel() {
  const override = process.env.GEMINI_VERTEX_MODEL;
  if (override && override !== 'gemini-2.5-pro') {
    // 문자열 모델 ID로 override — Genkit는 string model ID도 허용
    return `vertexai/${override}`;
  }
  return gemini25Pro;
}

export function resolveFlashModel() {
  const override = process.env.GEMINI_VERTEX_FLASH_MODEL;
  if (override && override !== 'gemini-2.5-flash') {
    return `vertexai/${override}`;
  }
  return gemini25Flash;
}
