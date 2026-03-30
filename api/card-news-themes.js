import { setCorsHeaders } from './_helpers.js';
import { buildThemePreviewMap } from './_card-news-themes.js';

export default async function handler(req, res) {
  setCorsHeaders(res, req);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  return res.status(200).json({
    themes: buildThemePreviewMap(),
  });
}
