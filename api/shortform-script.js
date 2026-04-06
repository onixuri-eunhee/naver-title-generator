import { resolveAdmin, setCorsHeaders, extractToken, resolveSessionEmail, getRedis, getClientIp } from './_helpers.js';
import { logUsage } from './_db.js';

export const config = { maxDuration: 60 };

const FREE_DAILY_LIMIT = 1;
const MODEL = 'claude-sonnet-4-20250514';

const SYSTEM_PROMPT = `당신은 한국어 숏폼 영상 대본 작가입니다. 사용자의 입력을 바탕으로 30~60초 분량의 숏폼 대본을 HPC(Hook-Point-CTA) 구조로 작성하세요.

[절대 규칙]
1. 반드시 존댓말만 사용하세요. 반말, 유행어 남발, 과장된 말투는 금지입니다.
2. 출력은 설명 없이 순수 JSON 객체 하나만 반환하세요. 마크다운 코드블록, 부가 설명, 서문 금지입니다.
3. 사실은 사용자가 제공한 topic과 blogText 안에서만 사용하세요. 입력에 없는 구체적 수치나 사례를 지어내지 마세요.
4. 대본은 자연스러운 내레이션 문장으로 작성하세요. 문장만 읽어도 바로 촬영할 수 있어야 합니다.
5. 전체 분량은 한국어 기준 약 30~60초가 되도록 작성하세요.

[HPC 법칙]
- Hook(처음 3초): 시청자의 고민이나 궁금증을 즉시 자극하는 질문 또는 충격적 사실 1~2문장
- Point(핵심 내용): 3개 이내의 핵심 포인트. 각 포인트는 반드시 2~3문장
- CTA(행동 유도): 댓글, 팔로우, 저장 중 하나 이상을 자연스럽게 유도하는 1~2문장

[톤 가이드]
- casual: 친근하지만 예의 있는 말투
- professional: 전문적이고 신뢰감 있는 말투

[출력 JSON 스키마]
{
  "hook": "string",
  "points": ["string", "string", "string"],
  "cta": "string",
  "brollSuggestions": ["phrase1", "phrase2", "phrase3", "phrase4", "phrase5", "phrase6", "phrase7", "phrase8", "phrase9", "phrase10", "phrase11", "phrase12"]
}

[brollSuggestions 규칙]
- 정확히 12개
- 영어로 작성
- 각 항목은 짧은 B-roll 이미지 설명
- 예: "close-up of hands typing on laptop"
`;

