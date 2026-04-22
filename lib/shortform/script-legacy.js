import { publishProgress, checkCancelled } from '@/lib/job-progress';
import { generateClaudeScript, inferCategory } from '@/lib/shortform/script-claude.js';
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

  // Sprint 1 (4/22) — category 먼저 결정해서 코퍼스 lookup 에 쓴다.
  // 뒤에서 generateClaudeScript 에도 preResolvedCategory 로 넘겨 Haiku 재호출 방지.
  let category = ctx.settings?.category;
  if (category === 'auto') {
    category = await inferCategory(ctx.topic || (ctx.blogText || '').slice(0, 100));
    console.log(`[SHORTFORM-SCRIPT] (legacy) inferCategory -> ${category}`);
  }

  const benchmark = await resolveBenchmark({
    topic: ctx.topic,
    blogText: ctx.blogText,
    category,
    jobId: ctx.jobId,
    contentType: ctx.contentType,
  });

  console.log(
    `[SHORTFORM-SCRIPT] Legacy path: benchmark=${benchmark?.source || 'none'} (category=${category} · contentType=${ctx.contentType})`,
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
    preResolvedCategory: category,
  });

  finalizeLegacyCaptions(script);

  return script;
}
