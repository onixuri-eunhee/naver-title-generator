// services/card-news-renderer.mjs
//
// Puppeteer-core 기반 카드뉴스 렌더러.
// HTML 문자열을 받아 각 .card 요소를 PNG로 캡처. JS 비활성(보안 + 정적 렌더).
// Remotion Chromium 경로를 공유 (resolveBrowserExecutable).

import puppeteer from 'puppeteer-core';
import { resolveBrowserExecutable } from './shortform-remotion-render.mjs';

const CARD_WIDTH = 1080;
const CARD_HEIGHT = 1350;
const SETCONTENT_TIMEOUT_MS = 10_000;
const ANIMATION_SETTLE_MS = 600;

/**
 * HTML 문자열을 렌더해 각 .card 요소의 PNG Buffer 배열 반환.
 *
 * @param {string} html
 * @param {number} expectedCardCount
 * @returns {Promise<Buffer[]>}
 */
export async function renderCardsFromHtml(html, expectedCardCount) {
  if (!html || typeof html !== 'string') {
    throw new Error('html required (non-empty string)');
  }
  if (!Number.isInteger(expectedCardCount) || expectedCardCount < 1) {
    throw new Error('expectedCardCount must be positive integer');
  }

  const executablePath = resolveBrowserExecutable();
  if (!executablePath) {
    throw new Error('CHROMIUM_NOT_FOUND: no executable on system');
  }

  const browser = await puppeteer.launch({
    executablePath,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
    ],
    headless: 'new',
  });

  try {
    const page = await browser.newPage();

    // JS 비활성 — XSS/SSRF 방어 + 정적 스냅샷
    await page.setJavaScriptEnabled(false);

    // viewport: N장 세로 배치를 수용
    await page.setViewport({
      width: CARD_WIDTH,
      height: CARD_HEIGHT * expectedCardCount,
      deviceScaleFactor: 1,
    });

    await page.setContent(html, {
      waitUntil: ['load'],
      timeout: SETCONTENT_TIMEOUT_MS,
    });

    // 폰트 로딩 대기 (CDN Pretendard)
    await page.evaluate(() => document.fonts.ready).catch(() => null);

    // CSS @keyframes 수렴
    await new Promise((r) => setTimeout(r, ANIMATION_SETTLE_MS));

    const cardHandles = await page.$$('.card');
    if (cardHandles.length !== expectedCardCount) {
      throw new Error(
        `CARD_COUNT_MISMATCH: expected ${expectedCardCount}, got ${cardHandles.length}`,
      );
    }

    const pngBuffers = [];
    for (const handle of cardHandles) {
      const buf = await handle.screenshot({
        type: 'png',
        omitBackground: false,
      });
      pngBuffers.push(Buffer.isBuffer(buf) ? buf : Buffer.from(buf));
    }
    return pngBuffers;
  } finally {
    try {
      await browser.close();
    } catch (closeErr) {
      console.warn('[card-news-renderer] browser.close failed:', closeErr?.message);
    }
  }
}
