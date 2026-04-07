# 숏폼 씬 기반 리팩토링 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 숏폼 파이프라인을 씬 기반 구조로 리팩토링하여 대본↔영상 1:1 매핑, 컨셉 4종, 텍스트 카드, ElevenLabs TTS, 자막 편집 기능을 구현한다.

**Architecture:** Claude가 대본을 scenes 배열로 생성 → 서버 후처리(비율/연속 보정) → broll 씬만 Imagen 3 + Veo i2v 자산 생성 → ElevenLabs TTS 또는 파일 업로드 → Whisper STT → Remotion 렌더링(broll 씬 + 텍스트 카드 씬 + 자막 오버레이)

**Tech Stack:** Claude Sonnet 4, Imagen 3, Veo 3.1 Lite, ElevenLabs TTS, Whisper STT, Remotion, Vercel Serverless

**Spec:** `docs/superpowers/specs/2026-04-08-shortform-scene-refactor-design.md`

---

## 파일 구조

### 수정 파일
| 파일 | 역할 |
|------|------|
| `api/shortform-script.js` | SYSTEM_PROMPT scenes 스키마 + 후처리 + 컨셉 상수 |
| `services/shortform-broll-core.js` | scenes 입력 처리 + text 씬 스킵 + 프롬프트 변경 |
| `api/shortform-broll.js` | scenes 기반 요청 파싱 |
| `api/shortform-stt.js` | 녹음 관련 코드 제거, TTS 오디오 입력 처리 |
| `shortform.html` | 컨셉 선택 UI + 음성 선택 UI + 녹음 제거 + scenes 렌더링 + 자막 편집 UI |
| `remotion/shortform/ShortformComposition.jsx` | TextCardLayer 추가 + text 씬 자막 숨김 |
| `remotion/shortform/timeline.js` | scenes 기반 타임라인 빌드 지원 |
| `vercel.json` | shortform-tts 라우트 추가 |

### 신규 파일
| 파일 | 역할 |
|------|------|
| `api/shortform-tts.js` | ElevenLabs TTS API 엔드포인트 |
| `remotion/shortform/TextCard.jsx` | 텍스트 카드 컴포넌트 4종 (cinematic/minimal/dynamic/natural) |

---

## Task 1: 컨셉 상수 + scenes 스키마 (shortform-script.js)

**Files:**
- Modify: `api/shortform-script.js`

- [ ] **Step 1: 컨셉 상수 추가**

`api/shortform-script.js` 파일 상단, `const MODEL = ...` 아래에 추가:

```js
const SCENE_COUNTS = { 30: 7, 45: 10, 60: 14, 90: 20 };

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

function resolveConcept(concept) {
  if (concept === 'random') {
    const keys = Object.keys(CONCEPTS);
    return { key: keys[Math.floor(Math.random() * keys.length)], ...CONCEPTS[keys[Math.floor(Math.random() * keys.length)]] };
  }
  return CONCEPTS[concept] ? { key: concept, ...CONCEPTS[concept] } : { key: 'cinematic', ...CONCEPTS.cinematic };
}
```

- [ ] **Step 2: SYSTEM_PROMPT를 scenes 기반으로 변경**

기존 `const SYSTEM_PROMPT = ...` 전체를 교체:

```js
const SYSTEM_PROMPT = `당신은 한국어 숏폼 영상 대본 작가입니다. 사용자의 입력을 바탕으로 숏폼 대본을 scenes 배열로 작성하세요.

[절대 규칙]
1. 반드시 존댓말만 사용하세요. 반말, 유행어 남발, 과장된 말투는 금지입니다.
2. 출력은 설명 없이 순수 JSON 객체 하나만 반환하세요. 마크다운 코드블록, 부가 설명, 서문 금지입니다.
3. 사실은 사용자가 제공한 topic과 blogText 안에서만 사용하세요. 입력에 없는 구체적 수치나 사례를 지어내지 마세요.
4. 대본은 자연스러운 내레이션 문장으로 작성하세요.

[HPC 법칙]
- Hook(처음 3초): 시청자의 고민이나 궁금증을 즉시 자극하는 질문 또는 충격적 사실
- Point(핵심 내용): 3개 이내의 핵심 포인트
- CTA(행동 유도): 댓글, 팔로우, 저장 중 하나 이상을 자연스럽게 유도

