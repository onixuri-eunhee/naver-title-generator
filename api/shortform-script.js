import { resolveAdmin, setCorsHeaders, extractToken, resolveSessionEmail, getRedis, getClientIp } from './_helpers.js';
import { getDb, logUsage } from './_db.js';

export const config = { maxDuration: 60 };

const SHORTFORM_CREDIT_COSTS = { 30: 7, 45: 10, 60: 14, 90: 18 };
const MODEL = 'claude-sonnet-4-20250514';

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
    const picked = keys[Math.floor(Math.random() * keys.length)];
    return { key: picked, ...CONCEPTS[picked] };
  }
  return CONCEPTS[concept] ? { key: concept, ...CONCEPTS[concept] } : { key: 'cinematic', ...CONCEPTS.cinematic };
}

const SYSTEM_PROMPT = `당신은 한국어 숏폼 영상 대본 작가입니다. 사용자의 입력을 바탕으로 숏폼 대본을 scenes 배열로 작성하세요.

[절대 규칙]
1. 반드시 존댓말만 사용하세요. 반말, 유행어 남발, 과장된 말투는 금지입니다.
2. 출력은 설명 없이 순수 JSON 객체 하나만 반환하세요. 마크다운 코드블록, 부가 설명, 서문 금지입니다.
3. 사실은 사용자가 제공한 topic과 blogText 안에서만 사용하세요. 입력에 없는 구체적 수치나 사례를 지어내지 마세요.
4. 구어체로 자연스러운 내레이션 문장을 작성하세요. 문어체 금지.
5. 한 문장에 하나의 정보만. 숫자는 구체적으로 (많이→87%, 대부분→10명 중 8명).

[후킹 공식 — scenes[0]에 반드시 적용]
아래 6가지 중 주제에 가장 적합한 후킹 유형을 선택하세요:
1. 질문형: 답을 모르면 불편한 구체적 질문 ("왜 ~일까요?")
2. 충격/대담형: 통념을 뒤집는 주장 ("~은(는) 틀렸습니다")
3. 비밀/배타형: 희소한 정보 암시 ("상위 1%만 아는 ~")
4. 증거형: 구체적 숫자로 결과 제시 ("30일 만에 ~ 달성")
5. 공감형: 시청자의 고통에 동일시 ("~ 저도 그랬습니다")
6. 경고형: 손실을 경고 ("이것 모르면 ~ 낭비입니다")

[대본 구조]
- Hook(첫 1~2씬): 후킹 공식 적용. 첫 문장이 스크롤을 멈춰야 합니다.
- Point(핵심): 하나의 핵심 메시지에 집중. 나열 금지, 깊이 있게.
- CTA(행동 유도): 강요가 아닌 자연스러운 대화체로 마무리.

[첫 씬 규칙 — 매우 중요]
- scenes[0]은 반드시 type: "broll" (텍스트 카드 아님)
- scenes[0]의 script는 후킹 공식을 적용한 강렬한 첫 문장
- scenes[0]의 visual은 "scroll-stopping"한 구체적 영어 이미지 설명 (dramatic, high contrast, cinematic 포함)
- scenes[0]에 hookText 필드 추가: 화면에 크게 표시할 후킹 핵심 문구 (한국어, 12자 이내, 임팩트 있게)

[출력 JSON 스키마]
{
  "scenes": [
    {
      "script": "대본 문장 (한국어, 1~2문장)",
      "section": "hook | point | cta",
      "type": "broll | text",
      "visual": "broll이면 영어 B-roll 이미지 설명 / text면 화면에 표시할 핵심 문구 (한국어, 15자 이내)",
      "hookText": "(첫 씬만) 화면에 크게 표시할 후킹 문구 (한국어, 12자 이내)"
    }
  ]
}

[scenes 규칙]
- scenes 개수는 targetSceneCount에 맞추세요
- 각 scene의 script는 1~2문장, 자연스러운 구어체 내레이션
- type은 대본 내용에 따라 자유롭게 판단하되, scenes[0]은 반드시 broll
- broll의 visual은 구체적인 영어 이미지 설명 (예: "close-up of hands typing on laptop")
- text의 visual은 화면에 크게 표시할 핵심 문구 (한국어, 15자 이내)
- section은 Hook → Point → CTA 흐름에 맞게 배정
- hookText는 scenes[0]에만 포함, 나머지 씬에는 생략
`;

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

function extractClaudeText(data) {
  return (data?.content || [])
    .filter(block => block?.type === 'text' && block?.text)
    .map(block => block.text)
    .join('\n')
    .trim();
}

