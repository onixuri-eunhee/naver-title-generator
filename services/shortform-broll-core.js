import { randomUUID } from 'node:crypto';

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

export const BROLL_VERSION = 'v2-image-fallback-default';

const GROK_IMAGE_MODEL = 'grok-2-image';
const GROK_IMAGE_SIZE = '1024x1792';
const CLIP_DURATION_SEC = 5;
const SEEDANCE_POLL_INTERVAL_MS = 4000;
const SEEDANCE_TIMEOUT_MS = 30000;
const EXTERNAL_FETCH_TIMEOUT_MS = 45000;

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

function buildVisualPrompt(suggestion, scriptContext, kind) {
  const context = (scriptContext || '').trim();
  if (kind === 'video') {
    return [
      suggestion.trim(),
      'Create a cinematic vertical 9:16 short-form B-roll clip with realistic motion, natural lighting, and no on-screen text.',
      `Target duration: ${CLIP_DURATION_SEC} seconds.`,
      context ? `Story context: ${context}` : '',
    ].filter(Boolean).join('\n');
  }

  return [
    suggestion.trim(),
    'Create a cinematic vertical 9:16 still image for short-form video B-roll. Realistic, clean, and no on-screen text.',
    context ? `Story context: ${context}` : '',
  ].filter(Boolean).join('\n');
}

function createR2Key(userId, suffix) {
  return `shortform-broll/${userId}/${getKSTDate()}/${randomUUID()}-${suffix}`;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
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

async function callGrokImage(prompt, key) {
  if (!process.env.XAI_API_KEY) throw new Error('XAI_API_KEY is missing');

  const response = await fetchWithTimeout('https://api.x.ai/v1/images/generations', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.XAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: GROK_IMAGE_MODEL,
      prompt,
      n: 1,
      size: GROK_IMAGE_SIZE,
    }),
  });
  const data = await parseJsonResponse(response);
  if (!response.ok) throw new Error(`Grok image failed: ${response.status} ${JSON.stringify(data)}`);
  const imagePayload = data?.data?.[0] || data?.images?.[0] || data;
  const asset = await persistImageResult(imagePayload, key);
  return { type: 'image', url: asset.url, r2Url: asset.r2Url, prompt };
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

async function createClipWithFallback(prompt, userId, clipNumber) {
  if (!(process.env.SEEDANCE_API_KEY || '').trim()) {
    return callGrokImage(prompt, createR2Key(userId, `clip${clipNumber}-fallback.png`));
  }

  try {
    return await callSeedanceVideo(prompt, createR2Key(userId, `clip${clipNumber}.mp4`));
  } catch (error) {
    console.error(`[SHORTFORM-BROLL] Seedance clip ${clipNumber} failed, falling back to Grok image:`, error.message);
    return callGrokImage(prompt, createR2Key(userId, `clip${clipNumber}-fallback.png`));
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
          hasXaiKey: !!((process.env.XAI_API_KEY || '').trim()),
          hasSeedanceKey: !!((process.env.SEEDANCE_API_KEY || '').trim()),
          hasR2: !!(process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY && process.env.R2_BUCKET_NAME),
        },
      };
    }
    throw new HttpError(405, 'Method not allowed');
  }

  if (method !== 'POST') throw new HttpError(405, 'Method not allowed');

  const body = parseRequestBody(rawBody ? rawBody.toString('utf8') : '');
  const brollSuggestions = Array.isArray(body.brollSuggestions)
    ? body.brollSuggestions.map(item => typeof item === 'string' ? item.trim() : '').filter(Boolean)
    : [];
  const scriptContext = typeof body.scriptContext === 'string' ? body.scriptContext.trim() : '';

  if (brollSuggestions.length < 3) {
    throw new HttpError(400, 'brollSuggestions는 비어 있지 않은 영어 설명 3개가 필요합니다.');
  }
  if (!scriptContext) {
    throw new HttpError(400, 'scriptContext가 필요합니다.');
  }

  const userId = getSafeUserId(userEmail, ip);
  const imagePrompt = buildVisualPrompt(brollSuggestions[0], scriptContext, 'image');
  const clipPrompt1 = buildVisualPrompt(brollSuggestions[1], scriptContext, 'video');
  const clipPrompt2 = buildVisualPrompt(brollSuggestions[2], scriptContext, 'video');

  const [heroImage, clip1, clip2] = await Promise.all([
    callGrokImage(imagePrompt, createR2Key(userId, 'img.png')).catch(error => {
      console.error('[SHORTFORM-BROLL] Grok hero image failed:', error.message);
      return null;
    }),
    createClipWithFallback(clipPrompt1, userId, 1).catch(error => {
      console.error('[SHORTFORM-BROLL] Clip 1 failed:', error.message);
      return null;
    }),
    createClipWithFallback(clipPrompt2, userId, 2).catch(error => {
      console.error('[SHORTFORM-BROLL] Clip 2 failed:', error.message);
      return null;
    }),
  ]);

  const items = [heroImage, clip1, clip2].filter(Boolean);
  if (items.length === 0) {
    throw new HttpError(502, 'B-roll 생성에 실패했습니다. 잠시 후 다시 시도해주세요.');
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
