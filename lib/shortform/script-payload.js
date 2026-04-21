import { captionsAreDuplicate } from '@/lib/shortform/caption-fallback.js';

export const SHORTFORM_CREDIT_COSTS = { 30: 6, 45: 10, 60: 11, 90: 12 };
export const LONGFORM_CREDIT_COSTS = { 180: 12, 300: 17, 600: 29 };
export const CREDIT_COSTS = {
  shortform: SHORTFORM_CREDIT_COSTS,
  longform: LONGFORM_CREDIT_COSTS,
};

export const SCENE_COUNTS = { 30: 7, 45: 10, 60: 14, 90: 20 };
export const LONGFORM_SCENE_COUNT = 7;
export const VALID_SHORTFORM_DURATIONS = [30, 45, 60, 90];
export const VALID_LONGFORM_DURATIONS = [180, 300, 600];

const CONCEPTS = {
  cinematic: {
    visualStyle: 'warm cinematic, golden hour lighting, shallow depth of field, film grain',
    textCard: 'dark-gradient',
  },
  minimal: {
    visualStyle: 'clean minimal, white background, soft shadows, modern aesthetic',
    textCard: 'white-clean',
  },
  dynamic: {
    visualStyle: 'vibrant colors, high contrast, bold composition, urban energy',
    textCard: 'bold-accent',
  },
  natural: {
    visualStyle: 'natural daylight, candid feel, organic textures, everyday life',
    textCard: 'soft-overlay',
  },
};

const LONGFORM_SECTIONS = ['hook', 'body1', 'body2', 'body3', 'body4', 'conclusion', 'cta'];
const SHORTFORM_SCENE_TYPES = ['text', 'comparison', 'emphasis', 'testimonial', 'data', 'flow'];

