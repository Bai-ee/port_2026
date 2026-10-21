'use strict';

// createAdminClient — the admin Create Client card. Without a website it is
// the original idea-only workspace (no brief run). With a website it is
// provisioned like a signup (queued 'signup' run) and stores the admin's
// onboarding step choices on client_configs.onboardingSteps.
// Runs against the in-memory fake Firestore (require.cache swap) — no network.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { makeFakeContext } = require('./fake-firestore.cjs');

const firebaseAdminPath = path.resolve(__dirname, '../firebase-admin.cjs');
const provisioningPath = path.resolve(__dirname, '../client-provisioning.cjs');

function loadWithFake() {
  delete require.cache[provisioningPath];
  const fake = makeFakeContext();
  require.cache[firebaseAdminPath] = { id: firebaseAdminPath, filename: firebaseAdminPath, loaded: true, exports: fake };
  return { fake, mod: require(provisioningPath) };
}

const ADMIN = { adminUid: 'adminuid12345', adminEmail: 'admin@hitloop.test' };

test('no website: idea-only workspace, no brief run, no onboardingSteps', async () => {
  const { fake, mod } = loadWithFake();
  const result = await mod.createAdminClient({ ...ADMIN, companyName: 'Idea Co', ideaDescription: 'A podcast' });
  assert.equal(result.initialRun, null);
  assert.equal(result.initialRunCreated, false);

  const cfg = fake.adminDb._raw('client_configs', result.clientId);
  assert.equal(cfg.sourceInputs.websiteUrl, '');
  assert.equal(cfg.sourceInputs.ideaDescription, 'A podcast');
  assert.equal('onboardingSteps' in cfg, false);
  assert.equal('entryMode' in cfg, false);

  const client = fake.adminDb._raw('clients', result.clientId);
  assert.equal(client.status, 'active');
  assert.equal(client.adminCreated, true);
  assert.equal(fake.adminDb._raw('brief_runs', `${result.clientId}-signup`), undefined);
});

test('with website: signup-style run queued, steps stored, off module steps idle', async () => {
  const { fake, mod } = loadWithFake();
  const result = await mod.createAdminClient({
    ...ADMIN,
    companyName: 'Acme',
    websiteUrl: 'acme.test',
    onboardingSteps: { motionVideo: false, socialPreview: false, bogus: false },
  });
  const id = result.clientId;
  assert.equal(result.initialRunCreated, true);
  assert.equal(result.initialRun.runId, `${id}-signup`);

  const run = fake.adminDb._raw('brief_runs', `${id}-signup`);
  assert.equal(run.trigger, 'signup');
  assert.equal(run.pipelineType, 'free-tier-intake');
  assert.equal(run.sourceUrl, 'https://acme.test/');
  assert.equal(run.requestedByUid, ADMIN.adminUid);

  const cfg = fake.adminDb._raw('client_configs', id);
  assert.equal(cfg.entryMode, 'website');
  assert.equal(cfg.sourceInputs.websiteUrl, 'https://acme.test/');
  assert.deepEqual(cfg.onboardingSteps, {
    deviceMockups: true,
    socialPreview: false,
    siteSources: true,
    motionVideo: false,
    briefSummary: true,
    brainDraft: true,
  });

  const client = fake.adminDb._raw('clients', id);
  assert.equal(client.status, 'provisioning');
  assert.equal(client.websiteUrl, 'https://acme.test/');
  assert.equal(client.latestRunId, `${id}-signup`);

  const dash = fake.adminDb._raw('dashboard_state', id);
  assert.equal(dash.modules['social-preview'].status, 'idle');
  assert.equal(dash.modules['multi-device-view'].status, 'queued');
});

test('with website and no step choices: every step on', async () => {
  const { fake, mod } = loadWithFake();
  const result = await mod.createAdminClient({ ...ADMIN, companyName: 'Beta', websiteUrl: 'https://beta.test' });
  const cfg = fake.adminDb._raw('client_configs', result.clientId);
  assert.ok(Object.values(cfg.onboardingSteps).every((v) => v === true));
});

test('invalid website URL is a 400', async () => {
  const { mod } = loadWithFake();
  await assert.rejects(
    mod.createAdminClient({ ...ADMIN, companyName: 'Bad', websiteUrl: 'http://' }),
    (err) => err.status === 400,
  );
});
