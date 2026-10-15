#!/usr/bin/env node
// Theme Studio end-to-end checks (contract 15.8). Modelled on scripts/smoke-routes.mjs.
//
//   THEME_E2E_BASE_URL=http://localhost:3000 node scripts/theme/e2e-theme.mjs [--only name,name] [--sweep quick|full]
//
// Start the app from THIS worktree first (`npm run dev` for the Studio checks, which rely on the
// dev-only `?theme-studio=1` gate; `next build && next start` covers everything else).
//
// Environment
//   THEME_E2E_BASE_URL       default http://localhost:3000
//   THEME_E2E_OUT_DIR        default /tmp/theme-e2e (screenshots + results.json)
//   THEME_E2E_STORAGE_STATE  Playwright storageState JSON for an admin session (enables /dashboard checks)
//   THEME_E2E_SWEEP          quick | full (default full: 5 hues x 3 intensities x 2 tints)
//
// Results are PASS / FAIL / SKIP. A SKIP always carries its reason and is never reported as a pass:
// the authenticated dashboard, the Studio UI and the WebGL scene stats are only exercised when the
// environment allows it. Exit code 1 on any FAIL.

import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import {
  BASELINE_DEFINITION, setMasterHue, setIntensity, setNeutral, toCss, resolveTheme,
  STORAGE_KEYS, DRAFT_CSS_MARKER, hashDefinition,
} from '../../lib/theme/index.js';

const baseUrl = process.env.THEME_E2E_BASE_URL || 'http://localhost:3000';
const outDir = process.env.THEME_E2E_OUT_DIR || '/tmp/theme-e2e';
const storageState = process.env.THEME_E2E_STORAGE_STATE || undefined;
const args = process.argv.slice(2);
const only = (args.includes('--only') ? args[args.indexOf('--only') + 1] : '').split(',').filter(Boolean);
const sweepMode = (args.includes('--sweep') ? args[args.indexOf('--sweep') + 1] : process.env.THEME_E2E_SWEEP) || 'full';

const results = [];
class Skip extends Error {}
const skip = (reason) => {
  throw new Skip(reason);
};

async function launchBrowser() {
  const chromeForTestingPath = path.join(
    process.env.HOME || '',
    'Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'
  );
  const launchOptions = { headless: true };
  try {
    await access(chromeForTestingPath);
    launchOptions.executablePath = chromeForTestingPath;
  } catch {
    // fall back to the bundled chromium
  }
  return chromium.launch(launchOptions);
}

async function check(name, fn) {
  if (only.length && !only.includes(name)) return;
  const started = Date.now();
  try {
    const detail = await fn();
    results.push({ name, status: 'PASS', ms: Date.now() - started, detail: detail || '' });
    console.log(`PASS  ${name}${detail ? `  ${detail}` : ''}`);
  } catch (e) {
    if (e instanceof Skip) {
      results.push({ name, status: 'SKIP', ms: Date.now() - started, detail: e.message });
      console.log(`SKIP  ${name}  ${e.message}`);
    } else {
      results.push({ name, status: 'FAIL', ms: Date.now() - started, detail: String(e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e) });
      console.log(`FAIL  ${name}  ${e && e.message}`);
    }
  }
}

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

const PREF = STORAGE_KEYS.pref;

function draftCssFor(def) {
  return `${DRAFT_CSS_MARKER}hash:${hashDefinition(def)} */\n${toCss(def, { header: false })}`;
}

