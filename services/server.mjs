import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import {
  renderShortformRemotion,
  SHORTFORM_REMOTION_VERSION,
} from './shortform-remotion-render.mjs';
import { postWithRetry } from './webhook-client.mjs';

const app = express();
app.use(express.json({ limit: '10mb' }));

const PORT = process.env.PORT || 8080;
const RENDER_SECRET = process.env.RENDER_SECRET;
const WEBHOOK_BASE_URL = process.env.WEBHOOK_BASE_URL; // 예: https://ddukddaktool.co.kr
const WEBHOOK_PATH = '/api/shortform-render-callback';
// NB: Remotion 내부 timeoutInMilliseconds (shortform-remotion-render.mjs의 RENDER_TIMEOUT_MS, 5분)
// 가 RENDER_HARD_TIMEOUT_MS (10분)보다 작아야 outer Promise.race 발동 시 렌더 프로세스가
// 이미 실패 상태라 leak되지 않음. 이 invariant를 깨면 Chromium/ffmpeg 자식 프로세스가
// 백그라운드에 계속 살아남을 수 있음.
// TODO: cancelSignal 기반 명시적 kill은 후속 PR.
const RENDER_HARD_TIMEOUT_MS = 10 * 60 * 1000;
const PROGRESS_REPORT_STEP = 0.1; // 10% 단위

// ---------------------------------------------------------------------------
// R2 upload
// ---------------------------------------------------------------------------
let _s3 = null;
function getS3() {
  if (_s3) return _s3;
  _s3 = new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
  });
  return _s3;
}

async function uploadToR2(key, filePath) {
  const stat = fs.statSync(filePath);
  const body = fs.createReadStream(filePath);
  // Content-Disposition: attachment — 브라우저가 cross-origin a[download]를 무시하는
  // 문제 회피. R2가 헤더로 "이건 다운로드"를 강제하면 모든 브라우저에서 정상 다운로드.
  const downloadFilename = key.split('/').pop() || 'shortform.mp4';
  await getS3().send(
    new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: key,
      Body: body,
      ContentType: 'video/mp4',
      ContentLength: stat.size,
      ContentDisposition: `attachment; filename="${downloadFilename}"`,
    }),
  );
  const publicUrl = process.env.R2_PUBLIC_URL || 'https://cdn.ddukddaktool.co.kr';
  return `${publicUrl}/${key}`;
}

// ---------------------------------------------------------------------------
// Webhook helper
// ---------------------------------------------------------------------------
async function reportToVercel(body) {
  if (!WEBHOOK_BASE_URL) {
    console.error('[webhook] WEBHOOK_BASE_URL 미설정 — skip');
    return;
  }
  if (!RENDER_SECRET) {
    console.error('[webhook] RENDER_SECRET 미설정 — webhook 인증 불가, skip');
    return;
  }
  const url = `${WEBHOOK_BASE_URL}${WEBHOOK_PATH}`;
  const result = await postWithRetry(url, body, { secret: RENDER_SECRET });
  if (!result.ok) {
    console.error(
      '[webhook] permanent failure jobId=%s type=%s attempts=%d finalStatus=%s network=%s',
      body.jobId,
      body.type,
      result.attempts,
      result.finalStatus,
      !!result.networkError,
    );
  }
}

// ---------------------------------------------------------------------------
// Background render job
// ---------------------------------------------------------------------------
async function runRenderJob({ jobId, inputProps, outputFilename }) {
  const startMs = Date.now();
  const localPath = path.join('/tmp', `${outputFilename}.mp4`);
  const r2Key = `shortform/${outputFilename}.mp4`;

  let lastReportedProgress = 0;
  let renderDone = false;

  try {
    const renderPromise = renderShortformRemotion({
      inputProps,
      outputLocation: localPath,
      onProgress: (frame) => {
        try {
          const { progress, renderedFrames, encodedFrames, framesTotal } = frame;
          if (progress - lastReportedProgress >= PROGRESS_REPORT_STEP) {
            lastReportedProgress = progress;
            // fire-and-forget (webhook 실패해도 렌더는 계속)
            reportToVercel({
              type: 'progress',
              jobId,
              progress,
              framesRendered: renderedFrames ?? encodedFrames ?? 0,
              framesTotal: framesTotal ?? 0,
            }).catch(() => {});
          }
        } catch {}
      },
    });

    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error('RENDER_TIMEOUT_10MIN')),
        RENDER_HARD_TIMEOUT_MS,
      ),
    );

    const result = await Promise.race([renderPromise, timeoutPromise]);
    renderDone = true;
    console.info('[render] remotion done in %ds', ((Date.now() - startMs) / 1000).toFixed(1));

    const url = await uploadToR2(r2Key, localPath);
    console.info('[render] uploaded to R2: %s', url);

    try { fs.unlinkSync(localPath); } catch {}

    await reportToVercel({
      type: 'complete',
      jobId,
      url,
      durationSec: result.durationInFrames / result.fps,
      elapsedMs: Date.now() - startMs,
    });
  } catch (err) {
    console.error('[render] jobId=%s error:', jobId, err);
    try { fs.unlinkSync(localPath); } catch {}

    const isTimeout = err?.message === 'RENDER_TIMEOUT_10MIN';
    const errorCode = isTimeout
      ? 'TIMEOUT'
      : renderDone
        ? 'R2_UPLOAD_FAILED'
        : 'REMOTION_RENDER_FAILED';

    await reportToVercel({
      type: 'error',
      jobId,
      errorCode,
      errorMessage: String(err?.message || err).slice(0, 500),
    });
  }
}

// ---------------------------------------------------------------------------
// Auth middleware
// ---------------------------------------------------------------------------
function secretsMatch(a, b) {
  if (!a || !b) return false;
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

function authMiddleware(req, res, next) {
  if (!RENDER_SECRET) {
    return res.status(500).json({ error: 'RENDER_SECRET not configured' });
  }
  if (!secretsMatch(req.headers['x-render-secret'], RENDER_SECRET)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// ---------------------------------------------------------------------------
// POST /render — fire-and-forget
// ---------------------------------------------------------------------------
app.post('/render', authMiddleware, async (req, res) => {
  const { jobId, inputProps, outputFilename } = req.body;

  if (!jobId || typeof jobId !== 'string') {
    return res.status(400).json({ error: 'jobId required' });
  }
  if (!inputProps || typeof inputProps !== 'object') {
    return res.status(400).json({ error: 'inputProps required' });
  }
  if (!outputFilename || typeof outputFilename !== 'string') {
    return res.status(400).json({ error: 'outputFilename required' });
  }

  // 즉시 202 반환 (클라가 기다리지 않게)
  res.status(202).json({ jobId, accepted: true });

  // 백그라운드 실행 (await 안 함)
  runRenderJob({ jobId, inputProps, outputFilename }).catch((err) => {
    console.error('[render] unhandled runRenderJob error:', err);
  });
});

// ---------------------------------------------------------------------------
// GET /health
// ---------------------------------------------------------------------------
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', version: SHORTFORM_REMOTION_VERSION });
});

app.listen(PORT, () => {
  console.info('[server] listening on port %d  version=%s', PORT, SHORTFORM_REMOTION_VERSION);
});
