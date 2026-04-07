import { resolveAdmin, setCorsHeaders, extractToken, resolveSessionEmail } from './_helpers.js';

export const config = { maxDuration: 30 };

const ELEVENLABS_API_URL = 'https://api.elevenlabs.io/v1/text-to-speech';
const DEFAULT_VOICE_ID = 'AW5wrnG1jVizOYY7R1Oo'; // 지영 (한국어 네이티브)
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
