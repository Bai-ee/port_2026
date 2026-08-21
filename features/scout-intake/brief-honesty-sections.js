'use strict';

// brief-honesty-sections.js — Phase 3 (docs/plans/BRIEF-RENDERED-SCRAPE-SONNET-HANDOFF.md §3)
//
// Pure row-derivation for the Creative Brief's honesty layer — the master
// prompt's L1 (absence requires proof, tier named), L4 (our limits are never
// phrased as the client's gaps), and L5 (no silent modules — a coverage
// manifest names what did and did not run). No I/O, no Firestore, no
// template strings: these functions take the same siteMeta/evidence already
// stored on dashboard_state and read by
// app/api/dashboard/brief-preview/route.js, and return small row objects the
// route turns into HTML. Keeping the derivation here (not buried in template
// literals) is what makes it directly unit-testable.

const { fieldTier, TIER } = require('./evidence-tiers.js');

// ── Social Share checklist (three states, never a bare ✗) ──────────────────

const CHECKLIST_STATE = { PRESENT: 'present', ABSENT_PROVEN: 'absent-proven', NOT_TESTED: 'not-tested' };

// Human-readable reasons for each renderFailed code site-fetcher.js can set
// (see attemptRenderedFallback in site-fetcher.js). Framed as OUR tooling's
// outcome this run (L4), never as something the client's site lacks.
const RENDER_FAILED_REASONS = {
  browserless_unavailable: 'the site is JS-rendered and the rendered (Browserless) capture did not succeed this run',
  no_improvement: 'the site is JS-rendered, but the rendered capture returned no more content than the static HTML',
  render_cap_reached: "the site is JS-rendered, but this run's rendered-capture budget was already spent on other pages",
  browserless_disabled: 'the site is JS-rendered and rendered capture is not configured for this run',
  timeout: 'the site is JS-rendered and the rendered capture timed out',
};

function renderFailureReason(reason) {
  if (!reason) return 'the site is JS-rendered and the rendered capture did not succeed this run';
  return RENDER_FAILED_REASONS[reason] || `the site is JS-rendered and the rendered capture did not succeed this run (${reason})`;
}

function findHomepage(evidence) {
  const pages = Array.isArray(evidence?.pages) ? evidence.pages : [];
  return pages.find((p) => p?.type === 'homepage') || pages[0] || null;
}

/** Tier label named in the ABSENT_PROVEN row — the master prompt requires naming the tier. */
function tierLabel(tier) {
  if (tier === TIER.RENDERED) return "checked in the site's rendered page (Tier A)";
  if (tier === TIER.STATIC) return "checked in the site's static HTML (Tier B)";
  return null;
}

