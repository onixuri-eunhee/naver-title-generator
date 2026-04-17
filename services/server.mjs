import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import {
  renderShortformRemotion,
  SHORTFORM_REMOTION_VERSION,
} from './shortform-remotion-render.mjs';

const app = express();
app.use(express.json({ limit: '10mb' }));

const PORT = process.env.PORT || 8080;
const RENDER_SECRET = process.env.RENDER_SECRET;

// ---------------------------------------------------------------------------
// R2 upload (self-contained — no lib/ import)
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
  const body = fs.readFileSync(filePath);
  await getS3().send(
    new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: key,
      Body: body,
      ContentType: 'video/mp4',
    }),
  );
  const publicUrl = process.env.R2_PUBLIC_URL || 'https://cdn.ddukddaktool.co.kr';
  return `${publicUrl}/${key}`;
}

// ---------------------------------------------------------------------------
// Auth middleware
// ---------------------------------------------------------------------------
function authMiddleware(req, res, next) {
  if (!RENDER_SECRET) {
    return res.status(500).json({ error: 'RENDER_SECRET not configured' });
  }
  if (req.headers['x-render-secret'] !== RENDER_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// ---------------------------------------------------------------------------
// POST /render
// ---------------------------------------------------------------------------
app.post('/render', authMiddleware, async (req, res) => {
  const startMs = Date.now();
  const { inputProps, outputFilename } = req.body;

  if (!inputProps || !outputFilename) {
    return res.status(400).json({ error: 'inputProps and outputFilename are required' });
  }

  const localPath = path.join('/tmp', `${outputFilename}.mp4`);
  const r2Key = `shortform/${outputFilename}.mp4`;

  try {
    console.info('[render] start outputFilename=%s', outputFilename);

    const result = await renderShortformRemotion({
      inputProps,
      outputLocation: localPath,
    });

    console.info('[render] remotion done in %ds', ((Date.now() - startMs) / 1000).toFixed(1));

    // Upload to R2
    const url = await uploadToR2(r2Key, localPath);
    console.info('[render] uploaded to R2: %s', url);

    // Clean up local file
    fs.unlinkSync(localPath);

    res.json({
      url,
      duration: result.durationInFrames / result.fps,
      durationInFrames: result.durationInFrames,
      fps: result.fps,
      elapsedMs: Date.now() - startMs,
    });
  } catch (err) {
    console.error('[render] error:', err);
    // Clean up on failure
    try { fs.unlinkSync(localPath); } catch {}
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /health
// ---------------------------------------------------------------------------
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', version: SHORTFORM_REMOTION_VERSION });
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
app.listen(PORT, () => {
  console.info('[server] listening on port %d  version=%s', PORT, SHORTFORM_REMOTION_VERSION);
});
