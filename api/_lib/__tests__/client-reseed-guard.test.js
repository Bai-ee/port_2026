'use strict';

// Reseed guard (assessReseedRequest + reseedIntakeForClient lock) and stale
// per-site output clearing. In-memory fake Firestore — no network.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { makeFakeContext } = require('./fake-firestore.cjs');

const firebaseAdminPath = path.resolve(__dirname, '../firebase-admin.cjs');
const provisioningPath = path.resolve(__dirname, '../client-provisioning.cjs');

function loadWithFake() {
  delete require.cache[provisioningPath];
  const fake = makeFakeContext({ deepMerge: true });
  require.cache[firebaseAdminPath] = { id: firebaseAdminPath, filename: firebaseAdminPath, loaded: true, exports: fake };
  return { fake, mod: require(provisioningPath) };
}

async function seedClient(fake, clientId, data) {
  await fake.adminDb.collection('clients').doc(clientId).set({ clientId, ...data });
}

const BASE = { clientId: 'acme-1', ownClientId: 'admin-own', uid: 'u1' };

test('assessReseedRequest: impersonating + admin/fallback host -> host-matches-admin-client', () => {
  const { mod } = loadWithFake();
  const args = { existing: { normalizedHost: 'acme.test' }, impersonating: true, clientId: 'acme-1', ownClientId: 'admin-own', adminOwnHost: 'www.bballi.co', confirmHostChange: true, confirmAdminHost: false, nowMs: 1000 };
  assert.equal(mod.assessReseedRequest({ ...args, newHost: 'bballi.co' }).code, 'host-matches-admin-client');
  assert.equal(mod.assessReseedRequest({ ...args, newHost: 'www.hitloop.agency' }).code, 'host-matches-admin-client');
  assert.equal(mod.assessReseedRequest({ ...args, newHost: 'bballi.co', confirmAdminHost: true }), null);
});

test('assessReseedRequest: owner self-reseed (not impersonating) to hitloop.agency is allowed', () => {
  const { mod } = loadWithFake();
  const verdict = mod.assessReseedRequest({
    existing: { normalizedHost: 'hitloop.agency' }, newHost: 'hitloop.agency', impersonating: false,
    clientId: 'admin-own', ownClientId: 'admin-own', adminOwnHost: 'hitloop.agency', nowMs: 1000,
  });
  assert.equal(verdict, null);
});

test('assessReseedRequest: host change needs confirmHostChange; www is ignored', () => {
  const { mod } = loadWithFake();
  const args = { existing: { normalizedHost: 'www.acme.test' }, impersonating: false, clientId: 'c', ownClientId: 'c', nowMs: 1000 };
  const v = mod.assessReseedRequest({ ...args, newHost: 'other.test' });
  assert.equal(v.code, 'confirm-host-change');
  assert.equal(v.oldHost, 'acme.test');
  assert.equal(v.newHost, 'other.test');
  assert.equal(mod.assessReseedRequest({ ...args, newHost: 'other.test', confirmHostChange: true }), null);
  assert.equal(mod.assessReseedRequest({ ...args, newHost: 'acme.test' }), null);
});

test('reseedIntakeForClient: unconfirmed host change throws coded 409 and writes nothing', async () => {
  const { fake, mod } = loadWithFake();
  await seedClient(fake, 'acme-1', { normalizedHost: 'acme.test', latestRunStatus: 'succeeded' });
  await assert.rejects(
    mod.reseedIntakeForClient({ ...BASE, websiteUrl: 'other.test' }),
    (e) => e.code === 'confirm-host-change' && e.status === 409 && e.oldHost === 'acme.test' && e.newHost === 'other.test'
  );
  assert.equal(fake.adminDb._raw('clients', 'acme-1').normalizedHost, 'acme.test');
  assert.equal(fake.adminDb._raw('clients', 'acme-1').reseedLock, undefined);
});

test('reseedIntakeForClient: impersonating + admin host -> host-matches-admin-client', async () => {
  const { fake, mod } = loadWithFake();
  await seedClient(fake, 'acme-1', { normalizedHost: 'acme.test' });
  await assert.rejects(
    mod.reseedIntakeForClient({ ...BASE, websiteUrl: 'hitloop.agency', impersonating: true, adminOwnHost: 'bballi.co', confirmHostChange: true }),
    (e) => e.code === 'host-matches-admin-client'
  );
});

