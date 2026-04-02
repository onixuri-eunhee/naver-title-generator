import { Redis } from '@upstash/redis';
import { resolveAdmin, setCorsHeaders } from './_helpers.js';
import { replaceUrlsWithR2, uploadImageUrlToR2 } from './_r2.js';
import { logUsage } from './_db.js';

/*
 * 이미지 생성 구조
 * FLUX Schnell 전용 (photo only) — 텍스트 없는 맥락 사진만 생성
 * Canvas API: 썸네일 텍스트 오버레이 (프론트엔드)
 * Haiku: 마커 분석 + 맥락 기반 영어 프롬프트 생성
 */

const MEMBER_DAILY_LIMIT = 5;
const MAX_MARKERS = 10;
const DIRECT_IMAGES = 8;
const IMAGE_SIZE = 'square_hd'; // 1024×1024

// 크레딧 10배 스케일링 (소수점 회피: 0.2cr → 2단위, 1cr → 10단위)
const CREDIT_SCALE = 10;
const FULL_COST = 10;         // 전체 생성/재생성: 1 크레딧
const SINGLE_REGEN_COST = 2;  // 개별 1장 재생성: 0.2 크레딧

// FLUX no-text suffix (단일 정의, 모든 모드에서 공유)
const FLUX_NO_TEXT = ', no text, no writing, no signs, no letters, no characters, pure visual only';

let redis;
function getRedis() {
  if (!redis) {
    redis = new Redis({
      url: process.env.KV_REST_API_URL,
      token: process.env.KV_REST_API_TOKEN,
    });
  }
  return redis;
}

function getClientIp(req) {
  return (
    req.headers['x-real-ip'] ||
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.socket?.remoteAddress ||
    'unknown'
  );
}

function getKSTDate() {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

function getTodayKey(ip) {
  return `ratelimit:blogimage:v2:${ip}:${getKSTDate()}`;
}

function getTodayKeyByEmail(email) {
  return `ratelimit:blogimage:${email}:${getKSTDate()}`;
}

function extractToken(req) {
  const auth = req.headers['authorization'] || req.headers['Authorization'] || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7);
  return null;
}

async function resolveSessionEmail(token) {
  if (!token) return null;
  try {
    const session = await getRedis().get(`session:${token}`);
    if (session && session.email) return session.email;
  } catch (e) {}
  return null;
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

const moodPrompts = {
  'bright': 'bright, clean, minimal Korean lifestyle blog image, white background, natural daylight, high quality',
  'warm': 'warm, cozy, soft tones Korean lifestyle blog image, golden hour lighting, high quality',
  'professional': 'professional, corporate, clean Korean business blog image, modern office, high quality',
  'emotional': 'emotional, moody, aesthetic Korean blog image, soft bokeh, film tone, high quality',
};

async function callClaude(systemPrompt, userMessage, maxTokens = 200) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(JSON.stringify(data));
  return (data.content?.[0]?.text || '').trim();
}

async function callFlux(prompt) {
  const response = await fetch('https://fal.run/fal-ai/flux/schnell', {
    method: 'POST',
    headers: {
      Authorization: `Key ${process.env.FAL_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      prompt,
      image_size: IMAGE_SIZE,
      num_images: 1,
      num_inference_steps: 4,
    }),
  });
  const data = await response.json();
  if (!response.ok || data.detail) throw new Error(JSON.stringify(data));
  return data.images?.[0]?.url || null;
}

async function callFluxBatch(prompt, count) {
  const images = [];
  const batches = count <= 4 ? [count] : [4, count - 4];
  for (const batchSize of batches) {
    const response = await fetch('https://fal.run/fal-ai/flux/schnell', {
      method: 'POST',
      headers: {
        Authorization: `Key ${process.env.FAL_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt,
        image_size: IMAGE_SIZE,
        num_images: batchSize,
        num_inference_steps: 4,
      }),
    });
    const data = await response.json();
    if (!response.ok || data.detail) {
      if (images.length === 0) throw new Error(JSON.stringify(data));
      break;
    }
    if (data.images) {
      for (const img of data.images) images.push(img.url);
    }
  }
  return images;
}

function extractJsonArray(raw) {
  let start = -1;
  let depth = 0;
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === '[' && depth === 0) { start = i; depth = 1; }
    else if (raw[i] === '[') depth++;
    else if (raw[i] === ']') { depth--; if (depth === 0 && start >= 0) return raw.substring(start, i + 1); }
  }
  return null;
}

// ─── Haiku 마커 자동 추천 (suggest_markers) ───