function extractJsonObject(rawText) {
  const trimmed = rawText.trim();

  try {
    return JSON.parse(trimmed);
  } catch (_) {}

  const fenced = trimmed.match(/```json\s*([\s\S]*?)```/i) || trimmed.match(/```\s*([\s\S]*?)```/);
  if (fenced?.[1]) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch (_) {}
  }

  const start = trimmed.indexOf('{');
  if (start === -1) {
    throw new Error('Claude 응답에서 JSON 객체를 찾을 수 없습니다.');
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < trimmed.length; i++) {
    const char = trimmed[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === '{') depth += 1;
    if (char === '}') depth -= 1;
    if (depth === 0) {
      return JSON.parse(trimmed.slice(start, i + 1));
    }
  }

  throw new Error('Claude 응답 JSON 파싱에 실패했습니다.');
}

function toSentence(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function postProcessScenes(scenes, targetSceneCount) {
  if (!Array.isArray(scenes) || scenes.length === 0) return scenes;

  // 1. 씬 수 보정
  while (scenes.length < targetSceneCount && scenes.length > 0) {
    const longest = scenes.reduce((max, s, i) => s.script.length > (scenes[max]?.script.length || 0) ? i : max, 0);
    const s = scenes[longest];
    const mid = Math.ceil(s.script.length / 2);
    const breakAt = s.script.indexOf('.', mid - 10);
    const splitPos = breakAt > 0 && breakAt < s.script.length - 2 ? breakAt + 1 : mid;
    const first = { ...s, script: s.script.slice(0, splitPos).trim() };
    const second = { ...s, script: s.script.slice(splitPos).trim() };
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

  // 2. 첫 씬 broll 강제 + hookText 보정
  if (scenes[0] && scenes[0].type !== 'broll') {
    scenes[0] = { ...scenes[0], type: 'broll', visual: 'scroll-stopping dramatic cinematic visual for the narration' };
  }
  if (scenes[0] && !scenes[0].hookText) {
    scenes[0].hookText = scenes[0].script.replace(/[^가-힣a-zA-Z0-9\s]/g, '').slice(0, 12);
  }

  // 3. 텍스트 카드 비율 20~40% 보정
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
      scenes[idx] = { ...scenes[idx], type: 'broll', visual: 'supporting visual for the narration' };
    }
  }

  // 3. 같은 type 3연속 방지
  for (let i = 1; i < scenes.length - 1; i++) {
    if (scenes[i - 1].type === scenes[i].type && scenes[i].type === scenes[i + 1].type) {
      if (scenes[i].type === 'broll') {
        scenes[i] = { ...scenes[i], type: 'text', visual: scenes[i].script.replace(/[^가-힣a-zA-Z0-9\s]/g, '').slice(0, 15) };
      } else {
        scenes[i] = { ...scenes[i], type: 'broll', visual: 'supporting visual for the narration' };
      }
    }
  }

  return scenes;
}

function buildScriptPayload(parsed, concept, targetSceneCount) {
  let scenes = Array.isArray(parsed?.scenes) ? parsed.scenes : [];

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

  scenes = postProcessScenes(scenes, targetSceneCount);

  const visualStyle = concept.visualStyle;
  const textCardTemplate = concept.textCard;

  const hook = scenes.filter(s => s.section === 'hook').map(s => s.script).join(' ');
  const points = scenes.filter(s => s.section === 'point').map(s => s.script);
  const cta = scenes.filter(s => s.section === 'cta').map(s => s.script).join(' ');
  const fullScript = scenes.map(s => s.script).join('\n\n');
  const spokenLength = fullScript.replace(/\s+/g, '').length;
  const estimatedSeconds = Math.max(1, Math.round(spokenLength / 5));

  const hookText = scenes[0]?.hookText || '';

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
    hookText,
  };
}

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

/**
 * 숏폼 크레딧 환불 (다른 API에서 호출 가능)
 * 에러 시 console.error만 — 환불 실패가 전체 요청을 깨트리면 안 됨
 */
export async function refundShortformCredits(email, creditCost, reason) {
  try {
    const sql = getDb();
    await sql`UPDATE users SET credits = credits + ${creditCost}, updated_at = NOW()
      WHERE email = ${email} RETURNING credits`;
    await sql`INSERT INTO credit_ledger (user_email, amount, type, reason)
      VALUES (${email}, ${creditCost}, 'refund', ${reason})`;
  } catch (err) {
    console.error('[SHORTFORM] refundShortformCredits failed:', err.message, { email, creditCost, reason });
  }
}

