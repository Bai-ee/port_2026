import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const baseUrl = process.env.STUDIO_SMOKE_BASE_URL || 'http://localhost:3000';
const outDir = process.env.STUDIO_SMOKE_OUT_DIR || '/tmp/studio-smoke';

const pngFixture = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAyAAAAHCCAIAAADq3a6SAAAACXBIWXMAAAsTAAALEwEAmpwYAAAJx0lEQVR4nO3dMW7cQBRF0d3/0nqQj0A0kRDRCkUqT2UiYQEmt2aq1QYzD2f2r8+fP//mAwAAgH/64gMAAAD8vQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAACQkQAEAAD4D5pJCVzDKS+TAAAAAElFTkSuQmCC',
  'base64'
);

const captureRef = (i = 1) => ({
  type: 'studio_capture',
  variant: 'studio-desktop',
  viewportLabel: 'Studio Desktop',
  viewportId: 'desktop',
  storagePath: `clients/studio-smoke/capture-${i}.png`,
  contentType: 'image/png',
  sizeBytes: pngFixture.length,
  sourceUrl: 'https://hitloop.agency',
  capturedAt: new Date().toISOString(),
  downloadUrl: `/__studio-fixture-${i}.png`,
});

const videoRef = () => ({
  type: 'studio_video',
  variant: 'video',
  label: 'Cloud GPU Mockup Video',
  viewportId: 'desktop',
  templateId: 'home-feature',
  storagePath: 'clients/studio-smoke/video.mp4',
  contentType: 'video/mp4',
  sizeBytes: 1024,
  sourceUrl: 'https://hitloop.agency',
  capturedAt: new Date().toISOString(),
  downloadUrl: '/__studio-fixture-video.mp4',
  jobId: 'render_smoke',
});

async function setupRoutes(page) {
  let captureCount = 0;

  await page.route('**/__studio-fixture-*.png', (route) => {
    route.fulfill({ status: 200, contentType: 'image/png', body: pngFixture });
  });

  await page.route('**/__studio-fixture-video.mp4', (route) => {
    route.fulfill({ status: 200, contentType: 'video/mp4', body: Buffer.from('') });
  });

  await page.route('**/api/dashboard/bootstrap', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ client: { websiteUrl: 'https://hitloop.agency' }, impersonating: false }),
    });
  });

  await page.route('**/api/dashboard/check-embeddable?**', (route) => {
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ embeddable: true }) });
  });

  await page.route('**/api/dashboard/studio-section-map', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        sections: [
          { selector: 'main', label: 'Homepage hero', pct: 0, media: true },
          { selector: '#content-section', label: 'Offer section', pct: 38, media: false },
        ],
      }),
    });
  });

  await page.route('**/api/dashboard/studio-capture?proxy=1**', (route) => {
    route.fulfill({ status: 200, contentType: 'image/png', body: pngFixture });
  });

  await page.route('**/api/dashboard/studio-capture', async (route) => {
    if (route.request().method() === 'GET') {
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, captures: [] }) });
      return;
    }
    captureCount += 1;
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, capture: captureRef(captureCount) }),
    });
  });

  await page.route('**/api/dashboard/studio-render', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 600));
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, capture: videoRef(), jobId: 'render_smoke' }),
    });
  });
}

async function clickText(page, text) {
  await page.getByText(text, { exact: true }).first().click();
}