/** Artifact detail for a present og:image (L3 — "present" is not a finding, inspect the artifact). */
function ogImageDetail(artifact) {
  if (!artifact || typeof artifact !== 'object') return null;
  const parts = [];
  if (artifact.width && artifact.height) parts.push(`${artifact.width}×${artifact.height}`);
  if (typeof artifact.bytes === 'number' && artifact.bytes > 0) parts.push(`${Math.max(1, Math.round(artifact.bytes / 1024))} KB`);
  if (artifact.contentType) parts.push(String(artifact.contentType).replace(/^image\//i, '').toUpperCase());
  if (artifact.host) parts.push(artifact.host);
  return parts.length ? parts.join(' · ') : null;
}

const CHECKLIST_FIELDS = [
  { id: 'og-image', label: 'Share image (og:image)', get: (sm) => sm.ogImage },
  { id: 'og-image-alt', label: 'Image alt text', get: (sm) => sm.ogImageAlt },
  { id: 'title', label: 'Title', get: (sm) => sm.title },
  { id: 'description', label: 'Description', get: (sm) => sm.description },
  { id: 'site-name', label: 'Site name', get: (sm) => sm.siteName },
  { id: 'favicon', label: 'Favicon', get: (sm) => sm.favicon },
  { id: 'theme-color', label: 'Brand color', get: (sm) => sm.themeColor },
];

/**
 * Three-state Social Share checklist rows: PRESENT, ABSENT (proven, tier
 * named), or NOT TESTED (reason named) — never a bare ✗ from a blind static
 * read. Derives the tier mechanically from the homepage's own capture facts
 * (evidence-tiers.js), the same page site-fetcher.js/normalize.js already
 * store on dashboard_state.evidence.
 *
 * @param {object|null} siteMeta - dashboard_state.siteMeta
 * @param {object|null} evidence - dashboard_state.evidence (SiteEvidence summary)
 * @returns {{id:string,label:string,state:string,detail:string|null}[]}
 */
function buildSocialChecklistRows(siteMeta, evidence) {
  const sm = siteMeta || {};
  const homepage = findHomepage(evidence);
  const tier = fieldTier('siteMeta', homepage);
  const provenLabel = tierLabel(tier);

  return CHECKLIST_FIELDS.map(({ id, label, get }) => {
    const value = get(sm);
    if (value) {
      const detail = id === 'og-image' ? ogImageDetail(sm.ogImageArtifact) : null;
      return { id, label, state: CHECKLIST_STATE.PRESENT, detail };
    }

    if (provenLabel) {
      return { id, label, state: CHECKLIST_STATE.ABSENT_PROVEN, detail: provenLabel };
    }

    const reason = homepage
      ? renderFailureReason(homepage.renderFailed)
      : 'site capture details were not recorded for this run';
    return { id, label, state: CHECKLIST_STATE.NOT_TESTED, detail: reason };
  });
}

// ── Crawler vs Human parity (Phase 2 crawlerParity → client-readable rows) ──

const PARITY_FIELDS = [
  { key: 'title', label: 'Page title' },
  { key: 'metaDescription', label: 'Meta description' },
  { key: 'socialMetaTags', label: 'Open Graph / Twitter tags' },
  { key: 'h1', label: 'Main heading (H1)' },
  { key: 'ctaTexts', label: 'Call-to-action text' },
  { key: 'bodyWordCount', label: 'Body word count' },
];

function formatParityValue(value) {
  if (value == null || value === '') return '(empty)';
  if (Array.isArray(value)) return value.length ? value.join(', ') : '(none found)';
  return String(value);
}

/**
 * Per-page crawler-vs-human parity rows, client-readable. Only pages that
 * actually carry a `crawlerParity` diff (i.e. a rendered fallback fired and
 * both the static and rendered HTML were in hand to compare) produce a page
 * entry — a page that was never rendered has nothing to diff against.
 *
 * @param {object|null} evidence - dashboard_state.evidence
 * @returns {{url:string|null,type:string,fields:{key:string,label:string,static:string,rendered:string,match:boolean}[]}[]}
 */
function buildCrawlerParityPages(evidence) {
  const pages = Array.isArray(evidence?.pages) ? evidence.pages : [];
  return pages
    .filter((p) => p && p.crawlerParity && typeof p.crawlerParity === 'object')
    .map((p) => ({
      url: p.url || null,
      type: p.type || 'page',
      fields: PARITY_FIELDS.map(({ key, label }) => {
        const f = (p.crawlerParity && p.crawlerParity[key]) || {};
        return {
          key,
          label,
          static: formatParityValue(f.static),
          rendered: formatParityValue(f.rendered),
          match: Boolean(f.match),
        };
      }),
    }));
}

// ── Coverage manifest (L4/L5 made visible) ──────────────────────────────────

const COVERAGE_LABELS = {
  pageCrawl: 'Page crawl',
  renderedFallback: 'Rendered (JS) capture',
  metaExtraction: 'Social/meta tag extraction',
  jsonLd: 'Structured data (JSON-LD) scan',
  ogImageInspection: 'Share image inspection',
  robotsSitemapProbe: 'robots.txt / sitemap.xml check',
  screenshots: 'Screenshot capture',
};
const COVERAGE_ORDER = ['pageCrawl', 'renderedFallback', 'metaExtraction', 'jsonLd', 'ogImageInspection', 'robotsSitemapProbe', 'screenshots'];

/**
 * Coverage manifest rows: every planned check that did NOT simply run clean
 * this run (skipped or failed), each with its own reason — plus a flag for
 * the "everything planned ran" quiet state. `coverage` is the run-level
 * object site-fetcher.js's buildCoverage/buildEmptyCoverage produce
 * (dashboard_state.evidence.coverage) — absent entirely on evidence captured
 * before Phase 2, or on a run that never fetched the site at all.
 *
 * @param {object|null} coverage
 * @returns {{hasData:boolean, allRan:boolean, rows:{key:string,label:string,status:string,reason:string|null}[]}}
 */
function buildCoverageManifestRows(coverage) {
  if (!coverage || typeof coverage !== 'object') {
    return { hasData: false, allRan: false, rows: [] };
  }
  const rows = COVERAGE_ORDER
    .filter((key) => coverage[key] && typeof coverage[key] === 'object')
    .map((key) => ({
      key,
      label: COVERAGE_LABELS[key] || key,
      status: coverage[key].status || 'skipped',
      reason: coverage[key].reason ?? null,
    }))
    .filter((row) => row.status !== 'ran');
  return { hasData: true, allRan: rows.length === 0, rows };
}

module.exports = {
  CHECKLIST_STATE,
  buildSocialChecklistRows,
  buildCrawlerParityPages,
  buildCoverageManifestRows,
};