[출력 JSON 스키마]
{
  "scenes": [
    {
      "script": "대본 문장 (한국어, 1~2문장)",
      "section": "hook | point | cta",
      "type": "broll | text",
      "visual": "broll이면 영어 B-roll 이미지 설명 / text면 화면에 표시할 핵심 문구 (한국어, 15자 이내)"
    }
  ]
}

[scenes 규칙]
- scenes 개수는 targetSceneCount에 맞추세요
- 각 scene의 script는 1~2문장, 자연스러운 내레이션
- type은 대본 내용에 따라 자유롭게 판단하세요
- broll의 visual은 구체적인 영어 이미지 설명 (예: "close-up of hands typing on laptop")
- text의 visual은 화면에 크게 표시할 핵심 문구 (한국어, 15자 이내)
- section은 HPC 흐름에 맞게 배정
`;
```

- [ ] **Step 3: buildUserPrompt 함수 변경**

기존 `function buildUserPrompt(...)` 전체를 교체:

```js
function buildUserPrompt(topic, blogText, tone, targetDurationSec, targetSceneCount) {
  const inputSummary = [
    `tone: ${tone}`,
    `targetDuration: ${targetDurationSec}초`,
    `targetSceneCount: ${targetSceneCount}`,
    topic ? `topic: ${topic}` : null,
    blogText ? `blogText:\n${blogText}` : null,
  ].filter(Boolean).join('\n\n');

  return `${inputSummary}

위 입력을 바탕으로 숏폼 영상 대본을 scenes 배열로 작성하세요.
- scenes 개수: 정확히 ${targetSceneCount}개
- 각 scene의 script를 합산한 총 글자수(공백 제외)가 ${targetDurationSec}초 분량에 맞아야 합니다 (약 ${targetDurationSec * 5}자).
- Hook, Point, CTA가 각각 뚜렷해야 합니다.
- 너무 긴 서론 없이 바로 몰입되게 시작하세요.`;
}
```

- [ ] **Step 4: 서버 후처리 함수 추가**

`extractJsonObject` 함수 아래에 추가:

```js
function postProcessScenes(scenes, targetSceneCount) {
  if (!Array.isArray(scenes) || scenes.length === 0) return scenes;

  // 1. 씬 수 보정 — 부족하면 긴 문장 분할, 초과하면 짧은 씬 병합
  while (scenes.length < targetSceneCount && scenes.length > 0) {
    const longest = scenes.reduce((max, s, i) => s.script.length > (scenes[max]?.script.length || 0) ? i : max, 0);
    const s = scenes[longest];
    const mid = Math.ceil(s.script.length / 2);
    const breakAt = s.script.indexOf('.', mid - 10);
    const splitPos = breakAt > 0 && breakAt < s.script.length - 2 ? breakAt + 1 : mid;
    const first = { ...s, script: s.script.slice(0, splitPos).trim() };
    const second = { ...s, script: s.script.slice(splitPos).trim(), visual: s.type === 'broll' ? s.visual : s.visual };
    scenes.splice(longest, 1, first, second);
  }
  while (scenes.length > targetSceneCount && scenes.length > 1) {
    let shortestIdx = 0;
    for (let i = 1; i < scenes.length - 1; i++) {
      if (scenes[i].script.length < scenes[shortestIdx].script.length) shortestIdx = i;
    }
    const mergeWith = shortestIdx > 0 ? shortestIdx - 1 : shortestIdx + 1;
    const [a, b] = shortestIdx < mergeWith ? [shortestIdx, mergeWith] : [mergeWith, shortestIdx];
    scenes[a] = { ...scenes[a], script: scenes[a].script + ' ' + scenes[b].script };
    scenes.splice(b, 1);
  }

  // 2. 텍스트 카드 비율 20~40% 보정
  const total = scenes.length;
  const textCount = scenes.filter(s => s.type === 'text').length;
  const minText = Math.ceil(total * 0.2);
  const maxText = Math.floor(total * 0.4);

  if (textCount < minText) {
    const pointScenes = scenes.map((s, i) => ({ s, i })).filter(({ s }) => s.type === 'broll' && s.section === 'point');
    for (let j = 0; j < minText - textCount && j < pointScenes.length; j++) {
      const idx = pointScenes[j].i;
      scenes[idx] = { ...scenes[idx], type: 'text', visual: scenes[idx].script.replace(/[^가-힣a-zA-Z0-9\s]/g, '').slice(0, 15) };
    }
  } else if (textCount > maxText) {
    const textScenes = scenes.map((s, i) => ({ s, i })).filter(({ s }) => s.type === 'text');
    for (let j = 0; j < textCount - maxText && j < textScenes.length; j++) {
      const idx = textScenes[textScenes.length - 1 - j].i;
      scenes[idx] = { ...scenes[idx], type: 'broll', visual: 'generic lifestyle scene related to the topic' };
    }
  }

  // 3. 같은 type 3연속 방지
  for (let i = 1; i < scenes.length - 1; i++) {
    if (scenes[i - 1].type === scenes[i].type && scenes[i].type === scenes[i + 1].type) {
      const flip = scenes[i].type === 'broll' ? 'text' : 'broll';
      if (flip === 'text') {
        scenes[i] = { ...scenes[i], type: 'text', visual: scenes[i].script.replace(/[^가-힣a-zA-Z0-9\s]/g, '').slice(0, 15) };
      } else {
        scenes[i] = { ...scenes[i], type: 'broll', visual: 'supporting visual for the narration' };
      }
    }
  }

  return scenes;
}
```