async function main() {
  await mkdir(outDir, { recursive: true });
  const backgroundFixturePath = path.join(outDir, 'studio-smoke-background.svg');
  await writeFile(
    backgroundFixturePath,
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 675"><defs><linearGradient id="g" x1="0" x2="1" y1="0" y2="1"><stop stop-color="#172033"/><stop offset="0.55" stop-color="#5b6ee1"/><stop offset="1" stop-color="#f59e0b"/></linearGradient></defs><rect width="1200" height="675" fill="url(#g)"/><circle cx="920" cy="160" r="110" fill="#ffffff" opacity="0.35"/><rect x="120" y="420" width="760" height="70" rx="35" fill="#ffffff" opacity="0.28"/></svg>'
  );

  const chromeForTestingPath = path.join(
    process.env.HOME || '',
    'Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'
  );
  const launchOptions = { headless: true };
  try {
    await access(chromeForTestingPath);
    launchOptions.executablePath = chromeForTestingPath;
  } catch {
    // Fall back to Playwright's default browser resolution on non-macOS hosts.
  }

  const browser = await chromium.launch(launchOptions);
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  const issues = [];

  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (/Failed to load resource.*401|favicon|video/i.test(text)) return;
    issues.push(`console error: ${text}`);
  });
  page.on('pageerror', (err) => issues.push(`page error: ${err.message}`));
  await setupRoutes(page);

  await page.goto(`${baseUrl}/dashboard/studio?smoke=1&url=https://hitloop.agency`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#studio-page-shell', { timeout: 20000 });
  await page.waitForSelector('#studio-stage-shell canvas', { timeout: 20000 });
  await page.screenshot({ path: path.join(outDir, '01-initial.png'), fullPage: true });

  await clickText(page, 'Size');
  await clickText(page, 'SQUARE');
  await page.waitForTimeout(300);
  await clickText(page, 'REEL');
  await page.waitForTimeout(300);

  await clickText(page, 'MOBILE');
  await page.waitForTimeout(300);
  await clickText(page, 'TABLET');
  await page.waitForTimeout(300);
  await clickText(page, 'DESKTOP');
  await page.waitForTimeout(300);

  await clickText(page, 'Background');
  let imageBackgroundReady = false;
  if (await page.getByText('Image', { exact: true }).count()) {
    await clickText(page, 'Image');
    await page.locator('#studio-background-panel input[type="file"]').setInputFiles(backgroundFixturePath);
    await page.waitForTimeout(2000);
    const backgroundPanelText = await page.locator('#studio-background-panel').innerText();
    const toastText = await page.locator('#studio-render-toast').count()
      ? await page.locator('#studio-render-toast').innerText()
      : '';
    imageBackgroundReady = backgroundPanelText.includes('Replace image');
    if (!imageBackgroundReady) {
      issues.push(`image background upload did not become ready${toastText ? `: ${toastText}` : ''}`);
    }
  }
  if (await page.getByText('Site', { exact: true }).count()) {
    issues.push('unsupported Site background mode is visible in launch UI');
  }
  if (imageBackgroundReady) {
    await page.locator('#studio-camera-template-select').selectOption('spiral-in');
    await page.waitForTimeout(500);
    page.once('dialog', async (dialog) => {
      await dialog.accept('Smoke Template');
    });
    await page.locator('#studio-undercanvas-actions button').first().click();
    await page.waitForFunction(
      () => {
        const saved = JSON.parse(window.localStorage.getItem('mockup-studio-custom-templates-v1') || '[]');
        return saved.some((entry) => (
          entry?.label === 'Smoke Template'
          && entry?.settings?.bgMode === 'image'
          && entry?.settings?.bgImageDataUrl
          && entry?.settings?.formatId === 'reel'
          && entry?.settings?.viewportId === 'desktop'
        ));
      },
      null,
      { timeout: 5000 }
    );
    await clickText(page, 'Color');
    await page.locator('#studio-camera-template-select').selectOption({ label: 'Smoke Template' });
    await page.waitForFunction(
      () => document.querySelector('#studio-background-panel')?.innerText.includes('Replace image'),
      null,
      { timeout: 5000 }
    );
  }
  await clickText(page, 'Color');
  await page.locator('input[type="color"]').fill('#172033');
  await clickText(page, 'Scene');
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(outDir, '02-backgrounds.png'), fullPage: true });

  await clickText(page, 'Environment');
  await clickText(page, 'On');
  await page.waitForTimeout(200);
  await clickText(page, 'Off');

  await clickText(page, 'Director');
  await clickText(page, 'Section');
  await clickText(page, 'Map sections');
  await page.getByText('main', { exact: false }).first().click();

  await clickText(page, 'Export');
  await page.locator('#studio-camera-template-select').selectOption('spiral-in');
  await clickText(page, 'Capture hi-res');
  await page.waitForTimeout(900);

  await clickText(page, 'Create video');
  await page.waitForSelector('#studio-render-console', { timeout: 5000 });
  await page.waitForFunction(() => document.body.innerText.includes('Video ready'), null, { timeout: 10000 });
  await page.screenshot({ path: path.join(outDir, '03-render-modal.png'), fullPage: true });
  await page.locator('#studio-render-console-close').click();

  await clickText(page, 'Captures');
  await page.waitForTimeout(500);
  const captureText = await page.locator('#studio-captures-panel').innerText();
  if (!/Cloud GPU Mockup Video|Studio Desktop/i.test(captureText)) {
    issues.push('captures panel did not show generated capture/video refs');
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(outDir, '04-mobile.png'), fullPage: true });
  const mobileOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 8);
  if (mobileOverflow) issues.push('mobile viewport has horizontal overflow');

  await browser.close();

  if (issues.length) {
    console.error(JSON.stringify({ ok: false, issues, outDir }, null, 2));
    process.exit(1);
  }

  console.log(JSON.stringify({ ok: true, outDir }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
