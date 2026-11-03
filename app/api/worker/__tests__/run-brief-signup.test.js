// Phase 2b.2–2b.4 — the signup run's source steps + Client Brain draft.
//
// The run-brief route itself (next/server, ESM, auth, run lifecycle) is not
// imported; its signup-only work is extracted into
// features/scout-intake/site-source-steps.js, which this test drives with the
// REAL scout-config generator, brand-overview synthesizer/merger,
// marketing-brief-config merger, seed extractor, usage logger and Client Brain
// store — against the in-memory fake Firestore (deep-merge mode), with the
// Anthropic client and the site crawl stubbed. A guard on global fetch proves
// no network call (X, ScrapeCreators, Anthropic, anything) is made.
//
// Signup budget: these steps make exactly 1 Anthropic call (scout-config);
// the route's onboarding summary (generateBriefSummaries, briefTypes
// ['onboarding']) is the 2nd and last.

import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../../..');
const { makeFakeContext } = require(path.join(ROOT, 'api/_lib/__tests__/fake-firestore.cjs'));

// ── Fakes: Firestore (whole module graph), Anthropic, network ────────────────
const fake = makeFakeContext({ deepMerge: true });
const fbPath = path.join(ROOT, 'api/_lib/firebase-admin.cjs');
require.cache[fbPath] = { id: fbPath, filename: fbPath, loaded: true, exports: fake };

const anthropicCalls = [];
const anthropicClient = require(path.join(ROOT, 'features/scout-intake/_anthropic-client.js'));
anthropicClient.callAnthropic = async (params) => {
  const toolName = params?.tools?.[0]?.name || params?.tool_choice?.name || null;
  anthropicCalls.push(toolName);
  const usage = { input_tokens: 1000, output_tokens: 200 };
  if (toolName === 'fill_brand_overview') {
    return {
      usage,
      content: [{ type: 'tool_use', name: 'fill_brand_overview', input: {
        headline: 'MODEL headline', summary: 'MODEL summary', industry: 'Widgets', businessModel: 'MODEL bm', targetAudience: 'MODEL aud', positioning: 'MODEL positioning',
      } }],
    };
  }
  return {
    usage,
    content: [{ type: 'tool_use', name: 'write_scout_config', input: {
      clientType: 'business',
      brandKeywords: ['"Acme"', 'acme.test'],
      competitors: ['Widgetco', 'Gizmo Inc'],
      categoryTerms: ['team widgets'],
      kols: [],
      reddit: { subreddits: ['smallbusiness'] },
      scout: { sourceFocus: 'widgets', searchPlan: [{ label: 'BRAND', query: 'acme widgets', goal: 'mentions' }] },
    } }],
  };
};

const networkCalls = [];
globalThis.fetch = async (url) => {
  networkCalls.push(String(url));
  throw new Error(`network disabled in tests: ${url}`);
};

const { provisionClientForUser } = require(path.join(ROOT, 'api/_lib/client-provisioning.cjs'));
const steps = require(path.join(ROOT, 'features/scout-intake/site-source-steps.js'));
const realDeps = {
  fb: fake,
  fetchSiteEvidence: async (url) => ({
    url,
    pages: [{
      type: 'homepage',
      url,
      title: 'Acme Widgets',
      metaDescription: 'Widgets for small teams.',
      h1: ['Acme Widgets'],
      h2: ['Why Acme'],
      bodyParagraphs: ['We build widgets for small teams.'],
      siteMeta: { title: 'Acme — Widgets for small teams', description: 'Widgets for small teams.' },
    }],
  }),
  ensureScoutConfig: require(path.join(ROOT, 'features/scout-intake/scout-config-generator.js')).ensureScoutConfig,
  buildUserContext: require(path.join(ROOT, 'features/scout-intake/user-context.js')).buildUserContext,
  buildSearchSeeds: require(path.join(ROOT, 'features/scout-intake/seed-extractor.js')).buildSearchSeeds,
  mergeMarketingBriefConfig: require(path.join(ROOT, 'features/scout-intake/marketing-brief-config-merger.js')).mergeMarketingBriefConfig,
  summarizeEvidencePages: require(path.join(ROOT, 'features/scout-intake/normalize.js')).summarizeEvidencePages,
  synthesizeBrandOverview: require(path.join(ROOT, 'features/scout-intake/brand-overview-synthesizer.js')).synthesizeBrandOverview,
  mergeBrandOverview: require(path.join(ROOT, 'features/scout-intake/brand-overview-merger.js')).mergeBrandOverview,
};

let uidSeq = 0;
async function provision(extra = {}) {
  uidSeq += 1;
  const uid = `uidsignup${String(uidSeq).padStart(4, '0')}xyz`;
  const { clientId } = await provisionClientForUser({
    uid, email: `owner${uidSeq}@acme.test`, companyName: `Acme ${uidSeq}`, websiteUrl: 'https://acme.test', ...extra,
  });
  const clientConfig = fake.adminDb._raw('client_configs', clientId);
  return { clientId, clientConfig };
}

