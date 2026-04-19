// app/api/card-news-zip/route.js
//
// 서버 사이드 ZIP 생성 — 브라우저가 R2 CDN cross-origin fetch CORS 에러로 다운로드
// 실패하는 문제 회피. same-origin blob을 클라가 받아 저장.

import { handleOptions, jsonResponse } from '@/lib/api-helpers';

export const maxDuration = 60;
export const runtime = 'nodejs';

const ALLOWED_URL_PREFIXES = [
  'https://cdn.ddukddaktool.co.kr/',
  'https://pub-cac85a1d3b8d486082bd1bff2fadcaed.r2.dev/',
];

export async function OPTIONS(request) {
  return handleOptions(request);
}

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse(request, { error: 'invalid json' }, { status: 400 });
  }

  const urls = Array.isArray(body.urls) ? body.urls : [];
  if (urls.length === 0 || urls.length > 20) {
    return jsonResponse(request, { error: 'urls required (1~20)' }, { status: 400 });
  }

  // SSRF 방어 — 화이트리스트된 R2 도메인만 허용
  for (const u of urls) {
    if (typeof u !== 'string') {
      return jsonResponse(request, { error: 'invalid url entry' }, { status: 400 });
    }
    if (!ALLOWED_URL_PREFIXES.some((p) => u.startsWith(p))) {
      return jsonResponse(request, { error: 'url must be R2 CDN' }, { status: 400 });
    }
  }

  const JSZip = (await import('jszip')).default;
  const zip = new JSZip();

  try {
    await Promise.all(
      urls.map(async (url, i) => {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`fetch ${i} status=${res.status}`);
        const buf = await res.arrayBuffer();
        zip.file(`card-news-${i + 1}.png`, buf);
      }),
    );
  } catch (err) {
    return jsonResponse(
      request,
      { error: String(err?.message || err).slice(0, 200) },
      { status: 502 },
    );
  }

  const zipBuf = await zip.generateAsync({ type: 'nodebuffer' });

  return new Response(zipBuf, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="card-news-${Date.now()}.zip"`,
      'Content-Length': String(zipBuf.length),
      'Cache-Control': 'no-store',
    },
  });
}
