import crypto from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import Stripe from 'stripe';

try {
  const dotenv = await import('dotenv');
  dotenv.config({ path: path.resolve(process.cwd(), '.env.local'), override: false, quiet: true });
  dotenv.config({ path: path.resolve(process.cwd(), '.env'), override: false, quiet: true });
} catch {
  // dotenv is a local convenience only.
}

const baseUrl = normalizeBaseUrl(process.env.PREVIEW_SMOKE_BASE_URL || process.env.ROUTE_SMOKE_BASE_URL);
const outDir = process.env.PREVIEW_SMOKE_OUT_DIR || '/tmp/preview-smoke';
const allowMutations = process.env.PREVIEW_SMOKE_ALLOW_MUTATIONS === '1';
const vercelBypassSecret = String(
  process.env.PREVIEW_SMOKE_VERCEL_BYPASS_SECRET ||
  process.env.VERCEL_AUTOMATION_BYPASS_SECRET ||
  process.env.VERCEL_PROTECTION_BYPASS ||
  ''
).trim();
const adminEmail = String(process.env.PREVIEW_SMOKE_ADMIN_EMAIL || 'bryanballi@gmail.com').trim().toLowerCase();
const testWebsiteUrl = process.env.PREVIEW_SMOKE_WEBSITE_URL || `${baseUrl}/`;
const stripeTiers = String(process.env.PREVIEW_SMOKE_STRIPE_TIERS || 'weekly,weekly-plus,daily,continuous,studio')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

if (!baseUrl) {
  console.error('Missing PREVIEW_SMOKE_BASE_URL.');
  process.exit(2);
}

const results = [];
let adminToken = null;
let smokeUser = null;
let smokeClientId = process.env.PREVIEW_SMOKE_CLIENT_ID || null;

function normalizeBaseUrl(value) {
  const raw = String(value || '').trim().replace(/\/+$/, '');
  if (!raw) return '';
  const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  return url.toString().replace(/\/+$/, '');
}

function fullUrl(pathname) {
  return `${baseUrl}${pathname.startsWith('/') ? pathname : `/${pathname}`}`;
}

function commonHeaders() {
  return vercelBypassSecret ? { 'x-vercel-protection-bypass': vercelBypassSecret } : {};
}

function describeResponseData(data) {
  if (typeof data === 'string') return data.replace(/\s+/g, ' ').slice(0, 180);
  try {
    return JSON.stringify(data).slice(0, 220);
  } catch {
    return String(data);
  }
}

function looksLikeVercelProtection(data) {
  return typeof data === 'string' && /vercel\.com\/sso-api|_vercel_sso_nonce|deployment protection/i.test(data);
}

function step(name, status, detail = {}) {
  const row = { name, status, ...detail };
  results.push(row);
  const marker = status === 'pass' ? 'PASS' : status === 'skip' ? 'SKIP' : 'FAIL';
  console.log(`[${marker}] ${name}${detail.message ? ` — ${detail.message}` : ''}`);
  return row;
}

async function fetchJson(pathname, options = {}) {
  const res = await fetch(fullUrl(pathname), {
    ...options,
    headers: {
      ...commonHeaders(),
      ...(options.body && !(options.body instanceof FormData) ? { 'content-type': 'application/json' } : null),
      ...(options.headers || {}),
    },
    cache: 'no-store',
  });
  const contentType = res.headers.get('content-type') || '';
  const data = contentType.includes('application/json')
    ? await res.json().catch(() => ({}))
    : await res.text().catch(() => '');
  return { res, data };
}

async function launchBrowser() {
  return chromium.launch({ headless: true });
}

