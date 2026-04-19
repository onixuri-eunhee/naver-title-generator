// tests/unit/cardnews-sanitize.test.js
//
// Claude 생성 HTML에 대한 security sanitize 검증.
// <script>/iframe/on*/javascript: URL/외부 stylesheet/img 호스트 화이트리스트.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { sanitizeCardNewsHtml } from '../../lib/cardnews/sanitize.js';

function countTag(html, tag) {
  const re = new RegExp(`<${tag}[\\s>]`, 'gi');
  return (html.match(re) || []).length;
}

test('sanitize — script 태그 전체 제거', () => {
  const input = '<!DOCTYPE html><html><body><div class="card c1">hi</div><script>alert(1)</script></body></html>';
  const { html, issues } = sanitizeCardNewsHtml(input);
  assert.equal(countTag(html, 'script'), 0);
  assert.ok(issues.some((i) => i.includes('script')));
});

test('sanitize — iframe/object/embed 제거', () => {
  const input = '<!DOCTYPE html><html><body><iframe src="x"></iframe><object></object><embed src="x"></body></html>';
  const { html } = sanitizeCardNewsHtml(input);
  assert.equal(countTag(html, 'iframe'), 0);
  assert.equal(countTag(html, 'object'), 0);
  assert.equal(countTag(html, 'embed'), 0);
});

test('sanitize — on* 이벤트 속성 제거', () => {
  const input = '<!DOCTYPE html><html><body><div onclick="x" onerror="y" onload="z">content</div></body></html>';
  const { html } = sanitizeCardNewsHtml(input);
  assert.ok(!/onclick=/i.test(html), 'onclick 남음');
  assert.ok(!/onerror=/i.test(html), 'onerror 남음');
  assert.ok(!/onload=/i.test(html), 'onload 남음');
});

test('sanitize — javascript: URL 제거 (href/src)', () => {
  const input = '<!DOCTYPE html><html><body><a href="javascript:alert(1)">x</a><img src="javascript:x"></body></html>';
  const { html } = sanitizeCardNewsHtml(input);
  assert.ok(!/javascript:/i.test(html));
});

test('sanitize — link stylesheet 화이트리스트 호스트만 허용 (Pretendard CDN OK)', () => {
  const input = `<!DOCTYPE html><html><head>
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard/xxx.css">
    <link rel="stylesheet" href="https://evil.example.com/x.css">
    <link rel="stylesheet" href="https://fonts.googleapis.com/css?family=A">
  </head><body><div class="card c1">x</div></body></html>`;
  const { html, issues } = sanitizeCardNewsHtml(input);
  assert.ok(html.includes('cdn.jsdelivr.net'), 'jsdelivr 허용');
  assert.ok(html.includes('fonts.googleapis.com'), 'google fonts 허용');
  assert.ok(!html.includes('evil.example.com'), 'evil 호스트 제거');
  assert.ok(issues.some((i) => i.includes('evil.example.com')));
});

test('sanitize — img src 화이트리스트: placeholder 통과', () => {
  const input = '<!DOCTYPE html><html><body><img src="{{img:0}}" alt="x"></body></html>';
  const { html } = sanitizeCardNewsHtml(input);
  assert.ok(html.includes('{{img:0}}'), 'placeholder 보존');
});

test('sanitize — img src: cdn.ddukddaktool.co.kr 허용', () => {
  const input = '<!DOCTYPE html><html><body><img src="https://cdn.ddukddaktool.co.kr/x.jpg"></body></html>';
  const { html } = sanitizeCardNewsHtml(input);
  assert.ok(html.includes('cdn.ddukddaktool.co.kr'));
});

test('sanitize — img src: data:image/* 허용', () => {
  const input = '<!DOCTYPE html><html><body><img src="data:image/png;base64,iVBORw0KGgo="></body></html>';
  const { html } = sanitizeCardNewsHtml(input);
  assert.ok(html.includes('data:image/png'));
});

test('sanitize — img src: 외부 호스트 차단', () => {
  const input = '<!DOCTYPE html><html><body><img src="https://evil.example.com/x.jpg"></body></html>';
  const { html, issues } = sanitizeCardNewsHtml(input);
  assert.ok(!html.includes('evil.example.com'));
  assert.ok(issues.some((i) => i.includes('evil.example.com') || i.includes('img_host_blocked')));
});

test('sanitize — meta http-equiv 제거 (refresh 등 악용 방지)', () => {
  const input = '<!DOCTYPE html><html><head><meta http-equiv="refresh" content="0;url=http://x"></head><body>x</body></html>';
  const { html } = sanitizeCardNewsHtml(input);
  assert.ok(!/http-equiv=/i.test(html));
});

test('sanitize — 정상 HTML은 손상 없이 통과', () => {
  const input = `<!DOCTYPE html><html lang="ko">
<head>
  <meta charset="UTF-8">
  <title>카드뉴스</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css">
  <style>
    :root { --accent: #ff6f61; }
    .card { width: 1080px; height: 1350px; }
    .c1 { background: var(--accent); }
    @keyframes fade { from { opacity: 0; } to { opacity: 1; } }
  </style>
</head>
<body>
  <div class="card c1"><h1>제목</h1></div>
  <div class="card c2"><img src="{{img:0}}"></div>
</body>
</html>`;
  const { html, issues } = sanitizeCardNewsHtml(input);
  assert.ok(html.includes('.card {'));
  assert.ok(html.includes('@keyframes'));
  assert.ok(html.includes('{{img:0}}'));
  assert.equal(issues.length, 0, `issues should be empty for clean HTML, got: ${JSON.stringify(issues)}`);
});

test('sanitize — 빈 문자열 / 잘못된 HTML 안전 처리 (throw 금지)', () => {
  assert.doesNotThrow(() => sanitizeCardNewsHtml(''));
  assert.doesNotThrow(() => sanitizeCardNewsHtml('not html'));
  assert.doesNotThrow(() => sanitizeCardNewsHtml('<div>unclosed'));
});