export function toSentence(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

export function resolveConcept(concept) {
  if (concept === 'random') {
    const keys = Object.keys(CONCEPTS);
    const picked = keys[Math.floor(Math.random() * keys.length)];
    return { key: picked, ...CONCEPTS[picked] };
  }
  return CONCEPTS[concept]
    ? { key: concept, ...CONCEPTS[concept] }
    : { key: 'cinematic', ...CONCEPTS.cinematic };
}

function postProcessScenes(scenes, targetSceneCount) {
  if (!Array.isArray(scenes) || scenes.length === 0) return scenes;

  while (scenes.length < targetSceneCount && scenes.length > 0) {
    const longest = scenes.reduce(
      (max, scene, index) => scene.script.length > (scenes[max]?.script.length || 0) ? index : max,
      0,
    );
    const scene = scenes[longest];
    const mid = Math.ceil(scene.script.length / 2);
    const breakAt = scene.script.indexOf('.', mid - 10);
    const splitPos = breakAt > 0 && breakAt < scene.script.length - 2 ? breakAt + 1 : mid;
    const first = { ...scene, script: scene.script.slice(0, splitPos).trim() };
    const second = { ...scene, script: scene.script.slice(splitPos).trim() };
    scenes.splice(longest, 1, first, second);
  }

  while (scenes.length > targetSceneCount && scenes.length > 1) {
    let shortestIdx = 0;
    for (let i = 1; i < scenes.length - 1; i += 1) {
      if (scenes[i].script.length < scenes[shortestIdx].script.length) {
        shortestIdx = i;
      }
    }
    const mergeWith = shortestIdx > 0 ? shortestIdx - 1 : shortestIdx + 1;
    const [a, b] = shortestIdx < mergeWith ? [shortestIdx, mergeWith] : [mergeWith, shortestIdx];
    scenes[a] = { ...scenes[a], script: `${scenes[a].script} ${scenes[b].script}` };
    scenes.splice(b, 1);
  }

  if (scenes[0] && scenes[0].type !== 'broll') {
    scenes[0] = {
      ...scenes[0],
      type: 'broll',
      visual: 'scroll-stopping dramatic cinematic visual for the narration',
    };
  }
  if (scenes[0] && !scenes[0].hookText) {
    scenes[0].hookText = scenes[0].script.replace(/[^가-힣a-zA-Z0-9\s]/g, '').slice(0, 12);
  }

  scenes.forEach((scene) => {
    if (scene.type !== 'broll') {
      scene.type = 'broll';
      if (!scene.visual || !/[a-zA-Z]/.test(scene.visual)) {
        scene.visual = 'supporting visual for the narration';
      }
    }
  });

  return scenes;
}

export function buildLongformScriptPayload(parsed, concept) {
  let scenes = Array.isArray(parsed?.scenes) ? parsed.scenes : [];
  scenes = scenes.filter((scene) => scene && typeof scene.script === 'string' && scene.script.trim());

  if (scenes.length < 3) {
    throw new Error('Claude 롱폼 응답에서 유효한 scenes가 3개 미만입니다.');
  }

  scenes.forEach((scene, index) => {
    scene.script = toSentence(scene.script);
    if (!LONGFORM_SECTIONS.includes(scene.section)) {
      scene.section = LONGFORM_SECTIONS[index] || 'body1';
    }
    const allowed = ['text', 'comparison', 'emphasis', 'testimonial', 'data', 'flow', 'broll'];
    if (!allowed.includes(scene.type)) scene.type = 'text';
    if (scene.type === 'broll') scene.type = 'text';
    scene.visual = toSentence(scene.visual) || 'long-form cinematic supporting visual for the narration';
  });

  while (scenes.length < 7) {
    const last = scenes[scenes.length - 1];
    scenes.push({ ...last, section: LONGFORM_SECTIONS[scenes.length] || 'body4' });
  }
  if (scenes.length > 7) scenes = scenes.slice(0, 7);
  scenes.forEach((scene, index) => {
    scene.section = LONGFORM_SECTIONS[index];
  });

  const hook = scenes[0]?.script || '';
  const body = scenes.slice(1, 5).map((scene) => scene.script);
  const conclusion = scenes[5]?.script || '';
  const cta = scenes[6]?.script || '';
  const fullScript = scenes.map((scene) => scene.script).join('\n\n');
  const spokenLength = fullScript.replace(/\s+/g, '').length;
  const estimatedSeconds = Math.max(1, Math.round(spokenLength / 5));
  const hookText = scenes[0]?.hookText || '';

  return {
    contentType: 'longform',
    hook,
    body,
    points: body,
    conclusion,
    cta,
    fullScript,
    estimatedSeconds,
    scenes,
    visualStyle: concept.visualStyle,
    textCardTemplate: concept.textCard,
    conceptKey: concept.key,
    hookText,
  };
}

export function buildScriptPayload(parsed, concept, targetSceneCount) {
  let scenes = Array.isArray(parsed?.scenes) ? parsed.scenes : [];

  scenes = scenes.filter((scene) => scene && typeof scene.script === 'string' && scene.script.trim());
  scenes.forEach((scene) => {
    scene.script = toSentence(scene.script);
    scene.section = ['hook', 'point', 'cta'].includes(scene.section) ? scene.section : 'point';
    if (!SHORTFORM_SCENE_TYPES.includes(scene.sceneKind)) {
      const originalType = scene.type;
      scene.sceneKind = SHORTFORM_SCENE_TYPES.includes(originalType) ? originalType : 'text';
    }
    scene.type = 'broll';
    scene.visual = toSentence(scene.visual) || 'generic B-roll scene';
  });

  if (scenes.length < 3) {
    throw new Error('Claude 응답에서 유효한 scenes가 3개 미만입니다.');
  }

  scenes = postProcessScenes(scenes, targetSceneCount);

  const hook = scenes.filter((scene) => scene.section === 'hook').map((scene) => scene.script).join(' ');
  const points = scenes.filter((scene) => scene.section === 'point').map((scene) => scene.script);
  const cta = scenes.filter((scene) => scene.section === 'cta').map((scene) => scene.script).join(' ');
  const fullScript = scenes.map((scene) => scene.script).join('\n\n');
  const spokenLength = fullScript.replace(/\s+/g, '').length;
  const estimatedSeconds = Math.max(1, Math.round(spokenLength / 5));
  const hookText = scenes[0]?.hookText || '';

  const parsedCaptionInstagram =
    typeof parsed?.captionInstagram === 'string' ? parsed.captionInstagram : '';
  const parsedCaptionYouTube =
    typeof parsed?.captionYouTube === 'string' ? parsed.captionYouTube : '';
  const parsedCaption =
    typeof parsed?.caption === 'string' ? parsed.caption : '';
  if (
    parsedCaptionInstagram &&
    parsedCaptionYouTube &&
    captionsAreDuplicate(parsedCaptionInstagram, parsedCaptionYouTube)
  ) {
    console.warn(
      '[SHORTFORM-SCRIPT] parsed caption duplicate detected — validator will trigger retry or fallback.',
    );
  }

  return {
    hook,
    points,
    cta,
    fullScript,
    estimatedSeconds,
    scenes,
    visualStyle: concept.visualStyle,
    textCardTemplate: concept.textCard,
    conceptKey: concept.key,
    hookText,
    captionInstagram: parsedCaptionInstagram,
    captionYouTube: parsedCaptionYouTube,
    caption: parsedCaption,
  };
}
