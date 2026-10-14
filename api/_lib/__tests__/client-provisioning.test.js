'use strict';

// Phase 2b.1 / 2b.5 — provisionClientForUser writes the optional signup brand
// fields as SOURCES + SETTINGS (never Brain Markdown), a schedule-OFF
// digest_config, and contentLoop.enabled=false. A URL-only signup is unchanged.
// Runs against the in-memory fake Firestore (require.cache swap) — no network.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { makeFakeContext } = require('./fake-firestore.cjs');

const firebaseAdminPath = path.resolve(__dirname, '../firebase-admin.cjs');
const provisioningPath = path.resolve(__dirname, '../client-provisioning.cjs');
const digestConfigPath = path.resolve(__dirname, '../../../features/intelligence/_digest-config.js');

function loadWithFake() {
  delete require.cache[provisioningPath];
  delete require.cache[digestConfigPath];
  const fake = makeFakeContext();
  require.cache[firebaseAdminPath] = { id: firebaseAdminPath, filename: firebaseAdminPath, loaded: true, exports: fake };
  return { fake, mod: require(provisioningPath) };
}

const BASE = { uid: 'uid12345abcdef', email: 'owner@acme.test', displayName: 'Owner', companyName: 'Acme', websiteUrl: 'acme.test' };

test('URL-only signup: same docs as before + digest_config OFF + contentLoop off, no signup extras', async () => {
  const { fake, mod } = loadWithFake();
  const result = await mod.provisionClientForUser({ ...BASE });
  const id = result.clientId;
  assert.equal(id, 'acme-uid12345');
  assert.equal(result.initialRunCreated, true);

  const cfg = fake.adminDb._raw('client_configs', id);
  assert.equal(cfg.onboardingAnswers, null, 'no optional fields -> onboardingAnswers stays null');
  assert.equal('marketingBriefConfig' in cfg, false, 'no settings written');
  assert.equal(cfg.sourceInputs.websiteUrl, 'https://acme.test/');

  const dash = fake.adminDb._raw('dashboard_state', id);
  assert.equal('snapshot' in dash, false, 'no brandOverview seed without a goal');

  const client = fake.adminDb._raw('clients', id);
  assert.deepEqual(client.contentLoop, { enabled: false });

  const digest = fake.adminDb._raw('digest_config', id);
  assert.ok(digest, 'digest_config created');
  assert.equal(digest.schedule.enabled, false);
  assert.equal(digest.schedule.frequency, 'off');
  assert.equal(digest.nextRunAt, null);
  assert.equal(digest.homeClientId, null);
  assert.equal(digest.recipientEmail, 'owner@acme.test');

  // Read-side config resolves to schedule OFF -> not cron-enrolled.
  const dc = require(digestConfigPath);
  const resolved = await dc.getDigestConfig(id);
  assert.equal(resolved.schedule.enabled, false);
  assert.equal(dc.isCronEnrolled(resolved), false);

  // Initial signup run still queued exactly once.
  const run = fake.adminDb._raw('brief_runs', `${id}-signup`);
  assert.equal(run.trigger, 'signup');
  assert.equal(run.status, 'queued');
});