function getKSTDate() {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

function getRateLimitKey(email) {
  return `ratelimit:shortform-script:${email}:${getKSTDate()}`;
}

function getTTLUntilMidnightKST() {
  const now = new Date();
  const kstOffset = 9 * 60 * 60 * 1000;
  const kstNow = new Date(now.getTime() + kstOffset);
  const nextMidnight = new Date(kstNow);
  nextMidnight.setUTCHours(0, 0, 0, 0);
  nextMidnight.setUTCDate(nextMidnight.getUTCDate() + 1);
  const seconds = Math.ceil((nextMidnight.getTime() - kstNow.getTime()) / 1000);
  return Math.max(seconds, 60);
}

function buildUserPrompt(topic, blogText, tone) {
  const inputSummary = [
    `tone: ${tone}`,
    topic ? `topic: ${topic}` : null,
    blogText ? `blogText:\n${blogText}` : null,
  ].filter(Boolean).join('\n\n');

  return `${inputSummary}

위 입력을 바탕으로 숏폼 영상 대본을 작성하세요.
- Hook, Point, CTA가 각각 뚜렷해야 합니다.
- Point는 최대 3개까지만 작성하세요.
- 각 Point는 독립된 핵심 메시지여야 하며, 문장 수는 2~3문장이어야 합니다.
- 너무 긴 서론 없이 바로 몰입되게 시작하세요.
- CTA는 부담스럽지 않게 마무리하세요.
- brollSuggestions는 대본 내용에 맞춰 영어로 작성하세요.`;
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

function normalizeBrollSuggestions(items) {
  const normalized = Array.isArray(items)
    ? items.map(item => toSentence(item)).filter(Boolean).slice(0, 5)
    : [];

  if (normalized.length === 5) return normalized;

  const fallback = [
    'person speaking to camera',
    'close-up of smartphone scrolling',
    'detail shot of everyday workspace',
    'wide shot of modern city street',
    'hands organizing notes on desk',
  ];

  return [...normalized, ...fallback].slice(0, 5);
}

function buildScriptPayload(parsed) {
  const hook = toSentence(parsed?.hook);
  const points = (Array.isArray(parsed?.points) ? parsed.points : [])
    .map(point => toSentence(point))
    .filter(Boolean)
    .slice(0, 3);
  const cta = toSentence(parsed?.cta);

  if (!hook || !cta || points.length === 0) {
    throw new Error('Claude 응답 스키마가 올바르지 않습니다.');
  }

  const fullScript = [hook, ...points, cta].join('\n\n');
  const spokenLength = fullScript.replace(/\s+/g, '').length;
  const estimatedSeconds = Math.max(1, Math.round(spokenLength / 5));

  return {
    hook,
    points,
    cta,
    fullScript,
    estimatedSeconds,
    brollSuggestions: normalizeBrollSuggestions(parsed?.brollSuggestions),
  };
}

async function callClaude(topic, blogText, tone) {
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
      max_tokens: 2000,
      temperature: 0.7,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildUserPrompt(topic, blogText, tone) }],
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(JSON.stringify(data));
  }

  return buildScriptPayload(extractJsonObject(extractClaudeText(data)));
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
        return res.status(200).json({ remaining: 999, limit: FREE_DAILY_LIMIT, admin: true });
      }

      const email = await resolveSessionEmail(extractToken(req));
      if (!email) {
        return res.status(200).json({ remaining: 0, limit: FREE_DAILY_LIMIT, loginRequired: true });
      }

      const count = (await getRedis().get(getRateLimitKey(email))) || 0;
      return res.status(200).json({
        remaining: Math.max(FREE_DAILY_LIMIT - count, 0),
        limit: FREE_DAILY_LIMIT,
      });
    } catch {
      return res.status(200).json({ remaining: 0, limit: FREE_DAILY_LIMIT });
    }
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let rateLimitKey = null;
  let rateLimitIncremented = false;

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const topic = toSentence(body.topic);
    const blogText = String(body.blogText || '').trim();
    const tone = body.tone === 'professional' ? 'professional' : 'casual';

    if (!topic && !blogText) {
      return res.status(400).json({ error: 'topic 또는 blogText 중 하나는 필요합니다.' });
    }

    const isAdmin = await resolveAdmin(req);
    const email = await resolveSessionEmail(extractToken(req));
    if (!isAdmin && !email) {
      return res.status(401).json({ error: '로그인이 필요합니다.' });
    }

    if (!isAdmin) {
      rateLimitKey = getRateLimitKey(email);
      const newCount = await getRedis().incr(rateLimitKey);
      rateLimitIncremented = true;
      await getRedis().expire(rateLimitKey, getTTLUntilMidnightKST());

      if (newCount > FREE_DAILY_LIMIT) {
        await getRedis().decr(rateLimitKey);
        rateLimitIncremented = false;
        return res.status(429).json({
          error: `일일 무료 사용 한도(${FREE_DAILY_LIMIT}회)를 초과했습니다. 내일 다시 이용해주세요.`,
          remaining: 0,
        });
      }
    }

    const script = await callClaude(topic, blogText, tone);
    await logUsage(email, 'shortform-script', tone, getClientIp(req));

    const currentCount = rateLimitKey ? ((await getRedis().get(rateLimitKey)) || 0) : 0;
    const remaining = isAdmin ? 999 : Math.max(FREE_DAILY_LIMIT - currentCount, 0);

    return res.status(200).json({ script, remaining, limit: FREE_DAILY_LIMIT });
  } catch (error) {
    console.error('shortform-script API Error:', error);
    if (rateLimitIncremented && rateLimitKey) {
      try {
        await getRedis().decr(rateLimitKey);
      } catch (_) {}
    }
    return res.status(500).json({ error: '숏폼 대본 생성 중 오류가 발생했습니다.' });
  }
}
