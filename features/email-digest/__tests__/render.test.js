// Characterization tests for the extracted pure renderer (features/email-digest/
// render.js). Renders a 7-variant config matrix off buildPlaceholderData and
// writes each output to features/email-digest/__fixtures__/*.html — those are
// characterization fixtures for human review, NOT yet frozen golden files. Once
// reviewed and accepted, future runs assert byte-for-byte equality against them
// (this file already does that on second-run: it compares against an existing
// fixture when present, and only writes when one is missing).

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildEmailHtml, buildPlaceholderData } from '../render.js';
import digestConfig from '../../intelligence/_digest-config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(__dirname, '..', '__fixtures__');
fs.mkdirSync(FIXTURES_DIR, { recursive: true });

const FIXED_TS = 1755600000000;
const FRESHNESS_TOKEN = 'render-characterization-2026-08-19';

const ph = buildPlaceholderData(FIXED_TS);

// ── Demo (zeroed) fixture literals ──────────────────────────────────────────
// Ported verbatim from the pre-extraction route handler (git show dc81280b,
// app/api/admin/daily-digest/route.js ~L2996-3037). These are local to the
// route's live-data-collection branch and did not move with the renderer, so
// they're reproduced here as literal test fixtures.
const NEUTRAL_VERCEL = { deployments: [], errorLogs: [], totalDeployments: 0 };
const NEUTRAL_AGENDA = { events: [], days: [], tomorrowSummary: '', error: null };
const ZERO_GA4 = {
  overview: { sessions: 0, pageViews: 0, totalUsers: 0, newUsers: 0, bounceRate: 0, avgSessionDuration: 0, engagedSessions: 0 },
  topPages: [], trafficSources: [], events: {}, error: null, demo: true,
};
const ZERO_VERCEL = { ...NEUTRAL_VERCEL, demo: true };
const SAMPLE_HOMEPAGE = {
  totalEvents: 42,
  byEventName: [{ name: 'homepage_cta_click', count: 12 }, { name: 'homepage_scroll_depth', count: 18 }],
  byInteractionType: [{ name: 'cta click', count: 12 }, { name: 'scroll', count: 18 }, { name: 'link click', count: 6 }],
  topTargets: [{ name: 'Get Started (sample)', count: 9 }, { name: 'View Work (sample)', count: 5 }],
  outboundLinks: [{ name: 'https://example.com (sample)', count: 4 }],
  scrollDepths: [{ name: '50%', count: 20 }, { name: '75%', count: 14 }, { name: '100%', count: 6 }],
  webVitals: [{ name: 'LCP', count: 30, average: 2100, poor: 0 }, { name: 'CLS', count: 30, average: 0.06, poor: 0 }],
  error: null, demo: true,
};
const SAMPLE_FIREBASE = {
  totalUsers: 128, newUsers: 3,
  newUsersList: [
    { email: 'sample.user@example.com', website: 'example.com', createdAt: new Date(FIXED_TS - 1_800_000).toISOString() },
    { email: 'new.lead@example.com', website: 'example.org', createdAt: new Date(FIXED_TS - 5_400_000).toISOString() },
    { email: 'placeholder@example.com', website: null, createdAt: new Date(FIXED_TS - 9_000_000).toISOString() },
  ],
  totalClients: 14, totalRuns: 320, recentRuns: 2,
  recentRunsList: [
    { id: 'sample-run-1', status: 'succeeded', website: 'example.com', createdAt: new Date(FIXED_TS - 2_700_000).toISOString() },
    { id: 'sample-run-2', status: 'queued', website: 'example.org', createdAt: new Date(FIXED_TS - 6_300_000).toISOString() },
  ],
  statusCounts: { succeeded: 280, failed: 12, queued: 4 }, demo: true,
};

function render(overrides = {}) {
  const {
    firebase = ph.firebase,
    vercel = ph.vercel,
    ga4 = ph.ga4,
    agenda = ph.agenda,
    homepage = ph.homepage,
    timestamp = FIXED_TS,
    summary = ph.summary,
    briefs = ph.briefs,
    include = { ...digestConfig.DEFAULT_INCLUDE },
    creative = ph.creative,
    briefUrl = null,
    contactUrl = '',
    videoItems = [],
    order = digestConfig.DEFAULT_ORDER,
    postPlatforms = digestConfig.DEFAULT_POST_PLATFORMS,
    freshnessToken = FRESHNESS_TOKEN,
    videoStatus = {},
    videoPublishCtx = {},
  } = overrides;
  return buildEmailHtml(
    firebase, vercel, ga4, agenda, homepage, timestamp, summary, briefs,
    include, creative, briefUrl, contactUrl, videoItems, order, postPlatforms,
    freshnessToken, videoStatus, videoPublishCtx,
  );
}

// Writes (or, once one exists, compares against) a characterization fixture.
function checkFixture(name, html) {
  const file = path.join(FIXTURES_DIR, `${name}.html`);
  if (fs.existsSync(file)) {
    const existing = fs.readFileSync(file, 'utf8');
    assert.equal(html, existing, `${name}: output changed vs the saved characterization fixture at ${file}`);
  } else {
    fs.writeFileSync(file, html);
  }
}

const allIncludeOn = () => Object.fromEntries(digestConfig.INCLUDE_KEYS.map((k) => [k, true]));
const allIncludeOff = () => Object.fromEntries(digestConfig.INCLUDE_KEYS.map((k) => [k, false]));

