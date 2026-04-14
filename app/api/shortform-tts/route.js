import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import {
  getRedis,
  resolveAdmin,
  extractToken,
  resolveSessionEmail,
  corsHeaders,
  jsonResponse,
  handleOptions,
} from '@/lib/api-helpers';

const PREVIEW_SAMPLE_TEXT = '안녕하세요. 저는 이 목소리를 담당하고 있어요';
const PREVIEW_CACHE_TTL = 60 * 60 * 24 * 30; // 30일

export const maxDuration = 30;

// ── Supertone Play API (메인) ──
const SUPERTONE_API_BASE = 'https://supertoneapi.com/v1';

const SUPERTONE_VOICES = {
  'e5f6fb1a53d0add87afb4f': { name: 'Agatha', gender: 'female' },
  '1f6b70f879da125bfec245': { name: 'Audrey', gender: 'female' },
  '52dc253df44d06aa7f0867': { name: 'Bella', gender: 'female' },
  '91992bbd4758bdcf9c9b01': { name: 'Adam', gender: 'male' },
  '4653d63d07d5340656b6bc': { name: 'Andrew', gender: 'male' },
  'ead6b9de6beb66dc8f6d2d': { name: 'Andy', gender: 'male' },
};

// ── ElevenLabs (정밀 자막용) ──
const ELEVENLABS_API_BASE = 'https://api.elevenlabs.io/v1';
const ELEVENLABS_MODEL = 'eleven_multilingual_v2';

const ELEVENLABS_VOICES = {
  '21m00Tcm4TlvDq8ikWAM': { name: 'Rachel', gender: 'female' },
  'EXAVITQu4vr4xnSDxMaL': { name: 'Sarah', gender: 'female' },
  'XB0fDUnXU5powFXDhCwa': { name: 'Charlotte', gender: 'female' },
  'pNInz6obpgDQGcFmaJgB': { name: 'Adam', gender: 'male' },
  'ErXwobaYiN019PkySvjV': { name: 'Antoni', gender: 'male' },
  'TxGEqnHWrfWFTfGW9XjX': { name: 'Josh', gender: 'male' },
};

async function callElevenLabs(text, voiceId) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error('ELEVENLABS_API_KEY is missing');

  const res = await fetch(`${ELEVENLABS_API_BASE}/text-to-speech/${voiceId}/with-timestamps`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'xi-api-key': apiKey,
      'Accept': 'application/json',
    },
    body: JSON.stringify({
      text,
      model_id: ELEVENLABS_MODEL,
      voice_settings: { stability: 0.5, similarity_boost: 0.75 },
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`ElevenLabs TTS failed: ${res.status} ${errText.slice(0, 200)}`);
  }

  const data = await res.json();
  const audioBase64 = data.audio_base64 || data.audioBase64;
  if (!audioBase64) throw new Error('ElevenLabs: audio_base64 missing');

  const alignment = data.alignment || data.normalized_alignment || null;
  return {
    audioBuffer: Buffer.from(audioBase64, 'base64'),
    wordTimestamps: alignment ? charsToWordTimestamps(alignment) : [],
  };
}

function charsToWordTimestamps(alignment) {
  const chars = alignment.characters || [];
  const starts = alignment.character_start_times_seconds || [];
  const ends = alignment.character_end_times_seconds || [];
  if (!chars.length || chars.length !== starts.length) return [];

  const words = [];
  let buf = '';
  let wordStart = null;
  let lastEnd = 0;

  const flush = () => {
    if (buf) {
      words.push({ word: buf, start: wordStart ?? lastEnd, end: lastEnd });
      buf = '';
      wordStart = null;
    }
  };

  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (/\s/.test(ch)) {
      flush();
      lastEnd = ends[i];
      continue;
    }
    if (wordStart === null) wordStart = starts[i];
    buf += ch;
    lastEnd = ends[i];
  }
  flush();
  return words;
}

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

