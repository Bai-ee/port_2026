// Match content packages to calendar slots.
//
// WHY: `build-calendar.js` decides WHEN to post and WHAT TYPE goes in each
// slot, then emits `copy: null, asset: null` because nothing knows what
// content exists. `day-plan.js` fills only the quote-react slots, from the
// live scan. This module fills the rest, from the inventory.
//
// Pure: no fs, no network. The clock is injected (`today`) so a plan is
// reproducible and testable.
//
// ⚠️ THIS MODULE NEVER PUBLISHES. It proposes. Drafting, guarding, scoring and
// posting are separate steps, and posting stays behind an explicit human
// action (see docs/source-of-truth/X-API-AND-PROFILE-OPERATIONS.md §0).

import { SERIES, resolveLabels } from './categories.js';

/** A package this far above `ready` cannot be promised to a slot inside this
 * many hours — a plan that queues a video shoot for 13:00 today is a plan that
 * produces a gap day. */
export const EFFORT_HORIZON_HOURS = { ready: 0, '10-min': 6, 'needs-edit': 48, 'needs-shoot': 120 };

/** Do not re-post the same artifact inside this window. Fatigue is measured on
 * the ARTIFACT (its assetRefs / sha256), not the package, because one artifact
 * legitimately spawns many packages and posting three views of the same flyer
 * in a week reads as one thing repeated. */
export const FATIGUE_DAYS = 45;

/** An anniversary fires within this many days of the date, so a plan generated
 * on Monday can still place Thursday's anniversary. */
export const ANNIVERSARY_WINDOW_DAYS = 2;

function daysBetween(aMs, bMs) { return Math.abs(aMs - bMs) / 86_400_000; }

/** Rights is a GATE, not a score. `never-public` rows are removed before
 * anything else runs, and client-owned material cannot be proposed until it is
 * cleared — automating the wrong asset once costs a client relationship. */
export function isPublishable(pkg) {
  return pkg?.rights === 'owned' || pkg?.rights === 'cleared';
}

/** Anniversary check against `eventDate`, ignoring the year. Returns the
 * matched anniversary age in years, or null. */
export function anniversaryYears(pkg, today) {
  const ms = Date.parse(pkg?.eventDate ?? '');
  if (!Number.isFinite(ms)) return null;
  const then = new Date(ms);
  const now = new Date(today);
  const thisYear = Date.UTC(now.getUTCFullYear(), then.getUTCMonth(), then.getUTCDate());
  if (daysBetween(thisYear, now.getTime()) > ANNIVERSARY_WINDOW_DAYS) return null;
  const years = now.getUTCFullYear() - then.getUTCFullYear();
  return years > 0 ? years : null;
}

/**
 * Score one package for one slot. Returns `null` when it cannot fill it at all,
 * so a caller can tell "not eligible" from "eligible but weak".
 *
 * Scoring is deliberately shallow and explainable — every component is a
 * measured rule from the strategy, and `reasons` is carried through to the UI
 * so a human can see WHY something was proposed rather than trusting a number.
 */
export function scoreMatch(pkg, slot, { today = Date.now(), ledger = {} } = {}) {
  const series = SERIES[pkg?.series];
  if (!series) return null;
  if (!isPublishable(pkg)) return null;
  if (pkg.status === 'retired' || pkg.status === 'posted') return null;
  if (!series.slotTypes.includes(slot?.type)) return null;

  // ⚠️ A SHOWCASE SLOT ALWAYS NEEDS VIDEO, whatever the series declares.
  // Measured: a static image reaches LESS than a plain text post, and video
  // out-reaches image 3.4× inside the same post type. So a still-only package
  // is not a weak showcase — it is a worse-than-nothing one, and it belongs in
  // a text slot until a render step (P5) turns it into video.
  //
  // This is enforced on the SLOT, not on `series.media`, because a series like
  // C3 (Event Archive) legitimately holds stills and can still carry a text
  // slot. Gating on the series alone let a flyer fill a showcase slot.
  if (slot.type === 'original-showcase' && pkg.mediaState !== 'video') return null;
  if (series.media === 'video' && pkg.mediaState !== 'video') return null;

  const horizon = EFFORT_HORIZON_HOURS[pkg.effort];
  if (horizon == null) return null;
  const hoursOut = Number.isFinite(slot?.hoursFromNow) ? slot.hoursFromNow : 24;
  if (horizon > hoursOut) return null;

  const reasons = [];
  let score = 0.5;

  // Lane agreement. A slot's lane comes from the client's own profile; a
  // package's lane is DERIVED from its pillar, never stored on the row — one
  // mapping table, so the three vocabularies cannot drift apart silently.
  const lane = resolveLabels(pkg.pillar).lane;
  if (slot.lane && lane && slot.lane === lane) { score += 0.15; reasons.push(`lane:${lane}`); }

  // T1 — anniversary. The strongest trigger there is, because it is a reason
  // to post TODAY rather than a thing that is merely postable.
  const anni = anniversaryYears(pkg, today);
  if (anni) { score += 0.3; reasons.push(`${anni}-year anniversary`); }

  // Ready beats nearly-ready, because streaks break on friction.
  if (pkg.effort === 'ready') { score += 0.1; reasons.push('ready'); }

  // Never posted beats posted-before, all else equal.
  const refs = Array.isArray(pkg.assetRefs) ? pkg.assetRefs : [];
  const lastPosts = refs.map((r) => Date.parse(ledger[r]?.lastPostedAt ?? '')).filter(Number.isFinite);
  if (lastPosts.length) {
    const freshestDays = daysBetween(Math.max(...lastPosts), today);
    if (freshestDays < FATIGUE_DAYS) return null; // fatigue gate
    score += 0.05;
    reasons.push(`last posted ${Math.round(freshestDays)}d ago`);
  } else {
    score += 0.1;
    reasons.push('never posted');
  }

  // A story is the post; the artifact is the attachment. A thin story is a
  // weak post no matter how good the artifact is.
  const storyLen = String(pkg.story ?? '').trim().length;
  if (storyLen >= 120) { score += 0.1; reasons.push('has a story'); }
  else if (storyLen < 40) { score -= 0.2; reasons.push('thin story'); }

  return { score: Math.round(score * 1000) / 1000, reasons };
}