// ── Variant 1: default config ───────────────────────────────────────────────
test('variant 1: DEFAULT_INCLUDE + DEFAULT_ORDER renders a well-formed, deterministic email', () => {
  const html = render({});
  assert.ok(html.startsWith('<!DOCTYPE html>'));
  assert.ok(html.includes('</html>'));
  assert.ok(html.includes('>Open Executive Brief<')); // execBriefLink defaults ON
  assert.ok(!html.includes('Happening on Reddit')); // redditAnalysis defaults OFF
  assert.equal(render({}), html, 'buildEmailHtml must be deterministic for identical input');
  checkFixture('01-default-config', html);
});

// ── Variant 2: every INCLUDE_KEY on ─────────────────────────────────────────
test('variant 2: all 33 INCLUDE_KEYS on renders every gated section', () => {
  const html = render({ include: allIncludeOn() });
  for (const title of [
    'Happening on Reddit', 'Happening on Instagram', 'Market Talk on X',
    'Opportunity Signals', 'Press Coverage', 'Happening on X',
  ]) {
    assert.ok(html.includes(title), `expected "${title}" section when all include keys are on`);
  }
  checkFixture('02-all-include-on', html);
});

// ── Variant 3: every INCLUDE_KEY off ────────────────────────────────────────
test('variant 3: all 33 INCLUDE_KEYS off renders neither CTA', () => {
  const html = render({ include: allIncludeOff() });
  // Match the rendered button/link text, not the always-present HTML comment
  // `<!-- Top CTA row (Brief + Contact Your Human) -->` that documents the
  // markup regardless of toggle state.
  assert.ok(!html.includes('>Open Executive Brief<'));
  assert.ok(!html.includes('>Contact Your Human<'));
  checkFixture('03-all-include-off', html);
});

// ── Variant 4: legacy coarse include ────────────────────────────────────────
// normalizeInclude() and LEGACY_INCLUDE_EXPANSION are now exported from
// _digest-config.js (additive export, added specifically to un-skip this
// variant) so the real expansion logic is exercised, not a guessed re-
// implementation. A saved config using the pre-granular coarse keys must
// still expand to the correct 33-key granular set — this is the invariant
// that section-registry unification (the next step) must not silently break.
test('variant 4: legacy coarse include expands via the real normalizeInclude()', () => {
  const rawLegacy = {
    marketingBrief: true,
    webStats: true,
    platformStats: true,
    deployments: true,
    creativeBrief: true,
    calendar: true,
  };
  const expanded = digestConfig.normalizeInclude(rawLegacy);

  // Every key every legacy flag maps to must have been turned on.
  for (const [legacyKey, targets] of Object.entries(digestConfig.LEGACY_INCLUDE_EXPANSION)) {
    assert.ok(rawLegacy[legacyKey] === true, `test fixture must cover legacy key "${legacyKey}"`);
    for (const target of targets) {
      assert.equal(expanded[target], true, `legacy "${legacyKey}" must expand to granular "${target}"`);
    }
  }

  const html = render({ include: expanded });
  assert.ok(html.includes('Happening on Reddit'), 'marketingBrief expansion must turn on redditAnalysis (default OFF)');
  assert.ok(html.includes('Deployments') || html.includes('Runtime Errors'), 'deployments legacy key must expand');
  checkFixture('04-legacy-coarse-include', html);
});

// ── Variant 5: custom/shuffled order within a group ─────────────────────────
test('variant 5: a shuffled order actually changes rendered section order', () => {
  const shuffledOrder = [...digestConfig.DEFAULT_ORDER];
  const i1 = shuffledOrder.indexOf('watchlist');
  const i2 = shuffledOrder.indexOf('pressCoverage');
  assert.ok(i1 !== -1 && i2 !== -1, 'fixture keys must exist in DEFAULT_ORDER');
  [shuffledOrder[i1], shuffledOrder[i2]] = [shuffledOrder[i2], shuffledOrder[i1]];

  const include = allIncludeOn();
  const htmlDefault = render({ include, order: digestConfig.DEFAULT_ORDER });
  const htmlShuffled = render({ include, order: shuffledOrder });

  assert.notEqual(htmlDefault, htmlShuffled);
  // DEFAULT_ORDER has 'watchlist' (Happening on X) before 'pressCoverage'
  // (Press Coverage); the swap above reverses that relative order.
  assert.ok(htmlDefault.indexOf('Happening on X') < htmlDefault.indexOf('Press Coverage'), 'default order: Happening on X before Press Coverage');
  assert.ok(htmlShuffled.indexOf('Happening on X') > htmlShuffled.indexOf('Press Coverage'), 'shuffled order: Happening on X after Press Coverage');
  checkFixture('05-shuffled-order', htmlShuffled);
});

// ── Variant 6: hand-built "demo" (zeroed) input ─────────────────────────────
test('variant 6: NEUTRAL_*/ZERO_*/SAMPLE_* demo-shaped input renders demo empty-state copy', () => {
  const html = render({
    firebase: SAMPLE_FIREBASE,
    vercel: ZERO_VERCEL,
    ga4: ZERO_GA4,
    agenda: NEUTRAL_AGENDA,
    homepage: SAMPLE_HOMEPAGE,
    include: allIncludeOn(),
  });
  assert.ok(html.includes('Not connected yet'), 'demo-flagged groups should render "connect this" copy, not a dead empty-state');
  checkFixture('06-demo-zeroed', html);
});

// ── Variant 7: stale summary ─────────────────────────────────────────────────
test('variant 7: summary.staleNote renders the honest staleness disclaimer', () => {
  const staleSummary = { ...ph.summary, staleNote: "Refresh failed at 08:00 — showing yesterday's summary." };
  const html = render({ summary: staleSummary });
  assert.ok(html.includes('Refresh failed at 08:00'));
  checkFixture('07-stale-summary', html);
});