async function checkBrowserRoutes() {
  const browser = await launchBrowser();
  try {
    const specs = [
      { name: 'home loads', path: '/', expectText: 'Dashboard' },
      { name: 'login loads', path: '/login', expectText: 'Sign in' },
      { name: 'dashboard redirects when signed out', path: '/dashboard', finalPath: '/login?redirect=/dashboard', expectText: 'Sign in' },
      { name: 'admin redirects when signed out', path: '/admin/control', finalPath: '/login?redirect=/admin/control', expectText: 'Sign in' },
    ];
    for (const spec of specs) {
      const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
      const headers = commonHeaders();
      if (Object.keys(headers).length) await page.setExtraHTTPHeaders(headers);
      const errors = [];
      page.on('pageerror', (err) => errors.push(err.message));
      page.on('console', (msg) => {
        if (msg.type() === 'error' && !/favicon|\.well-known/i.test(msg.text())) errors.push(msg.text());
      });
      const response = await page.goto(fullUrl(spec.path), { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await page.waitForTimeout(2000);
      const final = new URL(page.url());
      const body = await page.locator('body').innerText().catch(() => '');
      const failures = [];
      if (!response || response.status() >= 400) failures.push(`HTTP ${response?.status() || 'missing'}`);
      if (/vercel\.com\/sso-api/i.test(page.url()) || (/vercel/i.test(body) && /sso|deployment protection|provider's accounts list/i.test(body))) {
        failures.push('hit Vercel deployment protection instead of the app');
      }
      if (spec.finalPath && `${final.pathname}${final.search}` !== spec.finalPath) failures.push(`final path ${final.pathname}${final.search}`);
      if (spec.expectText && !body.toLowerCase().includes(spec.expectText.toLowerCase())) failures.push(`missing text ${spec.expectText}`);
      if (errors.length) failures.push(`console/page errors: ${errors.slice(0, 3).join('; ')}`);
      if (failures.length) {
        const shot = path.join(outDir, `${spec.name.replace(/[^a-z0-9]+/gi, '-')}.png`);
        await page.screenshot({ path: shot, fullPage: true });
        step(spec.name, 'fail', { message: failures.join(', '), screenshot: shot });
      } else {
        step(spec.name, 'pass', { httpStatus: response.status(), finalPath: `${final.pathname}${final.search}` });
      }
      await page.close();
    }
  } finally {
    await browser.close();
  }
}

async function initFirebaseAdmin() {
  const fb = await import('../api/_lib/firebase-admin.cjs');
  return fb.default || fb;
}

async function getIdTokenForEmail(email) {
  const fb = await initFirebaseAdmin();
  const user = await fb.adminAuth.getUserByEmail(email);
  const customToken = await fb.adminAuth.createCustomToken(user.uid);
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  if (!apiKey) throw new Error('Missing NEXT_PUBLIC_FIREBASE_API_KEY.');
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: customToken, returnSecureToken: true }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.idToken) throw new Error(data.error?.message || 'Could not exchange Firebase custom token.');
  return data.idToken;
}

async function createSmokeUser() {
  const fb = await initFirebaseAdmin();
  const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const email = `preview-smoke+${stamp}@example.com`;
  const user = await fb.adminAuth.createUser({
    email,
    emailVerified: true,
    displayName: 'Preview Smoke User',
    disabled: false,
  });
  const token = await getIdTokenForEmail(email);
  smokeUser = { uid: user.uid, email, token };
  return smokeUser;
}

async function checkAdminAccess() {
  try {
    adminToken = await getIdTokenForEmail(adminEmail);
    const { res, data } = await fetchJson('/api/admin/whoami', {
      headers: { authorization: `Bearer ${adminToken}` },
    });
    if (res.ok && data?.admin?.docExists === true) {
      step('admin access via admins collection', 'pass', { email: data.email || adminEmail });
    } else {
      const protection = looksLikeVercelProtection(data) ? ' hit Vercel deployment protection.' : '';
      step('admin access via admins collection', 'fail', {
        message: data?.error || `HTTP ${res.status}; body: ${describeResponseData(data)}.${protection}`,
      });
    }
  } catch (err) {
    step('admin access via admins collection', 'fail', { message: err.message });
  }
}

async function checkHealth() {
  try {
    const { res, data } = await fetchJson('/api/health');
    if (res.ok && data?.ok === true) step('/api/health', 'pass', { data });
    else {
      const protection = looksLikeVercelProtection(data) ? ' hit Vercel deployment protection.' : '';
      step('/api/health', 'fail', { message: `HTTP ${res.status}; body: ${describeResponseData(data)}.${protection}` });
    }
  } catch (err) {
    step('/api/health', 'fail', { message: err.message });
  }
}

async function checkProvisioning() {
  if (!allowMutations) return step('signup/provisioning', 'skip', { message: 'Set PREVIEW_SMOKE_ALLOW_MUTATIONS=1 to create preview test data.' });
  try {
    const user = await createSmokeUser();
    const { res, data } = await fetchJson('/api/clients/provision', {
      method: 'POST',
      headers: { authorization: `Bearer ${user.token}` },
      body: JSON.stringify({
        displayName: 'Preview Smoke User',
        companyName: `Preview Smoke ${Date.now()}`,
        websiteUrl: testWebsiteUrl,
      }),
    });
    if (!res.ok || !data?.clientId) throw new Error(data?.error || `HTTP ${res.status}`);
    smokeClientId = data.clientId;
    step('signup/provisioning', 'pass', { clientId: smokeClientId, alreadyProvisioned: Boolean(data.alreadyProvisioned) });
  } catch (err) {
    step('signup/provisioning', 'fail', { message: err.message });
  }
}

async function checkKnowledgeBase() {
  if (!allowMutations) return step('Knowledge Base upload/URL/text ingest', 'skip', { message: 'Set PREVIEW_SMOKE_ALLOW_MUTATIONS=1 to ingest test KB data.' });
  const token = smokeUser?.token || adminToken;
  const asParam = smokeUser ? '' : (smokeClientId ? `?as=${encodeURIComponent(smokeClientId)}` : '');
  if (!token) return step('Knowledge Base upload/URL/text ingest', 'fail', { message: 'No auth token available.' });
  try {
    const textBody = 'Preview smoke test knowledge base text. This content is intentionally long enough to chunk, embed, and verify the ingest route accepts text.';
    const text = await fetchJson(`/api/dashboard/knowledge-base/ingest-text${asParam}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: JSON.stringify({ title: 'Preview smoke text', text: textBody }),
    });
    if (text.res.status !== 202) throw new Error(`text ingest HTTP ${text.res.status}: ${text.data?.error || ''}`);

    const url = await fetchJson(`/api/dashboard/knowledge-base/ingest-url${asParam}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: JSON.stringify({ title: 'Preview smoke URL', url: `${baseUrl}/faq` }),
    });
    if (url.res.status !== 202) throw new Error(`url ingest HTTP ${url.res.status}: ${url.data?.error || ''}`);

    const form = new FormData();
    form.set('title', 'Preview smoke upload');
    form.set('file', new Blob([textBody], { type: 'text/plain' }), 'preview-smoke.txt');
    const upload = await fetchJson(`/api/dashboard/knowledge-base/upload${asParam}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: form,
    });
    if (upload.res.status !== 202) throw new Error(`upload HTTP ${upload.res.status}: ${upload.data?.error || ''}`);

    step('Knowledge Base upload/URL/text ingest', 'pass', {
      textItemId: text.data?.item?.id,
      urlItemId: url.data?.item?.id,
      uploadItemId: upload.data?.item?.id,
    });
  } catch (err) {
    step('Knowledge Base upload/URL/text ingest', 'fail', { message: err.message });
  }
}

async function checkStripeSubscriptions() {
  if (!allowMutations) return step('Stripe test subscription for each tier', 'skip', { message: 'Set PREVIEW_SMOKE_ALLOW_MUTATIONS=1 to create Stripe test subscriptions.' });
  const email = smokeUser?.email || `preview-smoke+${Date.now()}@example.com`;
  const tierResults = [];
  for (const tier of stripeTiers) {
    const { res, data } = await fetchJson('/api/payments/create-subscription', {
      method: 'POST',
      body: JSON.stringify({ email, tier }),
    });
    tierResults.push({ tier, status: res.status, ok: res.ok, subscriptionId: data?.subscriptionId || null, returnedTier: data?.tier || null, error: data?.error || null });
  }
  const failed = tierResults.filter((r) => !r.ok || !r.subscriptionId || r.returnedTier !== r.tier);
  step('Stripe test subscription for each tier', failed.length ? 'fail' : 'pass', {
    message: failed.length ? JSON.stringify(failed) : undefined,
    tiers: tierResults,
  });
}

function makeStripeSignature(payload, secret, timestamp) {
  const signedPayload = `${timestamp}.${payload}`;
  const signature = crypto.createHmac('sha256', secret).update(signedPayload, 'utf8').digest('hex');
  return `t=${timestamp},v1=${signature}`;
}

async function checkStripeWebhook() {
  if (!allowMutations) return step('Stripe webhook receipt/idempotency', 'skip', { message: 'Set PREVIEW_SMOKE_ALLOW_MUTATIONS=1 and STRIPE_WEBHOOK_SECRET to post signed smoke events.' });
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return step('Stripe webhook receipt/idempotency', 'skip', { message: 'Missing local STRIPE_WEBHOOK_SECRET for signing smoke event.' });
  const event = {
    id: `evt_preview_smoke_${Date.now()}`,
    object: 'event',
    api_version: '2024-06-20',
    created: Math.floor(Date.now() / 1000),
    type: 'customer.subscription.created',
    livemode: false,
    data: {
      object: {
        id: `sub_preview_smoke_${Date.now()}`,
        object: 'subscription',
        customer: 'cus_preview_smoke',
        status: 'active',
        current_period_end: Math.floor(Date.now() / 1000) + 3600,
        items: { data: [{ price: { id: 'price_preview_smoke' } }] },
      },
    },
  };
  const payload = JSON.stringify(event);
  const timestamp = Math.floor(Date.now() / 1000);
  const headers = {
    'stripe-signature': makeStripeSignature(payload, secret, timestamp),
    'content-type': 'application/json',
  };
  const first = await fetchJson('/api/payments/webhook', { method: 'POST', headers, body: payload });
  const second = await fetchJson('/api/payments/webhook', { method: 'POST', headers, body: payload });
  if (first.res.ok && second.res.ok && second.data?.replayed === true) {
    step('Stripe webhook receipt/idempotency', 'pass', { eventId: event.id, replayReason: second.data.reason });
  } else {
    step('Stripe webhook receipt/idempotency', 'fail', { message: `first ${first.res.status}, second ${second.res.status}` });
  }
}

async function checkStudio() {
  if (!allowMutations) return step('Studio capture/render', 'skip', { message: 'Set PREVIEW_SMOKE_ALLOW_MUTATIONS=1 to run Browserless/Studio smoke calls.' });
  const token = smokeUser?.token || adminToken;
  const asParam = smokeUser ? '' : (smokeClientId ? `?as=${encodeURIComponent(smokeClientId)}` : '');
  if (!token) return step('Studio capture/render', 'fail', { message: 'No auth token available.' });
  try {
    const capture = await fetchJson(`/api/dashboard/studio-capture${asParam}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: JSON.stringify({ action: 'capture', url: baseUrl, viewportId: 'desktop', fullPage: false, scale: 1 }),
    });
    if (!capture.res.ok) throw new Error(`capture HTTP ${capture.res.status}: ${capture.data?.error || ''}`);

    const render = await fetchJson(`/api/dashboard/studio-render${asParam}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: JSON.stringify({
        url: baseUrl,
        durationSec: 2,
        fps: 24,
        viewport: { width: 720, height: 450 },
        camera: { mode: 'orbit' },
      }),
    });
    if (render.res.status !== 202 || !render.data?.jobId) throw new Error(`render HTTP ${render.res.status}: ${render.data?.error || ''}`);
    step('Studio capture/render', 'pass', { capture: capture.data?.ref?.storagePath || capture.data?.capture?.storagePath || true, jobId: render.data.jobId });
  } catch (err) {
    step('Studio capture/render', 'fail', { message: err.message });
  }
}

async function checkWorkerDrain() {
  if (!allowMutations) return step('worker queue drain', 'skip', { message: 'Set PREVIEW_SMOKE_ALLOW_MUTATIONS=1 to invoke workers.' });
  if (!adminToken) return step('worker queue drain', 'fail', { message: 'No admin token available.' });
  try {
    const brief = await fetchJson('/api/worker/run-brief', {
      method: 'POST',
      headers: { authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ source: 'preview-smoke' }),
    });
    const studio = await fetchJson('/api/worker/render-studio', {
      method: 'POST',
      headers: { authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ source: 'preview-smoke' }),
    });
    if (!brief.res.ok) throw new Error(`run-brief HTTP ${brief.res.status}: ${brief.data?.error || ''}`);
    if (!studio.res.ok) throw new Error(`render-studio HTTP ${studio.res.status}: ${studio.data?.error || ''}`);
    step('worker queue drain', 'pass', {
      runBrief: brief.data?.message || brief.data?.ok,
      renderStudio: studio.data?.message || studio.data?.ok,
    });
  } catch (err) {
    step('worker queue drain', 'fail', { message: err.message });
  }
}

async function main() {
  await mkdir(outDir, { recursive: true });
  await checkHealth();
  await checkBrowserRoutes();
  await checkAdminAccess();
  await checkProvisioning();
  await checkStripeSubscriptions();
  await checkStripeWebhook();
  await checkKnowledgeBase();
  await checkStudio();
  await checkWorkerDrain();

  const summary = {
    ok: results.every((r) => r.status !== 'fail'),
    generatedAt: new Date().toISOString(),
    baseUrl,
    allowMutations,
    totals: {
      checks: results.length,
      passed: results.filter((r) => r.status === 'pass').length,
      skipped: results.filter((r) => r.status === 'skip').length,
      failed: results.filter((r) => r.status === 'fail').length,
    },
    results,
  };
  await writeFile(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
