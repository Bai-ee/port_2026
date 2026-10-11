// process-due cron gate: fails CLOSED in production without CRON_SECRET (x-vercel-cron alone is not enough there);
// a correct bearer runs the sweep and reports counts + the alert outcome. Mock/fake only, no network.
import assert from 'node:assert/strict';
import test, { beforeEach, afterEach } from 'node:test';
import { createRequire } from 'node:module';
import '../../archive/__tests__/esm-next-server-shim.mjs';

const require = createRequire(import.meta.url);
const fb = require('../../../../api/_lib/firebase-admin.cjs');
const { makeFakeContext } = require('../../../../api/_lib/__tests__/fake-firestore.cjs');
const route = await import('../route.js');

const realEnv = { ...process.env };
const dbDescriptor = Object.getOwnPropertyDescriptor(fb, 'adminDb');
let ctx;
beforeEach(() => {
  ctx = makeFakeContext();
  Object.defineProperty(fb, 'adminDb', { configurable: true, get: () => ctx.adminDb });
  delete process.env.CRON_SECRET;
  delete process.env.SOCIAL_POSTING_CRON_SECRET;
  delete process.env.PILOT_ALERT_EMAIL;
});
afterEach(() => {
  Object.defineProperty(fb, 'adminDb', dbDescriptor);
  process.env = { ...realEnv };
});

const get = (headers = {}) => route.GET(new Request('http://localhost/api/social-posting?action=process-due', { headers }));

test('production without CRON_SECRET: even x-vercel-cron: 1 is refused (401) — publishing fails closed', async () => {
  process.env.VERCEL_ENV = 'production';
  assert.equal((await get({ 'x-vercel-cron': '1' })).status, 401);
  assert.equal((await get()).status, 401);
});

test('production with CRON_SECRET: wrong bearer 401; right bearer runs the sweep with counts and an alert field', async () => {
  process.env.VERCEL_ENV = 'production';
  process.env.CRON_SECRET = 'test-secret-value';
  assert.equal((await get({ authorization: 'Bearer nope' })).status, 401);
  const res = await get({ authorization: 'Bearer test-secret-value' });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.posted, 0);
  assert.equal(body.expired, 0);
  assert.equal(body.alert, 'not-configured');
});

test('the SOCIAL_POSTING_CRON_SECRET alias is accepted by the route (note: Vercel itself only sends CRON_SECRET)', async () => {
  process.env.VERCEL_ENV = 'production';
  process.env.SOCIAL_POSTING_CRON_SECRET = 'alias-secret';
  assert.equal((await get({ authorization: 'Bearer alias-secret' })).status, 200);
});

test('a failing alert never breaks the sweep response', async () => {
  process.env.VERCEL_ENV = 'production';
  process.env.CRON_SECRET = 'test-secret-value';
  process.env.PILOT_ALERT_EMAIL = 'o@example.com';
  process.env.PILOT_ALERT_FROM = 'A <a@example.com>';
  process.env.RESEND_API_KEY = 'k';
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('network down'); };
  try {
    const res = await get({ authorization: 'Bearer test-secret-value' });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).alert, 'nothing-to-report'); // nothing held/failed/expired in an empty queue
  } finally { globalThis.fetch = realFetch; }
});
