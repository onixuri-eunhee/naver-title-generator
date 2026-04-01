# Railway Shortform STT Service

## Goal

Move Whisper transcription off Vercel so the web app keeps using Vercel for UI/auth/light APIs while long-running media work runs on Railway.

Current split:

- `Vercel`
  - `shortform.html`
  - auth/session checks
  - `api/shortform-stt.js` proxy
- `Railway`
  - `services/shortform-stt-service/server.js`
  - actual OpenAI transcription call

## Why this split

- Vercel is good for fast request/response APIs.
- STT and future longform/video automation are heavier, slower, and more failure-prone inside serverless limits.
- Railway is already in use on the paid plan, so this is the lowest-friction step.

## Files

- `services/shortform-stt-core.js`
  - shared transcription logic
- `services/shortform-stt-service/server.js`
  - Railway HTTP service
- `api/shortform-stt.js`
  - Vercel auth + proxy

## Railway setup

### Start command

```bash
npm run railway:shortform-stt
```

### Required environment variables on Railway

```bash
OPENAI_API_KEY=...
STT_SERVICE_SHARED_SECRET=...
SHORTFORM_STT_MAX_AUDIO_MB=20
```

### Health check

```text
GET /health
```

Expected response:

```json
{
  "ok": true,
  "service": "shortform-stt",
  "version": "v4-railway-service",
  "hasOpenAIKey": true,
  "maxAudioMb": 20
}
```

## Vercel setup

Add these environment variables to Vercel:

```bash
SHORTFORM_STT_SERVICE_URL=https://your-railway-domain.up.railway.app
STT_SERVICE_SHARED_SECRET=the-same-secret-as-railway
```

If both values are present, `api/shortform-stt.js` proxies to Railway.

If either value is missing, Vercel falls back to the local STT path.

## Request flow

### Current shortform flow

1. Browser uploads/records audio.
2. Browser calls `POST /api/shortform-stt` on Vercel.
3. Vercel checks login/admin.
4. Vercel forwards the raw request body to Railway with `X-Stt-Service-Secret`.
5. Railway calls OpenAI Whisper.
6. Railway returns transcript JSON.
7. Vercel returns the same JSON to the browser.

## Probe flow

These still work through Vercel:

- `GET /api/shortform-stt?probe=ping`
- `GET /api/shortform-stt?probe=models`
- `GET /api/shortform-stt?probe=transcribe-dry`
- `shortform.html?stt_probe=raw`
- `shortform.html?stt_probe=form`

They are useful to distinguish:

- Vercel boot issues
- proxy issues
- Railway outbound issues
- OpenAI endpoint issues

## Future longform architecture

This STT service should be treated as the first media worker, not the final architecture.

Recommended next evolution:

- `Vercel`
  - UI
  - auth
  - job submission
  - result polling
- `Railway media worker`
  - shortform STT
  - longform STT
  - transcript chunking
  - summarization
  - scene extraction
  - retry queue

For longform, prefer this over synchronous browser -> Vercel -> worker requests:

1. Browser uploads media to object storage.
2. Vercel creates a job.
3. Railway worker consumes the job.
4. Worker writes progress/result back.
5. Browser polls or receives callback/websocket updates.

That avoids keeping a browser request open for long transcriptions.
