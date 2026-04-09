import crypto from 'node:crypto';
import { resolveAdmin, setCorsHeaders, extractToken, resolveSessionEmail } from './_helpers.js';

export const config = { maxDuration: 30 };

// ── Supertone Play API (메인) ──
const SUPERTONE_API_BASE = 'https://supertoneapi.com/v1';

const SUPERTONE_VOICES = {
  // 여성
  'e5f6fb1a53d0add87afb4f': { name: 'Agatha', gender: 'female' },
  'ac449f240c2732b7f0b8bb': { name: 'Aiko', gender: 'female' },
  '451e6fa92768affdcced52': { name: 'Amantha', gender: 'female' },
  '259d4ac1ecf560c0f76e08': { name: 'Anna', gender: 'female' },
  '7c56c6a6471a12816604f0': { name: 'Ariel', gender: 'female' },
  '941fd27c5b0cb6a6f1e7c3': { name: 'Arin', gender: 'female' },
  '1f6b70f879da125bfec245': { name: 'Audrey', gender: 'female' },
  '2cd6c38c7087106be21888': { name: 'Aya', gender: 'female' },
  '52dc253df44d06aa7f0867': { name: 'Bella', gender: 'female' },
  'aeda85bfe699f338b74d68': { name: 'Blitz', gender: 'female' },
  // 남성
  '91992bbd4758bdcf9c9b01': { name: 'Adam', gender: 'male' },
  '2d5a380030e78fcab0c82a': { name: 'Aiden', gender: 'male' },
  'd9411052b13cba9cb4c313': { name: 'Allen', gender: 'male' },
  'c3c0898fd41489a8e8919c': { name: 'Alphonse', gender: 'male' },
  '4653d63d07d5340656b6bc': { name: 'Andrew', gender: 'male' },
  'ead6b9de6beb66dc8f6d2d': { name: 'Andy', gender: 'male' },
  '20160a4c5ba38967330c84': { name: 'Ben', gender: 'male' },
  '816bc977b4111a3034146a': { name: 'Bert', gender: 'male' },
  '257ff27e0d5377b184cb16': { name: 'Bin', gender: 'male' },
  '053c8b0d977ac6762b013e': { name: 'Bodhi', gender: 'male' },
};

// ── Google Cloud TTS (폴백) ──
const GOOGLE_OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_TTS_URL = 'https://texttospeech.googleapis.com/v1/text:synthesize';
const GOOGLE_CLOUD_SCOPE = 'https://www.googleapis.com/auth/cloud-platform';

const GOOGLE_VOICES = {
  'ko-KR-Neural2-A': { name: '서연', gender: 'FEMALE' },
  'ko-KR-Neural2-B': { name: '민지', gender: 'FEMALE' },
  'ko-KR-Wavenet-A': { name: '하은', gender: 'FEMALE' },
  'ko-KR-Wavenet-B': { name: '지수', gender: 'FEMALE' },
  'ko-KR-Standard-A': { name: '유나', gender: 'FEMALE' },
  'ko-KR-Neural2-C': { name: '도윤', gender: 'MALE' },
  'ko-KR-Wavenet-C': { name: '준서', gender: 'MALE' },
  'ko-KR-Wavenet-D': { name: '시우', gender: 'MALE' },
  'ko-KR-Standard-C': { name: '건우', gender: 'MALE' },
  'ko-KR-Standard-D': { name: '현우', gender: 'MALE' },
};

const DEFAULT_SUPERTONE_VOICE = '259d4ac1ecf560c0f76e08'; // Anna
const DEFAULT_GOOGLE_VOICE = 'ko-KR-Neural2-A';