// Mirrors the route's signup sequence (minus modules/summary/lifecycle).
async function runSignupSteps(clientId, clientConfig) {
  const out = await steps.runSiteSourceSteps({
    clientId,
    clientConfig,
    websiteUrl: clientConfig.sourceInputs.websiteUrl,
    force: false,
    brandOverviewUseModel: false, // trigger === 'signup'
    deps: realDeps,
  });
  const draft = await steps.ensureSignupBrainDraft(clientId);
  return { out, draft };
}

function usageEventsFor(clientId) {
  const map = fake.adminDb._store.get('usage_events') || new Map();
  return [...map.values()].filter((e) => e.clientId === clientId);
}

test('signup populates sources + settings, seeds scoutConfig from the form, 1 Anthropic call, no network', async () => {
  anthropicCalls.length = 0;
  networkCalls.length = 0;
  const { clientId, clientConfig } = await provision({
    xHandle: '@acmehq',
    instagramHandle: 'acme.ig',
    competitors: ['https://rival.example', '@seedco'],
    goal: 'The widget shop small teams trust',
  });

  const { out, draft } = await runSignupSteps(clientId, clientConfig);

  // Budget: only the scout-config call; brand overview stayed deterministic.
  assert.deepEqual(anthropicCalls, ['write_scout_config']);
  assert.equal(networkCalls.length, 0, `unexpected network: ${networkCalls.join(', ')}`);
  const events = usageEventsFor(clientId);
  assert.equal(events.length, 1, 'one usage_events row, attributed to the client');
  assert.equal(events[0].action, 'scout-config');
  assert.equal(out.stageCosts.length, 1);
  assert.equal(out.stageCosts[0].stage, 'scout-config');

  const cfg = fake.adminDb._raw('client_configs', clientId);
  // scoutConfig: form competitors first, then the model's.
  assert.deepEqual(cfg.scoutConfig.competitors.slice(0, 2), ['rival.example', 'seedco']);
  assert.ok(cfg.scoutConfig.competitors.includes('Widgetco'));
  assert.ok(cfg.scoutConfig.brandKeywords.includes('acme.test'));
  assert.equal(cfg.scoutConfig._meta.websiteUrl, 'https://acme.test/');

  // marketingBriefConfig: audit seeded AND the signup settings survived.
  const mbc = cfg.marketingBriefConfig;
  assert.equal(mbc.enabled, true);
  assert.equal(mbc.brandXHandle, 'acmehq');
  assert.deepEqual(mbc.instagramHandles, ['acme.ig']);
  assert.equal(mbc.xGrowth.ownHandle, 'acmehq');
  assert.ok(mbc.competitors.includes('seedco'));
  assert.ok(mbc.auditSeed, 'auditSeed recorded for next-run provenance');

  // dashboard_state: evidence + deterministic brand overview; the signup goal fills the empty positioning and the
  // result is a normal crawl (not frozen as 'user'), so later crawls can refresh it.
  const dash = fake.adminDb._raw('dashboard_state', clientId);
  assert.ok(dash.evidence, 'evidence summary written');
  const bo = dash.snapshot.brandOverview;
  assert.equal(bo.positioning, 'The widget shop small teams trust');
  assert.equal(bo.source, 'crawl');
  assert.equal(bo.headline, 'Acme — Widgets for small teams', 'headline from OG meta, not the model');
  assert.ok(!JSON.stringify(bo).includes('MODEL'), 'no model output at signup');

  // Brain draft: created, status draft, no Markdown written.
  assert.deepEqual(draft, { created: true, status: 'draft' });
  const brain = fake.adminDb._raw(`clients/${clientId}/client_brain`, 'current');
  assert.equal(brain.status, 'draft');
  assert.ok(!brain.markdownSource, 'signup never writes Brain Markdown');
  assert.equal(brain.approvedAt, undefined);
});

test('second signup run: Brain draft skipped, cached scoutConfig reused (0 Anthropic calls), seeds never re-applied', async () => {
  const { clientId, clientConfig } = await provision({ competitors: ['@firstseed'] });
  await runSignupSteps(clientId, clientConfig);
  const brainBefore = fake.adminDb._raw(`clients/${clientId}/client_brain`, 'current');

  // Owner edits scoutConfig competitors; a re-run must not overwrite them from seeds.
  const cfg = fake.adminDb._raw('client_configs', clientId);
  fake.adminDb._patch('client_configs', clientId, { scoutConfig: { ...cfg.scoutConfig, competitors: ['Owner Pick'] } });

  anthropicCalls.length = 0;
  const { draft } = await runSignupSteps(clientId, fake.adminDb._raw('client_configs', clientId));
  assert.deepEqual(draft, { created: false, skipped: 'exists' });
  assert.deepEqual(anthropicCalls, []);
  assert.deepEqual(fake.adminDb._raw('client_configs', clientId).scoutConfig.competitors, ['Owner Pick']);
  assert.equal(fake.adminDb._raw(`clients/${clientId}/client_brain`, 'current').updatedAtIso, brainBefore.updatedAtIso);
});

