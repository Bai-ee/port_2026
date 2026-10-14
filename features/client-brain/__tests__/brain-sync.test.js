import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  projectMarketSignals,
  applyCardEditsToMarkdown,
  changedManifestFields,
  buildScoutConfigMirror,
  MANIFEST_KEYS,
} from '../brain-sync.cjs';
import { compileClientBrainMarkdown, setMarkdownField, setFrontmatterValues, parseFrontmatter } from '../markdown.cjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const HITLOOP = fs.readFileSync(path.join(ROOT, 'features/client-brain/__tests__/fixtures/hitloop-CLIENT_BRAIN.md'), 'utf8');

const MINIMAL = `---
clientId: acme
status: approved
---

# Client Brain

## Identity Intelligence

### Name
Acme

### Positioning
Acme makes widgets.

## Market Intelligence

### Competitors
- Widgetco

## Decision Drivers

### Own Widgets
Own:
- widgets
`;

test('projection fills every Market Signals field the HITLOOP Brain can supply', () => {
  const { values, origin } = projectMarketSignals(HITLOOP);
  assert.equal(values.brandName, 'HITLOOP');
  assert.equal(values.brandKeywords.length, 12);
  assert.equal(values.categoryTerms.length, 12);
  assert.ok(values.kols.length > 0 && values.kols.length <= 20);
  assert.ok(values.competitors.length > 0 && values.competitors.length <= 20);
  // Brain lists linkedin/producthunt; the card only supports its allowed set.
  assert.ok(values.sourcePlatforms.every((p) => ['web', 'x', 'reddit', 'instagram', 'youtube', 'tiktok', 'hackernews'].includes(p)));
  assert.equal(origin.searches, 'derived');
  assert.deepEqual(values.searches.map((r) => r.label), ['BRAND', 'CATEGORY', 'COMPETITORS']);
  assert.equal(origin.sourceFocus, 'derived');
  assert.equal('brandXHandle' in values, false, 'absent Brain field is omitted, never blanked');
});

test('projection omits fields the Brain has nothing for', () => {
  const { values } = projectMarketSignals(MINIMAL);
  assert.deepEqual(Object.keys(values).sort(), ['brandName', 'competitors', 'guardianReviewerContext', 'searches', 'sourceFocus']);
});

test('card edit rewrites the home section and round-trips through projection', () => {
  const { values } = projectMarketSignals(HITLOOP);
  const kols = ['@newhandle', ...values.kols.slice(1)];
  const { markdown, changed } = applyCardEditsToMarkdown(HITLOOP, { kols });
  assert.deepEqual(changed, ['kols']);
  assert.deepEqual(projectMarketSignals(markdown).values.kols, kols);
  // Untouched fields are unchanged.
  const after = projectMarketSignals(markdown).values;
  for (const key of MANIFEST_KEYS.filter((k) => k !== 'kols')) assert.deepEqual(after[key], values[key], key);
});

test('write-back keeps Brain items the card could not show', () => {
  const { values, raw } = projectMarketSignals(HITLOOP);
  assert.ok(raw.brandKeywords.length > 12, 'fixture has more keywords than the card cap');
  const edited = values.brandKeywords.slice(1); // operator removes the first keyword
  const { markdown } = applyCardEditsToMarkdown(HITLOOP, { brandKeywords: edited });
  const next = projectMarketSignals(markdown);
  assert.equal(next.raw.brandKeywords.length, raw.brandKeywords.length - 1);
  assert.ok(!next.raw.brandKeywords.includes(values.brandKeywords[0]));
  // Unsupported platforms survive a platform edit.
  const { markdown: md2 } = applyCardEditsToMarkdown(HITLOOP, { sourcePlatforms: ['web', 'x'] });
  const platforms = projectMarketSignals(md2).raw.sourcePlatforms;
  assert.ok(platforms.includes('linkedin') && platforms.includes('producthunt'));
  assert.deepEqual(projectMarketSignals(md2).values.sourcePlatforms, ['web', 'x']);
});

