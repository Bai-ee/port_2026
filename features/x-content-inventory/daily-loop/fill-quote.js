// Quote slot filler: picks a live watchlist/scan post for a quote-react or
// quote-commentary slot (P1 curation). Fit is vein + content-guard lane, never
// owned-library vocabulary; owned packages only ever add an optional "related" note.
// Pure; candidates and clock are injected. Depends on text.js, x-content-guard
// and day-plan's tolerance constant only.

import { classifyLane, guardXPost } from '../../x-content-guard/index.js';
import { VEIN_SCORE_TOLERANCE } from '../../x-quote-targets/day-plan.js';
import { packageTerms, tokenize, WEAK_TERMS } from './text.js';

/** Measured on 216 real quote-reacts (median target age 17.8h): the quote window is 36h, not the 6h reply window. */
export const QUOTE_WINDOW_HOURS = 36;

const QUOTE_TYPES = new Set(['quote-react', 'quote-commentary']);

function ageHoursOf(c, now) {
  const created = typeof c.createdAt === 'string' ? Date.parse(c.createdAt) : NaN;
  if (Number.isFinite(created)) return Math.max(0, (now - created) / 3_600_000);
  return Number.isFinite(c.ageHours) ? c.ageHours : null;
}

const scoreOf = (c) => (Number.isFinite(c.score) ? c.score : 0);
const engagementOf = (c) => (Number(c.likes) || 0) + (Number(c.reposts) || 0) + (Number(c.replies) || 0);

/** Best score first; engagement then id keep the pick stable when scores tie or are absent. */
const byStrength = (a, b) => scoreOf(b) - scoreOf(a) || engagementOf(b) - engagementOf(a) || String(a.id).localeCompare(String(b.id));

/**
 * Conservative: two shared non-weak terms, at least one of them part of what the
 * package IS (title, tags, entities, facets). One shared word is coincidence.
 */
function relatedPackage(post, packages) {
  const words = new Set(tokenize(post.text));
  let best = null;
  for (const pkg of packages) {
    const shared = [];
    let identity = false;
    for (const [term, weight] of packageTerms(pkg)) {
      if (!words.has(term) || WEAK_TERMS.has(term)) continue;
      shared.push(term);
      if (weight >= 2) identity = true;
    }
    if (shared.length >= 2 && identity && (!best || shared.length > best.terms.length)) {
      best = { id: pkg.id ?? null, title: pkg.title ?? null, terms: shared };
    }
  }
  return best;
}

function gapReason(total, counts) {
  if (total === 0) return 'no candidates';
  const live = total - counts.used - counts.stale - counts.unknownAge;
  if (live === 0) return 'no fresh candidates';
  if (counts.blocked === 0) return `${live} candidates, none on a P1 vein`;
  return `${live} fresh candidates, none usable (${counts.blocked} blocked, ${counts.offVein} off-vein)`;
}

/**
 * @param {object} input
 * @param {object} input.slot  a slots.js slot (type quote-react | quote-commentary)
 * @param {object[]} input.candidates  normalized scan/watchlist posts ({id,text,createdAt,vein?,score?,...})
 * @param {number} input.now  epoch ms
 * @param {string[]} [input.usedIds]  post ids already taken
 * @param {object[]} [input.related]  owned packages; optional note only
 * @returns {{slot, post, fit:{vein,lane,reason}, related, rejected} | {slot, gap:{code,reason}, rejected}}
 */
export function fillQuoteSlot({ slot, candidates, now, usedIds = [], related = [] }) {
  const rejected = { used: 0, stale: 0, unknownAge: 0, blocked: 0, offVein: 0 };
  const list = Array.isArray(candidates) ? candidates : [];
  const gap = (reason) => ({ slot, gap: { code: `slot-unfilled:${slot?.letter}`, reason }, rejected });
  if (!QUOTE_TYPES.has(slot?.type)) return gap(`not a quote slot (${slot?.type})`);

  const used = new Set(usedIds);
  const eligible = [];
  for (const c of list) {
    if (used.has(c.id)) { rejected.used += 1; continue; }
    const age = ageHoursOf(c, now);
    if (age === null) { rejected.unknownAge += 1; continue; }
    if (age > QUOTE_WINDOW_HOURS) { rejected.stale += 1; continue; }

    // Hard blocks (casino, politics) apply even to a post the scan tagged with a vein.
    const verdict = guardXPost({ text: c.text, type: slot.type, media: c.hasMedia ? 'image' : 'none' });
    if (verdict.hardBlock) { rejected.blocked += 1; continue; }

    // A scan vein is trusted; without one the guard lane must be a known one.
    const lane = c.vein ? verdict.lane : classifyLane(c.text).lane;
    if (!c.vein && lane === 'unknown') { rejected.offVein += 1; continue; }
    eligible.push({ ...c, lane, ageHours: Math.round(age * 10) / 10 });
  }
  if (eligible.length === 0) return gap(gapReason(list.length, rejected));

  // Mirrors day-plan pickCandidateForSlot: a vein match close to the top beats a higher-scoring off-vein post.
  const sorted = [...eligible].sort(byStrength);
  const top = sorted[0];
  const veinMatch = slot.lane ? sorted.find((c) => c.vein === slot.lane) : null;
  const preferVein = veinMatch && veinMatch !== top && scoreOf(top) - scoreOf(veinMatch) <= VEIN_SCORE_TOLERANCE;
  const post = preferVein ? veinMatch : top;

  const reason = preferVein ? `vein match ${slot.lane}`
    : post.vein ? `top score on vein ${post.vein}`
      : `top score; no vein, ${post.lane} lane`;
  const note = relatedPackage(post, Array.isArray(related) ? related : []);
  return { slot, post, fit: { vein: post.vein ?? null, lane: post.lane, reason }, related: note, rejected };
}
