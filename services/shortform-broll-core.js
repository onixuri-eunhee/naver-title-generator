import { createSign, randomUUID } from 'node:crypto';

/* ── R2 upload (inlined from api/_r2.js) ── */
let _s3Client = null;
async function getS3Client() {
  if (_s3Client) return _s3Client;
  const { S3Client } = await import('@aws-sdk/client-s3');
  _s3Client = new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
  });
  return _s3Client;
}
async function uploadToR2(key, body, contentType = 'image/png') {
  const { PutObjectCommand } = await import('@aws-sdk/client-s3');
  const client = await getS3Client();
  await client.send(new PutObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME,
    Key: key,
    Body: body,
    ContentType: contentType,
  }));
  return `https://pub-cac85a1d3b8d486082bd1bff2fadcaed.r2.dev/${key}`;
}
async function uploadImageUrlToR2(imageUrl, key) {
  try {
    const response = await fetch(imageUrl);
    if (!response.ok) throw new Error(`Fetch failed: ${response.status}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    const contentType = response.headers.get('content-type') || 'image/png';
    return await uploadToR2(key, buffer, contentType);
  } catch (err) {
    console.error(`[R2] URL upload failed for ${key}:`, err.message);
    return null;
  }
}

/* ── DB usage log (inlined from api/_db.js) ── */
let _sql = null;
async function logUsage(userEmail, tool, mode, ip) {
  try {
    if (!_sql) {
      const { neon } = await import('@neondatabase/serverless');
      _sql = neon(process.env.POSTGRES_URL);
    }
    await _sql`INSERT INTO usage_logs (user_email, tool, mode, ip) VALUES (${userEmail}, ${tool}, ${mode || null}, ${ip || null})`;
  } catch (err) {
    console.error('[DB] logUsage failed:', err.message);
  }
}

export const BROLL_VERSION = 'v9-flux-kling-pipeline';

const FAL_API_BASE = 'https://fal.run';
const FLUX_SCHNELL_ENDPOINT = 'fal-ai/flux/schnell';
const KLING_I2V_ENDPOINT = 'fal-ai/kling-video/v3/pro/image-to-video';

const CLIP_DURATION_SEC = 5;
const VEO_CLIP_DURATION_SEC = 4;
const VEO_POLL_INTERVAL_MS = 5000;
const VEO_TIMEOUT_MS = 180000;
const SEEDANCE_POLL_INTERVAL_MS = 4000;
const SEEDANCE_TIMEOUT_MS = 30000;
const EXTERNAL_FETCH_TIMEOUT_MS = 45000;
const GOOGLE_OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_CLOUD_PLATFORM_SCOPE = 'https://www.googleapis.com/auth/cloud-platform';
const DEFAULT_VEO_LOCATION = 'us-central1';
const DEFAULT_VEO_MODEL = 'veo-3.1-lite-generate-001';

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function parseRequestBody(body) {
  if (!body) return {};
  if (typeof body === 'string') {
    try {
      return JSON.parse(body);
    } catch (_) {
      return {};
    }
  }
  return body;
}

function getKSTDate() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const year = parts.find(part => part.type === 'year')?.value || '1970';
  const month = parts.find(part => part.type === 'month')?.value || '01';
  const day = parts.find(part => part.type === 'day')?.value || '01';
  return `${year}-${month}-${day}`;
}

function getSafeUserId(email, ip) {
  return (email || ip || 'anonymous').replace(/[^a-zA-Z0-9_-]/g, '_');
}

function buildVisualPrompt(visual, visualStyle, kind, isFirstScene) {
  const scrollStopping = isFirstScene
    ? 'Scroll-stopping, dramatic composition, high contrast, cinematic impact, visually arresting. '
    : '';

  if (kind === 'video') {
    return [
      scrollStopping + visual.trim(),
      'Cinematic vertical 9:16 short-form B-roll clip with realistic motion, natural lighting, and no on-screen text.',
      `Target duration: ${CLIP_DURATION_SEC} seconds.`,
      visualStyle ? `Style: ${visualStyle}` : '',
    ].filter(Boolean).join('\n');
  }

  return [
    scrollStopping + visual.trim(),
    'Vertical 9:16 still image for short-form video. No on-screen text.',
    visualStyle ? `Style: ${visualStyle}` : '',
  ].filter(Boolean).join('\n');
}

function createR2Key(userId, suffix) {
  return `shortform-broll/${userId}/${getKSTDate()}/${randomUUID()}-${suffix}`;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function base64UrlEncode(value) {
  return Buffer.from(value)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function parseJsonEnv(value) {
  if (!value || typeof value !== 'string') return null;
  try {
    return JSON.parse(value);
  } catch (_) {
    return null;
  }
}

function parseBase64JsonEnv(value) {
  if (!value || typeof value !== 'string') return null;
  try {
    return JSON.parse(Buffer.from(value, 'base64').toString('utf8'));
  } catch (_) {
    return null;
  }
}

function getGoogleServiceAccount() {
  const parsed = parseJsonEnv(process.env.GOOGLE_VERTEX_SERVICE_ACCOUNT_JSON)
    || parseJsonEnv(process.env.GOOGLE_SERVICE_ACCOUNT_JSON)
    || parseBase64JsonEnv(process.env.GOOGLE_VERTEX_SERVICE_ACCOUNT_JSON_BASE64)
    || parseBase64JsonEnv(process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64);

  if (!parsed?.client_email || !parsed?.private_key) return null;
  return {
    clientEmail: parsed.client_email,
    privateKey: String(parsed.private_key).replace(/\\n/g, '\n'),
  };
}

function getVeoProjectId() {
  return (process.env.GOOGLE_VERTEX_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || '').trim();
}

function getVeoLocation() {
  return (process.env.GOOGLE_VERTEX_LOCATION || DEFAULT_VEO_LOCATION).trim();
}

function getVeoModelId() {
  return (process.env.GOOGLE_VERTEX_VEO_MODEL || DEFAULT_VEO_MODEL).trim();
}

function hasVeoConfig() {
  return !!(getVeoProjectId() && getGoogleServiceAccount());
}

let googleTokenCache = { token: null, expiresAt: 0 };

async function getGoogleAccessToken() {
  const serviceAccount = getGoogleServiceAccount();
  const projectId = getVeoProjectId();
  if (!serviceAccount || !projectId) {
    throw new Error('Google Vertex credentials are missing');
  }

  const now = Math.floor(Date.now() / 1000);
  if (googleTokenCache.token && googleTokenCache.expiresAt - 60 > now) {
    return googleTokenCache.token;
  }

  const header = { alg: 'RS256', typ: 'JWT' };
  const claimSet = {
    iss: serviceAccount.clientEmail,
    scope: GOOGLE_CLOUD_PLATFORM_SCOPE,
    aud: GOOGLE_OAUTH_TOKEN_URL,
    exp: now + 3600,
    iat: now,
  };
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedClaimSet = base64UrlEncode(JSON.stringify(claimSet));
  const unsignedJwt = `${encodedHeader}.${encodedClaimSet}`;
  const signature = createSign('RSA-SHA256').update(unsignedJwt).end().sign(serviceAccount.privateKey);
  const assertion = `${unsignedJwt}.${base64UrlEncode(signature)}`;

  const response = await fetchWithTimeout(GOOGLE_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }).toString(),
  }, 15000);
  const data = await parseJsonResponse(response);
  if (!response.ok || !data?.access_token) {
    throw new Error(`Google access token failed: ${response.status} ${JSON.stringify(data)}`);
  }

  googleTokenCache = {
    token: data.access_token,
    expiresAt: now + Number(data.expires_in || 3600),
  };
  return googleTokenCache.token;
}

function parseDataUri(dataUri) {
  const match = dataUri.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  return {
    contentType: match[1],
    buffer: Buffer.from(match[2], 'base64'),
  };
}

function findFirstUrl(value, extensions = []) {
  if (!value) return null;
  if (typeof value === 'string') {
    const lower = value.toLowerCase();
    if (!lower.startsWith('http://') && !lower.startsWith('https://') && !lower.startsWith('data:')) return null;
    if (extensions.length === 0) return value;
    if (extensions.some(ext => lower.includes(ext))) return value;
    if (lower.startsWith('data:')) return value;
    return null;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findFirstUrl(item, extensions);
      if (found) return found;
    }
    return null;
  }
  if (typeof value === 'object') {
    for (const key of ['url', 'video_url', 'download_url', 'downloadUrl', 'file_url', 'fileUrl', 'result_url', 'resultUrl', 'output_url', 'outputUrl', 'href']) {
      const found = findFirstUrl(value[key], extensions);
      if (found) return found;
    }
    for (const key of Object.keys(value)) {
      const found = findFirstUrl(value[key], extensions);
      if (found) return found;
    }
  }
  return null;
}

function findFirstVideoUrl(value) {
  if (!value) return null;
  if (typeof value === 'string') return findFirstUrl(value, ['.mp4', '.mov', '.webm']);
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findFirstVideoUrl(item);
      if (found) return found;
    }
    return null;
  }
  if (typeof value === 'object') {
    for (const key of ['video_url', 'videoUrl', 'download_url', 'downloadUrl', 'file_url', 'fileUrl', 'result_url', 'resultUrl', 'output_url', 'outputUrl', 'url', 'href']) {
      const candidate = value[key];
      if (typeof candidate === 'string' && /^(https?:\/\/|data:)/i.test(candidate)) return candidate;
      const found = findFirstVideoUrl(candidate);
      if (found) return found;
    }
    for (const nested of Object.values(value)) {
      const found = findFirstVideoUrl(nested);
      if (found) return found;
    }
  }
  return null;
}

function findFirstString(value, keys) {
  if (!value || typeof value !== 'object') return null;
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  }
  for (const nested of Object.values(value)) {
    if (!nested || typeof nested !== 'object') continue;
    const candidate = findFirstString(nested, keys);
    if (candidate) return candidate;
  }
  return null;
}

async function parseJsonResponse(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch (_) {
    return { raw: text };
  }
}

async function fetchWithTimeout(url, options, timeoutMs = EXTERNAL_FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function uploadRemoteAssetToR2(sourceUrl, key, fallbackContentType, expectedPrefix = '') {
  const response = await fetchWithTimeout(sourceUrl, {}, EXTERNAL_FETCH_TIMEOUT_MS);
  if (!response.ok) throw new Error(`Asset fetch failed: ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  const contentType = response.headers.get('content-type') || fallbackContentType;
  if (expectedPrefix && contentType && !contentType.toLowerCase().startsWith(expectedPrefix) && contentType.toLowerCase() !== 'application/octet-stream') {
    throw new Error(`Unexpected asset content type: ${contentType}`);
  }
  const r2Url = await uploadToR2(key, buffer, contentType);
  return { url: sourceUrl, r2Url };
}

async function persistImageResult(imagePayload, key) {
  if (imagePayload?.b64_json) {
    const r2Url = await uploadToR2(key, Buffer.from(imagePayload.b64_json, 'base64'), 'image/png');
    return { url: r2Url, r2Url };
  }

  const sourceUrl = findFirstUrl(imagePayload?.url || imagePayload?.image_url || imagePayload);
  if (!sourceUrl) throw new Error('Image URL not found');
  if (sourceUrl.startsWith('data:')) {
    const parsed = parseDataUri(sourceUrl);
    if (!parsed) throw new Error('Unsupported data URI image');
    if (!parsed.contentType.startsWith('image/')) throw new Error('Non-image data URI received for image payload');
    const r2Url = await uploadToR2(key, parsed.buffer, parsed.contentType || 'image/png');
    return { url: r2Url, r2Url };
  }
  const r2Url = await uploadImageUrlToR2(sourceUrl, key);
  if (!r2Url) throw new Error('R2 image upload failed');
  return { url: sourceUrl, r2Url };
}

async function persistVideoResult(videoPayload, key) {
  if (videoPayload?.bytesBase64Encoded) {
    const mimeType = videoPayload.mimeType || videoPayload.encoding || 'video/mp4';
    const r2Url = await uploadToR2(key, Buffer.from(videoPayload.bytesBase64Encoded, 'base64'), mimeType);
    return { url: r2Url, r2Url };
  }

  const sourceUrl = findFirstVideoUrl(videoPayload);
  if (!sourceUrl) throw new Error('Video URL not found');
  if (sourceUrl.startsWith('data:')) {
    const parsed = parseDataUri(sourceUrl);
    if (!parsed) throw new Error('Unsupported data URI video');
    if (!parsed.contentType.startsWith('video/')) throw new Error('Non-video data URI received for video payload');
    const r2Url = await uploadToR2(key, parsed.buffer, parsed.contentType || 'video/mp4');
    return { url: r2Url, r2Url };
  }
  return uploadRemoteAssetToR2(sourceUrl, key, 'video/mp4', 'video/');
}

// ── FLUX Schnell (fal.ai) — 메인 이미지 생성 ──
async function callFluxSchnell(prompt, key) {
  if (!process.env.FAL_KEY) throw new Error('FAL_KEY is missing');
  const response = await fetchWithTimeout(`${FAL_API_BASE}/${FLUX_SCHNELL_ENDPOINT}`, {
    method: 'POST',
    headers: {
      Authorization: `Key ${process.env.FAL_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      prompt,
      image_size: { width: 768, height: 1344 },
      num_images: 1,
    }),
  }, 30000);
  const data = await parseJsonResponse(response);
  if (!response.ok) throw new Error(`FLUX Schnell failed: ${response.status} ${JSON.stringify(data).slice(0, 200)}`);

  const imageUrl = data?.images?.[0]?.url;
  if (!imageUrl) throw new Error('FLUX Schnell: no image URL in response');

  // R2에 업로드 + base64 추출 (I2V용)
  const r2Url = await uploadImageUrlToR2(imageUrl, key);
  if (!r2Url) throw new Error('R2 image upload failed');

  let base64 = null;
  try {
    const imgRes = await fetchWithTimeout(r2Url, {}, 10000);
    if (imgRes.ok) base64 = Buffer.from(await imgRes.arrayBuffer()).toString('base64');
  } catch (_) {}

  console.log('[SHORTFORM-BROLL] FLUX Schnell image uploaded:', r2Url);
  return { type: 'image', url: r2Url, r2Url, prompt, base64, provider: 'flux-schnell' };
}

// ── Kling 3.0 Pro I2V (fal.ai 큐 방식) — 첫 씬 영상 변환 ──
const KLING_POLL_INTERVAL_MS = 5000;
const KLING_TIMEOUT_MS = 180000;

async function callKlingI2V(prompt, key, imageUrl) {
  if (!process.env.FAL_KEY) throw new Error('FAL_KEY is missing');
  const authHeader = { Authorization: `Key ${process.env.FAL_KEY}`, 'Content-Type': 'application/json' };

  // Step 1: 큐 제출
  const submitRes = await fetchWithTimeout(`https://queue.fal.run/${KLING_I2V_ENDPOINT}`, {
    method: 'POST',
    headers: authHeader,
    body: JSON.stringify({
      prompt,
      image_url: imageUrl,
      duration: '5',
      aspect_ratio: '9:16',
    }),
  }, 30000);
  const submitData = await parseJsonResponse(submitRes);
  if (!submitRes.ok) throw new Error(`Kling I2V submit failed: ${submitRes.status} ${JSON.stringify(submitData).slice(0, 200)}`);

  const requestId = submitData?.request_id;
  if (!requestId) throw new Error('Kling I2V: no request_id in submit response');
  console.log('[SHORTFORM-BROLL] Kling I2V submitted:', requestId);

  // Step 2: 폴링
  const startedAt = Date.now();
  while (Date.now() - startedAt < KLING_TIMEOUT_MS) {
    await sleep(KLING_POLL_INTERVAL_MS);
    const statusRes = await fetchWithTimeout(`https://queue.fal.run/${KLING_I2V_ENDPOINT}/requests/${requestId}/status`, {
      method: 'GET',
      headers: authHeader,
    }, 15000);
    const statusData = await parseJsonResponse(statusRes);
    const status = statusData?.status;

    if (status === 'COMPLETED') {
      // Step 3: 결과 가져오기
      const resultRes = await fetchWithTimeout(`https://queue.fal.run/${KLING_I2V_ENDPOINT}/requests/${requestId}`, {
        method: 'GET',
        headers: authHeader,
      }, 15000);
      const resultData = await parseJsonResponse(resultRes);
      const videoUrl = resultData?.video?.url || findFirstVideoUrl(resultData);
      if (!videoUrl) throw new Error('Kling I2V: no video URL in result');

      const asset = await uploadRemoteAssetToR2(videoUrl, key, 'video/mp4', 'video/');
      console.log('[SHORTFORM-BROLL] Kling I2V video uploaded:', asset.r2Url);
      return { type: 'video', url: asset.url, r2Url: asset.r2Url, prompt, durationSec: CLIP_DURATION_SEC, provider: 'kling-3-pro' };
    }

    if (status === 'FAILED') {
      throw new Error(`Kling I2V generation failed: ${JSON.stringify(statusData).slice(0, 200)}`);
    }

    console.log('[SHORTFORM-BROLL] Kling I2V polling...', status, Math.round((Date.now() - startedAt) / 1000) + 's');
  }

  throw new Error('Kling I2V generation timed out');
}

// ── Imagen 3 (폴백용으로 유지) ──
async function callImagen3Image(prompt, key) {
  const token = await getGoogleAccessToken();
  const projectId = getVeoProjectId();
  const location = (process.env.GOOGLE_VERTEX_LOCATION || 'us-central1').trim();
  const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/imagen-3.0-fast-generate-001:predict`;

  const response = await fetchWithTimeout(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      instances: [{ prompt }],
      parameters: { sampleCount: 1, aspectRatio: '9:16', outputOptions: { mimeType: 'image/png' } },
    }),
  }, 30000);
  const data = await parseJsonResponse(response);
  if (!response.ok) throw new Error(`Imagen 3 failed: ${response.status} ${JSON.stringify(data).slice(0, 200)}`);

  const prediction = data?.predictions?.[0];
  const b64 = prediction?.bytesBase64Encoded;
  if (!b64) {
    const reason = prediction?.raiFilteredReason || prediction?.filteredReason || JSON.stringify(data).slice(0, 300);
    console.error('[SHORTFORM-BROLL] Imagen 3 empty response. Prediction:', JSON.stringify(prediction || data).slice(0, 500));
    throw new Error(`Imagen 3: no image in response (${reason})`);
  }

  const imageBuffer = Buffer.from(b64, 'base64');
  const r2Url = await uploadToR2(key, imageBuffer, 'image/png');
  if (!r2Url) throw new Error('R2 image upload failed');
  console.log('[SHORTFORM-BROLL] Imagen 3 Fast image uploaded:', r2Url);
  return { type: 'image', url: r2Url, r2Url, prompt, base64: b64, provider: 'imagen-3-fast' };
}

async function callGrokImage(prompt, key) {
  if (!process.env.XAI_API_KEY) throw new Error('XAI_API_KEY is missing');
  const response = await fetchWithTimeout('https://api.x.ai/v1/images/generations', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.XAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'grok-2-image', prompt, n: 1, size: '1024x1792' }),
  }, 20000);
  const data = await parseJsonResponse(response);
  if (!response.ok) throw new Error(`Grok image failed: ${response.status} ${JSON.stringify(data).slice(0, 200)}`);
  const imagePayload = data?.data?.[0] || data;
  // b64_json이 있으면 base64 추출 (i2v 파이프라인 호환)
  const b64 = imagePayload?.b64_json || null;
  const asset = await persistImageResult(imagePayload, key);
  // base64가 없으면 R2에서 다운받아 추출
  let base64 = b64;
  if (!base64 && asset.r2Url) {
    try {
      const imgRes = await fetchWithTimeout(asset.r2Url, {}, 10000);
      if (imgRes.ok) base64 = Buffer.from(await imgRes.arrayBuffer()).toString('base64');
    } catch (_) {}
  }
  return { type: 'image', url: asset.url, r2Url: asset.r2Url, prompt, base64, provider: 'grok' };
}

async function pollVeoOperation(operationName, accessToken, location) {
  const projectId = getVeoProjectId();
  const modelId = getVeoModelId();
  const fetchOperationUrl = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${modelId}:fetchPredictOperation`;
  const startedAt = Date.now();

  while (Date.now() - startedAt < VEO_TIMEOUT_MS) {
    await sleep(VEO_POLL_INTERVAL_MS);
    const response = await fetchWithTimeout(fetchOperationUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({
        operationName,
      }),
    }, 15000);
    const data = await parseJsonResponse(response);
    if (!response.ok) {
      throw new Error(`Veo poll failed: ${response.status} ${JSON.stringify(data)}`);
    }
    if (data?.done) {
      if (data.error) {
        throw new Error(`Veo operation failed: ${JSON.stringify(data.error)}`);
      }
      return data;
    }
  }

  throw new Error('Veo generation timed out');
}

async function callVeoI2V(prompt, key, imageBase64) {
  if (!hasVeoConfig()) throw new Error('Google Vertex Veo config is missing');

  const projectId = getVeoProjectId();
  const location = getVeoLocation();
  const modelId = getVeoModelId();
  const accessToken = await getGoogleAccessToken();
  const endpoint = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${modelId}:predictLongRunning`;

  const instance = { prompt };
  if (imageBase64) {
    instance.image = {
      bytesBase64Encoded: imageBase64,
      mimeType: 'image/png',
    };
  }

  const response = await fetchWithTimeout(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify({
      instances: [instance],
      parameters: {
        aspectRatio: '9:16',
        durationSeconds: VEO_CLIP_DURATION_SEC,
        sampleCount: 1,
        resolution: '720p',
      },
    }),
  }, 30000);
  const data = await parseJsonResponse(response);
  if (!response.ok || !data?.name) {
    throw new Error(`Veo request failed: ${response.status} ${JSON.stringify(data)}`);
  }

  const operation = await pollVeoOperation(data.name, accessToken, location);
  const firstVideo = operation?.response?.videos?.[0];
  if (!firstVideo) {
    throw new Error(`Veo response missing video: ${JSON.stringify(operation)}`);
  }

  const asset = await persistVideoResult(firstVideo, key);
  return {
    type: 'video',
    url: asset.url,
    r2Url: asset.r2Url,
    prompt,
    durationSec: VEO_CLIP_DURATION_SEC,
    provider: 'veo-3.1-lite-i2v',
  };
}

/** @deprecated Use callVeoI2V instead. Kept for backward compatibility. */
async function callVeoHeroVideo(prompt, key) {
  return callVeoI2V(prompt, key, null);
}

async function fetchSeedanceStatus(id) {
  let lastError = null;
  for (const path of [
    `https://api.seedance.ai/v1/video/generations/${id}`,
    `https://api.seedance.ai/v1/video/generations/${id}/status`,
    `https://api.seedance.ai/v1/video/generations/${id}/result`,
  ]) {
    const response = await fetchWithTimeout(path, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${process.env.SEEDANCE_API_KEY}`,
        'Content-Type': 'application/json',
      },
    }, 15000);
    const data = await parseJsonResponse(response);
    if (response.ok) return data;
    lastError = new Error(`Seedance poll failed: ${response.status} ${JSON.stringify(data)}`);
  }
  throw lastError || new Error('Seedance poll failed');
}

async function callSeedanceVideo(prompt, key) {
  if (!process.env.SEEDANCE_API_KEY) throw new Error('SEEDANCE_API_KEY is missing');

  const response = await fetchWithTimeout('https://api.seedance.ai/v1/video/generations', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.SEEDANCE_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      prompt,
      duration: CLIP_DURATION_SEC,
      aspect_ratio: '9:16',
    }),
  });
  const data = await parseJsonResponse(response);
  if (!response.ok) throw new Error(`Seedance request failed: ${response.status} ${JSON.stringify(data)}`);

  const directVideoUrl = findFirstVideoUrl(data);
  if (directVideoUrl) {
    const asset = await persistVideoResult(directVideoUrl, key);
    return { type: 'video', url: asset.url, r2Url: asset.r2Url, prompt, durationSec: CLIP_DURATION_SEC };
  }

  const generationId = findFirstString(data, ['id', 'request_id', 'requestId', 'job_id', 'jobId', 'generation_id', 'generationId', 'task_id', 'taskId']);
  if (!generationId) {
    throw new Error(`Seedance response missing video URL and job id: ${JSON.stringify(data)}`);
  }

  const startedAt = Date.now();
  while (Date.now() - startedAt < SEEDANCE_TIMEOUT_MS) {
    await sleep(SEEDANCE_POLL_INTERVAL_MS);
    const statusData = await fetchSeedanceStatus(generationId);
    const status = (findFirstString(statusData, ['status', 'state']) || '').toLowerCase();
    const videoUrl = findFirstVideoUrl(statusData);
    if (videoUrl) {
      const asset = await persistVideoResult(videoUrl, key);
      return { type: 'video', url: asset.url, r2Url: asset.r2Url, prompt, durationSec: CLIP_DURATION_SEC };
    }
    if (['failed', 'error', 'cancelled', 'canceled'].includes(status)) {
      throw new Error(`Seedance generation failed: ${JSON.stringify(statusData)}`);
    }
  }

  throw new Error('Seedance generation timed out');
}

// i2v 영상 슬롯: 첫 씬 + 마지막 씬 필수, 중간은 이미지 연속 2개 방지 교차 배치
// 30초(5): [0,2,4]->2~3  45초(7): [0,2,4,6]->3~4  60초(8): [0,2,5,7]->4  90초(12): [0,3,6,9,11]->5
function computeVideoSlots(total) {
  if (total <= 1) return new Set([0]);
  if (total <= 5) {
    const slots = new Set([0, total - 1]);
    for (let i = 2; i < total - 1; i += 2) slots.add(i);
    return slots;
  }
  if (total <= 7) {
    const slots = new Set([0, total - 1]);
    for (let i = 2; i < total - 1; i += 2) slots.add(i);
    return slots;
  }
  if (total <= 8) {
    return new Set([0, 2, 5, total - 1]);
  }
  // 90초 (9~12): 0,3,6,9,last
  const slots = new Set([0, total - 1]);
  for (let i = 3; i < total - 1; i += 3) slots.add(i);
  return slots;
}

async function createClipWithFallback(prompt, userId, clipNumber) {
  if (!(process.env.SEEDANCE_API_KEY || '').trim()) {
    return callImagen3Image(prompt, createR2Key(userId, `clip${clipNumber}-fallback.png`));
  }

  try {
    return await callSeedanceVideo(prompt, createR2Key(userId, `clip${clipNumber}.mp4`));
  } catch (error) {
    console.error(`[SHORTFORM-BROLL] Seedance clip ${clipNumber} failed, falling back to Grok image:`, error.message);
    return callImagen3Image(prompt, createR2Key(userId, `clip${clipNumber}-fallback.png`));
  }
}

export async function handleShortformBrollRequest({ method, rawBody, userEmail, ip, query }) {
  const probeMode = typeof query?.probe === 'string' ? query.probe.trim().toLowerCase() : '';

  if (method === 'GET') {
    if (probeMode === 'ping') {
      return {
        status: 200,
        body: {
          ok: true,
          stage: 'ping',
          version: BROLL_VERSION,
          hasFalKey: !!((process.env.FAL_KEY || '').trim()),
          hasSeedanceKey: !!((process.env.SEEDANCE_API_KEY || '').trim()),
          hasVeoConfig: hasVeoConfig(),
          veoProjectId: getVeoProjectId() || null,
          veoLocation: getVeoLocation(),
          veoModelId: getVeoModelId(),
          hasR2: !!(process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY && process.env.R2_BUCKET_NAME),
        },
      };
    }
    throw new HttpError(405, 'Method not allowed');
  }

  if (method !== 'POST') throw new HttpError(405, 'Method not allowed');

  const body = parseRequestBody(rawBody ? rawBody.toString('utf8') : '');
  const scenes = Array.isArray(body.scenes) ? body.scenes : [];
  const visualStyle = typeof body.visualStyle === 'string' ? body.visualStyle.trim() : '';

  const brollScenes = scenes.filter(s => s && s.type === 'broll' && typeof s.visual === 'string' && s.visual.trim());

  if (brollScenes.length === 0) {
    throw new HttpError(400, 'broll 타입의 scene이 1개 이상 필요합니다.');
  }

  const userId = getSafeUserId(userEmail, ip);
  const failures = [];
  const maxAssets = brollScenes.length;
  const videoSlots = computeVideoSlots(maxAssets);

  async function generateWithFallback(scene, index, isFirstScene) {
    const imgPrompt = buildVisualPrompt(scene.visual, visualStyle, 'image', isFirstScene);
    const imgKey = createR2Key(userId, `image${index}.png`);

    // ── Step 1: 이미지 생성 (FLUX Schnell 메인 → Imagen 3 폴백 → Grok 폴백) ──
    let imageResult = null;
    try {
      imageResult = await callFluxSchnell(imgPrompt, imgKey);
    } catch (fluxError) {
      console.warn('[SHORTFORM-BROLL] FLUX Schnell failed for asset ' + index + ':', fluxError.message);
      // Imagen 3 폴백
      try {
        imageResult = await callImagen3Image(imgPrompt, createR2Key(userId, `image${index}-imagen.png`));
      } catch (imagenError) {
        console.warn('[SHORTFORM-BROLL] Imagen 3 fallback failed for asset ' + index + ':', imagenError.message);
        // Grok 최종 폴백
        try {
          imageResult = await callGrokImage(imgPrompt, createR2Key(userId, `image${index}-grok.png`));
        } catch (grokError) {
          console.error('[SHORTFORM-BROLL] All image providers failed for asset ' + index);
          failures.push(`asset${index}:FLUX+Imagen+Grok all failed`);
          return null;
        }
      }
    }

    // ── Step 2: 첫 씬만 Kling Pro I2V → Veo 폴백 ──
    if (isFirstScene && imageResult?.r2Url) {
      const videoPrompt = buildVisualPrompt(scene.visual, visualStyle, 'video', true);
      const videoKey = createR2Key(userId, `i2v${index}.mp4`);
      // Kling Pro 시도
      try {
        const videoResult = await callKlingI2V(videoPrompt, videoKey, imageResult.r2Url);
        return videoResult;
      } catch (klingError) {
        console.warn('[SHORTFORM-BROLL] Kling I2V failed for first scene:', klingError.message);
        // Veo 폴백
        if (hasVeoConfig() && imageResult.base64) {
          try {
            const veoResult = await callVeoI2V(videoPrompt, videoKey + '-veo.mp4', imageResult.base64);
            return veoResult;
          } catch (veoError) {
            console.warn('[SHORTFORM-BROLL] Veo I2V fallback also failed:', veoError.message);
          }
        }
        // I2V 모두 실패 → 이미지로 폴백
        return imageResult;
      }
    }

    return imageResult;
  }

  const BATCH_SIZE = 2;
  const items = [];
  for (let i = 0; i < brollScenes.length; i += BATCH_SIZE) {
    const batch = brollScenes.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(
      batch.map(function(scene, batchIndex) {
        return generateWithFallback(scene, i + batchIndex, i + batchIndex === 0);
      })
    );
    batchResults.forEach(function(result) { if (result) items.push(result); });
  }
  if (items.length === 0) {
    const reason = failures.length ? ` (${failures.slice(0, 2).join(' | ')})` : '';
    throw new HttpError(502, 'B-roll 생성에 실패했습니다. 잠시 후 다시 시도해주세요.' + reason);
  }

  await logUsage(userEmail, 'shortform-broll', null, ip);
  return { status: 200, body: { items } };
}

export function normalizeBrollError(error) {
  if (error instanceof HttpError) {
    return { status: error.status, message: error.message };
  }
  return { status: 500, message: error?.message || '서버 오류가 발생했습니다.' };
}