async function callHaikuSuggestMarkers(blogText) {
  const blogSummary = blogText.substring(0, 500).trim();
  const firstLine = blogText.split('\n').find(l => l.trim()) || '';
  const blogTitle = firstLine.trim().substring(0, 80);
  const headings = blogText.match(/【\d+\.?】[^\n]*/g) || [];
  const blogStructure = headings.map(h => h.trim()).join(' | ');
  const paragraphs = blogText.split(/\n\s*\n/).filter(p => p.trim().length > 30);

  const systemPrompt = `You are a Korean blog image placement expert. Analyze the blog post and suggest 4-8 optimal positions to insert images.

## YOUR TASK
1. Read the entire blog post carefully
2. Identify the heading/section structure (【1】, 【2】, etc.)
3. Find 4-8 locations where an image would enhance the reading experience
4. For each location, generate a descriptive Korean marker text that describes what image should go there

## PLACEMENT RULES
- First marker: representative image for the blog (대표이미지), placed near the beginning
- Place images after key paragraphs, not in the middle of sentences
- Space images evenly throughout the post (don't cluster them)
- Each section (【】) should have at least 1 image if possible
- Prefer placing images after emotional/descriptive paragraphs or topic transitions
- 4 markers minimum, 8 markers maximum

## MARKER TEXT RULES
- Write in Korean, 5-15 characters
- Describe the visual subject clearly (e.g., "커피 원두를 볶는 과정", "아늑한 카페 인테리어")
- Must be specific to the blog content, not generic
- All markers should describe photo-friendly scenes (this model generates photos only)

## POSITION DESCRIPTION
- Describe where in the post this marker should be inserted
- Reference the nearest heading or paragraph content
- Be specific enough that a human can find the exact location

## OUTPUT FORMAT
Return ONLY a valid JSON array. Each element:
{"text":"한국어 마커 텍스트","position":"이 마커가 들어갈 위치 설명 (한국어)"}`;

  const userPrompt = `블로그 제목: "${blogTitle}"
${blogStructure ? `글 구조: ${blogStructure}` : ''}
총 문단 수: ${paragraphs.length}개
글 길이: ${blogText.length}자

블로그 글 전문:
${blogText.substring(0, 6000)}`;

  const raw = await callClaude(systemPrompt, userPrompt, 2000);
  const jsonStr = extractJsonArray(raw);
  if (!jsonStr) throw new Error('Haiku suggest markers: no JSON array found');
  const result = JSON.parse(jsonStr);

  const validated = result
    .filter(item => item.text && item.position)
    .slice(0, 8);

  if (validated.length < 1) {
    throw new Error('Haiku suggest markers: no valid markers returned');
  }

  return validated;
}

function getSuggestMarkersKey(ip) {
  return `ratelimit:suggest_markers_img:${ip}:${getKSTDate()}`;
}

async function callHaikuMarkerAnalysis(blogText, markers, isRegenerate) {
  // 블로그 주제 파악을 위해 첫 300자 + 제목/소제목 추출
  const blogSummary = blogText.substring(0, 300).trim();
  const firstLine = blogText.split('\n').find(l => l.trim()) || '';
  const blogTitle = firstLine.trim().substring(0, 80);
  const headings = blogText.match(/【\d+\.?】[^\n]*/g) || [];
  const blogStructure = headings.map(h => h.trim()).join(' | ');

  const markerContext = markers.map((mk, i) => {
    const before = mk.before.substring(0, 200);
    const after = mk.after.substring(0, 200);
    return `마커 ${i + 1}: "${mk.text}"${mk.altText ? ` (alt: "${mk.altText}")` : ''}${mk.section ? `\n  소속 섹션: "${mk.section}"` : ''}\n  글 위치: ${mk.position}\n  앞 문맥 (200자): "${before}"\n  뒤 문맥 (200자): "${after}"`;
  }).join('\n\n');

  const systemPrompt = `You are a blog image prompt engineer for FLUX Schnell (1024x1024 square, photo only).
Generate English photo prompts for ALL markers. No infographics, no charts, no text — pure visual photography only.

## PHOTO PROMPT RULES
- Describe as cinematic/editorial photography matching each marker's meaning
- Read before/after context carefully — prompt MUST match the specific subject discussed
- Even if the marker mentions data/charts/comparisons, generate a mood/atmosphere photo related to the topic instead
- Include: materials, colors, textures, arrangement, lighting, camera angle
- Signs/menus → describe as blurred background elements
- End with: ", no text, no letters, photography style"
- Each prompt: 80-150 English words
- prompt MUST be 100% English (NO Korean)
- Maintain Korean/East Asian aesthetic
${isRegenerate ? '- REGENERATION MODE: MORE SPECIFIC prompts with different compositions and visual approaches.' : ''}

## Output Format
Return ONLY a valid JSON array:
[{"marker": "마커텍스트", "prompt": "English prompt 80-150 words..."}]`;

  const userPrompt = `블로그 제목: "${blogTitle}"
블로그 전체 주제 (첫 300자): ${blogSummary}${blogStructure ? `\n글 구조: ${blogStructure}` : ''}

마커 목록과 문맥:
${markerContext}

위 ${markers.length}개 마커 각각에 대해 JSON 배열을 출력하세요.`;

  const raw = await callClaude(systemPrompt, userPrompt, 4000);
  const jsonMatch = raw.match(/\[[\s\S]*?\](?=[^[\]]*$)/);
  if (!jsonMatch) throw new Error('Haiku marker analysis: no JSON array found');
  const result = JSON.parse(jsonMatch[0]);

  // 결과 개수 검증
  if (result.length !== markers.length) {
    throw new Error(`Haiku returned ${result.length} items, expected ${markers.length}`);
  }

  // ─── 안전 검증: 모든 항목을 photo로 강제 ───
  for (const item of result) {
    item.type = 'photo';
    if (!item.prompt) {
      item.prompt = 'high quality Korean lifestyle blog photography, soft natural lighting, editorial style';
    }
  }

  return result;
}