// Console errors that are not theme regressions: favicon / well-known probes, Stripe iframes, WebGL ReadPixels
// driver warnings, and the pre-existing HomePage.jsx GSAP tweens that target a null nav / panel headline
// (present at HEAD, tracked under WS4; accepted here so they do not mask real theme errors).
// 429 = the site's own /api/analytics/homepage beacon hitting its rate limit when the suite loads / repeatedly (not theme related).
const KNOWN_CONSOLE_NOISE = /status of 429|favicon|\.well-known|Stripe|ReadPixels|GSAP target null not found \(HomePage\.jsx/i;

async function newPage(browser, { colorScheme = 'light', viewport = { width: 1440, height: 900 }, storage = {}, state } = {}) {
  const context = await browser.newContext({ colorScheme, viewport, ...(state ? { storageState: state } : {}) });
  await context.addInitScript((entries) => {
    try {
      for (const [k, v] of Object.entries(entries)) if (v !== null) window.localStorage.setItem(k, v);
    } catch {
      // storage blocked
    }
  }, storage);
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('console', (m) => {
    if (m.type() === 'error' && !KNOWN_CONSOLE_NOISE.test(m.text())) consoleErrors.push(m.text());
  });
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
  return { context, page, consoleErrors };
}

const attrs = (page) =>
  page.evaluate(() => ({
    theme: document.documentElement.getAttribute('data-theme'),
    pref: document.documentElement.getAttribute('data-theme-pref'),
    scheme: document.documentElement.style.colorScheme,
  }));

function luminance([r, g, b]) {
  const f = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function ratio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
const parseRgb = (s) => (s.match(/[\d.]+/g) || []).slice(0, 3).map(Number);

async function main() {
  await mkdir(outDir, { recursive: true });
  // A dead or wedged server (non-2xx on /) would otherwise be reported as a pile of unrelated theme failures.
  let rootStatus = 0;
  try { rootStatus = (await fetch(`${baseUrl}/`)).status; } catch (e) { rootStatus = 0; }
  if (rootStatus < 200 || rootStatus >= 300) {
    console.error(`[theme-e2e] ${baseUrl}/ returned ${rootStatus || 'no response'}, not 2xx: the server is down or wedged (disk full? stale .next?). Fix the server before judging theme results.`);
    process.exit(2);
  }
  const browser = await launchBrowser();

  // ---------------------------------------------------------------- first paint
  await check('server-html-bootstrap-first', async () => {
    const res = await fetch(`${baseUrl}/`);
    const html = await res.text();
    const headStart = html.indexOf('<head');
    assert(headStart >= 0, 'no <head> in the server HTML');
    // Contract D6 / §8.1 want the bootstrap first in <head>, but Next always emits its own charset + viewport metas,
    // the layout stylesheet and the async app scripts ahead of the layout's <head> children, so a literal "first child"
    // is unattainable (next/script beforeInteractive is worse: it is injected from the body). What D6 protects is
    // "runs before first paint and before any app code": the script must sit inside <head>, and everything before it
    // must be a non-executing element (meta/link) or an async/defer script (stylesheets block paint, so it still runs first).
    const headEnd = html.indexOf('</head>', headStart);
    const bootAt = html.indexOf('id="theme-bootstrap"', headStart);
    assert(bootAt >= 0 && bootAt < headEnd, 'the bootstrap <script> is not inside <head>');
    const before = html.slice(headStart, bootAt);
    const blocking = (before.match(/<script\b[^>]*>/g) || []).filter((t) => !/\b(async|defer)\b/.test(t) && !/type="(?!text\/javascript)/.test(t));
    assert(blocking.length === 0, `a synchronous script precedes the bootstrap: ${blocking[0]}`);
    assert(html.includes("localStorage.getItem('theme:pref:v1')"), 'bootstrap script missing');
    assert(/<html[^>]*data-theme="(light|dark)"[^>]*>/.test(html) || /<html(?![^>]*data-theme)/.test(html), '<html> data-theme attribute shape');
    return html.match(/<html[^>]*>/)[0].slice(0, 120);
  });

  await check('first-paint-has-data-theme', async () => {
    const { context, page } = await newPage(browser, { storage: { [PREF]: 'dark' } });
    await page.addInitScript(() => {
      // Probes that do not depend on the attribute changing: when SSR already rendered the stored value the
      // MutationObserver never fires, so also sample data-theme at DOMContentLoaded and at the first frame.
      window.__themeTrace = { setAt: null, atDomReady: null, atFirstFrame: null };
      const read = () => document.documentElement.getAttribute('data-theme');
      new MutationObserver(() => {
        if (read() && window.__themeTrace.setAt === null) window.__themeTrace.setAt = performance.now();
      }).observe(document, { subtree: true, attributes: true, attributeFilter: ['data-theme'] });
      document.addEventListener('DOMContentLoaded', () => { window.__themeTrace.atDomReady = read(); });
      requestAnimationFrame(() => { window.__themeTrace.atFirstFrame = read(); });
    });
    await page.goto(`${baseUrl}/`, { waitUntil: 'load' });
    const t = await page.evaluate(() => ({
      setAt: window.__themeTrace.setAt,
      atDomReady: window.__themeTrace.atDomReady,
      atFirstFrame: window.__themeTrace.atFirstFrame,
      firstPaint: (performance.getEntriesByName('first-paint')[0] || {}).startTime ?? null,
      fcp: (performance.getEntriesByName('first-contentful-paint')[0] || {}).startTime ?? null,
      theme: document.documentElement.getAttribute('data-theme'),
    }));
    await context.close();
    assert(t.theme === 'dark', `stored dark preference resolved to ${t.theme}`);
    assert(t.atDomReady === 'dark', `data-theme was ${t.atDomReady} at DOMContentLoaded (expected dark)`);
    assert(t.atFirstFrame === 'dark', `data-theme was ${t.atFirstFrame} at the first animation frame (expected dark)`);
    const paint = t.firstPaint ?? t.fcp;
    // setAt is null when the server already rendered the stored value (no attribute change to observe): that is fine.
    assert(t.setAt === null || paint === null || t.setAt <= paint, `data-theme set at ${t.setAt}ms, after first paint at ${paint}ms`);
    return `dark at DOMContentLoaded and first frame, setAt ${t.setAt === null ? 'n/a (SSR)' : `${Math.round(t.setAt)}ms`}, first paint ${paint === null ? 'n/a' : `${Math.round(paint)}ms`}`;
  });

  // ---------------------------------------------------------------- preference rules
  await check('system-follows-os', async () => {
    for (const scheme of ['dark', 'light']) {
      const { context, page } = await newPage(browser, { colorScheme: scheme, storage: { [PREF]: 'system' } });
      await page.goto(`${baseUrl}/`, { waitUntil: 'load' });
      const a = await attrs(page);
      assert(a.theme === scheme && a.pref === 'system' && a.scheme === scheme, `system + OS ${scheme} -> ${JSON.stringify(a)}`);
      if (scheme === 'dark') {
        await page.emulateMedia({ colorScheme: 'light' });
        await page.waitForFunction(() => document.documentElement.getAttribute('data-theme') === 'light', null, { timeout: 3000 });
      }
      await context.close();
    }
  });

  await check('explicit-ignores-os', async () => {
    const { context, page } = await newPage(browser, { colorScheme: 'dark', storage: { [PREF]: 'light' } });
    await page.goto(`${baseUrl}/`, { waitUntil: 'load' });
    assert((await attrs(page)).theme === 'light', 'explicit light preference followed the OS');
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.waitForTimeout(400);
    assert((await attrs(page)).theme === 'light', 'OS change leaked into an explicit preference');
    await context.close();
  });

  await check('invalid-stored-value-falls-back', async () => {
    const { context, page } = await newPage(browser, { storage: { [PREF]: 'purple' } });
    await page.goto(`${baseUrl}/`, { waitUntil: 'load' });
    const a = await attrs(page);
    assert(a.theme === 'light' && a.pref === 'light', `invalid value -> ${JSON.stringify(a)}`);
    await context.close();
  });

  await check('soft-navigation-keeps-attributes', async () => {
    const { context, page } = await newPage(browser, { storage: { [PREF]: 'dark' } });
    await page.goto(`${baseUrl}/`, { waitUntil: 'load' });
    await page.evaluate(() => { window.__marker = 'same-document'; });
    const link = await page.evaluate(() => {
      const a = [...document.querySelectorAll('a[href^="/"]')].find((x) => /^\/(about|work|faq|contact)$/.test(x.getAttribute('href')));
      if (a) a.click();
      return a ? a.getAttribute('href') : null;
    });
    if (!link) {
      await context.close();
      skip('no internal link found on / to exercise a client-side navigation');
    }
    await page.waitForURL((u) => u.pathname === link, { timeout: 8000 });
    const marker = await page.evaluate(() => window.__marker);
    const a = await attrs(page);
    await context.close();
    assert(marker === 'same-document', 'navigation reloaded the document (not a soft navigation)');
    assert(a.theme === 'dark' && a.pref === 'dark', `attributes lost after navigation: ${JSON.stringify(a)}`);
    return `-> ${link}`;
  });

  await check('cross-tab-preference-sync', async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const p1 = await context.newPage();
    const p2 = await context.newPage();
    await p1.goto(`${baseUrl}/`, { waitUntil: 'load' });
    await p2.goto(`${baseUrl}/about`, { waitUntil: 'load' });
    await p1.evaluate((k) => localStorage.setItem(k, 'dark'), PREF);
    await p2.waitForFunction(() => document.documentElement.getAttribute('data-theme') === 'dark', null, { timeout: 4000 });
    await p1.evaluate((k) => localStorage.setItem(k, 'light'), PREF);
    await p2.waitForFunction(() => document.documentElement.getAttribute('data-theme') === 'light', null, { timeout: 4000 });
    await context.close();
  });

  // ---------------------------------------------------------------- readable dark pages
  await check('dark-body-text-is-readable', async () => {
    const findings = [];
    for (const route of ['/', '/about', '/faq', '/contact', '/login']) {
      const { context, page } = await newPage(browser, { storage: { [PREF]: 'dark' } });
      await page.goto(`${baseUrl}${route}`, { waitUntil: 'load' });
      const c = await page.evaluate(() => {
        const cs = getComputedStyle(document.body);
        return { fg: cs.color, bg: cs.backgroundColor, page: getComputedStyle(document.documentElement).getPropertyValue('--t-page').trim() };
      });
      const r = ratio(parseRgb(c.fg), parseRgb(c.bg));
      if (!(r >= 4.5)) findings.push(`${route}: body ${c.fg} on ${c.bg} = ${r.toFixed(2)}`);
      await page.screenshot({ path: path.join(outDir, `dark${route === '/' ? '-home' : route.replace(/\//g, '-')}.png`) });
      await context.close();
    }
    assert(findings.length === 0, findings.join('; '));
  });

  // ---------------------------------------------------------------- draft hue sweep
  await check('hue-sweep-applies-and-screenshots', async () => {
    const hues = sweepMode === 'quick' ? [0, 180] : [0, 90, 180, 270, 359];
    const intensities = sweepMode === 'quick' ? [1] : [0, 1, 1.5];
    const tints = sweepMode === 'quick' ? [1] : [0, 2];
    let shots = 0;
    let dashboardSkipped = null;
    for (const hue of hues) {
      for (const intensity of intensities) {
        for (const tint of tints) {
          const def = setNeutral(setIntensity(setMasterHue(BASELINE_DEFINITION, hue), intensity), { tintStrength: tint });
          const expected = resolveTheme(def, 'light').tokens['--t-accent'];
          for (const route of ['/', '/dashboard']) {
            if (route === '/dashboard' && !storageState) {
              dashboardSkipped = 'no THEME_E2E_STORAGE_STATE (admin session): /dashboard not exercised';
              continue;
            }
            const { context, page, consoleErrors } = await newPage(browser, {
              state: route === '/dashboard' ? storageState : undefined,
              storage: { [STORAGE_KEYS.active]: '1', [STORAGE_KEYS.draftCss]: draftCssFor(def) },
            });
            // ?theme-studio=1 (dev gate, D7): ThemeStudioMount clears an applied draft for viewers who are not allowed into the Studio.
            await page.goto(`${baseUrl}${route}${route === '/' ? '?theme-studio=1' : ''}`, { waitUntil: 'load' });
            if (route === '/dashboard' && !page.url().includes('/dashboard')) {
              dashboardSkipped = 'dashboard redirected to login: session not authorised';
              await context.close();
              continue;
            }
            const got = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--t-accent').trim());
            assert(got === expected, `${route} h${hue} i${intensity} t${tint}: --t-accent ${got} != ${expected}`);
            await page.screenshot({ path: path.join(outDir, `sweep-h${hue}-i${intensity}-t${tint}${route === '/' ? '-home' : '-dashboard'}.png`) });
            shots += 1;
            assert(consoleErrors.length === 0, `console errors on ${route}: ${consoleErrors.slice(0, 2).join(' | ')}`);
            await context.close();
          }
        }
      }
    }
    if (dashboardSkipped) console.log(`      note: ${dashboardSkipped}`);
    return `${shots} screenshots in ${outDir}${dashboardSkipped ? ` (${dashboardSkipped})` : ''}`;
  });

  // ---------------------------------------------------------------- scene stats (WS4)
  await check('scene-canvas-identity-and-program-count', async () => {
    const { context, page } = await newPage(browser, { storage: { [STORAGE_KEYS.debug]: '1' } });
    await page.goto(`${baseUrl}/`, { waitUntil: 'load' });
    const has = await page.waitForFunction(() => window.__themeSceneStats && window.__themeSceneStats.canvasId, null, { timeout: 8000 }).then(() => true, () => false);
    if (!has) {
      await context.close();
      skip('window.__themeSceneStats not exposed (WebGL unavailable headless, or the scene debug hook is not built)');
    }
    const before = await page.evaluate(() => ({ ...window.__themeSceneStats, canvases: document.querySelectorAll('canvas').length }));
    // rewrite the draft stylesheet 60 times on consecutive frames (CSS side of a drag)
    await page.evaluate(async (payload) => {
      const style = document.createElement('style');
      style.id = 'theme-draft-css';
      document.head.appendChild(style);
      for (let i = 0; i < 60; i += 1) {
        style.textContent = payload[i % payload.length];
        document.dispatchEvent(new CustomEvent('theme:tokens-changed'));
        await new Promise((r) => requestAnimationFrame(r));
      }
    }, Array.from({ length: 6 }, (_, i) => draftCssFor(setMasterHue(BASELINE_DEFINITION, i * 60))));
    await page.waitForTimeout(1500);
    const after = await page.evaluate(() => ({ ...window.__themeSceneStats, canvases: document.querySelectorAll('canvas').length }));
    await context.close();
    assert(before.canvasId === after.canvasId, `canvas remounted: ${before.canvasId} -> ${after.canvasId}`);
    assert(before.programCount === after.programCount, `program count changed ${before.programCount} -> ${after.programCount}`);
    assert(before.materialCount === after.materialCount, `material count changed ${before.materialCount} -> ${after.materialCount}`);
    assert(after.canvases === before.canvases, 'a second <canvas> appeared');
    return `canvasId ${after.canvasId}, programs ${after.programCount}, materials ${after.materialCount}`;
  });

  await check('scene-fallback-after-context-loss', async () => {
    const { context, page } = await newPage(browser, {});
    await page.goto(`${baseUrl}/`, { waitUntil: 'load' });
    const lost = await page.evaluate(() => {
      const c = document.querySelector('canvas');
      const gl = c && (c.getContext('webgl2') || c.getContext('webgl'));
      const ext = gl && gl.getExtension('WEBGL_lose_context');
      if (!ext) return false;
      ext.loseContext();
      return true;
    });
    if (!lost) {
      await context.close();
      skip('no WebGL canvas / WEBGL_lose_context extension in this environment');
    }
    await page.waitForFunction(() => document.querySelector('[data-scene-state="lost"]') !== null, null, { timeout: 4000 });
    await context.close();
  });

  // ---------------------------------------------------------------- Studio (dev only) — scenarios from WS3
  const openStudio = async (page) => {
    await page.goto(`${baseUrl}/?theme-studio=1`, { waitUntil: 'load' });
    const launcher = page.locator('#theme-studio-launcher');
    const shown = await launcher.waitFor({ state: 'visible', timeout: 6000 }).then(() => true, () => false);
    if (!shown) skip('Studio launcher not available (production build, or the Studio is not mounted)');
    // The page already owns canvases (scene + the home page's lava shader), so "the Studio adds none" is a delta.
    page.__canvasesBeforeStudio = await page.locator('canvas').count();
    await page.keyboard.press('Alt+Shift+T');
    const dialog = page.getByRole('dialog', { name: /theme studio/i });
    await dialog.waitFor({ state: 'visible', timeout: 6000 });
    return dialog;
  };
  const hueSlider = (dialog) => dialog.getByRole('slider', { name: /master hue|hue/i }).first();

  await check('studio-keyboard-slider', async () => {
    const { context, page } = await newPage(browser);
    const dialog = await openStudio(page);
    const slider = hueSlider(dialog);
    await slider.focus();
    const v0 = Number(await slider.getAttribute('aria-valuenow'));
    await page.keyboard.press('ArrowRight');
    const v1 = Number(await slider.getAttribute('aria-valuenow'));
    assert(v1 > v0 || (v0 === 359 && v1 === 0), `ArrowRight did not move the hue (${v0} -> ${v1})`);
    await page.keyboard.press('Home');
    assert(Number(await slider.getAttribute('aria-valuenow')) === 0, 'Home did not jump to 0');
    await page.keyboard.press('PageUp');
    assert(Number(await slider.getAttribute('aria-valuenow')) > 0, 'PageUp did not move the hue');
    assert(/degree/i.test((await slider.getAttribute('aria-valuetext')) || ''), 'aria-valuetext should read in degrees');
    await context.close();
  });

  await check('studio-drag-is-one-undo-and-reset', async () => {
    const { context, page } = await newPage(browser);
    const dialog = await openStudio(page);
    const slider = hueSlider(dialog);
    // The Master section sits below Preset/Palette-combos in the scrolling inspector: bring it on screen before using the mouse.
    await slider.scrollIntoViewIfNeeded();
    const box = await slider.boundingBox();
    if (!box) skip('hue slider has no bounding box (custom control)');
    const start = Number(await slider.getAttribute('aria-valuenow'));
    await page.mouse.move(box.x + 4, box.y + box.height / 2);
    await page.mouse.down();
    for (let i = 1; i <= 12; i += 1) await page.mouse.move(box.x + 4 + ((box.width - 8) * i) / 12, box.y + box.height / 2);
    await page.mouse.up();
    const moved = Number(await slider.getAttribute('aria-valuenow'));
    assert(moved !== start, 'drag did not change the hue');
    await slider.focus();
    await page.keyboard.press('Control+Z');
    assert(Number(await slider.getAttribute('aria-valuenow')) === start, 'a single undo did not restore the pre-drag hue (drag created several history entries)');
    await page.keyboard.press('Control+Shift+Z');
    assert(Number(await slider.getAttribute('aria-valuenow')) === moved, 'redo did not restore the dragged hue');
    await context.close();
  });

  await check('studio-esc-returns-focus', async () => {
    const { context, page } = await newPage(browser);
    const dialog = await openStudio(page);
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden', timeout: 4000 });
    const id = await page.evaluate(() => document.activeElement && document.activeElement.id);
    assert(id === 'theme-studio-launcher', `focus returned to "${id}" instead of #theme-studio-launcher`);
    await context.close();
  });

  await check('studio-mobile-sheet', async () => {
    const { context, page } = await newPage(browser, { viewport: { width: 390, height: 844 } });
    const dialog = await openStudio(page);
    const box = await dialog.boundingBox();
    assert(box && box.width <= 390 + 1, 'sheet wider than the viewport');
    assert(box.height >= 844 * 0.7 && box.height <= 844 * 0.95, `sheet height ${Math.round(box.height)}px, expected about 85% of 844`);
    assert((await dialog.getAttribute('aria-modal')) === 'true', 'mobile sheet must be modal');
    const hScroll = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    assert(!hScroll, 'horizontal page scroll at 390px');
    await context.close();
  });

  await check('studio-inspector-readable-with-poor-draft', async () => {
    const poor = setNeutral(setIntensity(setMasterHue(BASELINE_DEFINITION, 0), 1.5), { tintStrength: 2 });
    const draft = JSON.stringify({ v: 1, savedAt: '2026-01-01T00:00:00.000Z', baseHash: hashDefinition(BASELINE_DEFINITION), definition: poor });
    const { context, page } = await newPage(browser, {
      storage: { [STORAGE_KEYS.draft]: draft, [STORAGE_KEYS.active]: '1', [STORAGE_KEYS.draftCss]: draftCssFor(poor) },
    });
    const dialog = await openStudio(page);
    const c = await dialog.locator('h2, h1').first().evaluate((el) => {
      const cs = getComputedStyle(el);
      let bg = 'rgba(0, 0, 0, 0)';
      for (let n = el; n; n = n.parentElement) {
        const b = getComputedStyle(n).backgroundColor;
        if (b && b !== 'rgba(0, 0, 0, 0)' && b !== 'transparent') { bg = b; break; }
      }
      return { fg: cs.color, bg };
    });
    const r = ratio(parseRgb(c.fg), parseRgb(c.bg));
    assert(r >= 4.5, `inspector heading ${c.fg} on ${c.bg} = ${r.toFixed(2)}:1 under a poor draft`);
    assert((await page.locator('canvas').count()) <= page.__canvasesBeforeStudio, 'the Studio added a <canvas>');
    await context.close();
  });

  await browser.close();

  const summary = results.reduce((a, r) => ({ ...a, [r.status]: (a[r.status] || 0) + 1 }), {});
  await writeFile(path.join(outDir, 'results.json'), `${JSON.stringify({ baseUrl, sweepMode, summary, results }, null, 2)}\n`);
  console.log(`\n[theme:e2e] ${JSON.stringify(summary)}  (details: ${path.join(outDir, 'results.json')})`);
  const skipped = results.filter((r) => r.status === 'SKIP');
  if (skipped.length) console.log(`[theme:e2e] NOT VERIFIED: ${skipped.map((s) => `${s.name} (${s.detail})`).join('; ')}`);
  process.exit(results.some((r) => r.status === 'FAIL') ? 1 : 0);
}

// only run when executed directly (importing the file must never launch a browser)
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((e) => {
    console.error('[theme:e2e] fatal', e);
    process.exit(2);
  });
}
