import { Redis } from '@upstash/redis';
import { resolveAdmin, setCorsHeaders } from './_helpers.js';

/*
 * 블로그 영상 자동 생성 API (Creatomate)
 * POST: 이미지 1~8장 + 블로그 텍스트 → 영상 렌더 제출
 * GET:  renderId로 상태 폴링
 * 1크레딧 차감, blog-image와 동일 Redis 키 공유
 */

const GUEST_DAILY_LIMIT = 3;
const MEMBER_DAILY_LIMIT = 5;
const CREDIT_SCALE = 10;
const FULL_COST = 10; // 1크레딧

// BGM 매핑 (음원 추후 추가)
const BGM_MAP = {
  // 'calm': { url: '...', name: '잔잔한' },
  // 'upbeat': { url: '...', name: '경쾌한' },
  // 'emotional': { url: '...', name: '감성적' },
  // 'epic': { url: '...', name: '웅장한' },
};

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
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.headers['x-real-ip'] ||
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
  return req.body?.token || req.query?.token || null;
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

/* ─── POST: 렌더 제출 ─── */
async function handlePost(req, res) {
  let rateLimitKey = null;

  try {
    const { imageUrls, text, bgmId } = req.body;

    // 이미지 1~8장 허용
    if (!imageUrls || !Array.isArray(imageUrls) || imageUrls.length < 1 || imageUrls.length > 8) {
      return res.status(400).json({ error: '이미지는 1~8장이 필요합니다.' });
    }
    if (!text || text.trim().length < 50) {
      return res.status(400).json({ error: '블로그 글이 너무 짧습니다.' });
    }

    const imageCount = imageUrls.length;

    // ─── Rate Limit ───
    const whitelisted = await resolveAdmin(req);
    const token = extractToken(req);
    const email = await resolveSessionEmail(token);
    const ip = getClientIp(req);
    const dailyLimit = email ? MEMBER_DAILY_LIMIT : GUEST_DAILY_LIMIT;
    const dailyLimitScaled = dailyLimit * CREDIT_SCALE;

    if (!whitelisted && dailyLimit <= 0) {
      return res.status(429).json({ error: '현재 무료 사용이 제한되어 있습니다.', remaining: 0 });
    }

    let remaining = whitelisted ? 999 : dailyLimit;

    if (!whitelisted) {
      rateLimitKey = email ? getTodayKeyByEmail(email) : getTodayKey(ip);
      const newCount = await getRedis().incrby(rateLimitKey, FULL_COST);
      await getRedis().expire(rateLimitKey, getTTLUntilMidnightKST());

      if (newCount > dailyLimitScaled) {
        await getRedis().decrby(rateLimitKey, FULL_COST);
        return res.status(429).json({
          error: `일일 무료 사용 한도(${dailyLimit}크레딧)를 초과했습니다. 영상 생성에는 1크레딧이 필요합니다.`,
          remaining: 0,
        });
      }
      remaining = Math.round((dailyLimitScaled - newCount) / CREDIT_SCALE * 10) / 10;
    }

    // ─── Haiku: 블로그 텍스트 → N줄 요약 (이미지 수만큼) ───
    const blogSnippet = text.substring(0, 800).trim();
    const maxTokens = 200 + imageCount * 20;
    let subtitles;
    try {
      const raw = await callClaude(
        `블로그 글을 ${imageCount}줄로 요약해주세요. 각 줄은 15자 이내, 구어체, 핵심 메시지만. 반드시 JSON 배열로만 출력: ["줄1", "줄2", ...]`,
        blogSnippet,
        maxTokens,
      );
      const jsonMatch = raw.match(/\[[\s\S]*?\](?=[^[\]]*$)/);
      if (!jsonMatch) throw new Error('No JSON array');
      const parsed = JSON.parse(jsonMatch[0]);
      if (!Array.isArray(parsed) || parsed.length < imageCount) throw new Error(`Not ${imageCount} items`);
      subtitles = parsed.slice(0, imageCount).map(s => String(s).substring(0, 20));
    } catch (err) {
      console.warn('[BLOG-VIDEO] Summary generation failed:', err.message);
      // 폴백: imageCount에 맞게 기본 자막 생성
      const defaults = ['핵심 포인트 정리', '실전 활용 꿀팁', '지금 바로 시작하기', '놓치면 손해', '알아두면 좋은 팁', '한눈에 정리', '꼭 기억하세요', '마지막 정리'];
      subtitles = defaults.slice(0, imageCount);
    }

    console.log('[BLOG-VIDEO] Subtitles:', subtitles);

    // ─── Creatomate 렌더 제출 ───
    const urls = imageUrls.slice(0, 8);
    const slideDuration = 4; // 슬라이드당 4초
    const totalDuration = imageCount * slideDuration;

    const textStyle = {
      y: '60%',
      width: '90%',
      fill_color: '#ffffff',
      font_size: '7 vw',
      font_family: 'Pretendard',
      font_weight: '900',
      x_alignment: '50%',
      y_alignment: '50%',
      text_align: 'center',
      stroke_color: '#000000',
      stroke_width: '0.8 vw',
      shadow_color: 'rgba(0,0,0,0.9)',
      shadow_blur: 4,
      shadow_x: 3,
      shadow_y: 3,
    };

    // 트랜지션 패턴: slide/fade 교차
    const transitions = [
      null, // 첫 번째는 트랜지션 없음
      { type: 'slide', duration: 1, transition: true, easing: 'cubic-in-out' },
      { type: 'fade', duration: 1, transition: true },
      { type: 'slide', duration: 1, direction: '90°', transition: true, easing: 'cubic-in-out' },
      { type: 'fade', duration: 1, transition: true },
      { type: 'slide', duration: 1, transition: true, easing: 'cubic-in-out' },
      { type: 'fade', duration: 1, transition: true },
      { type: 'slide', duration: 1, direction: '90°', transition: true, easing: 'cubic-in-out' },
    ];

    // Track 1: 이미지 슬라이드 (동적)
    const imageElements = urls.map((url, i) => {
      const el = { type: 'image', source: url, track: 1, duration: slideDuration };
      if (transitions[i]) el.animations = [transitions[i]];
      return el;
    });

    // Track 2: 자막 (균등 시간 배분)
    const subtitleDuration = totalDuration / imageCount;
    const subtitleElements = subtitles.map((sub, i) => ({
      type: 'text',
      text: sub,
      track: 2,
      time: i * subtitleDuration,
      duration: subtitleDuration,
      ...textStyle,
    }));

    const elements = [...imageElements, ...subtitleElements];

    // BGM (준비만, 음원은 나중에 추가)
    if (bgmId && BGM_MAP[bgmId]) {
      elements.push({
        type: 'audio',
        source: BGM_MAP[bgmId].url,
        track: 3,
        duration: totalDuration,
        volume: '30%',
      });
    }

    const source = {
      output_format: 'mp4',
      width: 1080,
      height: 1920,
      elements,
    };

    const creatRes = await fetch('https://api.creatomate.com/v1/renders', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.CREATOMATE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ source }),
    });

    const creatData = await creatRes.json();
    if (!creatRes.ok) {
      console.error('[BLOG-VIDEO] Creatomate error:', creatData);
      if (rateLimitKey) try { await getRedis().decrby(rateLimitKey, FULL_COST); } catch (_) {}
      return res.status(500).json({ error: '영상 생성 요청에 실패했습니다.' });
    }

    const renderId = Array.isArray(creatData) ? creatData[0]?.id : creatData.id;
    if (!renderId) {
      console.error('[BLOG-VIDEO] No renderId:', creatData);
      if (rateLimitKey) try { await getRedis().decrby(rateLimitKey, FULL_COST); } catch (_) {}
      return res.status(500).json({ error: '영상 렌더 ID를 받지 못했습니다.' });
    }

    return res.status(200).json({ renderId, remaining, limit: dailyLimit });

  } catch (error) {
    console.error('[BLOG-VIDEO] Error:', error);
    if (rateLimitKey) try { await getRedis().decrby(rateLimitKey, FULL_COST); } catch (_) {}
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
}

/* ─── GET: 상태 폴링 ─── */
async function handleGet(req, res) {
  try {
    const { renderId } = req.query;
    if (!renderId) {
      return res.status(400).json({ error: 'renderId가 필요합니다.' });
    }

    const creatRes = await fetch(`https://api.creatomate.com/v1/renders/${renderId}`, {
      headers: {
        Authorization: `Bearer ${process.env.CREATOMATE_API_KEY}`,
      },
    });

    const creatData = await creatRes.json();
    if (!creatRes.ok) {
      console.error('[BLOG-VIDEO] Creatomate poll error:', creatData);
      return res.status(500).json({ error: '상태 조회에 실패했습니다.' });
    }

    const status = creatData.status; // "planned" | "rendering" | "succeeded" | "failed"
    const url = creatData.url || null;

    return res.status(200).json({
      status: status === 'rendering' || status === 'planned' ? 'processing' : status,
      url,
    });

  } catch (error) {
    console.error('[BLOG-VIDEO] Poll Error:', error);
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
}

export default async function handler(req, res) {
  setCorsHeaders(res, req);

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method === 'POST') return handlePost(req, res);
  if (req.method === 'GET') return handleGet(req, res);

  return res.status(405).json({ error: 'Method not allowed' });
}
