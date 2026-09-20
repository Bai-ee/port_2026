// Project a day plan into the shape the dashboard card renders.
//
// `buildDayPlan` returns the full working set — two corpus summaries, the whole
// benchmark comparison, every validator result, untruncated post text. That is
// the right output for a terminal script reading local files; it is the wrong
// thing to put on the wire. This module is the narrowing: it decides what the
// card needs, trims what it does not, and names each slot's state ONCE so the
// UI never re-derives it.
//
// Pure. No fs, no network, no clock — everything comes from the plan handed in.
// The card and `day-view.mjs` therefore describe the same day by construction;
// the drift this prevents is a slot that reads "GAP" in the terminal and shows
// content in the browser.

/** Post text on a resurrection row can be the full 280 — but the card shows a
 * preview line, and the untruncated body is one more thing crossing the wire
 * for every slot on every open. */
export const STORY_PREVIEW_CHARS = 280;

/**
 * One word for what is actually in this slot. The terminal view branches on
 * `source` + `packageId` + `story` at three separate call sites; getting those
 * three checks out of the render path is the point of this function.
 *
 * - `inventory` — a content package matched
 * - `ledger`    — one of the account's own past winners, re-surfaced
 * - `scan`      — a dynamic slot the 06:30 quote scan fills
 * - `gap`       — nothing in inventory can fill it, and `gaps` says what would
 * - `empty`     — a ledger slot with no eligible winner (not an inventory gap)
 */
export function slotState(slot) {
  const s = slot ?? {};
  if (s.source === 'scan') return 'scan';
  if (s.source === 'ledger') return s.story ? 'ledger' : 'empty';
  if (s.packageId) return 'inventory';
  return 'gap';
}

function preview(text, max = STORY_PREVIEW_CHARS) {
  if (typeof text !== 'string') return null;
  const flat = text.replace(/\s+/g, ' ').trim();
  if (!flat) return null;
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** Strip a validator result down to the rows that still need a human. A clean
 * row carries no information the counts do not already give. */
function inventoryIssues(audit = {}) {
  const results = Array.isArray(audit.results) ? audit.results : [];
  return results
    .filter((r) => (r.errors?.length ?? 0) > 0 || (r.warnings?.length ?? 0) > 0)
    .map((r) => ({
      id: r.id ?? null,
      ok: !!r.ok,
      errors: Array.isArray(r.errors) ? r.errors : [],
      warnings: Array.isArray(r.warnings) ? r.warnings : [],
    }));
}

/**
 * @param {object} plan  the return value of `buildDayPlan`
 * @param {object} [opts]
 * @param {number} [opts.posts]   authored posts requested for the day
 * @param {number} [opts.replies] the reply quota, for display alongside posts
 * @returns {object} the card payload
 */
export function projectDayPlan(plan, opts) {
  const p = plan ?? {};
  const o = opts ?? {};
  const rawSlots = Array.isArray(p.slots) ? p.slots : [];
  const audit = p.audit ?? {};

  const slots = rawSlots.map((raw) => {
    const s = raw ?? {};
    const state = slotState(s);
    return {
      slot: s.slot ?? null,
      timeCT: s.timeCT ?? null,
      type: s.type ?? null,
      lane: s.lane ?? null,
      state,
      source: s.source ?? null,
      series: s.series ?? null,
      pillar: s.pillar ?? null,
      packageId: s.packageId ?? null,
      story: preview(s.story),
      asset: s.asset ?? null,
      selfReply: s.selfReply ?? null,
      why: s.matchReason ?? null,
      score: Number.isFinite(s.matchScore) ? s.matchScore : null,
      // The adoption floor is a PROPOSED change to build-calendar.js living
      // outside it (plan-day.js §applyAdoptionFloor). A slot it moved has to say
      // so on screen, or the card silently presents a proposal as the plan.
      adopted: !!s.adopted,
      adoptedFrom: s.adoptedFrom ?? null,
      adoptReason: s.adoptReason ?? null,
      // Copy is drafted by draft-day.mjs and is never written by the view path.
      copy: s.copy ?? null,
    };
  });

  const countBy = (state) => slots.filter((s) => s.state === state).length;
  const gaps = Array.isArray(p.gaps) ? p.gaps : [];

  return {
    date: p.date ?? null,
    summary: {
      posts: Number.isFinite(o.posts) ? o.posts : slots.length,
      replies: Number.isFinite(o.replies) ? o.replies : null,
      slots: slots.length,
      // `plan.filled` counts inventory matches only — a re-surfaced winner and a
      // scan slot both carry content but are not "filled" by it. Reporting one
      // number would make a workable day look two-fifths built, so each route
      // into a slot is counted separately and the card labels them.
      fromInventory: countBy('inventory'),
      fromLedger: countBy('ledger'),
      fromScan: countBy('scan'),
      gaps: countBy('gap'),
      empty: countBy('empty'),
      adopted: slots.filter((s) => s.adopted).length,
    },
    slots,
    gaps: gaps.map((g) => ({
      slot: g.slot ?? null,
      type: g.type ?? null,
      lane: g.lane ?? null,
      need: g.need ?? null,
    })),
    inventory: {
      total: audit.total ?? 0,
      valid: audit.valid ?? 0,
      invalid: Math.max(0, (audit.total ?? 0) - (audit.valid ?? 0)),
      bySeries: audit.bySeries ?? {},
      issues: inventoryIssues(audit),
    },
    // Present only when a benchmark corpus was loaded. Without one, buildCalendar
    // falls back to the account's current mix, and the card must not imply the
    // day was shaped by a gap report that never ran.
    benchmarked: !!p.benchStats,
  };
}