- [ ] **Step 5: buildScriptPayload 함수 변경**

기존 `function buildScriptPayload(parsed)` 전체를 교체:

```js
function buildScriptPayload(parsed, concept, targetSceneCount) {
  let scenes = Array.isArray(parsed?.scenes) ? parsed.scenes : [];

  // 기본 검증
  scenes = scenes.filter(s => s && typeof s.script === 'string' && s.script.trim());
  scenes.forEach(s => {
    s.script = toSentence(s.script);
    s.section = ['hook', 'point', 'cta'].includes(s.section) ? s.section : 'point';
    s.type = ['broll', 'text'].includes(s.type) ? s.type : 'broll';
    s.visual = toSentence(s.visual) || (s.type === 'broll' ? 'generic B-roll scene' : s.script.slice(0, 15));
  });

  if (scenes.length < 3) {
    throw new Error('Claude 응답에서 유효한 scenes가 3개 미만입니다.');
  }

  // 후처리
  scenes = postProcessScenes(scenes, targetSceneCount);

  // 컨셉 스타일 주입
  const visualStyle = concept.visualStyle;
  const textCardTemplate = concept.textCard;

  // HPC 호환 데이터 생성 (기존 프론트엔드 호환용)
  const hook = scenes.filter(s => s.section === 'hook').map(s => s.script).join(' ');
  const points = scenes.filter(s => s.section === 'point').map(s => s.script);
  const cta = scenes.filter(s => s.section === 'cta').map(s => s.script).join(' ');
  const fullScript = scenes.map(s => s.script).join('\n\n');
  const spokenLength = fullScript.replace(/\s+/g, '').length;
  const estimatedSeconds = Math.max(1, Math.round(spokenLength / 5));

  return {
    hook,
    points,
    cta,
    fullScript,
    estimatedSeconds,
    scenes,
    visualStyle,
    textCardTemplate,
    conceptKey: concept.key,
  };
}
```

- [ ] **Step 6: callClaude 함수 + handler에서 concept/sceneCount 전달**

`callClaude` 함수 변경:

```js
async function callClaude(topic, blogText, tone, targetDurationSec, concept, targetSceneCount) {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is not configured.');
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 4000,
      temperature: 0.7,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildUserPrompt(topic, blogText, tone, targetDurationSec, targetSceneCount) }],
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(JSON.stringify(data));
  }

  return buildScriptPayload(extractJsonObject(extractClaudeText(data)), concept, targetSceneCount);
}
```

handler의 POST 처리에서 concept 파싱 추가 — `const body = ...` 블록 안:

```js
const conceptInput = ['cinematic', 'minimal', 'dynamic', 'natural', 'random'].includes(body.concept) ? body.concept : 'cinematic';
const concept = resolveConcept(conceptInput);
const targetSceneCount = SCENE_COUNTS[targetDurationSec] || SCENE_COUNTS[30];
```

`callClaude` 호출부 변경:

```js
const script = await callClaude(topic, blogText, tone, targetDurationSec, concept, targetSceneCount);
```

- [ ] **Step 7: normalizeBrollSuggestions 제거**

`normalizeBrollSuggestions` 함수와 기존 `brollSuggestions` 관련 fallback 코드를 제거. scenes 기반으로 대체되었으므로 불필요.

