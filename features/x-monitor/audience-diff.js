// audience-diff.js — pure roster/metric math for the X Monitor card.
//
// Deliberately free of Firestore and the X API so the parts that can silently
// corrupt the audience history (roster chunking, gained/lost diffing, snapshot
// deltas) are unit-testable in isolation.
//
// The single most dangerous case here is a TRUNCATED roster: if a follower sync
// stops early (rate limit, page cap, credits) and we diff the partial list
// against a complete one, every follower we simply did not fetch looks like an
// unfollow. diffRosters refuses to emit losses unless BOTH sides are complete.

// Firestore caps a document at 1MB. 400 stored follower profiles per chunk
// leaves a wide margin (~250 bytes each ≈ 100KB) while keeping chunk count low.
export const ROSTER_CHUNK_SIZE = 400;

/** Trim a raw X user object down to what the audience panels actually render. */
export function compactUser(user = {}) {
  const metrics = user.public_metrics || {};
  return {
    id: String(user.id || ''),
    username: String(user.username || ''),
    name: String(user.name || ''),
    avatar: String(user.profile_image_url || ''),
    bio: String(user.description || '').slice(0, 220),
    followers: Number(metrics.followers_count) || 0,
    following: Number(metrics.following_count) || 0,
    posts: Number(metrics.tweet_count) || 0,
    accountCreatedAt: user.created_at || null,
    verified: Boolean(user.verified),
  };
}

/** Split compacted users into fixed-size roster chunks. */
export function chunkUsers(users = [], size = ROSTER_CHUNK_SIZE) {
  const chunks = [];
  for (let i = 0; i < users.length; i += size) {
    chunks.push({ index: chunks.length, users: users.slice(i, i + size) });
  }
  return chunks;
}

/** Collapse stored roster chunk docs back into one id → user map. */
export function flattenRoster(chunkDocs = []) {
  const byId = new Map();
  for (const chunk of chunkDocs) {
    for (const user of chunk?.users || []) {
      if (user?.id) byId.set(String(user.id), user);
    }
  }
  return byId;
}

/**
 * Compare two roster snapshots.
 *
 * `gained` is safe to emit from a partial fetch (anyone newly seen really is
 * new). `lost` is NOT — absence from a truncated roster is meaningless, so it
 * is suppressed unless both rosters are complete. `lossesSuppressed` tells the
 * caller to say so out loud rather than render a silently empty column.
 */
export function diffRosters(prevById, nextById, { prevComplete = true, nextComplete = true } = {}) {
  const prev = prevById instanceof Map ? prevById : new Map(Object.entries(prevById || {}));
  const next = nextById instanceof Map ? nextById : new Map(Object.entries(nextById || {}));
  const baseline = prev.size === 0;
  const canDiffLosses = !baseline && prevComplete && nextComplete;

  const gained = [];
  for (const [id, user] of next) if (!prev.has(id)) gained.push(user);

  const lost = [];
  if (canDiffLosses) {
    for (const [id, user] of prev) if (!next.has(id)) lost.push(user);
  }

  return {
    baseline,
    gained: baseline ? [] : gained,
    lost,
    lossesSuppressed: !baseline && !canDiffLosses,
    prevSize: prev.size,
    nextSize: next.size,
  };
}

/** UTC calendar day key — snapshots are one doc per day, last write wins. */
export function snapshotDayKey(at = Date.now()) {
  return new Date(at).toISOString().slice(0, 10);
}

/**
 * Net change in each counter between the newest snapshot and the newest one at
 * least `days` old. Returns null per window when there is no old-enough
 * snapshot — an unknown delta must read as unknown, never as zero.
 */
export function snapshotDeltas(snapshots = [], windows = [1, 7, 30]) {
  const sorted = [...snapshots].filter((s) => s?.date).sort((a, b) => (a.date < b.date ? -1 : 1));
  const latest = sorted[sorted.length - 1] || null;
  const out = { latest, windows: {} };
  if (!latest) return out;

  const latestMs = Date.parse(`${latest.date}T00:00:00Z`);
  for (const days of windows) {
    const cutoff = latestMs - days * 86_400_000;
    let base = null;
    for (const snap of sorted) {
      const ms = Date.parse(`${snap.date}T00:00:00Z`);
      if (ms <= cutoff) base = snap;
    }
    out.windows[days] = base
      ? {
          from: base.date,
          followers: num(latest.followers) - num(base.followers),
          following: num(latest.following) - num(base.following),
          posts: num(latest.posts) - num(base.posts),
        }
      : null;
  }
  return out;
}

/** Per-day net follower change, oldest → newest, for the growth bars. */
export function snapshotSeries(snapshots = []) {
  const sorted = [...snapshots].filter((s) => s?.date).sort((a, b) => (a.date < b.date ? -1 : 1));
  return sorted.map((snap, i) => ({
    date: snap.date,
    followers: num(snap.followers),
    following: num(snap.following),
    posts: num(snap.posts),
    net: i === 0 ? null : num(snap.followers) - num(sorted[i - 1].followers),
  }));
}

/**
 * Engagement rate against impressions. Returns null rather than 0 when
 * impressions are unknown (public-metrics-only posts) so the UI can print "—".
 */
export function engagementRate(metrics = {}) {
  const impressions = Number(metrics.impressions);
  if (!Number.isFinite(impressions) || impressions <= 0) return null;
  const engagements = num(metrics.likes) + num(metrics.retweets) + num(metrics.replies)
    + num(metrics.quotes) + num(metrics.bookmarks);
  return engagements / impressions;
}

/** Metric deltas between the newest and previous history entry on a post. */
export function postMetricDeltas(history = []) {
  if (history.length < 2) return null;
  const latest = history[history.length - 1];
  const prev = history[history.length - 2];
  const keys = ['impressions', 'likes', 'retweets', 'replies', 'quotes', 'bookmarks'];
  const deltas = {};
  for (const key of keys) {
    const a = Number(latest?.[key]);
    const b = Number(prev?.[key]);
    deltas[key] = Number.isFinite(a) && Number.isFinite(b) ? a - b : null;
  }
  return { since: prev?.at || null, deltas };
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}
