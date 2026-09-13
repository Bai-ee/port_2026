// Merge a STATIC 15-day calendar with LIVE scanned quote-react candidates
// into one day view — "the dynamic calendar inside a longer strategy".
//
// The calendar (docs/audits/x-calendar-15day.json) is hand-written and fixed:
// it decides *when* to post and *what kind* of post goes in each slot. Only
// `type === 'quote-react'` slots are dynamic — they need a live target found
// by scripts/x-content/scan-quote-targets.mjs, because a quote-react target
// picked days in advance would be stale by the time it posts. Everything else
// on the calendar (originals, retweets, self-quotes) is copy someone already
// wrote and needs no live data at all.
//
// Pure, deterministic, no network, no fs. Given the same inputs it always
// assigns the same candidates to the same slots.

/** Candidate score gap (0-1 scale, same scale as rank.js's composite) within
 * which a vein-matching candidate is still "reasonable" to prefer over a
 * higher-scoring off-vein one. Not specified upstream — chosen so a small
 * affinity bonus can win a close race but can never buy a genuinely weak
 * candidate a slot over a clearly better one ("score still dominates"). */
export const VEIN_SCORE_TOLERANCE = 0.15;

/** A scan older than this is treated as stale — the posts it found may no
 * longer be worth quoting (rank.js's own window is 36h; half a day is a
 * conservative freshness bar for *finding out about* a target, not quoting
 * one). */
export const STALE_SCAN_HOURS = 12;

/** Hard X character limit. The composed quote-react caption + URL must fit. */
export const MAX_COMPOSED_LEN = 280;

function isObj(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function toIdSet(v) {
  if (v instanceof Set) return v;
  if (Array.isArray(v)) return new Set(v);
  return new Set();
}

function timeToMinutes(timeCT) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(timeCT ?? ''));
  if (!m) return Number.POSITIVE_INFINITY;
  return Number(m[1]) * 60 + Number(m[2]);
}

/**
 * Posting a caption that ends in an x.com status URL is how X turns a post
 * into a quote tweet — the trailing link is deliberate, not a stray one, and
 * it must never be the part that gets cut when the total runs long.
 */
function composeCopy(caption, url) {
  const cap = String(caption ?? '');
  const u = typeof url === 'string' && url ? url : '';
  if (!u) return cap || null;

  const sep = '\n\n';
  const full = cap + sep + u;
  if (full.length <= MAX_COMPOSED_LEN) return full;

  const reserve = sep.length + u.length;
  const maxCapLen = MAX_COMPOSED_LEN - reserve;
  if (maxCapLen <= 0) {
    // The URL alone (plus separator) already exceeds the limit. The URL is
    // never truncated, so this returns over-length rather than break the
    // quote link — an edge case real X URLs never actually hit.
    return sep + u;
  }
  const truncatedCap = cap.slice(0, maxCapLen).trimEnd();
  return truncatedCap + sep + u;
}

function buildScan(quoteTargets, now) {
  const generatedAt = quoteTargets.generatedAt ?? null;
  // Only a real ISO string counts — Date.parse() coerces numbers/objects into
  // surprising "valid" dates, which would silently accept a malformed field.
  const parsed = typeof generatedAt === 'string' ? Date.parse(generatedAt) : NaN;
  let ageHours = null;
  let stale = true;
  if (Number.isFinite(parsed)) {
    const diffMs = now - parsed;
    ageHours = Math.round((diffMs / 3_600_000) * 10) / 10;
    stale = diffMs > STALE_SCAN_HOURS * 3_600_000;
  }
  const candidateCount = Array.isArray(quoteTargets.candidates) ? quoteTargets.candidates.length : 0;
  return { generatedAt, ageHours, stale, candidateCount, usableCount: 0 };
}

/**
 * Choose the best remaining candidate for one quote-react slot.
 *
 * Priority: an open-window candidate always beats a closed-window one (rule:
 * stale is a last resort, not a preference). Within whichever pool is in
 * play, the top-scoring candidate wins unless a vein-matching candidate is
 * within VEIN_SCORE_TOLERANCE of it, in which case the vein match wins.
 */
function pickCandidateForSlot(remaining, lane) {
  if (remaining.length === 0) return { candidate: null, fillReason: 'no candidate available' };

  const fresh = remaining.filter((c) => c.windowOpen !== false);
  const usingStale = fresh.length === 0;
  const pool = usingStale ? remaining : fresh;
  const sorted = [...pool].sort((a, b) => b.score - a.score);
  const top = sorted[0];

  if (usingStale) {
    return { candidate: top, fillReason: 'stale candidate — window closed' };
  }
  if (top.vein === lane) {
    return { candidate: top, fillReason: 'top score' };
  }
  const veinMatches = sorted.filter((c) => lane != null && c.vein === lane);
  if (veinMatches.length > 0) {
    const bestVeinMatch = veinMatches[0];
    if (top.score - bestVeinMatch.score <= VEIN_SCORE_TOLERANCE) {
      return { candidate: bestVeinMatch, fillReason: `vein match ${lane}` };
    }
    return { candidate: top, fillReason: 'top score' };
  }
  return { candidate: top, fillReason: 'fallback: no vein match' };
}