- [ ] **Step 8: 커밋**

```bash
git add api/shortform-script.js
git commit -m "feat: scenes 기반 대본 스키마 + 컨셉 4종 + 서버 후처리"
```

---

## Task 2: ElevenLabs TTS API (shortform-tts.js)

**Files:**
- Create: `api/shortform-tts.js`
- Modify: `vercel.json`

- [ ] **Step 1: shortform-tts.js 생성**

```js
import { resolveAdmin, setCorsHeaders, extractToken, resolveSessionEmail } from './_helpers.js';

export const config = { maxDuration: 30 };

const ELEVENLABS_API_URL = 'https://api.elevenlabs.io/v1/text-to-speech';
const DEFAULT_VOICE_ID = 'EXAVITQu4vr4xnSDxMaL'; // Bella - multilingual
const DEFAULT_MODEL = 'eleven_multilingual_v2';

export default async function handler(req, res) {
  setCorsHeaders(res, req);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const token = extractToken(req);
  const email = await resolveSessionEmail(token);
  const isAdmin = await resolveAdmin(req);

  if (!isAdmin && !email) {
    return res.status(401).json({ error: '로그인이 필요합니다.' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const text = String(body.text || '').trim();
    const voiceId = String(body.voiceId || DEFAULT_VOICE_ID).trim();

    if (!text) return res.status(400).json({ error: 'text가 필요합니다.' });
    if (text.length > 5000) return res.status(400).json({ error: '텍스트가 너무 깁니다. (최대 5000자)' });

    if (!process.env.ELEVENLABS_API_KEY) {
      return res.status(500).json({ error: 'ElevenLabs API 키가 설정되지 않았습니다.' });
    }

    const ttsResponse = await fetch(`${ELEVENLABS_API_URL}/${voiceId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'xi-api-key': process.env.ELEVENLABS_API_KEY,
      },
      body: JSON.stringify({
        text,
        model_id: DEFAULT_MODEL,
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
        },
      }),
    });

    if (!ttsResponse.ok) {
      const errData = await ttsResponse.text();
      console.error('[TTS] ElevenLabs error:', ttsResponse.status, errData);
      return res.status(502).json({ error: '음성 생성에 실패했습니다. 음성 파일을 직접 업로드해주세요.' });
    }

    const audioBuffer = Buffer.from(await ttsResponse.arrayBuffer());

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Length', audioBuffer.length);
    return res.status(200).send(audioBuffer);
  } catch (error) {
    console.error('[TTS] Error:', error.message);
    return res.status(500).json({ error: '음성 생성 중 오류가 발생했습니다.' });
  }
}
```

- [ ] **Step 2: vercel.json에 라우트 추가**

`vercel.json`의 rewrites 배열에 추가:

```json
{ "source": "/api/shortform-tts", "destination": "/api/shortform-tts" }
```

- [ ] **Step 3: 커밋**

```bash
git add api/shortform-tts.js vercel.json
git commit -m "feat: ElevenLabs TTS API 엔드포인트 추가"
```

---

## Task 3: B-roll 코어 scenes 지원 (shortform-broll-core.js)

**Files:**
- Modify: `services/shortform-broll-core.js`

- [ ] **Step 1: buildVisualPrompt 변경**

기존 `buildVisualPrompt` 함수를 교체:

```js
function buildVisualPrompt(visual, visualStyle, kind) {
  if (kind === 'video') {
    return [
      visual.trim(),
      'Cinematic vertical 9:16 short-form B-roll clip with realistic motion, natural lighting, and no on-screen text.',
      `Target duration: ${CLIP_DURATION_SEC} seconds.`,
      visualStyle ? `Style: ${visualStyle}` : '',
    ].filter(Boolean).join('\n');
  }

  return [
    visual.trim(),
    'Vertical 9:16 still image for short-form video. No on-screen text.',
    visualStyle ? `Style: ${visualStyle}` : '',
  ].filter(Boolean).join('\n');
}
```

- [ ] **Step 2: handleShortformBrollRequest에서 scenes 입력 처리**

기존 `brollSuggestions` 파싱 부분을 scenes 기반으로 변경:

```js
// 기존 brollSuggestions 파싱 대신:
const scenes = Array.isArray(body.scenes) ? body.scenes : [];
const visualStyle = typeof body.visualStyle === 'string' ? body.visualStyle.trim() : '';

