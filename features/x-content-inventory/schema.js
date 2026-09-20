// ContentPackage — one thing you could post.
//
// WHY IT IS NOT AN ARCHIVE RECORD: the Archive (`Bai-ee/assetManager`) answers
// what an artifact IS — bytes, identity, entities, provenance, permanence. It
// deliberately never answers whether it is postable, in which series, with what
// call to action, or how much work is left. Those change weekly; an archival
// record is meant to outlive all of it. So a package REFERENCES archive
// identity (sha256) and carries publishing state of its own.
//
// One artifact yields MANY packages over time — a Housepit flyer is the flyer,
// the booking story, the crowd clip, the where-are-they-now, the anniversary.
// That multiplication is the point; `assetRefs` is therefore a list and the
// same sha256 may appear in several packages.
//
// Pure: no fs, no network, no clock.

import { PILLARS, SERIES } from './categories.js';

export const MEDIA_STATES = ['none', 'still', 'video', 'audio', 'needs-capture'];

/** How much work stands between this row and a published post. The scheduler
 * uses it as a hard gate: nothing above `ready` can fill a slot inside 24h,
 * because a plan that queues a video shoot for 13:00 today is a plan that
 * produces a gap day. */
export const EFFORT_LEVELS = ['ready', '10-min', 'needs-edit', 'needs-shoot'];

/** ⚠️ A GATE, NOT A FIELD. Anything touched by a client relationship defaults
 * to `client-approval-needed`, and `never-public` rows are filtered before the
 * matcher runs rather than shown and skipped. Automating the wrong asset once
 * costs a client; no amount of reach pays that back. */
export const RIGHTS_STATES = ['owned', 'cleared', 'client-approval-needed', 'never-public'];

export const STATUSES = ['idea', 'drafted', 'scheduled', 'posted', 'retired'];

export const PLATFORMS = ['x', 'instagram', 'youtube', 'site', 'email', 'bandcamp'];

/**
 * @typedef {object} ContentPackage
 * @property {string} id                slug, stable, yours to choose
 * @property {string} series            a key of SERIES (C1…C9)
 * @property {string} pillar            a key of PILLARS
 * @property {string} title             what this post is, in your words
 * @property {string} story             ⚠️ THE ONE FIELD NO MODEL CAN PRODUCE.
 *   TwelveLabs sees "dark room, strobe, four-on-the-floor". Jev never receives
 *   raw media at all. Neither was in the room. A flyer without this is a stock
 *   image — and a static image reaches less than plain text. The story IS the
 *   post; the artifact is the attachment.
 * @property {string[]} assetRefs       sha256 when the Archive has it, else a path or URL
 * @property {string} mediaState        one of MEDIA_STATES
 * @property {string} effort            one of EFFORT_LEVELS
 * @property {string} rights            one of RIGHTS_STATES
 * @property {string[]} platforms       subset of PLATFORMS
 * @property {string|null} cta          where the self-reply sends people
 * @property {number|null} eraYear      when the artifact is FROM
 * @property {string|null} eventDate    ISO date, when the thing happened — drives the anniversary trigger
 * @property {string[]} entities        people/labels/venues/releases named in it
 * @property {string} status            one of STATUSES
 * @property {string|null} lastPostedAt ISO, written by the ledger
 * @property {number} postCount         written by the ledger
 */

export const REQUIRED_FIELDS = ['id', 'series', 'pillar', 'title', 'story', 'mediaState', 'effort', 'rights'];

function isStr(v) { return typeof v === 'string' && v.trim().length > 0; }

/**
 * Validate one row. Returns `{ ok, errors[], warnings[] }`.
 *
 * Errors are structural — the matcher cannot use the row. Warnings are
 * strategic: the row will work but will underperform for a measured reason,
 * and saying so here is cheaper than finding out in 60 days of ledger data.
 */
export function validatePackage(pkg = {}) {
  const errors = [];
  const warnings = [];

  for (const f of REQUIRED_FIELDS) {
    if (!isStr(pkg[f])) errors.push(`missing required field: ${f}`);
  }
  if (pkg.series && !SERIES[pkg.series]) errors.push(`unknown series: ${pkg.series}`);
  if (pkg.pillar && !PILLARS[pkg.pillar]) errors.push(`unknown pillar: ${pkg.pillar}`);
  if (pkg.mediaState && !MEDIA_STATES.includes(pkg.mediaState)) errors.push(`bad mediaState: ${pkg.mediaState}`);
  if (pkg.effort && !EFFORT_LEVELS.includes(pkg.effort)) errors.push(`bad effort: ${pkg.effort}`);
  if (pkg.rights && !RIGHTS_STATES.includes(pkg.rights)) errors.push(`bad rights: ${pkg.rights}`);
  if (pkg.status && !STATUSES.includes(pkg.status)) errors.push(`bad status: ${pkg.status}`);

  const series = SERIES[pkg.series];
  if (series) {
    // A series declares the media its slot type actually needs. A C1 row with
    // no video cannot fill a showcase slot — it is a text post with a picture,
    // which measures worse than a text post without one.
    if (series.media === 'video' && pkg.mediaState !== 'video') {
      warnings.push(`${pkg.series} fills showcase slots and needs video; this row is "${pkg.mediaState}" — route it through a render step or repoint it at a text slot`);
    }
    if (series.trigger === 'anniversary') {
      // Checked by PARSING, not by presence: a placeholder string is the most
      // likely value here while an inventory is being filled in, and a row that
      // looks dated but never fires is worse than one that is obviously empty.
      if (!isStr(pkg.eventDate) || !Number.isFinite(Date.parse(pkg.eventDate))) {
        warnings.push(`${pkg.series} is anniversary-triggered but eventDate is not a parseable date — it will never fire on its own`);
      }
    }
    if (series.requiresLedger) {
      warnings.push(`${pkg.series} needs the post ledger (P2) before it can choose a winner`);
    }
  }

  if (isStr(pkg.story) && pkg.story.trim().length < 40) {
    warnings.push('story is very short — the story is the post, the artifact is the attachment');
  }
  if (pkg.rights === 'never-public') {
    warnings.push('rights: never-public — filtered before the matcher, kept here so the decision is recorded');
  }
  if (!Array.isArray(pkg.assetRefs) || !pkg.assetRefs.length) {
    warnings.push('no assetRefs — fine for a text-only row, a gap for anything else');
  }

  return { ok: errors.length === 0, errors, warnings };
}

/** Validate a whole inventory and report it in one pass. */
export function validateInventory(rows = []) {
  const list = Array.isArray(rows) ? rows : [];
  const seen = new Set();
  const results = list.map((pkg) => {
    const r = validatePackage(pkg);
    if (pkg?.id) {
      if (seen.has(pkg.id)) r.errors.push(`duplicate id: ${pkg.id}`);
      seen.add(pkg.id);
    }
    return { id: pkg?.id ?? null, ...r, ok: r.errors.length === 0 };
  });
  return {
    total: list.length,
    valid: results.filter((r) => r.ok).length,
    bySeries: list.reduce((acc, p) => { acc[p?.series ?? 'none'] = (acc[p?.series ?? 'none'] ?? 0) + 1; return acc; }, {}),
    results,
  };
}