const DEFAULT_SUPERTONE_VOICE = '52dc253df44d06aa7f0867';
const DEFAULT_GOOGLE_VOICE = 'ko-KR-Neural2-A';

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
        similarity: 1,
      },
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Supertone TTS failed: ${res.status} ${errText.slice(0, 200)}`);
  }

  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
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

function audioResponse(request, buffer, provider) {
  return new NextResponse(buffer, {
    status: 200,
    headers: {
      ...corsHeaders(request),
      'Content-Type': 'audio/mpeg',
      'Content-Length': String(buffer.length),
      'X-TTS-Provider': provider,
    },
  });
}

export async function OPTIONS(request) {
  return handleOptions(request);
}

export async function GET(request) {
  const hasSupertone = !!process.env.SUPERTONE_API_KEY;
  const hasEleven = !!process.env.ELEVENLABS_API_KEY;
  const voices = [];
  if (hasSupertone) {
    for (const [id, v] of Object.entries(SUPERTONE_VOICES)) {
      voices.push({ id, name: v.name, gender: v.gender, provider: 'supertone' });
    }
  }
  if (hasEleven) {
    for (const [id, v] of Object.entries(ELEVENLABS_VOICES)) {
      voices.push({ id, name: v.name, gender: v.gender, provider: 'elevenlabs' });
    }
  }
  if (!voices.length) {
    for (const [id, v] of Object.entries(GOOGLE_VOICES)) {
      voices.push({ id, name: v.name, gender: v.gender, provider: 'google' });
    }
  }
  return jsonResponse(request, { voices, provider: hasSupertone ? 'supertone' : (hasEleven ? 'elevenlabs' : 'google') });
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const isPreview = body.preview === true || body.preview === 'true';

    if (!isPreview) {
      const token = extractToken(request);
      const email = await resolveSessionEmail(token);
      const isAdmin = await resolveAdmin(request);
      if (!isAdmin && !email) return jsonResponse(request, { error: '로그인이 필요합니다.' }, { status: 401 });
    }

    const text = isPreview ? PREVIEW_SAMPLE_TEXT : String(body.text || '').trim();
    if (!text) return jsonResponse(request, { error: 'text가 필요합니다.' }, { status: 400 });
    if (text.length > 5000) return jsonResponse(request, { error: '텍스트가 너무 깁니다. (최대 5000자)' }, { status: 400 });

    const voiceId = body.voiceId || '';

    if (isPreview) {
      const redis = getRedis();
      const cacheKey = `tts-preview:${voiceId || 'default'}`;
      if (redis) {
        try {
          const cached = await redis.get(cacheKey);
          if (cached && typeof cached === 'string') {
            const cachedBuf = Buffer.from(cached, 'base64');
            return audioResponse(request, cachedBuf, 'cache');
          }
        } catch (_) {}
      }
    }
    let audioBuffer;
    let wordTimestamps = null;
    let provider;

    const isElevenVoice = !!ELEVENLABS_VOICES[voiceId];
    const isSupertoneVoice = !!SUPERTONE_VOICES[voiceId];
    const isGoogleVoice = !!GOOGLE_VOICES[voiceId];

    if (isElevenVoice && process.env.ELEVENLABS_API_KEY) {
      try {
        console.log(`[TTS] Calling ElevenLabs: voice=${voiceId}, text=${text.length} chars`);
        const result = await callElevenLabs(text, voiceId);
        audioBuffer = result.audioBuffer;
        wordTimestamps = result.wordTimestamps;
        provider = 'elevenlabs';
        console.log(`[TTS] ElevenLabs success: ${audioBuffer.length} bytes, ${wordTimestamps.length} words`);
      } catch (elError) {
        console.error('[TTS] ElevenLabs FAILED:', elError.message);
        return jsonResponse(request, { error: 'ElevenLabs 음성 생성 실패: ' + elError.message }, { status: 502 });
      }
    } else if (process.env.SUPERTONE_API_KEY && (isSupertoneVoice || !isGoogleVoice)) {
      const stVoiceId = isSupertoneVoice ? voiceId : DEFAULT_SUPERTONE_VOICE;
      try {
        console.log(`[TTS] Calling Supertone: voice=${stVoiceId}, text=${text.length} chars`);
        audioBuffer = await callSupertone(text, stVoiceId);
        provider = 'supertone';
        console.log(`[TTS] Supertone success: voice=${stVoiceId}, ${audioBuffer.length} bytes`);
      } catch (stError) {
        console.error('[TTS] Supertone FAILED:', stError.message, '| voice:', stVoiceId);
        return jsonResponse(request, { error: 'Supertone 음성 생성 실패: ' + stError.message }, { status: 502 });
      }
    } else {
      const gVoice = isGoogleVoice ? voiceId : DEFAULT_GOOGLE_VOICE;
      audioBuffer = await callGoogleTTS(text, gVoice, GOOGLE_VOICES[gVoice].gender);
      provider = 'google';
    }

    if (isPreview) {
      const redis = getRedis();
      if (redis) {
        try {
          await redis.set(`tts-preview:${voiceId || 'default'}`, audioBuffer.toString('base64'), { ex: PREVIEW_CACHE_TTL });
        } catch (_) {}
      }
    }

    if (provider === 'elevenlabs' && !isPreview) {
      return jsonResponse(request, {
        provider,
        skipWhisper: true,
        audioBase64: audioBuffer.toString('base64'),
        wordTimestamps: wordTimestamps || [],
      });
    }

    return audioResponse(request, audioBuffer, provider);
  } catch (error) {
    console.error('[TTS] Unexpected error:', error.message, error.stack);
    return jsonResponse(
      request,
      { error: '음성 생성 중 오류가 발생했습니다: ' + (error.message || 'unknown') },
      { status: 500 }
    );
  }
}
