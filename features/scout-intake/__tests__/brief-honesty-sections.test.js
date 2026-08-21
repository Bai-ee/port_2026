'use strict';

// Phase 3 (docs/plans/BRIEF-RENDERED-SCRAPE-SONNET-HANDOFF.md §3): the brief's
// honesty layer — three-state Social Share checklist, Crawler-vs-Human parity,
// and the coverage manifest. Pure — no I/O, no Firestore, no template strings.

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  CHECKLIST_STATE,
  buildSocialChecklistRows,
  buildCrawlerParityPages,
  buildCoverageManifestRows,
} = require('../brief-honesty-sections.js');

const byId = (rows, id) => rows.find((r) => r.id === id);

// ── Social checklist — the (a)/(b)/(c) matrix ───────────────────────────────

test('(a) static-rich site, all fields present: every row is PRESENT, never a bare miss', () => {
  const siteMeta = {
    ogImage: 'https://example.com/share.jpg',
    ogImageAlt: 'Team photo',
    title: 'Example Co.',
    description: 'We do the thing.',
    siteName: 'Example',
    favicon: 'https://example.com/favicon.ico',
    themeColor: '#111111',
  };
  const evidence = { pages: [{ url: 'https://example.com/', type: 'homepage', renderMode: 'static' }] };
  const rows = buildSocialChecklistRows(siteMeta, evidence);
  assert.equal(rows.length, 7);
  for (const row of rows) assert.equal(row.state, CHECKLIST_STATE.PRESENT, `${row.id} should be present`);
});

test('(a) static-rich site with a genuine gap: absent field is ABSENT_PROVEN, tier B named', () => {
  const siteMeta = { title: 'Example Co.', description: 'We do the thing.' }; // no og:image
  const evidence = { pages: [{ url: 'https://example.com/', type: 'homepage', renderMode: 'static' }] };
  const rows = buildSocialChecklistRows(siteMeta, evidence);
  const ogImage = byId(rows, 'og-image');
  assert.equal(ogImage.state, CHECKLIST_STATE.ABSENT_PROVEN);
  assert.match(ogImage.detail, /Tier B/);
  assert.match(ogImage.detail, /static HTML/);
});

test('(b) SPA with a successful rendered fallback: og:image PRESENT shows artifact detail; a real gap is ABSENT_PROVEN Tier A', () => {
  const siteMeta = {
    ogImage: 'https://cdn.example.com/share.png',
    ogImageArtifact: { bytes: 143360, contentType: 'image/png', width: 1200, height: 630, host: 'cdn.example.com' },
    title: 'Critters Quest',
    // description intentionally absent — a real, proven gap on the rendered page
  };
  const evidence = { pages: [{ url: 'https://critters.quest/', type: 'homepage', renderMode: 'rendered-fallback', renderedVia: 'browserless' }] };
  const rows = buildSocialChecklistRows(siteMeta, evidence);

  const ogImage = byId(rows, 'og-image');
  assert.equal(ogImage.state, CHECKLIST_STATE.PRESENT);
  assert.match(ogImage.detail, /1200×630/);
  assert.match(ogImage.detail, /140 KB/);
  assert.match(ogImage.detail, /PNG/);
  assert.match(ogImage.detail, /cdn\.example\.com/);

  const description = byId(rows, 'description');
  assert.equal(description.state, CHECKLIST_STATE.ABSENT_PROVEN);
  assert.match(description.detail, /Tier A/);
  assert.match(description.detail, /rendered page/);
});

test('(c) SPA with a FAILED rendered fallback: every absent field reads NOT TESTED, never a bare miss', () => {
  const siteMeta = { title: 'Critters Quest' }; // whatever the thin static shell happened to expose
  const evidence = {
    pages: [{ url: 'https://critters.quest/', type: 'homepage', renderMode: 'static', renderFailed: 'browserless_unavailable' }],
  };
  const rows = buildSocialChecklistRows(siteMeta, evidence);
  const description = byId(rows, 'description');
  assert.equal(description.state, CHECKLIST_STATE.NOT_TESTED);
  assert.match(description.detail, /JS-rendered/);
  assert.match(description.detail, /did not succeed/);
  assert.doesNotMatch(description.detail, /Tier/); // NOT TESTED never claims a tier
  // A field that DOES happen to be present on the thin static shell is still a real find.
  const title = byId(rows, 'title');
  assert.equal(title.state, CHECKLIST_STATE.PRESENT);
});

test('(c) render_cap_reached / no_improvement / browserless_disabled all read as an honest NOT TESTED, each with its own reason', () => {
  for (const renderFailed of ['render_cap_reached', 'no_improvement', 'browserless_disabled', 'timeout', 'some_unmapped_reason']) {
    const evidence = { pages: [{ url: 'https://x.test/', type: 'homepage', renderMode: 'static', renderFailed }] };
    const rows = buildSocialChecklistRows({}, evidence);
    for (const row of rows) {
      assert.equal(row.state, CHECKLIST_STATE.NOT_TESTED, `${renderFailed}: ${row.id} should be NOT TESTED`);
      assert.ok(row.detail && row.detail.length > 0);
    }
  }
});

