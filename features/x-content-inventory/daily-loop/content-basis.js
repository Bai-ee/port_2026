// What an owned content package can honestly ground (story / facts / none) and
// whether it passes the hard rights/approval/readiness gates.
// Decides eligibility and basis only; never ranks, matches conversations, or writes copy.
// Depends on text.js and the inventory schema; nothing downstream.

import { needsApproval, isApproved } from '../schema.js';
import { arrayValues, isRealStory } from './text.js';

// --- what a package can ground ------------------------------------------------

const READY_EFFORT = new Set(['ready', '10-min']);

/**
 * What can honestly be said from this package, by content type.
 *   story — the owner's own words; may carry memories and opinions
 *   facts — verifiable source metadata (Discogs release data, the owner's own
 *           rendered mix, text printed on a flyer). No memories, no results,
 *           no attendance — the facts say what the thing IS, not what happened.
 *   none  — an asset with nothing to say about it; not draftable
 * Model-written suggestions (`variants.x.suggestedStory`, `facets.storySuggestion`)
 * are never treated as either.
 */
export function contentBasis(pkg = {}) {
  const f = pkg.facets && typeof pkg.facets === 'object' ? pkg.facets : {};
  const kind = pkg.source?.kind || 'manual';
  const facts = [];
  const push = (label, value, provenance) => { if (value != null && String(value).trim()) facts.push({ label, value: String(value).trim(), provenance }); };

  if (kind === 'discogs') {
    push('release', pkg.title, 'Discogs');
    push('year', f.eraYear, 'Discogs');
    push('label', arrayValues(f.labels).join(', '), 'Discogs');
    push('catalog', arrayValues(f.catalogNumbers)[0], 'Discogs');
    push('genres', arrayValues(f.genres).slice(0, 4).join(', '), 'Discogs');
    push('credits', arrayValues(f.credits).slice(0, 4).join(', '), 'Discogs');
    push('source', pkg.source?.url, 'Discogs');
  } else if (kind === 'rendered-video') {
    const own = /^bai-?ee\b/i.test(String(pkg.title || '')) || arrayValues(f.people).some((p) => /^bai-?ee$/i.test(p));
    if (own) {
      push('own work', `${pkg.title} — a mix rendered by the owner's own video pipeline`, 'rendered-videos');
      push('year', f.eraYear, 'rendered-videos');
      // Artist-level tag from the Underground Existence artist record, not a per-mix genre.
      push('artist genre tag', arrayValues(f.genres).join(', '), 'Underground Existence artist record');
    }
  } else if (kind === 'nas-archive') {
    const printed = ['people', 'venues', 'cities', 'partyNames'].some((k) => arrayValues(f[k]).length) || f.dateText;
    if (printed && f.vibe?.kind === 'flyer') {
      push('flyer', pkg.title, 'printed on the flyer (OCR — verify before posting)');
      push('lineup', arrayValues(f.people).slice(0, 6).join(', '), 'printed on the flyer (OCR)');
      push('venue', [...arrayValues(f.venues), ...arrayValues(f.cities)].join(', '), 'printed on the flyer (OCR)');
      push('date', f.dateText, 'printed on the flyer (OCR)');
    }
  }

  if (isRealStory(pkg.story)) return { kind: 'story', story: String(pkg.story).trim(), facts };
  if (facts.length) return { kind: 'facts', story: '', facts };
  return { kind: 'none', story: '', facts: [] };
}

export const INELIGIBLE_REASONS = {
  placeholder: 'template/example row',
  rights: 'rights not owned or cleared',
  approval: 'needs approval',
  'no-grounding': 'no story and no verifiable facts — an asset with nothing to say',
  'not-ready': 'needs edit or shoot first',
  retired: 'retired',
  expired: 'expired',
  'not-for-x': 'not marked for X',
};

/** Hard gates, in order. A package that fails any of them is never offered. */
export function packageEligibility(pkg = {}, { now = Date.now() } = {}) {
  if (/^EXAMPLE-/i.test(String(pkg.id || '')) || /^TODO\b/i.test(String(pkg.title || ''))) return { ok: false, reason: 'placeholder' };
  if (pkg.rights !== 'owned' && pkg.rights !== 'cleared') return { ok: false, reason: 'rights' };
  if (needsApproval(pkg) && !isApproved(pkg)) return { ok: false, reason: 'approval' };
  if (pkg.status === 'retired') return { ok: false, reason: 'retired' };
  if (pkg.expiresAt && Date.parse(pkg.expiresAt) < now) return { ok: false, reason: 'expired' };
  if (Array.isArray(pkg.platforms) && pkg.platforms.length && !pkg.platforms.includes('x')) return { ok: false, reason: 'not-for-x' };
  if (pkg.effort && !READY_EFFORT.has(pkg.effort)) return { ok: false, reason: 'not-ready' };
  const basis = contentBasis(pkg);
  if (basis.kind === 'none') return { ok: false, reason: 'no-grounding' };
  return { ok: true, reason: null, basis: basis.kind };
}
