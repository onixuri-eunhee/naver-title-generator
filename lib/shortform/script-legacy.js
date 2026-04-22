import { publishProgress, checkCancelled } from '@/lib/job-progress';
import { generateClaudeScript } from '@/lib/shortform/script-claude.js';
import { resolveBenchmark } from '@/lib/shortform/benchmark-resolver.js';
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
  await publishProgress(ctx.jobId, {
    type: 'step',
    step: 'script-generation',
    status: 'running',
    progress: 15,
    subStep: 'benchmark',
  });
  await checkCancelled(ctx.jobId, 'script:benchmark');

  // 2026-04-22 복원 — pre-bbaa553 legacy 주입 체인 되살리기.
  // resolveBenchmark 는 self-call + Haiku 분석 실패 시 null 을 돌려 조용히 fallback 한다.
  const benchmark = await resolveBenchmark({
    topic: ctx.topic,
    blogText: ctx.blogText,
    jobId: ctx.jobId,
    contentType: ctx.contentType,
  });

  console.log(
    `[SHORTFORM-SCRIPT] Legacy path: benchmark=${benchmark?.patterns ? 'patterns' : 'fallback'} (contentType=${ctx.contentType})`,
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
    benchmark,
  });

  finalizeLegacyCaptions(script);

  return script;
}
