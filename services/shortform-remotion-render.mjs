import path from 'node:path';
import {bundle} from '@remotion/bundler';
import {renderMedia, selectComposition} from '@remotion/renderer';
import {fileURLToPath} from 'node:url';

let cachedServeUrl = null;
const SHORTFORM_REMOTION_ID = 'ShortformRemotion';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
  const composition = await selectComposition({
    id: SHORTFORM_REMOTION_ID,
    serveUrl,
    inputProps,
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