async function callHaikuSingleMarker(blogText, marker) {
  const blogSummary = blogText.substring(0, 300).trim();
  const firstLine = blogText.split('\n').find(l => l.trim()) || '';
  const blogTitle = firstLine.trim().substring(0, 80);

  const systemPrompt = `You are a blog image prompt engineer for FLUX Schnell (1024x1024 square, photo only).
Generate ONE new English photo prompt. SINGLE IMAGE REGENERATION — create a COMPLETELY DIFFERENT composition and visual approach.

## PHOTO PROMPT RULES
- Describe as cinematic/editorial photography matching the marker's meaning
- Read context carefully — prompt MUST match the specific subject discussed
- Even if the marker mentions data/charts/comparisons, generate a mood/atmosphere photo instead
- Include: materials, colors, textures, arrangement, lighting, camera angle
- Signs/menus → describe as blurred background elements
- End with: ", no text, no letters, photography style"
- Prompt: 80-150 English words, 100% English (NO Korean)
- Maintain Korean/East Asian aesthetic
- Use DIFFERENT composition, angle, and mood from typical approaches

## Output Format
Return ONLY a JSON object: {"prompt": "English prompt 80-150 words..."}`;

  const userPrompt = `블로그 제목: "${blogTitle}"
블로그 요약: ${blogSummary}
마커: "${marker.text}"${marker.altText ? ` (alt: "${marker.altText}")` : ''}${marker.section ? `\n소속 섹션: "${marker.section}"` : ''}
앞 문맥: "${marker.before.substring(0, 200)}"
뒤 문맥: "${marker.after.substring(0, 200)}"

이 마커에 대해 새로운 프롬프트를 생성하세요.`;

  const raw = await callClaude(systemPrompt, userPrompt, 500);
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('Haiku single marker: no JSON found');
  const result = JSON.parse(jsonMatch[0]);
  return result.prompt;
}

