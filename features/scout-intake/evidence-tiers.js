'use strict';

// evidence-tiers.js — Phase 2 (docs/plans/BRIEF-RENDERED-SCRAPE-SONNET-HANDOFF.md §3)
//
// Mirrors the master prompt's evidence tiers (/Users/bballi/Documents/Repos/
// Virtual_Time_capsule/brief-agent.system.md — A rendered / B transport /
// C inferred / D external / X not tested), collapsed to the four site-fetcher
// can actually produce (no external-source lookups happen in this pipeline).
//
// Pure — no I/O, no Firestore, no network. Derives a tier per field
// MECHANICALLY from a page's own capture facts (renderMode / renderFailed).
// Tiers are never hand-stored per field; call this over the stored evidence
// whenever a tier is needed (e.g. Phase 3's per-field checklist rows).

const TIER = { RENDERED: 'A', STATIC: 'B', HEURISTIC: 'C', NOT_RUN: 'X' };

// Every field site-fetcher.js can produce on a page, tiered the same way.
const PAGE_FIELDS = [
  'title', 'metaDescription', 'h1', 'h2', 'navLabels', 'ctaTexts',
  'bodyParagraphs', 'socialLinks', 'contactClues', 'jsonLdTypes', 'siteMeta',
];

// CTA and contact-clue extraction are pattern-guesses about INTENT
// ("this element looks like a call-to-action" / "this string looks like a
// phone number") — never a definitive read the way a <title> or <h1> tag is.
// That is exactly the master prompt's Tier C ("a strong signature implying a
// fact you did not directly observe"), regardless of whether the underlying
// page capture itself was rendered or static.
const HEURISTIC_FIELDS = new Set(['ctaTexts', 'contactClues']);

/**
 * Tier for one field on one page, derived from that page's own capture facts.
 *
 * @param {string} field - a PAGE_FIELDS name
 * @param {object} page - one page's stored/summarized evidence
 *   ({ renderMode: 'static'|'rendered-fallback', renderFailed?: string })
 * @returns {'A'|'B'|'C'|'X'}
 */
function fieldTier(field, page) {
  if (!page || typeof page !== 'object') return TIER.NOT_RUN;

  const capturedMode = page.renderMode === 'rendered-fallback' || page.renderMode === 'static';
  if (!capturedMode) return TIER.NOT_RUN;

  // A 'static' page carrying a renderFailed reason needed a render that never
  // confirmed or denied what a human/renderer would actually see — the static
  // content here is unproven relative to that, which is the honest X case,
  // not a B pass. (render_cap_reached is the same story: no attempt happened.)
  if (page.renderMode === 'static' && page.renderFailed) return TIER.NOT_RUN;

  if (HEURISTIC_FIELDS.has(field)) return TIER.HEURISTIC;

  return page.renderMode === 'rendered-fallback' ? TIER.RENDERED : TIER.STATIC;
}

/** Tier every capturable field on one page. */
function pageTiers(page) {
  const tiers = {};
  for (const field of PAGE_FIELDS) tiers[field] = fieldTier(field, page);
  return tiers;
}

/** Tier every page in a SiteEvidence (or its normalize.js-summarized form). */
function evidenceTiers(evidence) {
  const pages = Array.isArray(evidence?.pages) ? evidence.pages : [];
  return pages.map((p) => ({
    url: p?.url || null,
    type: p?.type || null,
    tiers: pageTiers(p),
  }));
}

module.exports = { TIER, PAGE_FIELDS, HEURISTIC_FIELDS, fieldTier, pageTiers, evidenceTiers };