test('optional fields -> onboardingAnswers (existing shape) + marketingBriefConfig settings + a signup-sourced (not frozen) positioning', async () => {
  const { fake, mod } = loadWithFake();
  const { clientId: id } = await mod.provisionClientForUser({
    ...BASE,
    xHandle: '@AcmeHQ',
    instagramHandle: 'https://instagram.com/acme.co/',
    competitors: ['https://www.rival.com', '@widgetco', '', 'fourth.com'],
    goal: '  The go-to widget shop for small teams ',
  });

  const cfg = fake.adminDb._raw('client_configs', id);
  const answers = cfg.onboardingAnswers.answers;
  assert.deepEqual(answers.competitors.value, [
    { name: 'rival.com', handle: 'https://www.rival.com/' },
    { name: 'widgetco', handle: '@widgetco' },
    { name: 'fourth.com', handle: 'https://fourth.com/' },
  ]);
  assert.equal(answers.competitors.skipped, false);
  assert.ok(answers.competitors.answeredAt, 'answeredAt stamped');
  assert.equal(answers.xHandle.value, '@AcmeHQ');
  assert.equal(answers.xHandle.source, 'signup');
  assert.equal(answers.instagramHandle.value, '@acme.co');
  assert.equal(answers.goal.value, 'The go-to widget shop for small teams');
  assert.ok(cfg.onboardingAnswers.updatedAt);

  assert.deepEqual(cfg.marketingBriefConfig, {
    brandXHandle: 'AcmeHQ',
    xGrowth: { ownHandle: 'AcmeHQ' },
    instagramHandles: ['acme.co'],
  });

  const bo = fake.adminDb._raw('dashboard_state', id).snapshot.brandOverview;
  assert.equal(bo.positioning, 'The go-to widget shop for small teams');
  assert.equal(bo.source, 'signup', 'not "user": a user-sourced overview would freeze later crawl fields');

  // Signup never touches the Client Brain.
  assert.equal(fake.adminDb._raw('clients/' + id + '/client_brain', 'current'), undefined);
});

test('competitors normalize through the survey config and feed buildSearchSeeds', () => {
  const { mod } = loadWithFake();
  const { buildSearchSeeds } = require('../../../features/scout-intake/seed-extractor.js');
  const profile = mod.buildSignupProfile({ competitors: ['acme.com', '@@foo'] });
  assert.deepEqual(profile.onboardingAnswers.answers.competitors.value, [
    { name: 'acme.com', handle: 'https://acme.com/' },
    { name: 'foo', handle: '@foo' },
  ]);
  // Non-survey keys (xHandle/goal) are ignored by the seed reader.
  const seeds = buildSearchSeeds(mod.buildSignupProfile({ competitors: ['@foo'], xHandle: 'x', goal: 'g' }).onboardingAnswers.answers);
  assert.deepEqual(Object.keys(seeds), ['competitors']);
});

test('only filled fields produce settings; empty input -> all null', () => {
  const { mod } = loadWithFake();
  assert.deepEqual(mod.buildSignupProfile({}), { onboardingAnswers: null, marketingBriefConfig: null, brandOverviewSeed: null });
  const igOnly = mod.buildSignupProfile({ instagramHandle: '@ig_only' });
  assert.deepEqual(igOnly.marketingBriefConfig, { instagramHandles: ['ig_only'] });
  assert.equal(igOnly.brandOverviewSeed, null);
});

test('already-provisioned user returns the existing client and writes nothing new', async () => {
  const { fake, mod } = loadWithFake();
  const first = await mod.provisionClientForUser({ ...BASE });
  fake.adminDb._store.get('digest_config').delete(first.clientId);
  const second = await mod.provisionClientForUser({ ...BASE, xHandle: 'later' });
  assert.equal(second.alreadyProvisioned, true);
  assert.equal(fake.adminDb._raw('digest_config', first.clientId), undefined);
  assert.equal('marketingBriefConfig' in fake.adminDb._raw('client_configs', first.clientId), false);
});

test('handle normalization: URLs with or without a scheme, post links and query strings keep only the account', async () => {
  const { mod } = loadWithFake();
  const x = (v) => mod.buildSignupProfile({ xHandle: v }).marketingBriefConfig?.brandXHandle;
  const ig = (v) => mod.buildSignupProfile({ instagramHandle: v }).marketingBriefConfig?.instagramHandles?.[0];
  assert.equal(x('https://x.com/acme/status/123?s=20'), 'acme');
  assert.equal(x('x.com/acme'), 'acme');
  assert.equal(x('twitter.com/Acme_HQ/'), 'Acme_HQ');
  assert.equal(x('@acme'), 'acme');
  assert.equal(x('averyveryverylonghandle'), 'averyveryverylo', 'capped at 15 like X');
  assert.equal(ig('instagram.com/acme.co'), 'acme.co');
  assert.equal(ig('https://www.instagram.com/acme.co/?hl=en'), 'acme.co');
  assert.equal(ig('@acme.co'), 'acme.co');
});
