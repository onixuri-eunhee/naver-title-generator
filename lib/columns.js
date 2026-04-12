import fs from 'node:fs';
import path from 'node:path';

const COLUMN_DIR = path.join(process.cwd());

function readFileSafe(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

function match1(html, pattern) {
  const m = html.match(pattern);
  return m ? m[1].trim() : '';
}

function extractArticleHtml(html) {
  const startMatch = html.match(/<div class="article">/);
  if (!startMatch) return '';
  const start = startMatch.index + startMatch[0].length;
  let depth = 1;
  const re = /<div\b[^>]*>|<\/div>/g;
  re.lastIndex = start;
  let m;
  while ((m = re.exec(html))) {
    if (m[0].startsWith('</')) {
      depth -= 1;
      if (depth === 0) return html.slice(start, m.index).trim();
    } else {
      depth += 1;
    }
  }
  return '';
}

function parseColumn(slug) {
  const filePath = path.join(COLUMN_DIR, `${slug}.html`);
  const html = readFileSafe(filePath);
  if (!html) return null;

  const rawTitle = match1(html, /<title>([^<]+)<\/title>/);
  const title = rawTitle.replace(/\s*\|\s*뚝딱툴\s*$/, '').trim();
  const description = match1(html, /<meta name="description" content="([^"]+)"/);
  const keywords = match1(html, /<meta name="keywords" content="([^"]+)"/);
  const ogTitle = match1(html, /<meta property="og:title" content="([^"]+)"/);
  const ogDescription = match1(html, /<meta property="og:description" content="([^"]+)"/);
  const heroBadge = match1(html, /<div class="hero-badge">([^<]+)<\/div>/);
  const heroMeta = match1(html, /<div class="hero-meta">([^<]+)<\/div>/);

  const heroH1Match = html.match(/<div class="hero">[\s\S]*?<h1>([\s\S]*?)<\/h1>/);
  const heroH1 = heroH1Match ? heroH1Match[1].trim() : '';
  const heroSubMatch = html.match(/<div class="hero">[\s\S]*?<\/h1>\s*<p>([\s\S]*?)<\/p>/);
  const heroSubtitle = heroSubMatch ? heroSubMatch[1].trim() : '';

  const article = extractArticleHtml(html);

  let dateStr = '';
  let readTime = '';
  if (heroMeta) {
    const parts = heroMeta.split('·').map((s) => s.trim());
    dateStr = parts[0] || '';
    readTime = parts[1] || '';
  }

  const num = parseInt(slug.replace('column-', ''), 10);

  return {
    slug,
    num,
    title,
    description: description || ogDescription || '',
    keywords,
    ogTitle: ogTitle || title,
    ogDescription: ogDescription || description || '',
    heroBadge,
    heroH1,
    heroSubtitle,
    heroMeta,
    dateStr,
    readTime,
    article,
  };
}

let _cache = null;
function loadAll() {
  if (_cache) return _cache;
  const columns = [];
  for (let i = 1; i <= 100; i++) {
    const slug = `column-${String(i).padStart(3, '0')}`;
    const col = parseColumn(slug);
    if (col && col.title && col.article) columns.push(col);
  }
  _cache = columns;
  return columns;
}

export function getAllColumns() {
  return loadAll();
}

export function getAllColumnSlugs() {
  return loadAll().map((c) => c.slug);
}

export function getColumn(slug) {
  return loadAll().find((c) => c.slug === slug) || null;
}

export function getAdjacentColumns(slug) {
  const all = loadAll();
  const idx = all.findIndex((c) => c.slug === slug);
  if (idx < 0) return { prev: null, next: null };
  return {
    prev: idx > 0 ? all[idx - 1] : null,
    next: idx < all.length - 1 ? all[idx + 1] : null,
  };
}
