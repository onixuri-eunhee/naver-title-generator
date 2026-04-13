import { jsonResponse, handleOptions } from '@/lib/api-helpers';
import { buildThemePreviewMap } from '@/lib/card-news-themes';

export async function OPTIONS(request) {
  return handleOptions(request);
}

export async function GET(request) {
  return jsonResponse(request, { themes: buildThemePreviewMap() });
}
