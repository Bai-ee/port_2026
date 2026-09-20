// The post ledger — what went out, when, and how it did.
//
// Two jobs, both of which the engine is currently blind without:
//
// 1. FATIGUE. Keyed on the ARTIFACT (sha256 / assetRef), not the package,
//    because one artifact legitimately spawns many packages and posting three
//    views of the same flyer in a week reads as one thing repeated. Content
//    identity being a byte hash is what makes this exact rather than a guess —
//    it is the single most useful thing the Archive gives the posting side.
//
// 2. RESURRECTION. Self-quote is the benchmark's HIGHEST-performing post type
//    (60.8 avg likes) and @bai_ee used it once in 65 days. Picking what to
//    re-surface needs to know what actually worked — which is post history,
//    and post history already exists on disk.
//
// ⚠️ THE LEDGER CAN BE BACKFILLED. It does not need a single new post: the
// committed corpus is 246 real posts with dates and likes. So C9 works from
// day one, on real winners, before the inventory has anything in it.
//
// Pure: no fs, no network. The clock is injected.

/** Re-surfacing something posted this recently reads as repetition to the
 * people who saw it the first time. */
export const MIN_RESURRECTION_AGE_DAYS = 21;

/** Past this, a post is not a "winner worth another look" — it is archive
 * material, which is what the inventory and its triggers are for. */
export const MAX_RESURRECTION_AGE_DAYS = 400;

/** A candidate has to have beaten this share of the account's own authored
 * posts. Percentile, not an absolute like count, so it works on an account
 * whose median is 0 and on one whose median is 200. */
export const WINNER_PERCENTILE = 0.8;

/** Do not resurrect the same post twice inside this window. */
export const RESURRECTION_COOLDOWN_DAYS = 180;

const DAY_MS = 86_400_000;

function num(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }

/**
 * Normalize corpus rows (or any post history) into ledger entries.
 * Retweets are dropped: they are not this account's posts and cannot be
 * re-surfaced or credited.
 */
export function buildPostLedger(rows = []) {
  return (Array.isArray(rows) ? rows : [])
    .filter((r) => r && r.type !== 'retweet' && r.id)
    .map((r) => ({
      id: String(r.id),
      url: r.url ?? null,
      utc: r.utc ?? null,
      type: r.type ?? null,
      text: r.text ?? '',
      media: r.media ?? 'none',
      likes: num(r.likes),
      engagement: num(r.engagement),
      // Views are usually absent (a bird timeline carries none), so ranking is
      // likes-based on purpose. Do not silently treat a missing view count as 0.
      views: Number.isFinite(Number(r.views)) ? Number(r.views) : null,
      assetRefs: Array.isArray(r.assetRefs) ? r.assetRefs : [],
    }));
}

/**
 * Which metric this set can be ranked on.
 *
 * ⚠️ Views beat likes WHENEVER THEY EXIST, and on this account that difference
 * decides the answer: the two breakout posts reached 4,712 and 1,870 views
 * while carrying almost no likes, and a likes-ranking buries both under a
 * 4-like post that 60 people saw. Reach is what a self-quote is borrowing
 * against, so reach is what should pick one.
 *
 * Elsewhere in the system `lift` is likes-based — correctly, because a bird
 * timeline carries no views at all. This corpus is the exception: its views
 * were backfilled for every authored post. So the basis is decided per set,
 * and always reported.
 */
export function rankingBasis(entries = [], minCoverage = 0.8) {
  if (!entries.length) return 'likes';
  const withViews = entries.filter((e) => Number.isFinite(e.views) && e.views > 0).length;
  return withViews / entries.length >= minCoverage ? 'views' : 'likes';
}

const metric = (e, basis) => (basis === 'views' ? (Number.isFinite(e.views) ? e.views : 0) : e.likes);

/** Percentile threshold across the account's own authored posts, on whichever
 * metric this set supports. */
export function winnerThreshold(entries = [], percentile = WINNER_PERCENTILE, basis = null) {
  const b = basis ?? rankingBasis(entries);
  const vals = entries.map((e) => metric(e, b)).sort((a, b2) => a - b2);
  if (!vals.length) return 0;
  const idx = Math.min(vals.length - 1, Math.floor(vals.length * percentile));
  return vals[idx];
}

/** assetRef -> { lastPostedAt, postCount }, for the matcher's fatigue gate. */
export function assetFatigue(entries = []) {
  const out = {};
  for (const e of entries) {
    for (const ref of e.assetRefs) {
      const prev = out[ref];
      if (!prev || (e.utc && e.utc > prev.lastPostedAt)) {
        out[ref] = { lastPostedAt: e.utc, postCount: (prev?.postCount ?? 0) + 1 };
      } else {
        prev.postCount += 1;
      }
    }
  }
  return out;
}

/**
 * Rank past posts worth quoting yourself on.
 *
 * @param {object[]} entries      from buildPostLedger
 * @param {object} opts
 * @param {number} [opts.today]   epoch ms
 * @param {object} [opts.resurrected]  postId -> ISO of the last time it was re-surfaced
 * @param {number} [opts.limit]
 * @returns {Array<{post, ageDays, likes, reason}>}
 */
export function pickResurrectionCandidates(entries = [], opts = {}) {
  const today = opts.today ?? Date.now();
  const resurrected = opts.resurrected ?? {};
  const limit = opts.limit ?? 5;

  const basis = opts.basis ?? rankingBasis(entries);
  const threshold = winnerThreshold(entries, WINNER_PERCENTILE, basis);
  const out = [];

  for (const e of entries) {
    const ms = Date.parse(e.utc ?? '');
    if (!Number.isFinite(ms)) continue;

    const ageDays = (today - ms) / DAY_MS;
    if (ageDays < MIN_RESURRECTION_AGE_DAYS || ageDays > MAX_RESURRECTION_AGE_DAYS) continue;

    // A self-quote of a self-quote is a hall of mirrors.
    if (e.type === 'self-quote') continue;

    // Quote-reacts borrow someone else's object; re-surfacing one re-surfaces
    // THEIR content, not yours, and the borrowed post may be long gone.
    if (e.type === 'quote-react' || e.type === 'quote-commentary') continue;

    // A reply lives inside someone else's thread. Quoting your own reply drags
    // that conversation along with it and reads as context nobody asked for.
    if (e.type === 'reply') continue;

    const value = metric(e, basis);
    if (value < threshold || value <= 0) continue;

    const last = Date.parse(resurrected[e.id] ?? '');
    if (Number.isFinite(last) && (today - last) / DAY_MS < RESURRECTION_COOLDOWN_DAYS) continue;

    const reasons = [
      `${value} ${basis} vs p${Math.round(WINNER_PERCENTILE * 100)} threshold of ${threshold}`,
      `${Math.round(ageDays)}d old`,
    ];
    if (e.media === 'video') reasons.push('video');

    out.push({
      post: e,
      ageDays: Math.round(ageDays),
      basis,
      value,
      likes: e.likes,
      views: e.views,
      // Older winners rank slightly higher: more of the audience has turned
      // over since, so more people are seeing it for the first time.
      score: Math.round((value * (1 + Math.min(ageDays, 365) / 730)) * 100) / 100,
      reason: reasons.join(' · '),
    });
  }

  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}
