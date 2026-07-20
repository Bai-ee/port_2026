// verify.mjs — A6 GATE. Serves the recreated site over a local static HTTP
// server and loads every page with headless Playwright. Acceptance = 0
// console errors and 0 HTTP 4xx/5xx across all pages, plus a best-effort nav
// click test and a data-localized presence count. No silent pass — a failing
// report is returned in full so the caller can attach it to the failed job.

import http from 'http';
import { createReadStream } from 'fs';
import { stat } from 'fs/promises';
import path from 'path';
import { chromium } from 'playwright';

const MIME = {
  '.html': 'text/html', '.htm': 'text/html', '.css': 'text/css', '.js': 'application/javascript',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.woff': 'font/woff',
  '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.ico': 'image/x-icon', '.mp4': 'video/mp4',
  '.webm': 'video/webm', '.mp3': 'audio/mpeg',
};

function startStaticServer(rootDir) {
  const server = http.createServer(async (req, res) => {
    try {
      const urlPath = decodeURIComponent(req.url.split('?')[0]);
      const safeRel = path.normalize(urlPath).replace(/^(\.\.[/\\])+/, '');
      const filePath = path.join(rootDir, safeRel);
      if (!filePath.startsWith(rootDir)) { res.writeHead(403); res.end(); return; }
      const st = await stat(filePath).catch(() => null);
      if (!st || !st.isFile()) { res.writeHead(404); res.end('Not found'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream' });
      createReadStream(filePath).pipe(res);
    } catch {
      res.writeHead(500); res.end('Server error');
    }
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

/**
 * @param {object} args
 * @param {string} args.siteDir
 * @param {Array<{path:string, file:string}>} args.pages
 */
export async function verifyStatic({ siteDir, pages }) {
  const server = await startStaticServer(siteDir);
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  const browser = await chromium.launch({ headless: true });
  let consoleErrors = 0;
  let httpErrors = 0;
  let dataLocalizedCount = 0;
  let navClickOk = null;
  const details = [];

  try {
    const context = await browser.newContext();
    for (const pg of pages) {
      const page = await context.newPage();
      const pageErrors = [];
      const pageHttpErrors = [];
      // Location/stack included so a failing report names the actual script —
      // without it, "setAttribute of null" style errors are undebuggable
      // (learned on the tonysoccer.com run).
      page.on('console', (msg) => {
        if (msg.type() !== 'error') return;
        const loc = msg.location();
        pageErrors.push(`${msg.text()}${loc?.url ? ` [${loc.url}:${loc.lineNumber}]` : ''}`);
      });
      page.on('pageerror', (err) => {
        const frame = String(err.stack || '').split('\n').find((l) => l.includes('http')) || '';
        pageErrors.push(`${err.message}${frame ? ` [${frame.trim()}]` : ''}`);
      });
      page.on('response', (res) => {
        const status = res.status();
        if (status >= 400) pageHttpErrors.push(`${status} ${res.url()}`);
      });

      await page.goto(`${baseUrl}/${pg.file}`, { waitUntil: 'networkidle', timeout: 30_000 })
        .catch((err) => { pageErrors.push(`navigation failed: ${err.message}`); });

      dataLocalizedCount += await page.locator('[data-localized]').count().catch(() => 0);

      if (pg.path === '/' && navClickOk === null) {
        try {
          // :visible — a hidden off-canvas menu drawer link is never
          // actionable and would just time out the click. Skip links back to
          // the current page so the test actually exercises navigation.
          const links = page.locator('a[href$=".html"]:visible');
          const count = await links.count();
          let target = null;
          for (let i = 0; i < count && !target; i += 1) {
            const href = await links.nth(i).getAttribute('href');
            if (href && href !== pg.file) target = { locator: links.nth(i), href };
          }
          if (target) {
            await target.locator.click({ timeout: 5000 });
            await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
            navClickOk = page.url().endsWith(target.href);
          }
        } catch {
          navClickOk = false;
        }
      }

      consoleErrors += pageErrors.length;
      httpErrors += pageHttpErrors.length;
      details.push({
        path: pg.path, file: pg.file,
        consoleErrors: pageErrors.length, httpErrors: pageHttpErrors.length,
        errors: pageErrors.slice(0, 10), httpErrorUrls: pageHttpErrors.slice(0, 10),
      });

      await page.close();
    }
  } finally {
    await browser.close();
    server.close();
  }

  return {
    pagesChecked: pages.length,
    consoleErrors,
    httpErrors,
    navClickOk,
    dataLocalizedCount,
    pass: consoleErrors === 0 && httpErrors === 0,
    details,
  };
}