test('unchanged values and clearing a derived field write nothing', () => {
  const { values } = projectMarketSignals(HITLOOP);
  assert.deepEqual(applyCardEditsToMarkdown(HITLOOP, values).changed, []);
  assert.deepEqual(applyCardEditsToMarkdown(MINIMAL, { brandXHandle: '' }).changed, []);
});

test('new fields get a home section that compiles', () => {
  const { markdown, changed } = applyCardEditsToMarkdown(MINIMAL, {
    brandXHandle: '@acme',
    instagramHandles: ['acmeco'],
    searches: [{ label: 'BRAND', query: '"acme widgets" OR site:acme.com', goal: 'mentions' }],
    sourceFocus: 'Widget buyers in the midwest.',
  });
  assert.deepEqual(changed.sort(), ['brandXHandle', 'instagramHandles', 'searches', 'sourceFocus']);
  const compiled = compileClientBrainMarkdown(markdown);
  assert.equal(compiled.identity.xHandle, 'acme');
  assert.deepEqual(compiled.discovery.instagramHandles, ['acmeco']);
  assert.deepEqual(compiled.discovery.searchQueries, [{ label: 'BRAND', query: '"acme widgets" OR site:acme.com', goal: 'mentions' }]);
  assert.equal(compiled.discovery.sourceFocus, 'Widget buyers in the midwest.');
  // New Discovery section went in before Decision Drivers, which still parse.
  assert.ok(markdown.indexOf('## Discovery Intelligence') < markdown.indexOf('## Decision Drivers'));
  assert.equal(compiled.decisions.decisionDrivers[0].label, 'Own Widgets');
});

test('changedManifestFields only reports fields the operator changed', () => {
  const prior = { brandName: 'Acme', kols: ['@a', '@b'], weather: { zip: '1' } };
  assert.deepEqual(changedManifestFields(prior, { ...prior, weather: { zip: '2' } }), {});
  assert.deepEqual(changedManifestFields(prior, { ...prior, kols: ['@a'] }), { kols: ['@a'] });
});

