import { publishProgress, checkCancelled } from '@/lib/job-progress';
import { generateClaudeScript } from '@/lib/shortform/script-claude.js';
import {
  buildCaptionFallbacks,
  captionsAreDuplicate,
  isValidCaption,
} from '@/lib/shortform/caption-fallback.js';

function finalizeLegacyCaptions(script) {
  const needInsta = !isValidCaption(script?.captionInstagram);
  const needYT = !isValidCaption(script?.captionYouTube);
  const isDup =
    isValidCaption(script?.captionInstagram) &&
    isValidCaption(script?.captionYouTube) &&
    captionsAreDuplicate(script.captionInstagram, script.captionYouTube);

  if (needInsta || needYT || isDup) {
    const { captionInstagram, captionYouTube } = buildCaptionFallbacks(
      script?.scenes || [],
    );
    if (needInsta || isDup) script.captionInstagram = captionInstagram;
    if (needYT || isDup) script.captionYouTube = captionYouTube;
    console.warn(
      `[SHORTFORM-SCRIPT] caption fallback applied: needInsta=${needInsta} needYT=${needYT} isDup=${isDup}`,
    );
  }
  if (!script.caption) script.caption = script.captionInstagram || '';
}

export async function generateLegacyScript(ctx) {
  console.log(
    `[SHORTFORM-SCRIPT] Legacy path: prompt assets only (contentType=${ctx.contentType})`,
  );

  await publishProgress(ctx.jobId, {
    type: 'step',
    step: 'script-generation',
    status: 'running',
    progress: 40,
    subStep: 'claude',
  });
  await checkCancelled(ctx.jobId, 'script:claude-call');

  const script = await generateClaudeScript({
    topic: ctx.topic,
    blogText: ctx.blogText,
    tone: ctx.tone,
    targetDurationSec: ctx.targetDurationSec,
    concept: ctx.concept,
    targetSceneCount: ctx.targetSceneCount,
    personaMemo: ctx.personaMemo,
    settings: ctx.settings,
    layoutMode: ctx.layoutMode,
    email: ctx.email,
  });

  finalizeLegacyCaptions(script);

  return script;
}
