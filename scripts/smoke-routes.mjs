import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const baseUrl = process.env.ROUTE_SMOKE_BASE_URL || 'http://localhost:3000';
const outDir = process.env.ROUTE_SMOKE_OUT_DIR || '/tmp/route-smoke';
const OVERALL_TIMEOUT_MS = Number(process.env.ROUTE_SMOKE_TIMEOUT_MS || 180_000);

const publicRoutes = [
  { path: '/', name: 'home', expectText: 'Dashboard' },
  { path: '/about', name: 'about', expectText: 'About' },
  { path: '/work', name: 'work', expectText: 'Featured Work' },
  { path: '/case-studies', name: 'case-studies', expectText: 'Case Studies' },
  { path: '/gallery', name: 'gallery', expectText: 'Gallery' },
  { path: '/faq', name: 'faq', expectText: 'FAQ' },
  { path: '/contact', name: 'contact', expectText: 'Contact' },
  { path: '/how-it-works', name: 'how-it-works', expectText: 'How It Works' },
  { path: '/process', name: 'process', expectText: 'Process' },
  { path: '/services/ai-design-consulting', name: 'svc-ai-design', expectText: 'AI Design Consulting' },
  { path: '/services/brand-identity', name: 'svc-brand-identity', expectText: 'Brand Identity' },
  { path: '/services/design-systems', name: 'svc-design-systems', expectText: 'Design Systems' },
  { path: '/services/seo-geo', name: 'svc-seo-geo', expectText: 'SEO' },
  { path: '/services/web-development', name: 'svc-web-dev', expectText: 'Web Development' },
  { path: '/login', name: 'login', expectText: 'Sign in' },
  { path: '/capture', name: 'capture', expectText: 'Capture Controls' },
  { path: '/preview/canvas', name: 'preview-canvas', expectText: 'Background' },
  { path: '/preview/intake-modal', name: 'preview-intake-modal', expectText: 'INTAKE' },
  { path: '/preview/mini-brief', name: 'preview-mini-brief', expectText: 'Mini Brief' },
  { path: '/api/health', name: 'health', expectText: '"ok":true', minBodyLength: 10, mode: 'fetch' },
];

const privateRoutes = [
  { path: '/dashboard', name: 'dashboard', expectedUrl: '/login?redirect=%2Fdashboard', expectText: 'Sign in' },
  { path: '/dashboard/studio', name: 'dashboard-studio', expectedUrl: '/login?redirect=/dashboard/studio', expectText: 'Sign in' },
  { path: '/admin/control', name: 'admin-control', expectedUrl: '/login?redirect=/admin/control', expectText: 'Sign in' },
  { path: '/preview/brief', name: 'preview-brief', expectedUrl: '/login?redirect=/preview/brief', expectText: 'Sign in' },
  { path: '/preview/scout-config', name: 'preview-scout-config', expectedUrl: '/login?redirect=/preview/scout-config', expectText: 'Sign in' },
];

async function launchBrowser() {
  const chromeForTestingPath = path.join(
    process.env.HOME || '',
    'Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'
  );
  const launchOptions = { headless: true };
  try {
    await access(chromeForTestingPath);
    launchOptions.executablePath = chromeForTestingPath;
  } catch {}
  return chromium.launch(launchOptions);
}

function normalizeForExpect(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isIgnorableConsole(message) {
  return (
    /favicon|\.well-known|Stripe\.js integration over HTTP/i.test(message) ||
    /GPU stall due to ReadPixels/i.test(message) ||
    /GSAP target null not found/i.test(message)
  );
}

async function smokeRoute(browser, spec, kind) {
  if (spec.mode === 'fetch') {
    console.log(`[smoke:routes] ${kind} ${spec.path}`);
    const response = await fetch(`${baseUrl}${spec.path}`, { cache: 'no-store' });
    const bodyText = await response.text();
    const result = {
      kind,
      path: spec.path,
      name: spec.name,
      status: response.status,
      finalPath: spec.path,
      title: '',
      bodyLength: bodyText.trim().length,
      overlay: false,
      errors: [],
    };
    const failures = [];
    if (response.status >= 400) failures.push(`http ${response.status}`);
    if (spec.expectText && !normalizeForExpect(bodyText).includes(normalizeForExpect(spec.expectText))) failures.push(`missing text: ${spec.expectText}`);
    if (kind === 'public' && result.bodyLength < (spec.minBodyLength ?? 120)) failures.push(`body too short: ${result.bodyLength}`);
    result.failures = failures;
    console.log(`[smoke:routes] ${failures.length ? 'FAIL' : 'PASS'} ${spec.path}`);
    return result;
  }

  console.log(`[smoke:routes] ${kind} ${spec.path}`);
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  const errors = [];
  page.on('console', (msg) => {
    if (msg.type() !== 'error' && msg.type() !== 'warning') return;
    const text = msg.text();
    if (isIgnorableConsole(text)) return;
    errors.push(`${msg.type()}: ${text}`);
  });
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));

  const response = await page.goto(`${baseUrl}${spec.path}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(2500);
  const bodyText = await page.locator('body').innerText().catch(() => '');
  const finalUrl = new URL(page.url());
  const overlay = await page.locator('[data-nextjs-dialog], .nextjs-portal').count();

  const result = {
    kind,
    path: spec.path,
    name: spec.name,
    status: response?.status() ?? null,
    finalPath: `${finalUrl.pathname}${finalUrl.search}`,
    title: await page.title(),
    bodyLength: bodyText.trim().length,
    overlay: overlay > 0,
    errors,
  };

  const failures = [];
  if (!response || response.status() >= 400) failures.push(`http ${response?.status()}`);
  if (result.overlay) failures.push('error overlay detected');
  if (spec.expectText) {
    const expected = normalizeForExpect(spec.expectText);
    const actual = normalizeForExpect(bodyText);
    if (!actual.includes(expected)) failures.push(`missing text: ${spec.expectText}`);
  }
  if (kind === 'public' && result.bodyLength < (spec.minBodyLength ?? 120)) failures.push(`body too short: ${result.bodyLength}`);
  if (kind === 'private' && result.finalPath !== spec.expectedUrl) failures.push(`redirect mismatch: ${result.finalPath}`);
  result.failures = failures;

  if (failures.length) {
    const shot = path.join(outDir, `${spec.name}-fail.png`);
    await page.screenshot({ path: shot, fullPage: true });
    result.screenshot = shot;
  }

  await page.close();
  console.log(`[smoke:routes] ${failures.length ? 'FAIL' : 'PASS'} ${spec.path}`);
  return result;
}

async function runSmoke() {
  await mkdir(outDir, { recursive: true });
  const browser = await launchBrowser();
  const results = [];

  try {
    for (const route of publicRoutes) {
      results.push(await smokeRoute(browser, route, 'public'));
    }
    for (const route of privateRoutes) {
      results.push(await smokeRoute(browser, route, 'private'));
    }
  } finally {
    await browser.close();
  }

  const summary = {
    ok: results.every((r) => r.failures.length === 0),
    generatedAt: new Date().toISOString(),
    baseUrl,
    totals: {
      routes: results.length,
      failed: results.filter((r) => r.failures.length).length,
    },
    results,
  };

  await writeFile(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) process.exit(1);
}

async function main() {
  let timeout;
  await Promise.race([
    runSmoke(),
    new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error(`Route smoke timed out after ${OVERALL_TIMEOUT_MS}ms.`)), OVERALL_TIMEOUT_MS);
      timeout.unref?.();
    }),
  ]);
  clearTimeout(timeout);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