export default async function handler(req, res) {
  setCorsHeaders(res, req);

  if (req.method === 'OPTIONS') return res.status(200).end();

  // ─── suggest_markers 모드: 별도 rate limit ───
  if (req.method === 'POST' && req.body?.mode === 'suggest_markers') {
    let smKey = null;
    try {
      const { blogText } = req.body;
      if (!blogText || blogText.trim().length < 100) {
        return res.status(400).json({ error: '블로그 글을 100자 이상 입력해주세요.' });
      }
      if (blogText.length > 30000) {
        return res.status(400).json({ error: '블로그 글이 너무 깁니다. 30,000자 이내로 입력해주세요.' });
      }

      const isAdmin = await resolveAdmin(req);
      const ip = getClientIp(req);

      if (!isAdmin) {
        smKey = getSuggestMarkersKey(ip);
        const count = await getRedis().incr(smKey);
        await getRedis().expire(smKey, getTTLUntilMidnightKST());
        if (count > 10) {
          try { await getRedis().decr(smKey); } catch (_) {}
          smKey = null;
          return res.status(429).json({
            error: '마커 추천 일일 한도(10회)를 초과했습니다. 내일 다시 이용해주세요.',
          });
        }
      }

      console.log(`[IMAGE] Mode: suggest_markers | blogText: ${blogText.length} chars | ip: ${ip}`);

      const markers = await callHaikuSuggestMarkers(blogText);

      console.log(`[IMAGE] Suggested ${markers.length} markers`);

      return res.status(200).json({ markers });
    } catch (error) {
      console.error('[IMAGE] suggest_markers error:', error.message);
      if (smKey) try { await getRedis().decr(smKey); } catch (_) {}
      return res.status(500).json({ error: 'AI 마커 추천에 실패했습니다. 잠시 후 다시 시도해주세요.' });
    }
  }

  // GET: 남은 크레딧 조회
  if (req.method === 'GET') {
    try {
      const whitelisted = await resolveAdmin(req);
      if (whitelisted) {
        return res.status(200).json({ remaining: 999, limit: MEMBER_DAILY_LIMIT, admin: true });
      }

      const token = extractToken(req);
      const email = await resolveSessionEmail(token);
      if (!email) {
        return res.status(200).json({ remaining: 0, limit: MEMBER_DAILY_LIMIT, loginRequired: true });
      }
      const dailyLimitScaled = MEMBER_DAILY_LIMIT * CREDIT_SCALE;
      const key = getTodayKeyByEmail(email);
      const count = Number((await getRedis().get(key)) || 0);
      const remaining = Math.max(Math.round((dailyLimitScaled - count) / CREDIT_SCALE * 10) / 10, 0);
      return res.status(200).json({ remaining, limit: MEMBER_DAILY_LIMIT });
    } catch {
      return res.status(200).json({ remaining: 0, limit: MEMBER_DAILY_LIMIT });
    }
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let rateLimitKey = null;
  let creditCost = FULL_COST;

  try {
    const { mode, is_regenerate } = req.body;
    creditCost = mode === 'regenerate_single' ? SINGLE_REGEN_COST : FULL_COST;

    // Rate limit
    const whitelisted = await resolveAdmin(req);

    // 로그인 유저 확인
    const token = extractToken(req);
    const email = await resolveSessionEmail(token);

    if (!whitelisted && !email) {
      return res.status(401).json({ error: '로그인이 필요합니다.' });
    }

    const ip = getClientIp(req);
    const dailyLimit = MEMBER_DAILY_LIMIT;
    const dailyLimitScaled = dailyLimit * CREDIT_SCALE;

    if (!whitelisted && dailyLimit <= 0) {
      return res.status(429).json({ error: '현재 무료 사용이 제한되어 있습니다.', remaining: 0 });
    }

    let remaining = whitelisted ? 999 : dailyLimit;

    // 개별 재생성은 테스트 기간 무료 (프론트에서 이미지당 1회 제한)
    if (mode !== 'regenerate_single' && !whitelisted && dailyLimit > 0) {
      rateLimitKey = email ? getTodayKeyByEmail(email) : getTodayKey(ip);
      const newCount = await getRedis().incrby(rateLimitKey, creditCost);
      await getRedis().expire(rateLimitKey, getTTLUntilMidnightKST());

      if (newCount > dailyLimitScaled) {
        await getRedis().decrby(rateLimitKey, creditCost);
        return res.status(429).json({
          error: `일일 무료 사용 한도(${dailyLimit}크레딧)를 초과했습니다. 내일 다시 이용해주세요.`,
          remaining: 0,
        });
      }
      remaining = Math.round((dailyLimitScaled - newCount) / CREDIT_SCALE * 10) / 10;
    }

    // ===== REGENERATE_SINGLE 모드: 개별 1장 재생성 (테스트 기간 무료) =====
    if (mode === 'regenerate_single') {
      const { blogText, markerText, originalPrompt } = req.body;

      if (!markerText && !originalPrompt) {
        if (rateLimitKey) try { await getRedis().decrby(rateLimitKey, creditCost); } catch (_) {}
        return res.status(400).json({ error: '마커 정보 또는 프롬프트가 누락되었습니다.' });
      }

      let fullPrompt;

      if (markerText && blogText) {
        // Parse 모드 이미지: 마커 컨텍스트 추출 → Haiku 재생성
        const totalLen = blogText.length;
        const cleanCtx = (s) => s.replace(/\((사진|이미지):\s*[^)]+\)/g, '').replace(/#\S+/g, '').replace(/【\d+\.?】/g, '').replace(/\s{2,}/g, ' ').trim();
        const marker = { text: markerText, altText: '', before: '', after: '', position: 'middle', section: '' };
        const escaped = markerText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const found = blogText.match(new RegExp(`\\((사진|이미지):\\s*${escaped}[^)]*\\)`));
        if (found) {
          const pos = blogText.indexOf(found[0]);
          marker.before = cleanCtx(blogText.substring(Math.max(0, pos - 400), pos));
          marker.after = cleanCtx(blogText.substring(pos + found[0].length, Math.min(totalLen, pos + found[0].length + 400)));
          const ratio = pos / totalLen;
          marker.position = ratio < 0.25 ? 'early' : ratio < 0.75 ? 'middle' : 'ending';
          const beforeText = blogText.substring(0, pos);
          const secs = [...beforeText.matchAll(/【\d+\.?】[^\n]*/g)];
          marker.section = secs.length > 0 ? secs[secs.length - 1][0].trim() : '';
        }

        let newPrompt;
        try {
          newPrompt = await callHaikuSingleMarker(blogText, marker);
        } catch (err) {
          console.warn('[IMAGE] Haiku single regen failed, using original prompt:', err.message);
          newPrompt = originalPrompt || 'high quality Korean lifestyle blog photography, soft natural lighting, editorial style';
        }
        fullPrompt = `${newPrompt}, high quality editorial photography, square composition${FLUX_NO_TEXT}`;
      } else {
        // Direct 모드 이미지: 기존 프롬프트 재사용 (FLUX 시드 랜덤으로 다른 결과)
        fullPrompt = originalPrompt;
      }

      try {
        const url = await callFlux(fullPrompt);
        if (!url) throw new Error('No image URL');
        // R2 업로드 (non-fatal)
        const userId = (email || ip || 'anonymous').replace(/[^a-zA-Z0-9]/g, '_');
        const r2Result = await uploadImageUrlToR2(url, `images/${userId}/${getKSTDate()}/${Math.random().toString(36).substring(2, 10)}.png`);
        return res.status(200).json({
          mode: 'regenerate_single',
          image: { url, marker: markerText || '', prompt: fullPrompt, type: 'photo', r2Url: r2Result },
          remaining,
          limit: dailyLimit,
        });
      } catch (err) {
        console.error('[IMAGE] Single regen FLUX error:', err);
        if (rateLimitKey) try { await getRedis().decrby(rateLimitKey, creditCost); } catch (_) {}
        return res.status(500).json({ error: '이미지 재생성에 실패했습니다.' });
      }
    }

    // ===== PARSE 모드: 블로그 글에서 마커 파싱 → FLUX 전용 =====
    if (mode === 'parse') {
      const { blogText, thumbnailText } = req.body;
      const frontMarkers = req.body.markers;
      if (!blogText) {
        if (rateLimitKey) try { await getRedis().decrby(rateLimitKey, creditCost); } catch (_) {}
        return res.status(400).json({ error: '블로그 글을 입력해주세요.' });
      }

      const totalLen = blogText.length;

      const cleanContext = (str) => str
        .replace(/\((사진|이미지):\s*[^)]+\)/g, '')
        .replace(/#\S+/g, '')
        .replace(/【\d+\.?】/g, '')
        .replace(/\s{2,}/g, ' ')
        .trim();

      let markers = [];

      console.log(`[IMAGE] Mode: parse | blogText: ${totalLen} chars | frontMarkers: ${frontMarkers?.length || 0} | is_regenerate: ${is_regenerate}`);

      if (Array.isArray(frontMarkers) && frontMarkers.length > 0) {
        const validMarkers = frontMarkers.filter(m => m && m.trim()).slice(0, MAX_MARKERS);
        markers = validMarkers.map((markerText) => {
          const text = markerText.trim();
          const escapedText = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const findRegex = new RegExp(`\\((사진|이미지):\\s*${escapedText}[^)]*\\)`);
          const found = blogText.match(findRegex);
          let before = '', after = '', position = 'middle', section = '';

          if (found) {
            const pos = blogText.indexOf(found[0]);
            const rawBefore = blogText.substring(Math.max(0, pos - 400), pos);
            const rawAfter = blogText.substring(pos + found[0].length, Math.min(totalLen, pos + found[0].length + 400));
            before = cleanContext(rawBefore);
            after = cleanContext(rawAfter);
            const positionRatio = pos / totalLen;
            position = positionRatio < 0.25 ? 'early' : positionRatio < 0.75 ? 'middle' : 'ending';
            const textBeforeMarker = blogText.substring(0, pos);
            const sectionMatches = [...textBeforeMarker.matchAll(/【\d+\.?】[^\n]*/g)];
            section = sectionMatches.length > 0 ? sectionMatches[sectionMatches.length - 1][0].trim() : '';
          } else {
            console.warn(`[IMAGE] Marker NOT FOUND in blogText: "${text.substring(0, 40)}..." — using first 400 chars as context`);
            before = cleanContext(blogText.substring(0, Math.min(400, totalLen)));
            after = '';
            position = 'middle';
          }

          return { text, altText: '', before, after, position, section };
        });
      } else {
        const markerRegex = /\((사진|이미지):\s*([^)]+)\)/g;
        let m;

        while ((m = markerRegex.exec(blogText)) !== null) {
          const rawText = m[2].trim();
          let text = rawText;
          let altText = '';
          const altMatch = rawText.match(/^(.+?),\s*alt:\s*(.+)$/);
          if (altMatch) {
            text = altMatch[1].trim();
            altText = altMatch[2].trim();
          }
          const pos = m.index;
          const rawBefore = blogText.substring(Math.max(0, pos - 400), pos);
          const rawAfter = blogText.substring(pos + m[0].length, Math.min(totalLen, pos + m[0].length + 400));
          const before = cleanContext(rawBefore);
          const after = cleanContext(rawAfter);
          const positionRatio = pos / totalLen;
          const position = positionRatio < 0.25 ? 'early' : positionRatio < 0.75 ? 'middle' : 'ending';
          const textBeforeMarker = blogText.substring(0, pos);
          const sectionMatches = [...textBeforeMarker.matchAll(/【\d+\.?】[^\n]*/g)];
          const section = sectionMatches.length > 0 ? sectionMatches[sectionMatches.length - 1][0].trim() : '';
          markers.push({ text, altText, before, after, position, section });
        }
      }

      if (markers.length === 0) {
        console.warn('[IMAGE] No markers found in blogText');
        if (rateLimitKey) try { await getRedis().decrby(rateLimitKey, creditCost); } catch (_) {}
        return res.status(400).json({ error: '블로그 글에서 (사진: ...) 또는 (이미지: ...) 마커를 찾을 수 없습니다. 블로그 글 생성기에서 작성한 글을 붙여넣어주세요.' });
      }

      console.log(`[IMAGE] Markers found: ${markers.length} | contexts: ${markers.map(m => `"${m.text.substring(0, 20)}…" before:${m.before.length}ch after:${m.after.length}ch`).join(', ')}`);

      // 마커가 정확히 8개가 아닐 경우: FLUX 전용 로직 (fallback)
      if (markers.length !== 8) {
        const firstLine = blogText.split('\n').find(l => l.trim()) || '';
        const blogTitle = firstLine.trim().substring(0, 80);
        const blogSummary = blogText.substring(0, 300).trim();
        const headings = blogText.match(/【\d+\.?】[^\n]*/g) || [];
        const blogStructure = headings.map(h => h.trim()).join(' | ');
        const allMarkerNames = markers.map(mk => mk.text);

        const markersList = markers.map((mk, i) => {
          let entry = `Image ${i + 1} of ${markers.length}:\n  Marker: "${mk.text}"`;
          if (mk.altText) entry += `\n  Alt text: "${mk.altText}"`;
          if (mk.section) entry += `\n  Section: "${mk.section}"`;
          entry += `\n  Position in article: ${mk.position}`;
          entry += `\n  Before (400 chars): "${mk.before}"`;
          entry += `\n  After (400 chars): "${mk.after}"`;
          return entry;
        }).join('\n\n');

        const claudeSystem = `You are a blog image prompt engineer. Generate prompts that PRECISELY match each marker's topic and surrounding context.
${is_regenerate
  ? `REGENERATION MODE: Generate MORE SPECIFIC prompts with different compositions and visual approaches.`
  : `Read the before/after text carefully to understand the specific subject being discussed.`}

## Rules
- Generate English-only prompts for FLUX Schnell (1024x1024 square). Translate Korean markers to PRECISE English visual descriptions.
- Describe as cinematic/editorial photography. Each prompt: 80-150 English words.
- Every prompt MUST directly depict the subject of the blog and marker.
- Be hyper-specific: materials, textures, colors, arrangement, lighting, camera angle.
- Signs/menus → describe as "soft blurred background elements".
- End with: ", no text, no letters, photography style"
- Maintain Korean/East Asian aesthetic.

## Output
Return ONLY a valid JSON array of English prompt strings.`;

        const claudeUser = `Blog title: "${blogTitle}"
Blog summary (300 chars): "${blogSummary}"${blogStructure ? `\nArticle structure: "${blogStructure}"` : ''}

All image markers in order: ${JSON.stringify(allMarkerNames)}

---
${markersList}`;

        let prompts;
        try {
          const claudeRaw = await callClaude(claudeSystem, claudeUser, 2000);
          const jsonMatch = claudeRaw.match(/\[[\s\S]*?\](?=[^[\]]*$)/);
          prompts = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
        } catch (err) {
          console.error('[IMAGE] Claude parse error:', err);
          prompts = null;
        }

        if (!prompts || prompts.length !== markers.length) {
          console.warn(`[IMAGE] Non-8 marker path: Claude returned ${prompts?.length || 0} prompts for ${markers.length} markers — using generic English fallback`);
          // fallback: 순수 영어 generic 프롬프트로 대체 (한글을 FLUX에 넣지 않으면서 이미지 생성은 계속)
          prompts = markers.map(() => `high quality Korean lifestyle blog photography, soft natural lighting, editorial style`);
        }

        console.log('[IMAGE] Non-8 prompts generated:', prompts.map(p => p.substring(0, 60)));
        prompts = prompts.map(p => `${p}, high quality editorial photography, square composition${FLUX_NO_TEXT}`);

        const images = [];
        for (let i = 0; i < prompts.length; i += 4) {
          const batch = prompts.slice(i, i + 4);
          const batchResults = await Promise.all(
            batch.map(async (prompt, j) => {
              const markerIndex = i + j;
              try {
                const url = await callFlux(prompt);
                return { url, marker: markers[markerIndex].text, prompt, type: 'photo' };
              } catch (err) {
                console.error(`FLUX error for marker ${markerIndex}:`, err);
                return { url: null, marker: markers[markerIndex].text, prompt, type: 'photo' };
              }
            })
          );
          images.push(...batchResults);
        }

        const validImages = images.filter(img => img.url);
        if (validImages.length === 0) {
          if (rateLimitKey) try { await getRedis().decrby(rateLimitKey, creditCost); } catch (_) {}
          return res.status(500).json({ error: '이미지 생성에 실패했습니다. 잠시 후 다시 시도해주세요.' });
        }

        // R2 업로드 (non-fatal)
        const userId = (email || ip || 'anonymous').replace(/[^a-zA-Z0-9]/g, '_');
        const r2Images = await replaceUrlsWithR2(validImages, 'images', userId);

        logUsage(email, 'image', 'parse', ip);
        return res.status(200).json({
          mode: 'parse',
          images: r2Images,
          thumbnailText: thumbnailText || '',
          remaining,
          limit: dailyLimit,
        });
      }

      // ===== 마커 8개: Haiku 맥락 분석 → FLUX Schnell photo 전용 =====
      let analysisResult;
      try {
        analysisResult = await callHaikuMarkerAnalysis(blogText, markers, is_regenerate);
        console.log(`[IMAGE] Haiku analysis SUCCESS - ${analysisResult.length} photos`, JSON.stringify(analysisResult.map(r => ({ marker: r.marker, prompt: r.prompt?.substring(0, 60) }))));
      } catch (err) {
        console.error('[IMAGE] Haiku marker analysis FAILED:', err.message);
        // fallback: 간단한 Haiku 호출로 마커별 영어 번역 시도
        try {
          const firstLine = blogText.split('\n').find(l => l.trim()) || '';
          const blogTitle = firstLine.trim().substring(0, 80);
          const markerTexts = markers.map(mk => mk.text);
          const fallbackRaw = await callClaude(
            'You are a Korean-to-English translator for image generation. Translate each Korean image description into a specific, detailed English visual prompt (1-2 sentences). The prompts must describe the EXACT subject mentioned. No text/writing/signs in images. Output ONLY a JSON array of English prompt strings.',
            `Blog topic: "${blogTitle}"\n\nTranslate these image descriptions:\n${markerTexts.map((t, i) => `${i + 1}. ${t}`).join('\n')}`,
            1500
          );
          const fallbackMatch = fallbackRaw.match(/\[[\s\S]*?\](?=[^[\]]*$)/);
          const fallbackPrompts = fallbackMatch ? JSON.parse(fallbackMatch[0]) : null;
          if (fallbackPrompts && fallbackPrompts.length === markers.length) {
            console.log('[IMAGE] Fallback translation SUCCESS (all photo)');
            analysisResult = fallbackPrompts.map((prompt, i) => ({
              marker: markers[i].text,
              type: 'photo',
              prompt,
            }));
          } else {
            throw new Error('Fallback translation returned wrong count');
          }
        } catch (fallbackErr) {
          console.error('[IMAGE] Fallback translation also FAILED:', fallbackErr.message);
          if (rateLimitKey) try { await getRedis().decrby(rateLimitKey, creditCost); } catch (_) {}
          return res.status(500).json({ error: 'AI 이미지 분석에 실패했습니다. 잠시 후 다시 시도해주세요.' });
        }
      }

      // 원래 마커 순서대로 매핑 + originalIndex 부여
      const orderedItems = markers.map((mk, i) => {
        const found = analysisResult.find(a => a.marker === mk.text) || analysisResult[i];
        if (!found) {
          return { type: 'photo', prompt: 'high quality Korean lifestyle blog photography, soft natural lighting, editorial style', marker: mk.text, originalIndex: i };
        }
        return { ...found, marker: mk.text, originalIndex: i };
      });

      console.log(`[IMAGE] Pipeline: ${orderedItems.length} photos (FLUX Schnell)`);

      // ─── FLUX 배치 처리 (4장씩) ───
      const allResults = [];
      for (let i = 0; i < orderedItems.length; i += 4) {
        const batch = orderedItems.slice(i, i + 4);
        const batchResults = await Promise.all(
          batch.map(async (item) => {
            const prompt = item.prompt || 'high quality Korean lifestyle blog photography, soft natural lighting, editorial style';
            const fullPrompt = `${prompt}, high quality editorial photography, square composition${FLUX_NO_TEXT}`;
            try {
              const url = await callFlux(fullPrompt);
              return { url, marker: item.marker, prompt: fullPrompt, type: 'photo', originalIndex: item.originalIndex };
            } catch (err) {
              console.error(`[IMAGE] FLUX error for marker "${item.marker}":`, err);
              return { url: null, marker: item.marker, prompt: fullPrompt, type: 'photo', originalIndex: item.originalIndex };
            }
          })
        );
        allResults.push(...batchResults);
      }

      const validImages = allResults.filter(img => img.url);
      if (validImages.length === 0) {
        if (rateLimitKey) try { await getRedis().decrby(rateLimitKey, creditCost); } catch (_) {}
        return res.status(500).json({ error: '이미지 생성에 실패했습니다. 잠시 후 다시 시도해주세요.' });
      }

      // R2 업로드 (non-fatal)
      const userId2 = (email || ip || 'anonymous').replace(/[^a-zA-Z0-9]/g, '_');
      const r2Images2 = await replaceUrlsWithR2(validImages, 'images', userId2);

      logUsage(email, 'image', 'parse', ip);
      return res.status(200).json({
        mode: 'parse',
        images: r2Images2,
        thumbnailText: thumbnailText || '',
        remaining,
        limit: dailyLimit,
      });
    }

    // ===== DIRECT 모드: 주제+분위기 → DIRECT_IMAGES장 고정 (FLUX 전용) =====
    const { topic, mood, thumbnailText } = req.body;
    if (!topic) {
      if (rateLimitKey) try { await getRedis().decrby(rateLimitKey, creditCost); } catch (_) {}
      return res.status(400).json({ error: '블로그 주제를 입력해주세요.' });
    }

    const directSystem = is_regenerate
      ? 'You are an image prompt translator. This is a REGENERATION request — generate MORE SPECIFIC and DETAILED prompts. Convert the Korean blog topic into a rich, detailed English image description (2-3 sentences). Describe the EXACT subject of the topic with specific materials, colors, composition, and props. Focus on visual elements only. No people faces. CRITICAL: Never include any text, typography, letters, signs, or written words. Compose for square 1024x1024 format. No explanations, just the prompt.'
      : 'You are an image prompt translator. Convert the given Korean blog topic into a concise English image description (1-2 sentences) that depicts the EXACT subject. Focus on visual elements only. No people faces. CRITICAL: Never include any text, typography, letters, signs, or written words. Compose for square 1024x1024 format. Purely visual elements only. No explanations, just the prompt.';
    const englishTopic = await callClaude(
      directSystem,
      topic,
      is_regenerate ? 300 : 150
    );

    console.log('[IMAGE] Direct mode - topic:', topic, '→ prompt:', englishTopic.substring(0, 100));
    const moodStyle = moodPrompts[mood] || moodPrompts['bright'];
    const fullPrompt = `${englishTopic}, ${moodStyle}${FLUX_NO_TEXT}`;

    const urls = await callFluxBatch(fullPrompt, DIRECT_IMAGES);
    if (urls.length === 0) {
      if (rateLimitKey) try { await getRedis().decrby(rateLimitKey, creditCost); } catch (_) {}
      return res.status(500).json({ error: '이미지 생성에 실패했습니다.' });
    }

    // R2 업로드 (non-fatal)
    const directUserId = (email || ip || 'anonymous').replace(/[^a-zA-Z0-9]/g, '_');
    const directImages = urls.map(url => ({ url, prompt: fullPrompt }));
    const r2DirectImages = await replaceUrlsWithR2(directImages, 'images', directUserId);

    logUsage(email, 'image', 'direct', ip);
    return res.status(200).json({
      mode: 'direct',
      images: r2DirectImages,
      thumbnailText: thumbnailText || '',
      remaining,
      limit: dailyLimit,
    });

  } catch (error) {
    console.error('Blog Image API Error:', error);
    if (rateLimitKey) try { await getRedis().decrby(rateLimitKey, creditCost); } catch (_) {}
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
}
