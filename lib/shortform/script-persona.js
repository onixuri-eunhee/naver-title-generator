import { generateScriptFlow } from '@/lib/script-flow';
import { buildPromptContextForEmail } from '@/lib/brand-kit';
import { publishProgress, checkCancelled } from '@/lib/job-progress';
import {
  buildScriptPayload,
  buildLongformScriptPayload,
} from '@/lib/shortform/script-payload.js';

export async function generatePersonaScript(ctx) {
  const {
    email,
    topic,
    blogText,
    userExperience,
    personaId,
    customPersonaLabel,
    customPersonaHint,
    tone,
    contentType,
    targetDurationSec,
    benchmarkAggregated,
    concept,
    targetSceneCount,
    isLongform,
    creditCost,
    jobId,
    keywords,
  } = ctx;

  let brandContext = null;
  if (email) {
    brandContext = await buildPromptContextForEmail(email);
  }

  console.log(
    `[SHORTFORM-SCRIPT] Phase D path: type=${contentType} persona=${personaId} tone=${tone} dur=${targetDurationSec}s ` +
    `cost=${creditCost}cr benchmark=${benchmarkAggregated ? 'yes' : 'no'} brandKit=${brandContext ? 'yes' : 'no'}`,
  );

  console.log(
    '[SHORTFORM-METRICS]',
    JSON.stringify({
      mode: 'phaseD_bypass',
      personaId,
      contentType,
      emailPrefix: (email || 'anon').slice(0, 3) + '***',
      timestamp: new Date().toISOString(),
    }),
  );

  const flowResult = await generateScriptFlow({
    blogText,
    keywords: keywords || topic,
    userExperience,
    personaId,
    customPersonaLabel,
    customPersonaHint,
    tone,
    contentType,
    durationSec: targetDurationSec,
    benchmarkAggregated,
    brandContext,
  });

  await publishProgress(jobId, {
    type: 'step',
    step: 'script-generation',
    status: 'running',
    progress: 60,
    subStep: 'caption',
  });
  await checkCancelled(jobId, 'script:caption-done');

  const script = isLongform
    ? buildLongformScriptPayload(
        {
          scenes: flowResult.scenes,
          totalDuration: flowResult.totalDuration,
          presetUsed: flowResult.presetUsed,
        },
        concept,
      )
    : buildScriptPayload(
        {
          scenes: flowResult.scenes,
          totalDuration: flowResult.totalDuration,
          presetUsed: flowResult.presetUsed,
        },
        concept,
        targetSceneCount,
      );

  script.captionInstagram = flowResult.captionInstagram || flowResult.caption || '';
  script.captionYouTube = flowResult.captionYouTube || '';
  script.caption = flowResult.caption || flowResult.captionInstagram || '';
  script.warnings = flowResult.warnings;
  script.personaId = personaId;
  script.contentType = contentType;
  script.creditCost = creditCost;

  return script;
}
