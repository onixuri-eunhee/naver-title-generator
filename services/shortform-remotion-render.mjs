import path from 'node:path';
import fs from 'node:fs';
import {bundle} from '@remotion/bundler';
import {renderMedia, selectComposition} from '@remotion/renderer';
import {fileURLToPath} from 'node:url';

let cachedServeUrl = null;
const SHORTFORM_REMOTION_ID = 'ShortformRemotion';
export const SHORTFORM_REMOTION_VERSION = 'v2-remotion-stt-sync';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function resolveBrowserExecutable() {
  const candidates = [
    process.env.REMOTION_BROWSER_EXECUTABLE,
    process.env.PUPPETEER_EXECUTABLE_PATH,
    '/usr/lib/chromium/chromium',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome',
  ].filter(Boolean);

  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

async function getServeUrl() {
  if (cachedServeUrl) return cachedServeUrl;

  cachedServeUrl = await bundle({
    entryPoint: path.join(__dirname, '..', 'remotion', 'index.jsx'),
    webpackOverride: (config) => config,
  });

  return cachedServeUrl;
}

export async function renderShortformRemotion({
  inputProps,
  outputLocation,
  codec = 'h264',
}) {
  const serveUrl = await getServeUrl();
  const browserExecutable = resolveBrowserExecutable() || undefined;
  const chromeMode = browserExecutable ? 'chrome-for-testing' : 'headless-shell';
  console.info('[shortform-remotion] browserExecutable=%s chromeMode=%s', browserExecutable || 'downloaded-shell', chromeMode);
  const composition = await selectComposition({
    id: SHORTFORM_REMOTION_ID,
    serveUrl,
    inputProps,
    browserExecutable,
    chromeMode,
    chromiumOptions: {
      gl: 'angle',
    },
    timeoutInMilliseconds: 120000,
  });

  await renderMedia({
    serveUrl,
    composition,
    inputProps,
    outputLocation,
    codec,
    browserExecutable,
    chromeMode,
    overwrite: true,
    chromiumOptions: {
      gl: 'angle',
    },
    timeoutInMilliseconds: 120000,
  });

  return {
    outputLocation,
    durationInFrames: composition.durationInFrames,
    fps: composition.fps,
  };
}