export default async function handler(req, res) {
  setCorsHeaders(res, req);

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method === 'GET') {
    try {
      const isAdmin = await resolveAdmin(req);
      if (isAdmin) {
        return res.status(200).json({ remaining: 999, admin: true, creditCosts: SHORTFORM_CREDIT_COSTS });
      }

      const email = await resolveSessionEmail(extractToken(req));
      if (!email) {
        return res.status(200).json({ remaining: 0, loginRequired: true, creditCosts: SHORTFORM_CREDIT_COSTS });
      }

      // 무료 체험 사용 여부 확인
      const freeUsed = await getRedis().get(`shortform-free:${email}`);
      const sql = getDb();
      const [user] = await sql`SELECT credits FROM users WHERE email = ${email}`;

      return res.status(200).json({
        freeAvailable: !freeUsed,
        credits: user?.credits || 0,
        creditCosts: SHORTFORM_CREDIT_COSTS,
      });
    } catch {
      return res.status(200).json({ remaining: 0, creditCosts: SHORTFORM_CREDIT_COSTS });
    }
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let creditCharged = false;
  let creditCost = 0;
  let email = null;

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const topic = toSentence(body.topic);
    const blogText = String(body.blogText || '').trim();
    const tone = body.tone === 'professional' ? 'professional' : 'casual';
    const targetDurationSec = [30, 45, 60, 90].includes(Number(body.targetDurationSec)) ? Number(body.targetDurationSec) : 30;

    const conceptInput = ['cinematic', 'minimal', 'dynamic', 'natural', 'random'].includes(body.concept) ? body.concept : 'cinematic';
    const concept = resolveConcept(conceptInput);
    const targetSceneCount = SCENE_COUNTS[targetDurationSec] || SCENE_COUNTS[30];

    if (!topic && !blogText) {
      return res.status(400).json({ error: 'topic 또는 blogText 중 하나는 필요합니다.' });
    }

    const isAdmin = await resolveAdmin(req);
    email = await resolveSessionEmail(extractToken(req));
    if (!isAdmin && !email) {
      return res.status(401).json({ error: '로그인이 필요합니다.' });
    }

    let wasFree = false;

    if (!isAdmin) {
      creditCost = SHORTFORM_CREDIT_COSTS[targetDurationSec] || SHORTFORM_CREDIT_COSTS[30];

      // 30초 무료 체험 1회 확인
      const freeKey = `shortform-free:${email}`;
      const freeUsed = await getRedis().get(freeKey);

      if (!freeUsed && targetDurationSec === 30) {
        // 무료 체험 사용
        wasFree = true;
        await getRedis().set(freeKey, '1');
      } else {
        // 크레딧 차감 (원자적)
        const sql = getDb();
        const result = await sql`UPDATE users SET credits = credits - ${creditCost}, updated_at = NOW()
          WHERE email = ${email} AND credits >= ${creditCost}
          RETURNING credits`;

        if (result.length === 0) {
          return res.status(402).json({
            error: '크레딧이 부족합니다. 충전 후 이용해주세요.',
            required: creditCost,
            code: 'INSUFFICIENT_CREDITS',
          });
        }

        creditCharged = true;

        // credit_ledger 기록
        await sql`INSERT INTO credit_ledger (user_email, amount, type, reason)
          VALUES (${email}, ${-creditCost}, 'usage', ${'shortform-script-' + targetDurationSec + 's'})`;
      }
    }

    const script = await callClaude(topic, blogText, tone, targetDurationSec, concept, targetSceneCount);
    await logUsage(email, 'shortform-script', tone, getClientIp(req));

    // 현재 잔액 조회
    let remainingCredits = 0;
    if (!isAdmin && email) {
      try {
        const sql = getDb();
        const [user] = await sql`SELECT credits FROM users WHERE email = ${email}`;
        remainingCredits = user?.credits || 0;
      } catch (_) {}
    }

    return res.status(200).json({
      script,
      credits: {
        used: wasFree ? 0 : creditCost,
        remaining: isAdmin ? 999 : remainingCredits,
        wasFree,
      },
    });
  } catch (error) {
    console.error('shortform-script API Error:', error);
    // 크레딧 차감 후 대본 생성 실패 시 자동 환불
    if (creditCharged && email) {
      await refundShortformCredits(email, creditCost, 'shortform-script-error-refund');
    }
    return res.status(500).json({ error: '숏폼 대본 생성 중 오류가 발생했습니다.' });
  }
}
