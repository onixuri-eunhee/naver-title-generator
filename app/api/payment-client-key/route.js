import { jsonResponse, handleOptions } from '@/lib/api-helpers';

export async function OPTIONS(request) {
  return handleOptions(request);
}

export async function GET(request) {
  return jsonResponse(request, { clientKey: process.env.TOSS_CLIENT_KEY || '' });
}
