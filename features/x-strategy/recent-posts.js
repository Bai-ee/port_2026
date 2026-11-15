// recent-posts.js - the get_recent_posts read tool: an account's own posts in the last N hours WITH views.
//
// Source: ONE `bird user-tweets --json-full` call (free, browser cookies). The timeline's `_raw` carries each
// post's own view count (`_raw.views.count`) and bookmark / quote counts, so no per-post `bird read` is needed
// (fewer requests => fewer HTTP 429s). A quote-tweet's `_raw` ALSO nests the quoted post (`quoted_status_result`)
// and the row carries `quotedTweet` with the ORIGINAL's likes/views: those are returned under `quoted`, never as
// the owner's own numbers. Own numbers are read only from the top level (and only when `_raw.rest_id` is the row's id).
//
// WHERE IT RUNS: bird needs the Mac's Chrome cookies, so it cannot run on Vercel. Same pattern as scan-quote-targets:
//   - Mac / local dev (X_STRATEGY_LOCAL_INGEST=1 and bird runnable): live pull, cached ~15 min in memory + Firestore.
//   - Vercel (no bird): serve the last Firestore snapshot the Mac wrote (the refresh worker re-pulls hourly; a stale read
//     sets refreshRequestedAt and the worker pulls within ~60s), flagged stale with its as-of; with no snapshot, fall
//     back to X Monitor's stored impressions (source x-monitor). Each snapshot carries per-post checkpoints (2h/24h/72h).
// Every figure carries its source and as-of; where bird and X Monitor both have a post the LATER capture wins.
//
// Pure except through injected `runBird` / `store`; READ-ONLY bird verbs only (see assertReadOnlyBird).

import { classifyType, mediaKind } from '../x-benchmark/normalize-corpus.js';
import { median } from '../x-content-inventory/performance.js';
import { classifyBirdError, BIRD_FAILURE } from './ingest.js';

export const RECENT_DEFAULT_HOURS = 48;
export const RECENT_MAX_HOURS = 168;
export const RECENT_POSTS_MAX = 24; // rows returned to the model (result must fit LIMITS.resultMaxChars)
export const RECENT_CACHE_TTL_MS = 15 * 60 * 1000;
export const RATE_LIMIT_COOLDOWN_MS = 5 * 60 * 1000;
export const BASELINE_DAYS = 14; // window of the owner's median
export const OUTLIER_RATIO = 10; // views / median >= this => outlier
export const RECENT_COLLECTION = 'x_recent_posts';
export const RECENT_SNAPSHOT_MAX_ROWS = 150;
export const SCHEDULED_PULL_MS = 60 * 60 * 1000; // the Mac worker re-pulls each snapshot hourly
export const REFRESH_REQUEST_COOLDOWN_MS = 5 * 60 * 1000; // a stale read asks the Mac worker at most this often
export const CHECKPOINT_HOURS = Object.freeze([2, 24, 72]); // per-post metrics frozen at the first pull past each mark
const CHECKPOINT_KEEP_MS = 8 * 86_400_000;
const TEXT_MAX = 160;
const CT = 'America/Chicago';
const AUTHORED = new Set(['original-showcase', 'original-text', 'quote-react', 'quote-commentary', 'self-quote']);

/** bird verbs that only read. Anything else (tweet, reply, follow, ...) is refused before a process is spawned. */
const READ_ONLY_BIRD_VERBS = new Set(['read', 'user-tweets', 'replies', 'thread', 'search', 'user', 'whoami', '--version']);
export function assertReadOnlyBird(args) {
  const verb = Array.isArray(args) ? args[0] : null;
  if (!READ_ONLY_BIRD_VERBS.has(verb)) throw new Error(`refusing bird command "${String(verb).slice(0, 30)}": read-only verbs only`);
  return args;
}
/** Wrap any runBird so it can only ever run read verbs. */
export const readOnlyBird = (runBird) => (args) => runBird(assertReadOnlyBird(args));

export function birdArgsFor(handle) {
  return ['user-tweets', `@${handle}`, '-n', '100', '--max-pages', '5', '--delay', '1200', '--json-full'];
}

const finite = (v) => { const n = Number(v); return v !== null && v !== undefined && v !== '' && Number.isFinite(n) ? n : null; };
const decodeEntities = (t) => t.replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const excerpt = (t) => decodeEntities(String(t ?? '')).replace(/\s+/g, ' ').trim().slice(0, TEXT_MAX);

