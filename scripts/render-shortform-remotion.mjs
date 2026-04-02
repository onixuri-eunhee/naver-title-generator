import fs from 'node:fs/promises';
import path from 'node:path';
import {renderShortformRemotion} from '../services/shortform-remotion-render.mjs';

async function main() {
  const inputArg = process.argv[2];
  if (!inputArg) {
    console.error('Usage: npm run remotion:render-shortform -- <input-json> [output-file]');
    process.exit(1);
  }

  const inputPath = path.resolve(process.cwd(), inputArg);
  const outputArg = process.argv[3] || 'tmp/shortform-remotion.mp4';
  const outputPath = path.resolve(process.cwd(), outputArg);
  const raw = await fs.readFile(inputPath, 'utf8');
  const inputProps = JSON.parse(raw);

  await fs.mkdir(path.dirname(outputPath), {recursive: true});

  const result = await renderShortformRemotion({
    inputProps,
    outputLocation: outputPath,
  });

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
