// Phase 2b.6 — Brain wins over signup-derived settings.
//
// Full flow on the in-memory fake Firestore (deep-merge mode), using the same
// functions the routes call:
//   signup: provisionClientForUser → runSiteSourceSteps (stubbed crawl +
//           Anthropic) → ensureSignupBrainDraft            → Brain 'draft'
//   upload: store.compileAndSaveClientBrainMarkdown(md, {reason:'inject'})
//           → brainSync.onBrainStatusChanged              (client-brain route)
//   approve: store.markClientBrainStatus('approved')
//           → brainSync.onBrainStatusChanged              (approve route)
// Asserts: adoption fills only EMPTY Brain sections from signup settings;
// non-empty uploaded sections win and are pushed back to the settings; a second
// approve is a no-op for adoption (adoption: null). brain-sync.cjs is called,
// never modified.

import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const { makeFakeContext } = require(path.join(ROOT, 'api/_lib/__tests__/fake-firestore.cjs'));

const fake = makeFakeContext({ deepMerge: true });
const fbPath = path.join(ROOT, 'api/_lib/firebase-admin.cjs');
require.cache[fbPath] = { id: fbPath, filename: fbPath, loaded: true, exports: fake };

const anthropicClient = require(path.join(ROOT, 'features/scout-intake/_anthropic-client.js'));
anthropicClient.callAnthropic = async () => ({
  usage: { input_tokens: 10, output_tokens: 10 },
  content: [{ type: 'tool_use', name: 'write_scout_config', input: {
    brandKeywords: ['"Acme"'], competitors: ['Signup Model Rival'], categoryTerms: ['widgets'], kols: [],
  } }],
});
globalThis.fetch = async (url) => { throw new Error(`network disabled in tests: ${url}`); };

const { provisionClientForUser } = require(path.join(ROOT, 'api/_lib/client-provisioning.cjs'));
const steps = require(path.join(ROOT, 'features/scout-intake/site-source-steps.js'));
const store = require(path.join(ROOT, 'features/client-brain/store.cjs'));
const brainSync = require(path.join(ROOT, 'features/client-brain/brain-sync.cjs'));
const { projectFields, MARKET_SIGNALS_FIELDS, BRAND_OVERVIEW_FIELDS } = brainSync;

const deps = {
  fb: fake,
  fetchSiteEvidence: async (url) => ({ url, pages: [{ type: 'homepage', url, title: 'Acme', siteMeta: { title: 'Acme Widgets', description: 'Widgets.' } }] }),
  ensureScoutConfig: require(path.join(ROOT, 'features/scout-intake/scout-config-generator.js')).ensureScoutConfig,
  buildUserContext: require(path.join(ROOT, 'features/scout-intake/user-context.js')).buildUserContext,
  buildSearchSeeds: require(path.join(ROOT, 'features/scout-intake/seed-extractor.js')).buildSearchSeeds,
  mergeMarketingBriefConfig: require(path.join(ROOT, 'features/scout-intake/marketing-brief-config-merger.js')).mergeMarketingBriefConfig,
  summarizeEvidencePages: require(path.join(ROOT, 'features/scout-intake/normalize.js')).summarizeEvidencePages,
  synthesizeBrandOverview: require(path.join(ROOT, 'features/scout-intake/brand-overview-synthesizer.js')).synthesizeBrandOverview,
  mergeBrandOverview: require(path.join(ROOT, 'features/scout-intake/brand-overview-merger.js')).mergeBrandOverview,
};

const SIGNUP = {
  xHandle: '@signupx',
  instagramHandle: '@signup.ig',
  competitors: ['@signupcomp'],
  goal: 'Signup goal positioning line',
};

let seq = 0;
async function signup() {
  seq += 1;
  const { clientId } = await provisionClientForUser({
    uid: `uidbrainwins${seq}xyz`, email: `o${seq}@acme.test`, companyName: `Acme Brain ${seq}`, websiteUrl: 'https://acme.test', ...SIGNUP,
  });
  const clientConfig = fake.adminDb._raw('client_configs', clientId);
  await steps.runSiteSourceSteps({ clientId, clientConfig, websiteUrl: clientConfig.sourceInputs.websiteUrl, brandOverviewUseModel: false, deps });
  const draft = await steps.ensureSignupBrainDraft(clientId);
  assert.equal(draft.status, 'draft');
  return clientId;
}

async function uploadAndApprove(clientId, markdown) {
  // client-brain route (inject): compile + status-changed hook.
  let brain = await store.compileAndSaveClientBrainMarkdown(clientId, markdown, { reason: 'inject' });
  const onInject = await brainSync.onBrainStatusChanged(clientId, brain);
  // approve route.
  brain = await store.markClientBrainStatus(clientId, 'approved');
  const onApprove = await brainSync.onBrainStatusChanged(clientId, brain);
  return { onInject, onApprove };
}

const brainDoc = (id) => fake.adminDb._raw(`clients/${id}/client_brain`, 'current');
const mbc = (id) => fake.adminDb._raw('client_configs', id).marketingBriefConfig;

