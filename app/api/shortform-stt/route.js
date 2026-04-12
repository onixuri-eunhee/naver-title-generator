import { NextResponse } from 'next/server';
import {
  extractToken,
  resolveAdmin,
  resolveSessionEmail,
  getClientIp,
  corsHeaders,
  handleOptions,
  jsonResponse,
} from '@/lib/api-helpers';
import { logUsage } from '@/lib/db';
import {
  STT_VERSION,
  handleShortformSttRequest,
  normalizeError,
} from '../../../services/shortform-stt-core.js';

export const maxDuration = 300;

const REMOTE_STT_BASE_URL = (process.env.SHORTFORM_STT_SERVICE_URL || '').trim().replace(/\/+$/, '');
const REMOTE_STT_SECRET = (process.env.STT_SERVICE_SHARED_SECRET || '').trim();

function getProbeMode(request) {
  const fromHeader = request.headers.get('x-stt-probe') || '';
  if (fromHeader.trim()) return fromHeader.trim().toLowerCase();
  const fromQuery = new URL(request.url).searchParams.get('probe') || '';
  return fromQuery.trim().toLowerCase();
}

function getQueryObject(request) {
  return Object.fromEntries(new URL(request.url).searchParams.entries());
}

function buildHeaderRecord(request) {
  const record = {};
  request.headers.forEach((value, key) => {
    record[key.toLowerCase()] = value;
  });
  return record;
}

async function readRawBody(request) {
  const arrayBuffer = await request.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

function buildProxyUrl(request) {
  const url = new URL(`${REMOTE_STT_BASE_URL}/api/shortform-stt`);
  const probe = new URL(request.url).searchParams.get('probe');
  if (probe && probe.trim()) {
    url.searchParams.set('probe', probe.trim());
  }
  return url;
}

async function proxyToRailway(request, rawBody) {
  const headers = {
    'X-Stt-Service-Secret': REMOTE_STT_SECRET,
  };
  const contentType = request.headers.get('content-type');
  const audioMimeType = request.headers.get('x-audio-mime-type');
  const probeMode = request.headers.get('x-stt-probe');

  if (contentType) headers['Content-Type'] = contentType;
  if (audioMimeType) headers['X-Audio-Mime-Type'] = audioMimeType;
  if (probeMode) headers['X-Stt-Probe'] = probeMode;

  const response = await fetch(buildProxyUrl(request), {
    method: request.method,
    headers,
    body: request.method === 'GET' ? undefined : rawBody,
  });

  return {
    status: response.status,
    text: await response.text(),
    contentType: response.headers.get('content-type') || 'application/json; charset=utf-8',
    version: response.headers.get('x-shortform-stt-version') || STT_VERSION,
  };
}

function proxyResponse(request, proxied) {
  return new NextResponse(proxied.text, {
    status: proxied.status,
    headers: {
      ...corsHeaders(request),
      'Content-Type': proxied.contentType,
      'X-Shortform-Stt-Version': proxied.version,
    },
  });
}

function withVersion(request, body, init = {}) {
  return jsonResponse(request, body, {
    ...init,
    headers: { 'X-Shortform-Stt-Version': STT_VERSION, ...(init.headers || {}) },
  });
}

export async function OPTIONS(request) {
  return handleOptions(request);
}

export async function GET(request) {
  try {
    if (REMOTE_STT_BASE_URL && REMOTE_STT_SECRET) {
      const proxied = await proxyToRailway(request, Buffer.alloc(0));
      return proxyResponse(request, proxied);
    }

    const localGet = await handleShortformSttRequest({
      method: 'GET',
      headers: buildHeaderRecord(request),
      query: getQueryObject(request),
      rawBody: Buffer.alloc(0),
    });
    return withVersion(request, localGet.body, { status: localGet.status });
  } catch (error) {
    const normalized = normalizeError(error);
    console.error('[shortform-stt] API error:', normalized.message);
    return withVersion(request, { error: normalized.message, version: STT_VERSION }, { status: normalized.status });
  }
}

export async function POST(request) {
  try {
    const isAdmin = await resolveAdmin(request);
    const token = extractToken(request);
    const email = await resolveSessionEmail(token);

    if (!isAdmin && !email) {
      return withVersion(request, { error: '로그인이 필요합니다.' }, { status: 401 });
    }

    const rawBody = await readRawBody(request);

    if (REMOTE_STT_BASE_URL && REMOTE_STT_SECRET) {
      const proxied = await proxyToRailway(request, rawBody);

      if (proxied.status >= 200 && proxied.status < 300 && !getProbeMode(request)) {
        await logUsage(email, 'shortform-stt', null, getClientIp(request));
      }

      return proxyResponse(request, proxied);
    }

    const localPost = await handleShortformSttRequest({
      method: 'POST',
      headers: buildHeaderRecord(request),
      query: getQueryObject(request),
      rawBody,
    });

    if (!getProbeMode(request)) {
      await logUsage(email, 'shortform-stt', null, getClientIp(request));
    }

    return withVersion(request, localPost.body, { status: localPost.status });
  } catch (error) {
    const normalized = normalizeError(error);
    console.error('[shortform-stt] API error:', normalized.message);
    return withVersion(request, { error: normalized.message, version: STT_VERSION }, { status: normalized.status });
  }
}
