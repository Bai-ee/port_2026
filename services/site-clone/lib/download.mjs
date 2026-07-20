// download.mjs — A1: fetch page HTML. `static` platforms (Shopify) get a
// plain curl-equivalent fetch (server-rendered HTML is complete); `rendered`
// platforms (Squarespace/Wix/generic) go through headless Playwright so
// client-side-hydrated markup is captured, not the pre-hydration shell.

import { chromium } from 'playwright';
import { fetchPageHtml, DESKTOP_UA } from './http.mjs';

/**
 * @param {object} args
 * @param {string} args.origin
 * @param {string[]} args.pages          discovered page paths, e.g. ['/', '/pages/menu-2']
 * @param {object} args.profile
 * @param {string} args.homepageHtml     already-fetched homepage (from discovery) — reused for 'static' only
 * @param {number} args.homepageStatus
 * @returns {Promise<Array<{ path: string, html: string, status: number }>>}
 */
export async function downloadPages({ origin, pages, profile, homepageHtml, homepageStatus }) {
  if (profile.renderMode === 'static') {
    const results = [];
    for (const p of pages) {
      if (p === '/') {
        results.push({ path: p, html: homepageHtml, status: homepageStatus });
        continue;
      }
      const { html, status } = await fetchPageHtml(origin + p);
      results.push({ path: p, html, status });
    }
    return results;
  }

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ userAgent: DESKTOP_UA });
    const results = [];
    for (const p of pages) {
      const page = await context.newPage();
      try {
        const response = await page.goto(origin + p, { waitUntil: 'networkidle', timeout: 30_000 });
        const html = await page.content();
        results.push({ path: p, html, status: response ? response.status() : 0 });
      } finally {
        await page.close();
      }
    }
    return results;
  } finally {
    await browser.close();
  }
}