/** bird prints banner lines before the JSON; take everything from the first { or [. */
export function parseTimeline(stdout) {
  const raw = String(stdout ?? '');
  const o = raw.indexOf('{');
  const a = raw.indexOf('[');
  const start = o === -1 ? a : (a === -1 ? o : Math.min(o, a));
  if (start === -1) throw new Error('no JSON in bird output');
  const payload = JSON.parse(raw.slice(start));
  return Array.isArray(payload) ? payload : (payload.tweets || []);
}

/** "2026-10-19 09:14" in America/Chicago. */
export function ctStamp(ms) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: CT, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

/** Cheap text heuristic, labelled as a guess. Returns design | music | throwback | unknown. */
export function guessTrack(row) {
  const t = `${row.text} ${row.quoted?.text ?? ''}`;
  if (/\b(circa|throwback|tbt|years? ago|anniversary)\b/i.test(t)) return 'throwback';
  if (/\[[^\]]+,\s*(19|20)\d{2}\]/.test(t) || /\b(dj|mix|vinyl|discogs|b2b|techno|house music|live @|live set)\b/i.test(t)) return 'music';
  if (row.type === 'quote-react' || /\b(design|figma|remotion|brand|logo|typograph|motion|after effects|ui|ux)\b/i.test(t)) return 'design';
  return 'unknown';
}

/**
 * One raw bird timeline object -> a compact row. OWN stats come from the top level only; the quoted post's stats are
 * kept apart under `quoted`. Views are null when the row's `_raw` is missing or is not this post (never guessed).
 */
export function normalizeRecentPost(raw, { handle } = {}) {
  const id = String(raw?.id ?? '');
  const ms = Date.parse(raw?.createdAt);
  if (!id || !Number.isFinite(ms)) return null;
  const type = classifyType({ ...raw, inReplyToStatusId: raw.inReplyToStatusId ?? raw?._raw?.legacy?.in_reply_to_status_id_str }, handle);
  const own = raw._raw && String(raw._raw.rest_id) === id ? raw._raw : null;
  // A retweet's view count belongs to the original: never reported as the owner's.
  const views = type === 'retweet' ? null : finite(own?.views?.count);
  const media = Array.isArray(raw.media) ? raw.media : [];
  const durations = media.map((m) => finite(m?.durationMs)).filter((d) => d !== null);
  const text = String(raw.text ?? '');

  let quoted = null;
  if (raw.quotedTweet && type !== 'retweet') {
    const q = raw.quotedTweet;
    const qRaw = raw._raw?.quoted_status_result?.result;
    const qViews = qRaw && String(qRaw.rest_id) === String(q.id) ? finite(qRaw.views?.count) : null;
    quoted = {
      id: q.id ? String(q.id) : null,
      author: q.author?.username ?? null,
      text: excerpt(q.text),
      likes: finite(q.likeCount), reposts: finite(q.retweetCount), replies: finite(q.replyCount), views: qViews,
      note: "the QUOTED post's stats, not the account's own",
    };
  }
  const row = {
    id,
    url: `https://x.com/${String(handle ?? '').replace(/^@+/, '')}/status/${id}`,
    utc: new Date(ms).toISOString(),
    type,
    media: mediaKind(raw),
    ...(durations.length ? { videoSeconds: Math.round(Math.max(...durations) / 100) / 10 } : {}),
    hasLink: /https?:\/\/(?!t\.co\/\w+$)/i.test(text),
    text: excerpt(text),
    views,
    likes: finite(raw.likeCount), reposts: finite(raw.retweetCount), replies: finite(raw.replyCount),
    bookmarks: finite(own?.legacy?.bookmark_count), quotes: finite(own?.legacy?.quote_count),
    ...(quoted ? { quoted } : {}),
  };
  row.trackGuess = guessTrack(row);
  return row;
}

/**
 * Carry the previous snapshot's checkpoints forward and add any newly due ones: for each mark in CHECKPOINT_HOURS, the
 * first pull at or past that post age freezes its numbers (with the real age, so a late capture is visible as late).
 * Posts older than 8 days are dropped.
 */
export function updateCheckpoints(prev, rows, pulledAt) {
  const out = {};
  for (const [id, cp] of Object.entries(prev || {})) if (cp && pulledAt - Date.parse(cp.utc) < CHECKPOINT_KEEP_MS) out[id] = cp;
  for (const r of rows) {
    const ms = Date.parse(r.utc);
    if (r.views === null || !Number.isFinite(ms) || pulledAt - ms >= CHECKPOINT_KEEP_MS) continue;
    const ageHours = (pulledAt - ms) / 3_600_000;
    for (const mark of CHECKPOINT_HOURS) {
      const k = `h${mark}`;
      if (ageHours < mark || out[r.id]?.[k]) continue;
      out[r.id] = { ...(out[r.id] || { utc: r.utc }), [k]: { at: new Date(pulledAt).toISOString(), ageHours: Math.round(ageHours * 10) / 10, views: r.views, likes: r.likes, reposts: r.reposts, replies: r.replies, bookmarks: r.bookmarks } };
    }
  }
  return out;
}