function candidateOutput(c) {
  return {
    id: c.id ?? null,
    url: c.url ?? null,
    author: c.author ?? null,
    text: c.text ?? null,
    velocity: c.velocity ?? null,
    ageHours: c.ageHours ?? null,
    engagement: c.engagement ?? null,
    vein: c.vein ?? null,
    score: c.score,
    reasons: Array.isArray(c.reasons) ? c.reasons : [],
  };
}

/**
 * @param {object} input
 * @param {object} input.calendar - the static 15-day calendar (docs/audits/x-calendar-15day.json shape)
 * @param {object} input.quoteTargets - live scan output (scripts/x-content/scan-quote-targets.mjs shape)
 * @param {number} input.dayNumber - which calendar day to build (matches `day` field, not array index)
 * @param {number} [input.now] - epoch ms, defaults to Date.now()
 * @param {Set|Array} [input.existingDraftIds] - candidate ids already drafted elsewhere; never reused
 * @returns {object} the merged day plan (see module header / SSOT for shape)
 */
export function buildDayPlan(input) {
  // A default parameter only catches `undefined`, not `null` — and a null
  // arg is a real case here (an upstream fetch that resolved to nothing).
  const opts = isObj(input) ? input : {};
  const { dayNumber, existingDraftIds } = opts;
  const now = Number.isFinite(opts.now) ? opts.now : Date.now();
  const calendar = isObj(opts.calendar) ? opts.calendar : {};
  const quoteTargets = isObj(opts.quoteTargets) ? opts.quoteTargets : {};

  const days = Array.isArray(calendar.days) ? calendar.days : [];
  const dayEntry = days.find((d) => isObj(d) && d.day === dayNumber) || null;
  const daySlots = dayEntry && Array.isArray(dayEntry.slots) ? dayEntry.slots : [];

  const scan = buildScan(quoteTargets, now);
  const draftIds = toIdSet(existingDraftIds);

  const rawCandidates = Array.isArray(quoteTargets.candidates)
    ? quoteTargets.candidates.filter((c) => isObj(c))
    : [];
  const usablePool = rawCandidates.filter((c) => c.id == null || !draftIds.has(c.id));
  scan.usableCount = usablePool.length;

  // Normalize scores once so sorting never sees NaN/undefined.
  let remaining = usablePool.map((c) => ({ ...c, score: Number.isFinite(c.score) ? c.score : 0 }));

  // Assign in timeCT order (earliest slot gets first pick), stable on ties.
  const quoteSlotOrder = daySlots
    .map((s, i) => ({ s: isObj(s) ? s : {}, i }))
    .filter(({ s }) => s.type === 'quote-react')
    .sort((a, b) => timeToMinutes(a.s.timeCT) - timeToMinutes(b.s.timeCT) || a.i - b.i);

  const assignments = new Map(); // slot index -> { candidate, fillReason }
  for (const { s, i } of quoteSlotOrder) {
    const { candidate, fillReason } = pickCandidateForSlot(remaining, s.lane ?? null);
    assignments.set(i, { candidate, fillReason });
    if (candidate) remaining = remaining.filter((c) => c !== candidate);
  }

  const slots = daySlots.map((rawSlot, i) => {
    const s = isObj(rawSlot) ? rawSlot : {};
    const isQuote = s.type === 'quote-react';
    const picked = assignments.get(i);
    const candidate = isQuote && picked ? picked.candidate : null;

    let status = 'planned';
    let composedCopy = null;
    let fillReason = 'n/a';
    if (isQuote) {
      fillReason = picked ? picked.fillReason : 'no candidate available';
      if (candidate) {
        // 'ready' not 'drafted': a candidate has been matched to the slot, but
        // no social_posts draft exists until the operator presses the button.
        // Candidates already drafted are excluded from assignment entirely.
        status = 'ready';
        composedCopy = composeCopy(s.copy, candidate.url);
      } else {
        status = 'needs-candidate';
      }
    }

    return {
      slot: s.slot ?? null,
      timeCT: s.timeCT ?? null,
      type: s.type ?? null,
      lane: s.lane ?? null,
      copy: s.copy ?? null,
      brief: s.brief ?? null,
      asset: s.asset ?? null,
      selfReply: s.selfReply ?? null,
      score: s.score ?? null,
      guard: s.guard ?? null,
      candidate: candidate ? candidateOutput(candidate) : null,
      composedCopy,
      status,
      fillReason,
    };
  });

  const quoteSlots = slots.filter((s) => s.type === 'quote-react').length;
  const quoteSlotsFilled = slots.filter((s) => s.type === 'quote-react' && s.status === 'ready').length;

  return {
    day: dayEntry ? dayEntry.day : (Number.isFinite(dayNumber) ? dayNumber : null),
    weekday: dayEntry ? dayEntry.weekday ?? null : null,
    theme: dayEntry ? dayEntry.theme ?? null : null,
    scan,
    slots,
    coverage: { quoteSlots, quoteSlotsFilled, unfilled: quoteSlots - quoteSlotsFilled },
  };
}