test('reseedIntakeForClient: second reseed inside 60s while the run is queued -> reseed-in-flight with runId', async () => {
  const { fake, mod } = loadWithFake();
  await seedClient(fake, 'acme-1', { normalizedHost: 'acme.test' });
  const first = await mod.reseedIntakeForClient({ ...BASE, websiteUrl: 'acme.test' });
  assert.equal(fake.adminDb._raw('clients', 'acme-1').reseedLock.runId, first.runId);
  await assert.rejects(
    mod.reseedIntakeForClient({ ...BASE, websiteUrl: 'acme.test' }),
    (e) => e.code === 'reseed-in-flight' && e.runId === first.runId
  );
});

test('reseedIntakeForClient: owner self-reseed to hitloop.agency (not impersonating) is allowed', async () => {
  const { fake, mod } = loadWithFake();
  await seedClient(fake, 'admin-own', { normalizedHost: 'hitloop.agency' });
  const res = await mod.reseedIntakeForClient({ clientId: 'admin-own', ownClientId: 'admin-own', uid: 'u1', websiteUrl: 'hitloop.agency', impersonating: false });
  assert.equal(res.status, 'queued');
});

async function seedDashboard(fake, clientId) {
  await fake.adminDb.collection('dashboard_state').doc(clientId).set({
    clientId,
    snapshot: { brandOverview: { headline: 'User edited' } },
    analyzerOutputs: { 'seo-performance': { aggregate: 1 } },
    seoAudit: { score: 90 },
    siteMeta: { ogImage: 'https://old.test/og.png' },
    moduleBriefs: { items: [{ id: 'x' }] },
    artifacts: {
      homepageScreenshot: { downloadUrl: 'a' }, homepageScreenshots: { desktop: {} }, fullPageScreenshots: { desktop: {} },
      homepageDeviceMockup: { downloadUrl: 'b' }, skillDocs: { s: {} }, studioCaptures: ['keep'],
    },
    onboard: { socialPreview: { status: 'succeeded' } },
    modules: {
      'design-evaluation': { status: 'succeeded', result: { score: 1 }, lastSuccessAt: 1 },
      'multi-device-view': { status: 'succeeded', result: { shots: 1 }, lastSuccessAt: 1 },
    },
  });
}

test('host change nulls old-site outputs but keeps snapshot and unrelated artifacts', async () => {
  const { fake, mod } = loadWithFake();
  await seedClient(fake, 'acme-1', { normalizedHost: 'acme.test', latestRunStatus: 'succeeded' });
  await seedDashboard(fake, 'acme-1');
  await mod.reseedIntakeForClient({ ...BASE, websiteUrl: 'other.test', confirmHostChange: true });
  const d = fake.adminDb._raw('dashboard_state', 'acme-1');
  for (const k of ['analyzerOutputs', 'seoAudit', 'siteMeta', 'moduleBriefs']) assert.equal(d[k], null, k);
  for (const k of ['homepageScreenshot', 'homepageScreenshots', 'fullPageScreenshots', 'homepageDeviceMockup', 'skillDocs']) assert.equal(d.artifacts[k], null, k);
  assert.deepEqual(d.artifacts.studioCaptures, ['keep']);
  assert.equal(d.onboard.socialPreview, null);
  assert.equal(d.modules['design-evaluation'].result, null);
  assert.equal(d.modules['design-evaluation'].lastSuccessAt, null);
  assert.equal(d.modules['multi-device-view'].result, null);
  assert.equal(d.snapshot.brandOverview.headline, 'User edited');
});

test('same host reseed leaves old-site outputs untouched', async () => {
  const { fake, mod } = loadWithFake();
  await seedClient(fake, 'acme-1', { normalizedHost: 'acme.test', latestRunStatus: 'succeeded' });
  await seedDashboard(fake, 'acme-1');
  await mod.reseedIntakeForClient({ ...BASE, websiteUrl: 'acme.test' });
  const d = fake.adminDb._raw('dashboard_state', 'acme-1');
  assert.deepEqual(d.seoAudit, { score: 90 });
  assert.equal(d.siteMeta.ogImage, 'https://old.test/og.png');
  assert.deepEqual(d.modules['design-evaluation'].result, { score: 1 });
  assert.ok(d.artifacts.homepageScreenshot);
});