test('HITLOOP fixture over a signup draft: non-empty Brain sections win, empty ones adopt signup settings', async () => {
  const clientId = await signup();
  const md = fs.readFileSync(path.join(ROOT, 'features/client-brain/__tests__/fixtures/hitloop-CLIENT_BRAIN.md'), 'utf8');
  const uploaded = projectFields(md, MARKET_SIGNALS_FIELDS).values;
  assert.equal(uploaded.brandXHandle, undefined, 'fixture has no X Handle (empty section)');
  assert.ok(uploaded.competitors.length > 0, 'fixture has Competitors (non-empty)');

  const { onInject, onApprove } = await uploadAndApprove(clientId, md);
  assert.equal(onInject.skipped, 'not-approved', 'inject of an unapproved Markdown never syncs');
  assert.ok(onApprove.adoption, 'first approve adopts');

  const adopted = onApprove.adoption.changes.map((c) => `${c.target}.${c.field}`);
  // Empty Brain sections took the signup settings…
  assert.ok(adopted.includes('marketingBrief.brandXHandle'));
  assert.ok(adopted.includes('marketingBrief.instagramHandles'));
  // …non-empty ones did not.
  assert.ok(!adopted.includes('marketingBrief.competitors'));
  assert.ok(!adopted.includes('brandOverview.positioning'));

  const brain = brainDoc(clientId);
  assert.equal(brain.status, 'approved');
  const after = projectFields(brain.markdownSource, MARKET_SIGNALS_FIELDS).values;
  assert.equal(after.brandXHandle, 'signupx');
  assert.ok(after.instagramHandles.some((h) => /signup\.ig/.test(h)));
  assert.deepEqual(after.competitors, uploaded.competitors, 'uploaded competitors unchanged');
  const bo = projectFields(brain.markdownSource, BRAND_OVERVIEW_FIELDS).values;
  assert.notEqual(bo.positioning, SIGNUP.goal, 'uploaded Positioning wins over the signup goal');

  // Sync pushed the Brain's non-empty values back over the signup-derived settings.
  const cfg = mbc(clientId);
  assert.deepEqual(cfg.competitors, after.competitors);
  assert.ok(!cfg.competitors.includes('signupcomp'));
  assert.equal(cfg.brandXHandle, 'signupx');
  const snapBo = fake.adminDb._raw('dashboard_state', clientId).snapshot.brandOverview;
  assert.equal(snapBo.positioning, bo.positioning);

  // Second approve: adoption already stamped → adoption: null.
  const again = await brainSync.onBrainStatusChanged(clientId, await store.markClientBrainStatus(clientId, 'approved'));
  assert.equal(again.adoption, null);
  assert.equal(brainDoc(clientId).markdownSource, brain.markdownSource, 'Markdown untouched by the second approve');
});

test('minimal upload with an EMPTY Positioning adopts the signup goal; its non-empty Competitors win', async () => {
  const clientId = await signup();
  const md = `---
clientId: ${clientId}
status: draft
---

# Client Brain

## Identity Intelligence

### Name
Acme Uploaded

## Market Intelligence

### Competitors
- Uploaded Rival
`;
  const { onApprove } = await uploadAndApprove(clientId, md);
  const adopted = onApprove.adoption.changes.map((c) => `${c.target}.${c.field}`);
  assert.ok(adopted.includes('brandOverview.positioning'));
  assert.ok(!adopted.includes('marketingBrief.competitors'));

  const brain = brainDoc(clientId);
  assert.equal(projectFields(brain.markdownSource, BRAND_OVERVIEW_FIELDS).values.positioning, SIGNUP.goal);
  assert.deepEqual(projectFields(brain.markdownSource, MARKET_SIGNALS_FIELDS).values.competitors, ['Uploaded Rival']);
  assert.deepEqual(mbc(clientId).competitors, ['Uploaded Rival']);

  const again = await brainSync.onBrainStatusChanged(clientId, await store.markClientBrainStatus(clientId, 'approved'));
  assert.equal(again.adoption, null);
});

test('pure adoptSettingsIntoMarkdown with signup-shaped store values', () => {
  const md = `---
status: approved
---

## Identity Intelligence

### Positioning
Brain positioning wins.

## Market Intelligence

### Competitors
- Brain Rival
`;
  const { markdown, changes } = brainSync.adoptSettingsIntoMarkdown(md, {
    marketingBrief: { brandXHandle: 'signupx', instagramHandles: ['signup.ig'], xGrowth: { ownHandle: 'signupx' }, competitors: ['signupcomp'] },
    brandOverview: { positioning: 'Signup goal', source: 'user' },
  });
  const fields = changes.map((c) => c.field);
  assert.ok(fields.includes('brandXHandle'));
  assert.ok(fields.includes('instagramHandles'));
  assert.ok(!fields.includes('competitors'));
  assert.ok(!fields.includes('positioning'));
  assert.match(markdown, /Brain positioning wins\./);
  assert.match(markdown, /- Brain Rival/);
  assert.doesNotMatch(markdown, /signupcomp|Signup goal/);
});
