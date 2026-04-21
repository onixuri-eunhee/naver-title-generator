import { logUsage } from '@/lib/db';
import {
  publishProgress,
  checkCancelled,
  cleanupJob,
} from '@/lib/job-progress';
import { CancelledError } from '@/lib/cancelled-error';
import {
  migrateSettings,
  validateSettings,
  SETTINGS_SCHEMA_VERSION,
} from '@/lib/shortform/settings.js';
import { getDesignTokens } from '@/lib/shortform/design-tokens.js';
import { generatePersonaScript } from '@/lib/shortform/script-persona.js';
import { generateLegacyScript } from '@/lib/shortform/script-legacy.js';
import {
  toSentence,
  resolveConcept,
  CREDIT_COSTS,
  SCENE_COUNTS,
  LONGFORM_SCENE_COUNT,
  VALID_SHORTFORM_DURATIONS,
  VALID_LONGFORM_DURATIONS,
} from '@/lib/shortform/script-payload.js';

function normalizeScriptRequest(body) {
  const topic = toSentence(body?.topic);
  const blogText = String(body?.blogText || '').trim();
  const personaMemo = String(body?.personaMemo || '').trim();
  const tone = body?.tone === 'professional' ? 'professional' : 'casual';

  const settings = migrateSettings(body?.settings || {});
  const settingsCheck = validateSettings(settings);
  if (!settingsCheck.ok) {
    console.warn(
      '[shortform-script] settings validation failed, continuing with merged defaults:',
      settingsCheck.errors,
    );
  }

  const contentType = body?.contentType === 'longform' ? 'longform' : 'shortform';
  const isLongform = contentType === 'longform';
  const validDurations = isLongform ? VALID_LONGFORM_DURATIONS : VALID_SHORTFORM_DURATIONS;
  const defaultDuration = isLongform ? 180 : 30;
  const targetDurationSec = validDurations.includes(Number(body?.targetDurationSec))
    ? Number(body.targetDurationSec)
    : defaultDuration;
  const creditCost = CREDIT_COSTS[contentType]?.[targetDurationSec] || 0;

  const personaId = String(body?.personaId || body?.persona || '').trim();
  const customPersonaLabel = body?.customPersonaLabel
    ? String(body.customPersonaLabel).slice(0, 30)
    : null;
  const customPersonaHint = body?.customPersonaHint
    ? String(body.customPersonaHint).slice(0, 100)
    : null;
  const userExperience = String(body?.userExperience || body?.personaMemo || '').trim();
  const keywords = String(body?.keywords || '').trim();
  const benchmarkAggregated = body?.benchmarkAggregated || null;
  const layoutMode = body?.visualStyle === 'kinetic' ? 'kinetic' : 'image';
  const conceptInput = ['cinematic', 'minimal', 'dynamic', 'natural', 'random'].includes(body?.concept)
    ? body.concept
    : 'cinematic';
  const concept = resolveConcept(conceptInput);
  const targetSceneCount = isLongform
    ? LONGFORM_SCENE_COUNT
    : (SCENE_COUNTS[targetDurationSec] || SCENE_COUNTS[30]);

  return {
    topic,
    blogText,
    personaMemo,
    tone,
    settings,
    contentType,
    isLongform,
    targetDurationSec,
    creditCost,
    personaId,
    customPersonaLabel,
    customPersonaHint,
    userExperience,
    keywords,
    benchmarkAggregated,
    layoutMode,
    concept,
    targetSceneCount,
  };
}

function warnIfScriptTooShort(script, targetDurationSec) {
  if (script?.estimatedSeconds && script.estimatedSeconds < targetDurationSec * 0.85) {
    const fullText = (script.scenes || []).map((scene) => scene.script || '').join('');
    const charCount = fullText.replace(/\s+/g, '').length;
    console.warn(
      `[SHORTFORM-SCRIPT] 분량 부족: ${charCount}자 (목표 ${targetDurationSec * 5}자), ` +
      `추정 ${script.estimatedSeconds}초 (목표 ${targetDurationSec}초)`,
    );
  }
}

async function finalizeScriptResult({ jobId, script, settings, tone, email, ip }) {
  await publishProgress(jobId, {
    type: 'step',
    step: 'script-generation',
    status: 'done',
    progress: 100,
    result: { sceneCount: script?.scenes?.length || 0 },
  });

  await logUsage(email, 'shortform-script', tone, ip || '');

  const resolvedCategory = script?._resolvedCategory || settings?.category || '';
  const designTokens = resolvedCategory && resolvedCategory !== 'auto'
    ? await getDesignTokens(resolvedCategory)
    : await getDesignTokens('other');

  const responsePayload = {
    jobId,
    script,
    settings,
    settingsVersion: SETTINGS_SCHEMA_VERSION,
    designTokens,
  };

  await publishProgress(jobId, {
    type: 'complete',
    result: responsePayload,
  });

  return responsePayload;
}

/**
 * @param {Object} params
 * @param {string} params.jobId
 * @param {string|null} params.email
 * @param {boolean} params.isAdmin
 * @param {string|null} params.ip
 * @param {Object} params.body
 * @returns {Promise<Object>}
 */
export async function runScriptGeneration({ jobId, email, isAdmin, ip, body }) {
  try {
    const ctx = normalizeScriptRequest(body);

    await publishProgress(jobId, {
      type: 'step',
      step: 'script-generation',
      status: 'running',
      progress: 0,
      subStep: 'draft',
    });
    await checkCancelled(jobId, 'script:draft-start');

    const script = ctx.personaId
      ? await generatePersonaScript({ ...ctx, email, isAdmin, ip, jobId })
      : await generateLegacyScript({ ...ctx, email, isAdmin, ip, jobId });

    warnIfScriptTooShort(script, ctx.targetDurationSec);

    return finalizeScriptResult({
      jobId,
      script,
      settings: ctx.settings,
      tone: ctx.tone,
      email,
      ip,
    });
  } catch (error) {
    if (error instanceof CancelledError) {
      await publishProgress(jobId, {
        type: 'cancelled',
        cancelledAt: error.checkpoint,
      });
      throw error;
    }
    console.error('shortform-script API Error:', error);
    await publishProgress(jobId, {
      type: 'error',
      error: error?.message || 'script generation error',
      step: 'script-generation',
    });
    throw error;
  } finally {
    await cleanupJob(jobId);
  }
}