/** Timeline -> snapshot rows (newest first, deduped, capped). `pulledAt` is when bird answered; `prev` carries checkpoints. */
export function buildSnapshot({ raws, handle, pulledAt, clientId = null, prev = null }) {
  const seen = new Set();
  const rows = [];
  for (const raw of raws || []) {
    const row = normalizeRecentPost(raw, { handle });
    if (!row || seen.has(row.id)) continue;
    seen.add(row.id);
    rows.push(row);
  }
  rows.sort((a, b) => (a.utc < b.utc ? 1 : -1));
  const kept = rows.slice(0, RECENT_SNAPSHOT_MAX_ROWS);
  return { clientId, handle: String(handle).replace(/^@+/, ''), pulledAt, rows: kept, checkpoints: updateCheckpoints(prev?.checkpoints, kept, pulledAt) };
}

const clampHours = (h) => (Number.isInteger(h) ? Math.min(Math.max(h, 1), RECENT_MAX_HOURS) : RECENT_DEFAULT_HOURS);

/**
 * Snapshot (+ optional X Monitor impressions) -> the tool result. Nothing is computed from quoted stats.
 * @param {{rows:object[],pulledAt:number,handle:string}} snap
 * @param {{hours?:number, now?:number, source:string, monitor?:{asOf:number, byId:Map<string,number>}|null, caveats?:string[]}} o
 */
export function shapeRecentPosts(snap, { hours, now = Date.now(), source, monitor = null, caveats = [] } = {}) {
  const windowHours = clampHours(hours);
  const asOf = snap.pulledAt;
  const rows = snap.rows.map((r) => {
    const m = monitor?.byId?.get(r.id);
    // The later capture wins (views only grow): X Monitor beats bird only when it was synced after the bird pull.
    const useMonitor = Number.isFinite(m) && monitor.asOf > asOf && (r.views === null || m >= r.views);
    return useMonitor
      ? { ...r, views: m, viewsSource: 'x-monitor', viewsAsOf: new Date(monitor.asOf).toISOString() }
      : { ...r, viewsSource: r.views === null ? null : (source === 'x-monitor' ? 'x-monitor' : 'bird'), viewsAsOf: r.views === null ? null : new Date(asOf).toISOString() };
  });

  const baselineCut = now - BASELINE_DAYS * 86_400_000;
  const base = rows.filter((r) => AUTHORED.has(r.type) && r.views !== null && Date.parse(r.utc) >= baselineCut).map((r) => r.views);
  const med = median(base);
  const medianViews = { value: med, n: base.length, windowDays: BASELINE_DAYS, basis: 'originals + quotes (no replies / retweets)' };

  const cut = now - windowHours * 3_600_000;
  const inWindow = rows.filter((r) => Date.parse(r.utc) >= cut);
  const posts = inWindow.slice(0, RECENT_POSTS_MAX).map((r) => {
    const vsMedian = AUTHORED.has(r.type) && r.views !== null && med > 0 ? Math.round((r.views / med) * 10) / 10 : null;
    const cp = snap.checkpoints?.[r.id];
    const checkpoints = cp ? Object.fromEntries(CHECKPOINT_HOURS.filter((h) => cp[`h${h}`]).map((h) => [`h${h}`, cp[`h${h}`]])) : null;
    return { ...r, atCT: ctStamp(Date.parse(r.utc)), vsMedian, outlier: vsMedian !== null && vsMedian >= OUTLIER_RATIO, ...(checkpoints && Object.keys(checkpoints).length ? { checkpoints } : {}) };
  });
  // Posts the account can still learn from but has no view count for (never guessed, never zero).
  const needsMetrics = inWindow.filter((r) => r.type !== 'retweet' && r.views === null).map((r) => ({ id: r.id, url: r.url, atCT: ctStamp(Date.parse(r.utc)) }));
  const ageMinutes = Math.max(0, Math.round((now - asOf) / 60_000));
  return {
    available: true,
    handle: snap.handle,
    windowHours,
    source, // bird-live | bird-cache | bird-snapshot | x-monitor
    asOf: new Date(asOf).toISOString(),
    ageMinutes,
    stale: ageMinutes > RECENT_CACHE_TTL_MS / 60_000,
    medianViews,
    outlierRule: `outlier = views / median >= ${OUTLIER_RATIO}`,
    count: inWindow.length,
    ...(inWindow.length > posts.length ? { truncated: true } : {}),
    checkpointRule: `checkpoints h${CHECKPOINT_HOURS.join('/h')} = numbers frozen at the first pull past that post age (ageHours shows how late)`,
    needsMetrics,
    ...(snap.lastError ? { lastPullError: snap.lastError } : {}),
    ...(snap.refreshRequestedAt ? { refreshRequestedAt: new Date(snap.refreshRequestedAt).toISOString() } : {}),
    posts,
    caveats: [
      'views = X impression count at as-of; it grows after the pull. A post under ~2h old is still moving.',
      'A quote post carries the ORIGINAL post\'s stats under `quoted` - never report those as the account\'s own.',
      ...caveats,
    ],
  };
}