/**
 * Fill a day's slots from the inventory.
 *
 * @param {object} input
 * @param {object[]} input.slots     slots from buildCalendar (one day)
 * @param {object[]} input.packages  the inventory
 * @param {object} [input.ledger]    assetRef -> { lastPostedAt }
 * @param {number} [input.today]     epoch ms, injected for testability
 * @returns {{ slots: object[], filled: number, unfilled: number, gaps: object[] }}
 *
 * Quote-react slots are left untouched: their value is borrowed reach and they
 * belong to `day-plan.js` + the live scan. Pairing an archive artifact onto one
 * (trigger T2) is a later, separate step.
 */
export function matchDay(input = {}) {
  const slots = Array.isArray(input.slots) ? input.slots : [];
  const packages = Array.isArray(input.packages) ? input.packages : [];
  const ledger = input.ledger ?? {};
  const today = input.today ?? Date.now();

  const used = new Set();
  const out = [];
  const gaps = [];

  // Self-quote slots are filled from the POST LEDGER, not the inventory: what
  // to re-surface is a question about what already worked, and the answer is
  // post history. This is the benchmark's highest-performing type and it needs
  // no new content at all.
  const resurrections = Array.isArray(input.resurrections) ? [...input.resurrections] : [];

  for (const slot of slots) {
    if (slot.type === 'quote-react' || slot.type === 'quote-commentary') {
      out.push({ ...slot, source: 'scan', matchReason: 'dynamic slot — filled by the daily scan' });
      continue;
    }

    if (slot.type === 'self-quote') {
      const pick = resurrections.shift();
      out.push(pick
        ? {
          ...slot,
          source: 'ledger',
          asset: pick.post?.url ?? null,
          story: pick.post?.text ?? null,
          copy: null, // the new line on top is drafted in P3
          matchScore: pick.score ?? null,
          matchReason: pick.reason ?? 'past winner',
        }
        : { ...slot, source: 'ledger', matchReason: 'no eligible past winner (too recent, already re-surfaced, or below threshold)' });
      continue;
    }

    const ranked = packages
      .filter((p) => !used.has(p.id))
      .map((p) => ({ pkg: p, m: scoreMatch(p, slot, { today, ledger }) }))
      .filter((r) => r.m)
      .sort((a, b) => b.m.score - a.m.score);

    const best = ranked[0];
    if (!best) {
      // An unfilled slot is reported as a NAMED GAP, not silently dropped:
      // "nothing in inventory can fill a 13:00 showcase" is the single most
      // actionable output this module produces.
      gaps.push({ slot: slot.slot, type: slot.type, lane: slot.lane, need: SERIES_NEED(slot.type) });
      out.push({ ...slot, source: 'inventory', matchReason: 'no eligible package' });
      continue;
    }

    used.add(best.pkg.id);
    out.push({
      ...slot,
      source: 'inventory',
      packageId: best.pkg.id,
      series: best.pkg.series,
      pillar: best.pkg.pillar,
      asset: (best.pkg.assetRefs ?? [])[0] ?? null,
      copy: null, // drafted in P3, from story + Client Brain voice
      story: best.pkg.story ?? null,
      selfReply: best.pkg.cta ?? null,
      matchScore: best.m.score,
      matchReason: best.m.reasons.join(' · '),
    });
  }

  return {
    slots: out,
    filled: out.filter((s) => s.packageId).length,
    unfilled: gaps.length,
    gaps,
  };
}

/** What kind of package would have filled a slot of this type — printed next
 * to a gap so the answer to "what should I make" is explicit. */
function SERIES_NEED(type) {
  // A showcase slot needs video whatever the series holds, so listing a
  // still-based series here as a candidate would contradict the gate above and
  // send someone off to prepare something that still cannot fill the slot.
  const needsVideo = type === 'original-showcase';
  const candidates = Object.entries(SERIES)
    .filter(([, s]) => s.slotTypes.includes(type))
    .filter(([, s]) => !needsVideo || s.media === 'video' || s.media === 'still');
  if (!candidates.length) return 'no series covers this slot type';
  const names = candidates.map(([k, s]) => `${k} ${s.label}`).join(', ');
  return needsVideo ? `a VIDEO package from: ${names}` : `a package from: ${names}`;
}