// scenes에서 broll 타입만 추출
const brollScenes = scenes.filter(s => s && s.type === 'broll' && typeof s.visual === 'string' && s.visual.trim());

if (brollScenes.length === 0) {
  throw new HttpError(400, 'broll 타입의 scene이 1개 이상 필요합니다.');
}
```

- [ ] **Step 3: 자산 생성 루프를 brollScenes 기반으로 변경**

기존 `allSuggestions` 루프를 교체:

```js
const maxAssets = brollScenes.length;
const videoSlots = computeVideoSlots(maxAssets);

async function generateWithFallback(scene, index) {
  const imgPrompt = buildVisualPrompt(scene.visual, visualStyle, 'image');
  const imgKey = createR2Key(userId, `image${index}.png`);

  let imageResult = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      imageResult = await callImagen3Image(imgPrompt, imgKey);
      break;
    } catch (error) {
      console.warn('[SHORTFORM-BROLL] Imagen attempt ' + (attempt + 1) + ' for asset ' + index + ' failed:', error.message);
      if (attempt === 1) {
        failures.push(`asset${index}:${error.message}`);
        return null;
      }
    }
  }
  if (!imageResult) return null;

  if (videoSlots.has(index) && hasVeoConfig()) {
    const videoPrompt = buildVisualPrompt(scene.visual, visualStyle, 'video');
    const videoKey = createR2Key(userId, `i2v${index}.mp4`);
    try {
      const videoResult = await callVeoI2V(videoPrompt, videoKey, imageResult.base64);
      return videoResult;
    } catch (error) {
      console.warn('[SHORTFORM-BROLL] i2v slot ' + index + ' failed, using image fallback:', error.message);
      return imageResult;
    }
  }

  return imageResult;
}

const items = [];
for (let i = 0; i < brollScenes.length; i += BATCH_SIZE) {
  const batch = brollScenes.slice(i, i + BATCH_SIZE);
  const batchResults = await Promise.all(
    batch.map(function(scene, batchIndex) {
      return generateWithFallback(scene, i + batchIndex);
    })
  );
  batchResults.forEach(function(result) { if (result) items.push(result); });
}
```

- [ ] **Step 4: scriptContext 파라미터 제거**

`handleShortformBrollRequest`에서 `scriptContext` 관련 검증과 파싱을 제거. scenes에 이미 컨텍스트가 내장되어 있으므로 불필요.

- [ ] **Step 5: 커밋**

```bash
git add services/shortform-broll-core.js
git commit -m "feat: B-roll 코어 scenes 기반 자산 생성 + visualStyle 적용"
```

---

## Task 4: Remotion 텍스트 카드 컴포넌트 (TextCard.jsx)

**Files:**
- Create: `remotion/shortform/TextCard.jsx`
- Modify: `remotion/shortform/ShortformComposition.jsx`

- [ ] **Step 1: TextCard.jsx 생성**

```jsx
import React from 'react';
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';

const TEMPLATES = {
  'dark-gradient': {
    background: 'linear-gradient(160deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)',
    color: '#ffffff',
    fontFamily: '"Noto Sans KR", sans-serif',
    fontWeight: 900,
    animation: 'fadeSlideUp',
  },
  'white-clean': {
    background: '#fafafa',
    color: '#111111',
    fontFamily: '"Noto Sans KR", sans-serif',
    fontWeight: 700,
    animation: 'typing',
    accent: '#111111',
  },
  'bold-accent': {
    background: '#222222',
    color: '#ffffff',
    fontFamily: '"Noto Sans KR", sans-serif',
    fontWeight: 900,
    animation: 'scaleBounce',
    accent: '#ff5f1f',
  },
  'soft-overlay': {
    background: 'linear-gradient(170deg, #f5f0e8 0%, #e8e0d0 100%)',
    color: '#4a3728',
    fontFamily: '"Noto Serif KR", "Noto Sans KR", serif',
    fontWeight: 600,
    animation: 'softFade',
  },
};

function splitTextLines(text, maxChars = 15) {
  if (!text || text.length <= maxChars) return [text || ''];
  const mid = Math.ceil(text.length / 2);
  const breakAt = text.lastIndexOf(' ', mid);
  const pos = breakAt > 0 ? breakAt : mid;
  return [text.slice(0, pos).trim(), text.slice(pos).trim()].filter(Boolean);
}