test('URL-only signup (no optional fields) still gets sources + a draft Brain', async () => {
  anthropicCalls.length = 0;
  const { clientId, clientConfig } = await provision();
  assert.equal(clientConfig.onboardingAnswers, null);
  const { draft } = await runSignupSteps(clientId, clientConfig);
  assert.deepEqual(anthropicCalls, ['write_scout_config']);
  const cfg = fake.adminDb._raw('client_configs', clientId);
  assert.deepEqual(cfg.scoutConfig.competitors, ['Widgetco', 'Gizmo Inc']);
  assert.equal(cfg.marketingBriefConfig.enabled, true);
  assert.equal(fake.adminDb._raw('dashboard_state', clientId).snapshot.brandOverview.source, 'crawl');
  assert.equal(draft.status, 'draft');
});

test('non-signup triggers keep the model brand overview (2 calls) — option is signup-only', async () => {
  anthropicCalls.length = 0;
  const { clientId, clientConfig } = await provision();
  await steps.runSiteSourceSteps({
    clientId, clientConfig, websiteUrl: clientConfig.sourceInputs.websiteUrl, deps: realDeps,
  });
  assert.deepEqual(anthropicCalls, ['write_scout_config', 'fill_brand_overview']);
  assert.equal(fake.adminDb._raw('dashboard_state', clientId).snapshot.brandOverview.positioning, 'MODEL positioning');
  const events = usageEventsFor(clientId);
  assert.deepEqual(events.map((e) => e.action).sort(), ['brand-overview', 'scout-config'], 'brand-overview call now logged with the clientId');
});

test('Brain draft failure never throws (signup run continues)', async () => {
  const res = await steps.ensureSignupBrainDraft('c-broken', {
    store: { readClientBrainDoc: async () => { throw new Error('firestore down'); } },
  });
  assert.equal(res.created, false);
  assert.match(res.error, /firestore down/);
});

test('route wiring: signup runs the source steps with a deterministic brand overview and drafts the Brain', () => {
  const src = fs.readFileSync(path.join(ROOT, 'app/api/worker/run-brief/route.js'), 'utf8');
  assert.match(src, /if \(ownSiteUrl && claimedRun\.trigger !== 'creative-brief' && signupStepOn\('siteSources'\)\)/);
  assert.match(src, /brandOverviewUseModel: claimedRun\.trigger !== 'signup'/);
  assert.match(src, /if \(claimedRun\.trigger !== 'signup' \|\| !signupStepOn\('brainDraft'\)\) return;\s*const \{ ensureSignupBrainDraft \}/);
  // The draft runs on BOTH paths: before the failed-return and after the onboarding summary on success.
  assert.match(src, /if \(pipelineResult\.status === 'failed'\) \{\s*await ensureSignupDraft\(\);/);
  assert.ok(src.indexOf('await ensureSignupDraft();\n\n  await completeRun(') > -1, 'success-path draft precedes completeRun');
  // Signup modules follow client_configs.onboardingSteps (absent = both modules).
  assert.match(src, /\? signupModuleIds\(clientConfig\?\.onboardingSteps\)\s*: \['multi-device-view', 'social-preview'\]/);
  // Admin-chosen onboarding steps gate only the signup trigger.
  assert.match(src, /claimedRun\.trigger !== 'signup' \|\| isOnboardingStepEnabled\(clientConfig\?\.onboardingSteps, key\)/);
  assert.match(src, /if \(!signupStepOn\('motionVideo'\)\)/);
  assert.match(src, /claimedRun\.trigger === 'signup'\) && signupStepOn\('briefSummary'\)\)/);
  // Signup never chains the scout-brief (market signals) run.
  assert.match(src, /claimedRun\.trigger === 'brief-refresh' \|\| claimedRun\.trigger === 'reseed'\)\) \{\s*const chainSourceUrl/);
});

test('retry after a half-finished draft: an existing generated (non-Markdown) Brain is marked draft; others untouched', async () => {
  const marks = [];
  const mkStore = (doc) => ({
    readClientBrainDoc: async () => doc,
    generateAndSaveClientBrain: async () => { throw new Error('must not regenerate'); },
    markClientBrainStatus: async (id, status) => { marks.push([id, status]); return { status }; },
  });
  const half = await steps.ensureSignupBrainDraft('c-half', { store: mkStore({ status: 'generated' }) });
  assert.deepEqual([half.skipped, half.status], ['exists', 'draft']);
  for (const doc of [{ status: 'generated', markdownSource: '# injected' }, { status: 'approved' }, { status: 'draft' }]) {
    const res = await steps.ensureSignupBrainDraft('c-other', { store: mkStore(doc) });
    assert.equal(res.skipped, 'exists');
  }
  assert.deepEqual(marks, [['c-half', 'draft']]);
});