// ── Supertone TTS ──
async function callSupertone(text, voiceId) {
  const apiKey = process.env.SUPERTONE_API_KEY;
  if (!apiKey) throw new Error('SUPERTONE_API_KEY is missing');

  const res = await fetch(`${SUPERTONE_API_BASE}/text-to-speech/${voiceId}/stream`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-sup-api-key': apiKey,
    },
    body: JSON.stringify({
      text,
      language: 'ko',
      model: 'sona_speech_1',
      output_format: 'mp3',
      voice_settings: {
        speed: 1.1,
        similarity: 0.75,
      },
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Supertone TTS failed: ${res.status} ${errText.slice(0, 200)}`);
  }

  // 스트리밍 응답 → Buffer로 수집
  const chunks = [];
  const reader = res.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

// ── Google Cloud TTS (폴백) ──
let _tokenCache = { token: null, expiresAt: 0 };

function _parseServiceAccount() {
  const raw = process.env.GOOGLE_VERTEX_SERVICE_ACCOUNT_JSON || process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '';
  try { const p = JSON.parse(raw); return p?.client_email && p?.private_key ? p : null; } catch { return null; }
}

function _base64url(input) {
  const b = typeof input === 'string' ? Buffer.from(input) : input;
  return b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function getGoogleAccessToken() {
  const now = Math.floor(Date.now() / 1000);
  if (_tokenCache.token && _tokenCache.expiresAt - 60 > now) return _tokenCache.token;

  const sa = _parseServiceAccount();
  if (!sa) throw new Error('Google 서비스 계정 환경변수가 없습니다');

  const header = _base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = _base64url(JSON.stringify({ iss: sa.client_email, scope: GOOGLE_CLOUD_SCOPE, aud: GOOGLE_OAUTH_TOKEN_URL, exp: now + 3600, iat: now }));
  const sig = crypto.createSign('RSA-SHA256').update(`${header}.${claims}`).end().sign(sa.private_key.replace(/\\n/g, '\n'));
  const jwt = `${header}.${claims}.${_base64url(sig)}`;

  const res = await fetch(GOOGLE_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });
  const data = await res.json();
  if (!res.ok || !data.access_token) throw new Error(`Google token failed: ${res.status}`);
  _tokenCache = { token: data.access_token, expiresAt: now + (data.expires_in || 3600) };
  return data.access_token;
}

async function callGoogleTTS(text, voiceName, voiceGender) {
  const accessToken = await getGoogleAccessToken();
  const res = await fetch(GOOGLE_TTS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({
      input: { text },
      voice: { languageCode: 'ko-KR', name: voiceName, ssmlGender: voiceGender },
      audioConfig: { audioEncoding: 'MP3', speakingRate: 1.1, pitch: 0 },
    }),
  });
  if (!res.ok) throw new Error(`Google TTS failed: ${res.status}`);
  const data = await res.json();
  return Buffer.from(data.audioContent, 'base64');
}

// ── 핸들러 ──
export default async function handler(req, res) {
  setCorsHeaders(res, req);
  if (req.method === 'OPTIONS') return res.status(200).end();

  // GET: 사용 가능한 음성 목록 반환
  if (req.method === 'GET') {
    const hasSupertone = !!process.env.SUPERTONE_API_KEY;
    const voices = hasSupertone
      ? Object.entries(SUPERTONE_VOICES).map(([id, v]) => ({ id, name: v.name, gender: v.gender, provider: 'supertone' }))
      : Object.entries(GOOGLE_VOICES).map(([id, v]) => ({ id, name: v.name, gender: v.gender, provider: 'google' }));
    return res.status(200).json({ voices, provider: hasSupertone ? 'supertone' : 'google' });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const token = extractToken(req);
  const email = await resolveSessionEmail(token);
  const isAdmin = await resolveAdmin(req);
  if (!isAdmin && !email) return res.status(401).json({ error: '로그인이 필요합니다.' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const text = String(body.text || '').trim();
    if (!text) return res.status(400).json({ error: 'text가 필요합니다.' });
    if (text.length > 5000) return res.status(400).json({ error: '텍스트가 너무 깁니다. (최대 5000자)' });

    const voiceId = body.voiceId || '';
    let audioBuffer;
    let provider;

    // Supertone 메인 → Google 폴백
    if (process.env.SUPERTONE_API_KEY && (SUPERTONE_VOICES[voiceId] || !GOOGLE_VOICES[voiceId])) {
      const stVoiceId = SUPERTONE_VOICES[voiceId] ? voiceId : DEFAULT_SUPERTONE_VOICE;
      try {
        console.log(`[TTS] Calling Supertone: voice=${stVoiceId}, text=${text.length} chars`);
        audioBuffer = await callSupertone(text, stVoiceId);
        provider = 'supertone';
        console.log(`[TTS] Supertone success: voice=${stVoiceId}, ${audioBuffer.length} bytes`);
      } catch (stError) {
        console.error('[TTS] Supertone FAILED:', stError.message, '| voice:', stVoiceId);
        // 폴백 없이 에러 반환 — 조용히 여성 음성으로 빠지는 것 방지
        return res.status(502).json({ error: 'Supertone 음성 생성 실패: ' + stError.message });
      }
    } else {
      // Google TTS 직접 사용 (Supertone 키 없거나 Google 음성 명시 선택)
      const gVoice = GOOGLE_VOICES[voiceId] ? voiceId : DEFAULT_GOOGLE_VOICE;
      audioBuffer = await callGoogleTTS(text, gVoice, GOOGLE_VOICES[gVoice].gender);
      provider = 'google';
    }

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Length', audioBuffer.length);
    res.setHeader('X-TTS-Provider', provider);
    return res.status(200).send(audioBuffer);
  } catch (error) {
    console.error('[TTS] Error:', error.message);
    return res.status(500).json({ error: '음성 생성 중 오류가 발생했습니다.' });
  }
}