test('setMarkdownField replaces only the target field', () => {
  const md = setMarkdownField(MINIMAL, { section: 'Market Intelligence', field: 'Competitors' }, '- Gadgetco');
  assert.match(md, /### Competitors\n- Gadgetco\n/);
  assert.doesNotMatch(md, /Widgetco/);
  assert.match(md, /### Positioning\nAcme makes widgets\./);
});

test('setFrontmatterValues keeps approval in the Markdown', () => {
  const md = setFrontmatterValues(MINIMAL.replace('status: approved', 'status: draft'), { status: 'approved', updatedAt: '2026-10-13' });
  const { frontmatter } = parseFrontmatter(md);
  assert.equal(frontmatter.status, 'approved');
  assert.equal(frontmatter.updatedAt, '2026-10-13');
  assert.equal(compileClientBrainMarkdown(md).status, 'approved');
});

test('scoutConfig mirror matches the route rules', () => {
  const cfg = { brandName: 'Acme', brandKeywords: ['acme widgets', 'acme'], categoryTerms: ['widgets'] };
  assert.deepEqual(buildScoutConfigMirror(cfg, { priorScoutConfig: { reddit: {} } }), {
    brandKeywords: ['"acme widgets"', 'acme'],
    categoryTerms: ['widgets'],
    clientName: 'Acme',
    reddit: { mentionQueries: ['"acme widgets"', 'acme'] },
  });
  assert.equal(buildScoutConfigMirror(cfg, { priorSourceWebsiteUrl: 'https://acme.com' }), null);
});

/* ------------------------------------------------ Phase 2: voice, digest, brand overview */

import { TARGETS, projectFields, planTargetWrite } from '../brain-sync.cjs';

test('voice + guard fields project from Content / Authority sections', () => {
  const { values, origin } = projectMarketSignals(HITLOOP);
  assert.match(values.scribeTone, /^Direct, systems-minded/);
  assert.ok(values.guardianRestrictedPatterns.includes('Guaranteed growth'));
  // No Hard Constraints / Reviewer Context sections yet -> derived.
  assert.equal(origin.scribeHardConstraints, 'derived');
  assert.ok(values.scribeHardConstraints.includes('revolutionary'));
  assert.equal(origin.guardianReviewerContext, 'derived');
  assert.match(values.guardianReviewerContext, /^HITLOOP: HITLOOP is a human-in-the-loop/);
  assert.equal('scoutInstructions' in values, false);
});

test('digest + brand overview project from the Brain', () => {
  const digest = projectFields(HITLOOP, TARGETS.digest);
  assert.equal(digest.values.tone, 'Direct, systems-minded, concrete, and operator-led');
  assert.equal(digest.origin.tone, 'derived');
  const bo = projectFields(HITLOOP, TARGETS.brandOverview).values;
  assert.match(bo.positioning, /^HITLOOP is a human-in-the-loop/);
  assert.match(bo.targetAudience, /^Startup founders, AI SaaS teams/);
  assert.match(bo.headline, /^HITLOOP turns client information/);
  assert.match(bo.summary, /scattered client information/);
  assert.equal(bo.industry, 'Human-in-the-loop creative systems');
});

test('derived values fill empty fields only; the digest default tone counts as empty', () => {
  const tuned = planTargetWrite(TARGETS.digest, HITLOOP, { tone: 'warm and brief' });
  assert.equal('tone' in tuned.values, false);
  const fresh = planTargetWrite(TARGETS.digest, HITLOOP, { tone: 'concise, professional, direct' });
  assert.equal(fresh.values.tone, 'Direct, systems-minded, concrete, and operator-led');
  const ms = planTargetWrite(TARGETS.marketingBrief, HITLOOP, { searches: [{ label: 'X', query: 'tuned', goal: '' }] });
  assert.equal('searches' in ms.values, false);
  assert.ok(ms.diff.some((d) => d.field === 'kols'));
});

test('brand overview audience edit writes a bullet list home section', () => {
  const { markdown, changed } = applyCardEditsToMarkdown(HITLOOP, { targetAudience: 'Founders, Agencies; Product teams' }, TARGETS.brandOverview);
  assert.deepEqual(changed, ['targetAudience']);
  assert.match(markdown, /### Primary Audience\n- Founders\n- Agencies\n- Product teams\n/);
  assert.deepEqual(compileClientBrainMarkdown(markdown).audience.primary, ['Founders', 'Agencies', 'Product teams']);
});

test('digest default tone is not written into the Brain', () => {
  assert.deepEqual(applyCardEditsToMarkdown(MINIMAL, { tone: 'concise, professional, direct' }, TARGETS.digest).changed, []);
  const { changed, markdown } = applyCardEditsToMarkdown(MINIMAL, { contactUrl: 'https://cal.com/acme' }, TARGETS.digest);
  assert.deepEqual(changed, ['contactUrl']);
  assert.match(markdown, /### Contact Url\nhttps:\/\/cal\.com\/acme/);
});

test('hard constraints keep commas inside a bullet', () => {
  const rule = 'Never name clients, partners, or prices';
  const { markdown } = applyCardEditsToMarkdown(MINIMAL, { scribeHardConstraints: [rule] });
  assert.deepEqual(projectMarketSignals(markdown).values.scribeHardConstraints, [rule]);
});

/* ------------------------------------------------ one-time settings adoption */

import { adoptSettingsIntoMarkdown } from '../brain-sync.cjs';

test('adoption fills only empty Brain sections; where the Brain has a value the Brain wins', () => {
  const settings = {
    marketingBrief: {
      kols: ['@tuned_one', '@tuned_two'], // Brain has Watch Lists: Brain wins
      guardianRestrictedPatterns: ['insured and bonded'], // Brain has Prohibited Claims: Brain wins
      sourcePlatforms: ['web', 'reddit'], // Brain has Primary Platforms: Brain wins
      searches: [{ label: 'LOCAL', query: '"dog walker" brooklyn', goal: 'leads' }], // Brain only derives: adopted
      brandName: 'Tuned name', // Brain has Name: Brain wins
    },
    digest: { tone: 'concise, professional, direct' }, // stock default: not adopted
    brandOverview: { headline: 'Tuned headline' }, // Brain has Strategic One-Liner: Brain wins
  };
  const { markdown, changes } = adoptSettingsIntoMarkdown(HITLOOP, settings);
  assert.deepEqual(changes.map((c) => `${c.target}.${c.field}`), ['marketingBrief.searches']);
  // The adopted field now syncs back unchanged; Brain-owned values are pushed to the card.
  const { diff } = planTargetWrite(TARGETS.marketingBrief, markdown, settings.marketingBrief);
  const fields = diff.map((d) => d.field);
  assert.equal(fields.includes('searches'), false);
  for (const f of ['kols', 'guardianRestrictedPatterns', 'sourcePlatforms', 'brandName']) assert.ok(fields.includes(f), f);
  const head = planTargetWrite(TARGETS.brandOverview, markdown, settings.brandOverview).diff.find((d) => d.field === 'headline');
  assert.ok(head && head.to !== 'Tuned headline');
  // Brain items the card can't show stay in the Brain.
  assert.ok(projectMarketSignals(markdown).raw.sourcePlatforms.includes('linkedin'));
});

test('adoption keeps comma-containing settings items whole in an empty section', () => {
  const rules = ['Zero live signal = create useful or local signal, not vague filler', 'No prices'];
  const settings = { marketingBrief: { scribeHardConstraints: rules, brandKeywords: ['acme', 'acme widgets'] } };
  const { markdown, changes } = adoptSettingsIntoMarkdown(HITLOOP, settings);
  assert.deepEqual(changes.map((c) => c.field), ['scribeHardConstraints']); // Keywords exist in the Brain: Brain wins
  assert.deepEqual(projectMarketSignals(markdown).values.scribeHardConstraints, rules);
  assert.notDeepEqual(projectMarketSignals(markdown).values.brandKeywords, ['acme', 'acme widgets']);
});

/* ------------------------------------------------ Phase 3a: opportunity, X profile, Strategy Builder */

test('Strategy Builder fields project from the Brain', () => {
  const { values, origin } = projectFields(HITLOOP, TARGETS.strategyBuilder);
  assert.equal(values.vertical, 'Human-in-the-loop creative systems');
  assert.equal(values['campaign.ctaText'], 'Build your Client Brain');
  assert.equal(values['campaign.ctaUrl'], 'https://hitloop.agency');
  assert.equal(origin['campaign.ctaUrl'], 'derived');
  assert.match(values['campaign.guardrails'], /^revolutionary\ngame-changing/);
  assert.ok(values['editorial.operatorPreferences.avoidTopics'].includes('generic AI hype'));
  assert.ok(values['editorial.operatorPreferences.preferredNarratives'].includes('Client Brain as decision engine'));
});

test('dotted fields compare against nested store values', () => {
  const current = { campaign: { ctaText: 'Build your Client Brain' }, vertical: 'Human-in-the-loop creative systems' };
  const { diff } = planTargetWrite(TARGETS.strategyBuilder, HITLOOP, current);
  assert.equal(diff.some((d) => d.field === 'campaign.ctaText' || d.field === 'vertical'), false);
  assert.deepEqual(changedManifestFields(current, { ...current, campaign: { ctaText: 'Book a call' } }, TARGETS.strategyBuilder), { 'campaign.ctaText': 'Book a call' });
});

test('CTA edit replaces only the first Calls To Action item', () => {
  const { markdown, changed } = applyCardEditsToMarkdown(HITLOOP, { 'campaign.ctaText': 'Book a call' }, TARGETS.strategyBuilder);
  assert.deepEqual(changed, ['campaign.ctaText']);
  const ctas = compileClientBrainMarkdown(markdown).offers.callsToAction;
  assert.equal(ctas[0], 'Book a call');
  assert.ok(ctas.length > 1, 'remaining CTAs kept');
});

test('opportunity query rows round-trip, keeping a disabled row disabled', () => {
  const queries = [
    { label: 'Hiring', query: '"looking for a designer" OR "need an agency"', enabled: true },
    { label: 'Launch', query: '"launching" OR "new site"', enabled: false },
  ];
  const { markdown } = applyCardEditsToMarkdown(MINIMAL, { 'opportunitySignals.queries': queries });
  assert.match(markdown, /### Opportunity Queries\n- label: Hiring \| query: "looking for a designer" OR "need an agency"\n- label: Launch \| query: "launching" OR "new site" \| enabled: false/);
  assert.deepEqual(projectMarketSignals(markdown).values['opportunitySignals.queries'], queries);
});

test('X profile handles share the X Handle home and normalize like the profile', () => {
  const { markdown } = applyCardEditsToMarkdown(MINIMAL, { 'xGrowth.ownHandle': '@Acme_Co', 'xGrowth.benchmarkHandles': ['@seb__design', 'https://x.com/levelsio'] });
  const v = projectMarketSignals(markdown).values;
  assert.equal(v['xGrowth.ownHandle'], 'Acme_Co');
  assert.equal(v.brandXHandle, 'Acme_Co');
  assert.deepEqual(v['xGrowth.benchmarkHandles'], ['seb__design', 'levelsio']);
});

/* ---------------------------------------------- strategy doc + tracks (3b/6b) */

const sync = await import('../brain-sync.cjs');
const { STRATEGY_DOC_SECTIONS } = await import('../../x-strategy/strategy-doc.js');
const { createMemoryPlanStore } = await import('../../x-strategy/plan-store.js');
const { twoTracks } = await import('../../x-strategy/__tests__/fixtures/two-tracks.js');
const { tracksOf } = await import('../../x-strategy/content-tracks.js');
const { mergeEngineConfig } = await import('../../x-content-inventory/engine-quota.js');
const mods = { tracksOf, mergeEngineConfig };
const BRAIN_X = `${MINIMAL}
## Strategy Document

### Thesis
Show the work, not the casino.

### Open questions
Does video beat text?

## Content Intelligence

### Content Tracks
- label: Design & client work | share: 60% | topics: branding; web3 | benchmarks: @Seb__Design
- label: Music (UE mixes, Discogs) | share: 0.4 | benchmarks: djx

### Track Targets
- track: Design & client work | postsPerDay: 2 | original-showcase: 30 | reply: 30 | video: 40
`;

test('strategy doc manifest mirrors the doc sections', () => {
  assert.deepEqual(sync.STRATEGY_DOC_FIELDS.map((f) => [f.key, f.field]), STRATEGY_DOC_SECTIONS.map((s) => [s.key, s.title]));
});

test('projects strategy doc, tracks and track targets from Markdown', () => {
  const doc = sync.projectFields(BRAIN_X, sync.STRATEGY_DOC_FIELDS).values;
  assert.equal(doc.thesis, 'Show the work, not the casino.');
  assert.equal(doc.open, 'Does video beat text?');
  assert.equal(doc.rules, undefined);
  const tracks = sync.projectFields(BRAIN_X, sync.CONTENT_TRACKS_FIELDS).values.contentTracks;
  assert.deepEqual(tracks[0], { label: 'Design & client work', share: 0.6, topics: ['branding', 'web3'], benchmarks: ['seb__design'] });
  assert.equal(tracks[1].share, 0.4);
  const targets = sync.projectFields(BRAIN_X, sync.TRACK_TARGETS_FIELDS).values.trackTargets;
  assert.equal(targets[0].postsPerDay, 2);
  assert.equal(targets[0].video, 40);
});

test('track write-back round-trips and keeps Brain-only target shares', () => {
  const edits = { contentTracks: [{ label: 'Design & client work', share: 0.7, topics: ['branding'], benchmarks: ['seb__design'] }] };
  const out = sync.applyCardEditsToMarkdown(BRAIN_X, edits, sync.CONTENT_TRACKS_FIELDS);
  assert.deepEqual(out.changed, ['contentTracks']);
  assert.match(out.markdown, /label: Design & client work \| share: 70% \| topics: branding \| benchmarks: seb__design/);
  const t = sync.applyCardEditsToMarkdown(BRAIN_X, { trackTargets: [{ track: 'Design & client work', postsPerDay: 3 }] }, sync.TRACK_TARGETS_FIELDS);
  assert.match(t.markdown, /postsPerDay: 3 \| original-showcase: 30 \| reply: 30 \| video: 40/);
  // Same mapped value => no edit, the unmapped shares are not treated as a difference.
  assert.deepEqual(sync.applyCardEditsToMarkdown(BRAIN_X, { trackTargets: [{ track: 'design & client work', postsPerDay: 2 }] }, sync.TRACK_TARGETS_FIELDS).changed, []);
});

// The client's own stored tracks (code has no default tracks since multi-client 4.7).
async function storeWithTracks() {
  const store = createMemoryPlanStore();
  await store.apply('c1', { changes: { contentTracks: twoTracks() }, by: 'owner', source: 'manual', reason: 'fixture', expectedVersion: 0 });
  return store;
}

test('writeBrainTracksToPlan with no stored tracks: nothing written, warned (Brain rows carry no engines)', async () => {
  const store = createMemoryPlanStore();
  const rows = sync.projectFields(BRAIN_X, sync.CONTENT_TRACKS_FIELDS).values.contentTracks;
  const res = await sync.writeBrainTracksToPlan(store, 'c1', rows, mods);
  assert.equal(res.warnings.some((w) => /Every engine must belong to a track/.test(w)), true);
  assert.equal(await store.get('c1'), null);
});

test('writeBrainTracksToPlan merges by label, keeps engines/promotions, versions with the actor', async () => {
  const store = await storeWithTracks();
  const rows = sync.projectFields(BRAIN_X, sync.CONTENT_TRACKS_FIELDS).values.contentTracks;
  const res = await sync.writeBrainTracksToPlan(store, 'c1', rows, mods);
  assert.deepEqual(res.warnings, []);
  const doc = await store.get('c1');
  const design = doc.plan.contentTracks.find((t) => t.id === 'design');
  assert.deepEqual(design.topics, ['branding', 'web3']);
  assert.deepEqual(design.engines, ['client', 'identity']);
  assert.equal(design.promotions.length, 1);
  assert.equal(doc.updatedBy, 'client-brain');
});

test('writeBrainTracksToPlan keeps the plan and warns when the result is invalid', async () => {
  const store = createMemoryPlanStore();
  const res = await sync.writeBrainTracksToPlan(store, 'c1', [{ label: 'Design & client work', share: 0.5, topics: [], benchmarks: ['bad handle!'] }], mods);
  assert.equal(res.warnings.length > 0, true);
  assert.equal(await store.get('c1'), null);
});

test('writeBrainTargetsToPlan maps postsPerDay onto engines and the daily total', async () => {
  const store = await storeWithTracks();
  await sync.writeBrainTracksToPlan(store, 'c1', sync.projectFields(BRAIN_X, sync.CONTENT_TRACKS_FIELDS).values.contentTracks, mods);
  const rows = [{ track: 'Design & client work', postsPerDay: 2 }, { track: 'Music (UE mixes, Discogs)', postsPerDay: 2 }, { track: 'Nope', postsPerDay: 1 }];
  const res = await sync.writeBrainTargetsToPlan(store, 'c1', rows, mods);
  assert.equal(res.warnings.some((w) => /no track named "Nope"/.test(w)), true);
  const { plan } = await store.get('c1');
  assert.equal(plan.authoredPerDay, 4);
  assert.equal(typeof plan.engineTargets.engines.identity.targetPerDay, 'number');
  assert.equal(sync.trackTargetsFromPlan(await store.get('c1'), mods).length, 2);
});