export const TextCard = ({ template, text, durationInFrames }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = TEMPLATES[template] || TEMPLATES['dark-gradient'];
  const lines = splitTextLines(text);
  const fontSize = text && text.length > 10 ? 72 : 88;

  let opacity = 1;
  let translateY = 0;
  let scale = 1;

  if (t.animation === 'fadeSlideUp') {
    opacity = interpolate(frame, [0, 15], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
    translateY = interpolate(frame, [0, 15], [30, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  } else if (t.animation === 'scaleBounce') {
    const s = spring({ fps, frame, config: { damping: 12, stiffness: 200, mass: 0.8 } });
    scale = interpolate(s, [0, 1], [0.7, 1]);
    opacity = interpolate(frame, [0, 8], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  } else if (t.animation === 'softFade') {
    opacity = interpolate(frame, [0, 20], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  } else if (t.animation === 'typing') {
    opacity = interpolate(frame, [0, 10], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  }

  // fade out
  const fadeOut = interpolate(frame, [Math.max(0, durationInFrames - 10), durationInFrames], [1, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });
  opacity = Math.min(opacity, fadeOut);

  const hasAccent = t.accent && text;
  const accentWord = hasAccent ? text.split(/\s+/)[0] : '';
  const restText = hasAccent ? text.slice(accentWord.length).trim() : text;

  return (
    <AbsoluteFill style={{ background: t.background, justifyContent: 'center', alignItems: 'center', padding: '0 80px' }}>
      <div style={{
        opacity,
        transform: `translateY(${translateY}px) scale(${scale})`,
        textAlign: 'center',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}>
        {lines.map((line, i) => (
          <div key={i} style={{
            fontFamily: t.fontFamily,
            fontWeight: t.fontWeight,
            fontSize,
            lineHeight: 1.2,
            color: t.color,
          }}>
            {t.accent && i === 0 ? (
              <>
                <span style={{ color: t.accent }}>{line.split(/\s+/)[0]}</span>
                <span>{' ' + line.split(/\s+/).slice(1).join(' ')}</span>
              </>
            ) : line}
          </div>
        ))}
      </div>
    </AbsoluteFill>
  );
};
```

- [ ] **Step 2: ShortformComposition.jsx에 TextCard 통합**

`ShortformComposition.jsx` 상단에 import 추가:

```jsx
import { TextCard } from './TextCard.jsx';
```

기존 `visualSpans.map(...)` 렌더링 부분을 scenes 기반으로 교체하는 것은 Task 6 (shortform.html)에서 props 구조가 변경된 후 진행. 여기서는 컴포넌트만 생성.

- [ ] **Step 3: 커밋**

```bash
git add remotion/shortform/TextCard.jsx remotion/shortform/ShortformComposition.jsx
git commit -m "feat: Remotion 텍스트 카드 컴포넌트 4종"
```

---

## Task 5: shortform.html — 컨셉 선택 + 음성 선택 + 녹음 제거

**Files:**
- Modify: `shortform.html`

이 태스크는 프론트엔드 HTML 파일의 UI 변경으로, 구체적인 코드는 기존 shortform.html의 구조에 맞춰 작성해야 합니다. 핵심 변경:

- [ ] **Step 1: 컨셉 선택 UI 추가**

기존 "영상 길이" 선택 아래에 컨셉 선택 추가:

```html
<div class="form-group">
  <label>영상 컨셉</label>
  <div class="concept-cards">
    <label class="concept-card active" data-concept="cinematic">
      <input type="radio" name="concept" value="cinematic" checked>
      <span class="concept-name">시네마틱</span>
      <span class="concept-desc">따뜻한 영화 느낌</span>
    </label>
    <label class="concept-card" data-concept="minimal">
      <input type="radio" name="concept" value="minimal">
      <span class="concept-name">미니멀</span>
      <span class="concept-desc">깔끔한 모던 스타일</span>
    </label>
    <label class="concept-card" data-concept="dynamic">
      <input type="radio" name="concept" value="dynamic">
      <span class="concept-name">다이나믹</span>
      <span class="concept-desc">강렬한 컬러 전환</span>
    </label>
    <label class="concept-card" data-concept="natural">
      <input type="radio" name="concept" value="natural">
      <span class="concept-name">내추럴</span>
      <span class="concept-desc">자연광 일상 분위기</span>
    </label>
    <label class="concept-card" data-concept="random">
      <input type="radio" name="concept" value="random">
      <span class="concept-name">랜덤</span>
      <span class="concept-desc">매번 다른 스타일</span>
    </label>
  </div>
</div>
```

- [ ] **Step 2: 음성 선택 UI (녹음 버튼 대체)**

기존 녹음 관련 UI를 교체:

```html
<div class="form-group">
  <label>음성</label>
  <div class="voice-options">
    <label class="voice-option active">
      <input type="radio" name="voiceMode" value="tts" checked>
      <span>TTS 자동 생성</span>
    </label>
    <label class="voice-option">
      <input type="radio" name="voiceMode" value="upload">
      <span>음성 파일 업로드</span>
    </label>
  </div>
  <div id="voiceUploadArea" class="hidden">
    <input type="file" id="voiceFile" accept="audio/*">
  </div>
</div>
```

- [ ] **Step 3: 녹음 관련 코드 제거**

`MediaRecorder`, `navigator.mediaDevices.getUserMedia`, 녹음 버튼 이벤트, 워밍업 코드 등 모두 제거.

- [ ] **Step 4: 대본 생성 API 호출에 concept 추가**

```js
body: JSON.stringify({
  topic: topic,
  blogText: blogText,
  tone: tone,
  targetDurationSec: targetDurationSec,
  concept: document.querySelector('input[name="concept"]:checked').value,
})
```

- [ ] **Step 5: B-roll 요청에 scenes 전달**

기존 brollSuggestions 전달 대신:

```js
body: JSON.stringify({
  scenes: state.scenes.filter(s => s.type === 'broll'),
  visualStyle: state.visualStyle,
})
```

- [ ] **Step 6: TTS 호출 또는 파일 업로드 처리**

```js
async function getAudioBlob() {
  var voiceMode = document.querySelector('input[name="voiceMode"]:checked').value;
  
  if (voiceMode === 'upload') {
    var file = document.getElementById('voiceFile').files[0];
    if (!file) throw new Error('음성 파일을 선택해주세요.');
    return file;
  }
  
  // TTS
  var res = await fetch('/api/shortform-tts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
    body: JSON.stringify({ text: state.fullScript }),
  });
  if (!res.ok) {
    var err = await res.json();
    throw new Error(err.error || '음성 생성 실패');
  }
  return await res.blob();
}
```

- [ ] **Step 7: 커밋**

```bash
git add shortform.html
git commit -m "feat: 숏폼 컨셉 선택 + TTS/업로드 음성 + 녹음 제거"
```

---

## Task 6: Remotion 타임라인 scenes 통합

**Files:**
- Modify: `remotion/shortform/timeline.js`
- Modify: `remotion/shortform/ShortformComposition.jsx`

- [ ] **Step 1: timeline.js에 scenes 기반 빌드 지원**

`buildShortformTimeline` 함수 내에서 `inputProps.scenes`가 있으면 scenes 기반 타임라인 생성:

```js
// buildShortformTimeline 내부, visualSpans 빌드 후:
const sceneDefinitions = Array.isArray(inputProps?.scenes) ? inputProps.scenes : [];
const textCardTemplate = inputProps?.textCardTemplate || 'dark-gradient';
```

- [ ] **Step 2: ShortformComposition.jsx에서 text 씬 분기**

`ShortformComposition` 렌더링에서 scenes prop이 있으면 scene type에 따라 BackgroundLayer 또는 TextCard를 렌더링하고, text 씬에서는 TextLayer(자막)를 숨김:

```jsx
{timeline.visualSpans.map((visual, index) => {
  const sceneDef = props.scenes?.[index];
  const isTextCard = sceneDef?.type === 'text';
  
  return (
    <Sequence
      key={`visual-${index}-${visual.startFrame}`}
      from={visual.startFrame}
      durationInFrames={visual.durationInFrames}
    >
      {isTextCard ? (
        <TextCard
          template={props.textCardTemplate || 'dark-gradient'}
          text={sceneDef.visual}
          durationInFrames={visual.durationInFrames}
        />
      ) : (
        <BackgroundLayer visual={visual} durationInFrames={visual.durationInFrames} />
      )}
    </Sequence>
  );
})}
```

자막(TextLayer)은 text 씬 구간에서 숨김:

```jsx
{timeline.textScenes
  .filter(scene => {
    // text 카드 씬 구간과 겹치는 자막은 숨김
    if (!props.scenes) return true;
    const sceneTimeSec = scene.startSec + (scene.endSec - scene.startSec) / 2;
    return !props.scenes.some((s, i) => {
      if (s.type !== 'text') return false;
      const span = timeline.visualSpans[i];
      return span && sceneTimeSec >= span.startSec && sceneTimeSec < span.endSec;
    });
  })
  .map((scene) => (
    <Sequence key={`text-${scene.id}`} from={scene.startFrame} durationInFrames={scene.durationInFrames}>
      <TextLayer scene={scene} motionSpeed={timeline.motionSpeed} textRevealMode={timeline.textRevealMode} />
    </Sequence>
  ))
}
```

- [ ] **Step 3: 커밋**

```bash
git add remotion/shortform/timeline.js remotion/shortform/ShortformComposition.jsx
git commit -m "feat: Remotion scenes 기반 타임라인 + text 씬 자막 숨김"
```

---

## Task 7: 자막 편집 UI (shortform.html)

**Files:**
- Modify: `shortform.html`

- [ ] **Step 1: 자막 편집 UI 추가**

STT 결과 수신 후 렌더링 전에 자막 편집 단계를 삽입:

```html
<div id="subtitleEditStep" class="hidden">
  <h3>자막 편집</h3>
  <p style="font-size:13px; color:#94a3b8; margin-bottom:12px;">자막 텍스트와 줄바꿈을 직접 수정할 수 있어요.</p>
  <div id="subtitleTimeline"></div>
  <button onclick="confirmSubtitles()">확인 후 렌더링</button>
</div>
```

- [ ] **Step 2: 자막 편집 렌더링 함수**

```js
function renderSubtitleEditor(sttWords) {
  var container = document.getElementById('subtitleTimeline');
  container.innerHTML = '';
  
  // 문장 단위로 그룹핑
  var sentences = groupIntoSentences(sttWords);
  sentences.forEach(function(sentence, idx) {
    var row = document.createElement('div');
    row.className = 'subtitle-row';
    row.innerHTML = '<span class="subtitle-time">' + formatTime(sentence.start) + '</span>' +
      '<input type="text" class="subtitle-text" data-idx="' + idx + '" value="' + escapeHtml(sentence.text) + '">';
    container.appendChild(row);
  });
  
  document.getElementById('subtitleEditStep').classList.remove('hidden');
}

function confirmSubtitles() {
  // 편집된 텍스트를 sttWords에 반영
  var inputs = document.querySelectorAll('.subtitle-text');
  inputs.forEach(function(input) {
    var idx = parseInt(input.dataset.idx);
    state.editedSubtitles[idx] = input.value;
  });
  document.getElementById('subtitleEditStep').classList.add('hidden');
  proceedToRender();
}
```

- [ ] **Step 3: 커밋**

```bash
git add shortform.html
git commit -m "feat: 자막 편집 UI — STT 결과 수정 후 렌더링"
```

---

## Task 8: 통합 테스트 + 정리

**Files:**
- All modified files

- [ ] **Step 1: vercel.json 최종 확인**

shortform-tts 라우트가 추가되었는지 확인.

- [ ] **Step 2: 로컬 테스트**

```bash
npx remotion studio remotion/index.jsx
```

Remotion Studio에서 TextCard 컴포넌트 4종 렌더링 확인.

- [ ] **Step 3: 배포 후 실 테스트**

1. 30초 cinematic + TTS → scenes 생성 + B-roll + 텍스트 카드 + TTS 음성
2. 60초 minimal + 파일 업로드 → 업로드 음성 + 자막 편집 → 렌더링
3. 90초 random + TTS → 랜덤 컨셉 적용 확인
4. 후처리 보정: 텍스트 카드 20~40%, 3연속 없음

- [ ] **Step 4: 기존 음성 정책 메모리 업데이트**

`project_shortform_voice.md` 업데이트: "TTS 금지" → "ElevenLabs TTS 허용 + 파일 업로드 허용, 브라우저 녹음 제거"

- [ ] **Step 5: 최종 커밋 + 푸시**

```bash
git add -A
git commit -m "feat: 숏폼 씬 기반 리팩토링 완료 — 컨셉 4종 + TTS + 텍스트 카드 + 자막 편집"
git push origin main
```