/** X Monitor fallback: stored impressions (paid sync) in the window. Fewer fields; no bookmarks / quoted split. */
export function snapshotFromMonitor(audience, { handle, hours, now = Date.now() } = {}) {
  const asOf = Math.max(0, ...[audience?.account?.sync?.postsAt, audience?.account?.updatedAt].map(Number).filter(Number.isFinite)) || null;
  const rows = (audience?.posts || []).map((p) => {
    const ms = Date.parse(p.createdAt);
    const views = finite(p.metrics?.impressions);
    if (!p.id || !Number.isFinite(ms)) return null;
    return {
      id: String(p.id), url: `https://x.com/${handle}/status/${p.id}`, utc: new Date(ms).toISOString(),
      type: p.kind === 'quote' ? 'quote-react' : (p.kind === 'reply' ? 'reply' : 'original-text'), media: 'unknown', hasLink: false,
      text: excerpt(p.text), views, likes: finite(p.metrics?.likes), reposts: finite(p.metrics?.retweets ?? p.metrics?.reposts), replies: finite(p.metrics?.replies),
      bookmarks: finite(p.metrics?.bookmarks), quotes: finite(p.metrics?.quotes), trackGuess: 'unknown',
    };
  }).filter(Boolean).sort((a, b) => (a.utc < b.utc ? 1 : -1));
  return asOf && rows.length ? { handle, pulledAt: asOf, rows } : null;
}

export function createMemoryRecentPostsStore() {
  const m = new Map();
  return { async get(key) { return m.get(key) ?? null; }, async put(key, snap) { m.set(key, snap); } };
}

/**
 * Firestore snapshot cache: x_recent_posts/{clientId}__{handle}. Snapshots are written only by a live pull (Mac / local);
 * `put` replaces the doc, so a successful pull also clears refreshRequestedAt and lastError.
 */
export function createFirestoreRecentPostsStore(db) {
  const ref = (key) => db.collection(RECENT_COLLECTION).doc(String(key).replace(/[^\w.-]+/g, '_'));
  return {
    async get(key) { const s = await ref(key).get(); return s.exists ? s.data() : null; },
    async put(key, snap) { await ref(key).set(snap); },
    /** Ask the Mac worker for a pull now (it drains every 60s). */
    async requestRefresh(key, at) { await ref(key).set({ refreshRequestedAt: at }, { merge: true }); },
    async markFailed(key, error) { await ref(key).set({ lastError: error }, { merge: true }); },
  };
}

/**
 * Mac worker: is this snapshot due? Hourly, or sooner when a reader asked (refreshRequestedAt after the last pull).
 * @returns {false|'scheduled'|'requested'}
 */
export function recentPullDue(snap, now = Date.now(), everyMs = SCHEDULED_PULL_MS) {
  if (!snap || !Number.isFinite(snap.pulledAt)) return 'scheduled';
  if (Number.isFinite(snap.refreshRequestedAt) && snap.refreshRequestedAt > snap.pulledAt) return 'requested';
  return now - snap.pulledAt >= everyMs ? 'scheduled' : false;
}

/**
 * The orchestrator behind the tool. `runBird` is null where bird cannot run (Vercel): then only snapshots are served.
 * @param {{runBird?:Function|null, store?:object, readMonitor?:Function|null, now?:()=>number, ttlMs?:number}} deps
 * @returns {(a:{clientId:string, handle:string, hours?:number})=>Promise<object>}
 */
