import crypto from 'node:crypto';
import { resolveAdmin, setCorsHeaders, extractToken, resolveSessionEmail } from './_helpers.js';

export const config = { maxDuration: 30 };

const GOOGLE_OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_TTS_URL = 'https://texttospeech.googleapis.com/v1/text:synthesize';
const GOOGLE_CLOUD_SCOPE = 'https://www.googleapis.com/auth/cloud-platform';

const VOICES = {
  // 여성
  'ko-KR-Neural2-A': { name: '서연', gender: 'FEMALE' },
  'ko-KR-Neural2-B': { name: '민지', gender: 'FEMALE' },
  'ko-KR-Wavenet-A': { name: '하은', gender: 'FEMALE' },
  'ko-KR-Wavenet-B': { name: '지수', gender: 'FEMALE' },
  'ko-KR-Standard-A': { name: '유나', gender: 'FEMALE' },
  // 남성
  'ko-KR-Neural2-C': { name: '도윤', gender: 'MALE' },
  'ko-KR-Wavenet-C': { name: '준서', gender: 'MALE' },
  'ko-KR-Wavenet-D': { name: '시우', gender: 'MALE' },
  'ko-KR-Standard-C': { name: '건우', gender: 'MALE' },
  'ko-KR-Standard-D': { name: '현우', gender: 'MALE' },
};

const DEFAULT_VOICE = 'ko-KR-Neural2-A';

let _tokenCache = { token: null, expiresAt: 0 };

function _parseServiceAccount() {
  const raw = process.env.GOOGLE_VERTEX_SERVICE_ACCOUNT_JSON || process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '';
  try { const p = JSON.parse(raw); return p?.client_email && p?.private_key ? p : null; } catch { return null; }
}

function _base64url(input) {
  const b = typeof input === 'string' ? Buffer.from(input) : input;
  return b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function getAccessToken() {
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
    const voiceName = VOICES[body.voiceId] ? body.voiceId : DEFAULT_VOICE;
    const voiceInfo = VOICES[voiceName];

    if (!text) return res.status(400).json({ error: 'text가 필요합니다.' });
    if (text.length > 5000) return res.status(400).json({ error: '텍스트가 너무 깁니다. (최대 5000자)' });

    const accessToken = await getAccessToken();

    const ttsResponse = await fetch(GOOGLE_TTS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        input: { text },
        voice: {
          languageCode: 'ko-KR',
          name: voiceName,
          ssmlGender: voiceInfo.gender,
        },
        audioConfig: {
          audioEncoding: 'MP3',
          speakingRate: 1.0,
          pitch: 0,
        },
      }),
    });

    if (!ttsResponse.ok) {
      const errData = await ttsResponse.text();
      console.error('[TTS] Google Cloud error:', ttsResponse.status, errData);
      return res.status(502).json({ error: '음성 생성에 실패했습니다.' });
    }

    const data = await ttsResponse.json();
    const audioBuffer = Buffer.from(data.audioContent, 'base64');

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Length', audioBuffer.length);
    return res.status(200).send(audioBuffer);
  } catch (error) {
    console.error('[TTS] Error:', error.message);
    return res.status(500).json({ error: '음성 생성 중 오류가 발생했습니다.' });
  }
}