test('no evidence at all (page crawl never ran): every absent field is NOT TESTED with an honest reason, not a tier claim', () => {
  const rows = buildSocialChecklistRows({ title: 'Whatever siteMeta survived' }, null);
  const description = byId(rows, 'description');
  assert.equal(description.state, CHECKLIST_STATE.NOT_TESTED);
  assert.match(description.detail, /not recorded/);
});

test('no siteMeta and no evidence: every row is NOT TESTED', () => {
  const rows = buildSocialChecklistRows(null, null);
  assert.equal(rows.length, 7);
  for (const row of rows) assert.equal(row.state, CHECKLIST_STATE.NOT_TESTED);
});

// ── Crawler-vs-Human parity ──────────────────────────────────────────────────

test('crawlerParity: a page with no crawlerParity produces no parity entry', () => {
  const evidence = { pages: [{ url: 'https://example.com/', type: 'homepage', renderMode: 'static' }] };
  assert.deepEqual(buildCrawlerParityPages(evidence), []);
});

test('crawlerParity: no evidence at all produces no parity entries', () => {
  assert.deepEqual(buildCrawlerParityPages(null), []);
  assert.deepEqual(buildCrawlerParityPages({}), []);
});

test('crawlerParity: a page with the diff produces one entry with all six fields, formatted and match-flagged', () => {
  const evidence = {
    pages: [
      {
        url: 'https://critters.quest/',
        type: 'homepage',
        renderMode: 'rendered-fallback',
        crawlerParity: {
          title: { static: '', rendered: 'Critters Quest - Choose Your World', match: false },
          metaDescription: { static: '', rendered: '', match: true },
          socialMetaTags: { static: [], rendered: ['og:title', 'og:image'], match: false },
          h1: { static: [], rendered: ['MINE', 'PLAY GAME'], match: false },
          ctaTexts: { static: [], rendered: ['Pre-Mine'], match: false },
          bodyWordCount: { static: 0, rendered: 480, match: false },
        },
      },
    ],
  };
  const pages = buildCrawlerParityPages(evidence);
  assert.equal(pages.length, 1);
  assert.equal(pages[0].type, 'homepage');
  assert.equal(pages[0].fields.length, 6);
  const title = pages[0].fields.find((f) => f.key === 'title');
  assert.equal(title.static, '(empty)');
  assert.equal(title.rendered, 'Critters Quest - Choose Your World');
  assert.equal(title.match, false);
  const desc = pages[0].fields.find((f) => f.key === 'metaDescription');
  assert.equal(desc.match, true);
  const socialTags = pages[0].fields.find((f) => f.key === 'socialMetaTags');
  assert.equal(socialTags.static, '(none found)');
  assert.equal(socialTags.rendered, 'og:title, og:image');
  const wc = pages[0].fields.find((f) => f.key === 'bodyWordCount');
  assert.equal(wc.static, '0');
  assert.equal(wc.rendered, '480');
});

// ── Coverage manifest ─────────────────────────────────────────────────────

test('coverage manifest: no coverage object at all — no data to report', () => {
  assert.deepEqual(buildCoverageManifestRows(null), { hasData: false, allRan: false, rows: [] });
});

test('coverage manifest: every entry ran — the quiet "all ran" state', () => {
  const coverage = {
    pageCrawl: { status: 'ran', reason: null },
    renderedFallback: { status: 'ran', reason: null },
    metaExtraction: { status: 'ran', reason: null },
    jsonLd: { status: 'ran', reason: null },
    ogImageInspection: { status: 'ran', reason: null },
  };
  const result = buildCoverageManifestRows(coverage);
  assert.equal(result.hasData, true);
  assert.equal(result.allRan, true);
  assert.deepEqual(result.rows, []);
});

test('coverage manifest: skipped/failed entries are named with their reason, in declared order', () => {
  const coverage = {
    pageCrawl: { status: 'ran', reason: null },
    renderedFallback: { status: 'skipped', reason: 'no page required a rendered fallback — static reads were sufficient' },
    metaExtraction: { status: 'ran', reason: null },
    jsonLd: { status: 'ran', reason: null },
    ogImageInspection: { status: 'skipped', reason: 'no_og_image' },
    robotsSitemapProbe: { status: 'skipped', reason: 'robots/sitemap probe runs as a separate agent-readiness module, not part of this fetch stage' },
    screenshots: { status: 'skipped', reason: 'screenshot capture runs as a separate parallel task (api/_lib/browserless.cjs), not part of this fetch stage' },
  };
  const result = buildCoverageManifestRows(coverage);
  assert.equal(result.hasData, true);
  assert.equal(result.allRan, false);
  assert.equal(result.rows.length, 4);
  assert.deepEqual(result.rows.map((r) => r.key), ['renderedFallback', 'ogImageInspection', 'robotsSitemapProbe', 'screenshots']);
  assert.equal(result.rows[0].label, 'Rendered (JS) capture');
  assert.match(result.rows[2].reason, /agent-readiness/);
});

test('coverage manifest: a failed entry reports its status distinctly from skipped', () => {
  const coverage = {
    pageCrawl: { status: 'ran', reason: null },
    renderedFallback: { status: 'failed', reason: 'browserless_unavailable' },
  };
  const result = buildCoverageManifestRows(coverage);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].status, 'failed');
});