export function createRecentPostsReader({ runBird = null, store = createMemoryRecentPostsStore(), readMonitor = null, now = Date.now, ttlMs = RECENT_CACHE_TTL_MS } = {}) {
  const mem = new Map(); // key -> snapshot (15 min in-process cache, also dedupes a burst of tool calls)
  const inflight = new Map();
  let cooldownUntil = 0; // after a 429 do not hit bird again for a few minutes
  const bird = runBird ? readOnlyBird(runBird) : null;

  async function livePull(key, clientId, handle) {
    let prev = mem.get(key) ?? null;
    if (!prev) { try { prev = await store.get(key); } catch { prev = null; } }
    const stdout = await bird(birdArgsFor(handle));
    const snap = buildSnapshot({ raws: parseTimeline(stdout), handle, pulledAt: now(), clientId, prev });
    if (!snap.rows.length) throw Object.assign(new Error('bird returned no posts'), { code: 'NO_POSTS' });
    mem.set(key, snap);
    try { await store.put(key, snap); } catch { /* cache write is best effort */ }
    return snap;
  }

  async function monitorFor(clientId) {
    if (typeof readMonitor !== 'function') return null;
    try {
      const a = await readMonitor(clientId);
      const asOf = Math.max(0, ...[a?.account?.sync?.postsAt].map(Number).filter(Number.isFinite)) || null;
      if (!asOf) return null;
      const byId = new Map((a.posts || []).map((p) => [String(p.id), finite(p.metrics?.impressions)]).filter(([, v]) => v !== null));
      return { asOf, byId, audience: a };
    } catch { return null; }
  }

  return async function readRecentPosts({ clientId, handle, hours } = {}) {
    const h = String(handle || '').replace(/^@+/, '').toLowerCase();
    if (!h) return { available: false, reason: 'no handle' };
    const key = `${clientId}__${h}`;
    const t = now();
    const extra = [];

    let snap = mem.get(key) ?? null;
    let source = 'bird-cache';
    if (!snap) {
      try { snap = await store.get(key); } catch { snap = null; }
      source = 'bird-snapshot';
    }
    let fresh = snap && t - snap.pulledAt < ttlMs;

    if (!fresh && bird) {
      if (t < cooldownUntil) {
        extra.push('bird was rate-limited (HTTP 429) a moment ago; serving the last snapshot. Try again in a few minutes.');
      } else {
        try {
          if (!inflight.has(key)) inflight.set(key, livePull(key, clientId, h).finally(() => inflight.delete(key)));
          snap = await inflight.get(key);
          source = 'bird-live';
          fresh = true;
        } catch (err) {
          const kind = classifyBirdError(err);
          if (kind === BIRD_FAILURE.RATE_LIMITED) cooldownUntil = now() + RATE_LIMIT_COOLDOWN_MS;
          extra.push(`live pull failed (${kind}); ${snap ? 'serving the last snapshot' : 'no snapshot available'}.`);
        }
      }
    }

    // No bird here (Vercel): a stale read asks the Mac worker for a pull (it drains every 60s), at most every few minutes.
    if (!fresh && !bird && typeof store.requestRefresh === 'function') {
      const asked = Number(snap?.refreshRequestedAt);
      const pending = Number.isFinite(asked) && asked > (snap?.pulledAt ?? 0);
      if (pending && t - asked < REFRESH_REQUEST_COOLDOWN_MS) {
        extra.push('A fresh pull is already requested from the Mac worker; ask again in about a minute.');
      } else {
        try {
          await store.requestRefresh(key, t);
          if (snap) snap = { ...snap, refreshRequestedAt: t };
          extra.push('Requested a fresh pull from the Mac worker (it runs every 60s); ask again in about a minute for newer numbers.');
        } catch { /* best effort */ }
      }
    }

    const monitor = await monitorFor(clientId);
    if (snap) {
      if (!fresh && !bird) extra.push('bird cannot run on this deployment (it needs the Mac\'s browser cookies); this is the last snapshot the Mac wrote (it re-pulls hourly).');
      return shapeRecentPosts(snap, { hours, now: t, source, monitor, caveats: extra });
    }
    const fallback = monitor ? snapshotFromMonitor(monitor.audience, { handle: h, hours, now: t }) : null;
    if (fallback) {
      return shapeRecentPosts(fallback, { hours, now: t, source: 'x-monitor', caveats: [...extra, 'No bird data: views are X Monitor impressions from its last paid sync (see asOf). No bookmarks / quoted-post split.'] });
    }
    return { available: false, reason: bird ? 'no posts could be read (bird failed and no snapshot or X Monitor data)' : 'no snapshot yet and bird cannot run here: run scripts/x-content/pull-recent-posts.mjs on the Mac', handle: h, caveats: extra };
  };
}
