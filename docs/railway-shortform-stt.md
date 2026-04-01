# Railway Shortform STT Service

## Goal

Move Whisper transcription off Vercel so the web app keeps using Vercel for UI/auth/light APIs while long-running media work runs on Railway.

Current split:

- `Vercel`
  - `shortform.html`
  - login/session issuance
  - B-roll and other light APIs
- `Railway`
  - `services/shortform-stt-service/server.js`
  - session validation
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
  - legacy/fallback endpoint

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
KV_REST_API_URL=...
KV_REST_API_TOKEN=...
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

For direct browser -> Railway STT, Vercel does not need STT proxy env vars.

The shortform page is hardcoded to call the Railway STT URL in production and `/api/shortform-stt` only on localhost.

Keep Vercel focused on static hosting, login flow, and light APIs like B-roll.

If you still want to preserve the Vercel proxy path as a fallback, add these variables to Vercel:

```bash
SHORTFORM_STT_SERVICE_URL=https://your-railway-domain.up.railway.app
STT_SERVICE_SHARED_SECRET=the-same-secret-as-railway
```

If both values are present, `api/shortform-stt.js` can proxy to Railway.

## Request flow

### Current shortform flow

1. Browser uploads/records audio.
2. Browser sends `POST https://<railway-domain>/api/shortform-stt`.
3. Browser includes the login Bearer token from localStorage.
4. Railway validates that token against Upstash session storage.
5. Railway calls OpenAI Whisper.
6. Railway returns transcript JSON directly to the browser.

## Probe flow

These work through the Railway STT service:

- `GET https://<railway-domain>/api/shortform-stt?probe=ping`
- `GET https://<railway-domain>/api/shortform-stt?probe=models`
- `GET https://<railway-domain>/api/shortform-stt?probe=transcribe-dry`
- `shortform.html?stt_probe=raw`
- `shortform.html?stt_probe=form`

They are useful to distinguish:

- session validation issues
- Railway service issues
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
