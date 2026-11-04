// calendar-sync.js — one client's calendar also posts on another client's accounts.
//
//   client_configs/{viewer}.calendarSyncs = [
//     { clientId: 'bai-ees-discogs-TP37NQG0', x: 'copy', instagram: 'copy', offsetMinutes: 0 },
//   ]
//
// The viewer (e.g. the HITLOOP home client) opts in to a SOURCE client's calendar. Every scheduled source post
// gets a MIRROR row on the viewer's own calendar: a normal social_posts row owned by the viewer (clientId = viewer)
// that publishes through the viewer's own connected accounts via the unchanged due sweep. Nothing about delivery,
// ledgers, approvals or calendar views changes — a mirror is just another scheduled post, marked:
//
//   source: 'calendar-sync', mirrorOf: { clientId, postId, key, hash }
//
// Modes per network — x: 'copy' (own original post) | 'repost' (retweet the source's live tweet) | 'off';
// instagram: 'copy' | 'off'. One mirror row per source post carries both networks when x is 'copy'; when x is
// 'repost' (or 'off') and Instagram is on, the Instagram leg is a second, Instagram-only row (a repost row cannot
// carry Instagram). Instagram is only targeted when the source has media and the viewer has a connected account.
//
// Reconcile, not events: `planCalendarSync` is pure and idempotent over the two queues; the runner executes it on
// every due sweep (every 15 min), when the owner saves the toggle, and on demand. Rules:
//   - only scheduled/queued source rows are mirrored (copy); repost needs the source already posted (twitterId)
//   - never a mirror of a mirror, a reply, a manual row, or (copy mode) a repost row
//   - a mirror the owner rejected/expired for the SAME content stays rejected (an owner cancel wins over the sync)
//   - a source edit (text / media / time) retires the open mirror and creates a fresh one; posted mirrors are kept
//   - a source unscheduled/rejected/removed retires its open mirrors (scheduled/queued only; never a posted row)
//   - the viewer's own open copy of the same package blocks the mirror (schedulePost's package-collision rule)
// Spend: the toggle is the owner's standing consent; every mirror is an X write on the viewer's account.

import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const CLIENT_ID_RE = /^[A-Za-z0-9_-]{3,80}$/;
export const MAX_CALENDAR_SYNCS = 10;
export const X_MODES = ['copy', 'repost', 'off'];
export const INSTAGRAM_MODES = ['copy', 'off'];
export const MAX_OFFSET_MINUTES = 7 * 24 * 60;
export const MIN_LEAD_MS = 2 * 60_000; // a mirror is never scheduled closer than this to "now"
export const REPOST_WINDOW_MS = 48 * 3_600_000; // repost only a source tweet this fresh
export const SOURCE = 'calendar-sync';

const OPEN_MIRROR = new Set(['scheduled', 'queued', 'posting', 'posted', 'manual', 'needs_review', 'failed']);
const RETIRABLE = new Set(['scheduled', 'queued']);
// A mirror the OWNER took off the calendar (unscheduled to draft/approved, rejected, or left to expire). A row the
// sync itself retired (rejected with reviewedBy = SOURCE) is not a decision and never blocks a fresh mirror.
const declinedByOwner = (r) => !OPEN_MIRROR.has(r.status) && !(r.status === 'rejected' && r.reviewedBy === SOURCE);

const database = (db) => db || require('../../api/_lib/firebase-admin.cjs').adminDb;

/** Pure. One config entry; null when unusable. */
function normalizeEntry(v, selfId) {
  if (!v || typeof v !== 'object') return null;
  const clientId = typeof v.clientId === 'string' ? v.clientId.trim() : '';
  if (!CLIENT_ID_RE.test(clientId) || clientId === selfId) return null;
  const x = X_MODES.includes(v.x) ? v.x : 'copy';
  const instagram = INSTAGRAM_MODES.includes(v.instagram) ? v.instagram : 'off';
  const n = Number(v.offsetMinutes);
  const offsetMinutes = Number.isFinite(n) ? Math.max(0, Math.min(MAX_OFFSET_MINUTES, Math.round(n))) : 0;
  return { clientId, x, instagram, offsetMinutes };
}

/** Pure. Clean sync entries: valid, de-duplicated (first wins), never the viewer itself, capped, no all-off rows. */
export function normalizeCalendarSyncs(raw, selfId = null) {
  if (!Array.isArray(raw)) return [];
  const self = typeof selfId === 'string' ? selfId.trim() : '';
  const out = [];
  for (const v of raw) {
    const e = normalizeEntry(v, self);
    if (!e || (e.x === 'off' && e.instagram === 'off') || out.some((o) => o.clientId === e.clientId)) continue;
    out.push(e);
    if (out.length >= MAX_CALENDAR_SYNCS) break;
  }
  return out;
}

export async function readCalendarSyncs(clientId, { db } = {}) {
  const id = typeof clientId === 'string' ? clientId.trim() : '';
  if (!CLIENT_ID_RE.test(id)) return [];
  const snap = await database(db).collection('client_configs').doc(id).get();
  return snap.exists ? normalizeCalendarSyncs(snap.data()?.calendarSyncs, id) : [];
}

export async function writeCalendarSyncs(clientId, raw, { db } = {}) {
  const next = normalizeCalendarSyncs(raw, clientId);
  await database(db).collection('client_configs').doc(clientId).set({ calendarSyncs: next }, { merge: true });
  return next;
}

export const isMirror = (post) => Boolean(post?.mirrorOf && typeof post.mirrorOf === 'object' && post.mirrorOf.postId);
export const mirrorKey = (sourceClientId, postId, leg) => `${SOURCE}:${sourceClientId}:${postId}:${leg}`;

const hashOf = (parts) => createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 16);

const mediaOf = (post) => (post?.mediaUrl ? {
  mediaUrl: post.mediaUrl,
  mediaType: post.mediaType || null,
  mediaStoragePath: post.mediaStoragePath || null,
  mediaContentType: post.mediaContentType || null,
} : null);

/** Why a source row cannot be mirrored at all ('' = it can). Pure. */
export function sourceBlockReason(post) {
  if (!post) return 'missing';
  if (isMirror(post)) return 'is-a-mirror';
  if (post.replyTo && (post.replyTo.url || post.replyTo.author || post.replyTo.text)) return 'reply';
  if (post.status === 'manual') return 'manual';
  if (post.status === 'rejected' || post.status === 'expired') return post.status;
  return '';
}

const scheduleMs = (fromMs, offsetMinutes, nowMs) => Math.max(fromMs + offsetMinutes * 60_000, nowMs + MIN_LEAD_MS);

/**
 * Pure. The mirror rows one source post wants under `entry`, as schedulePost payloads (without clientId).
 * `igAllowed` = the viewer has a usable Instagram account. Empty when nothing should be mirrored.
 */
export function desiredMirrors(sourcePost, entry, { viewer, nowMs, igAllowed = false }) {
  if (sourceBlockReason(sourcePost)) return [];
  const src = sourcePost.clientId || entry.clientId;
  const media = mediaOf(sourcePost);
  const wantIg = entry.instagram === 'copy' && igAllowed && Boolean(media) && sourcePost.kind !== 'repost';
  const out = [];
  const scheduled = (sourcePost.status === 'scheduled' || sourcePost.status === 'queued') && Number.isFinite(Date.parse(sourcePost.scheduledAt || ''));
  const base = (leg, extra, hashParts) => {
    const key = mirrorKey(src, sourcePost.id, leg);
    const hash = hashOf(hashParts);
    return {
      key,
      hash,
      payload: {
        source: SOURCE,
        idempotencyKey: `${key}:${hash}`,
        mirrorOf: { clientId: src, postId: sourcePost.id, key, hash },
        ...(sourcePost.packageId ? { packageId: sourcePost.packageId } : {}),
        ...(sourcePost.engine ? { engine: sourcePost.engine } : {}),
        ...(sourcePost.bucketId ? { bucketId: sourcePost.bucketId } : {}),
        ...extra,
      },
    };
  };

  if (entry.x === 'copy' && scheduled && sourcePost.kind !== 'repost') {
    const at = new Date(scheduleMs(Date.parse(sourcePost.scheduledAt), entry.offsetMinutes, nowMs)).toISOString();
    out.push(base('x', {
      content: sourcePost.content,
      ...(media || {}),
      scheduledAt: at,
      targets: { x: true, instagram: wantIg },
    }, ['copy', sourcePost.content, media, sourcePost.scheduledAt, entry.offsetMinutes, wantIg]));
    return out;
  }

  if (entry.x === 'repost' && sourcePost.status === 'posted' && sourcePost.twitterId && sourcePost.kind !== 'repost') {
    const postedMs = Date.parse(sourcePost.postedAt || sourcePost.updatedAt || '');
    if (Number.isFinite(postedMs) && nowMs - postedMs <= REPOST_WINDOW_MS) {
      const at = new Date(scheduleMs(postedMs, entry.offsetMinutes, nowMs)).toISOString();
      out.push(base('x', {
        kind: 'repost',
        repostOf: { tweetId: sourcePost.twitterId },
        content: `Repost ${sourcePost.twitterId}`,
        scheduledAt: at,
        targets: { x: true, instagram: false },
      }, ['repost', sourcePost.twitterId, entry.offsetMinutes]));
    }
  }

  // Instagram-only companion when the X leg is not a copy row (repost / off).
  if (wantIg && scheduled && entry.x !== 'copy') {
    const at = new Date(scheduleMs(Date.parse(sourcePost.scheduledAt), entry.offsetMinutes, nowMs)).toISOString();
    out.push(base('ig', {
      content: sourcePost.content,
      ...media,
      scheduledAt: at,
      targets: { x: false, instagram: true },
    }, ['ig', sourcePost.content, media, sourcePost.scheduledAt, entry.offsetMinutes]));
  }
  return out;
}

/**
 * Pure. Reconcile one sync entry: what to create and what to retire on the viewer's calendar.
 *   sourcePosts  = the source client's queue (readSocialQueue(entry.clientId))
 *   viewerPosts  = the viewer's queue (readSocialQueue(viewer))
 * Returns { create: [{ key, hash, payload }], retire: [mirrorRow], keep: [mirrorRow], skipped: [{ postId, reason }] }.
 */
export function planCalendarSync({ entry, viewer, sourcePosts, viewerPosts, nowMs = Date.now(), igAllowed = false }) {
  const mirrors = (Array.isArray(viewerPosts) ? viewerPosts : []).filter((p) => isMirror(p) && p.mirrorOf.clientId === entry.clientId);
  const byKey = new Map();
  for (const m of mirrors) {
    const k = m.mirrorOf.key;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(m);
  }
  const wantedKeys = new Set();
  const create = [];
  const retire = [];
  const keep = [];
  const skipped = [];

  for (const src of Array.isArray(sourcePosts) ? sourcePosts : []) {
    if (!src?.id) continue;
    const why = sourceBlockReason(src);
    if (why) { if (why !== 'rejected' && why !== 'expired') skipped.push({ postId: src.id, reason: why }); continue; }
    for (const want of desiredMirrors(src, entry, { viewer, nowMs, igAllowed })) {
      wantedKeys.add(want.key);
      const rows = byKey.get(want.key) || [];
      const open = rows.filter((r) => OPEN_MIRROR.has(r.status));
      const same = open.find((r) => r.mirrorOf.hash === want.hash);
      if (same) { keep.push(same); continue; }
      // The owner cancelled this exact mirror (or it missed its window): do not bring it back.
      if (rows.some((r) => r.mirrorOf.hash === want.hash && declinedByOwner(r))) { skipped.push({ postId: src.id, reason: 'declined' }); continue; }
      const live = open.filter((r) => !RETIRABLE.has(r.status));
      if (live.length) { keep.push(...live); skipped.push({ postId: src.id, reason: 'already-live' }); continue; }
      retire.push(...open); // stale copy (source edited): replace it
      create.push(want);
    }
  }
  // Mirrors whose source no longer wants them (unscheduled, rejected, deleted, mode changed).
  for (const [key, rows] of byKey) {
    if (wantedKeys.has(key)) continue;
    for (const r of rows) if (RETIRABLE.has(r.status)) retire.push(r);
  }
  return { create, retire, keep, skipped };
}

/** The viewer's Instagram account can take a cross-post right now (connected, not expired). */
export const instagramUsable = (account) => Boolean(account?.accessToken && account?.userId && !(account.expiresAt && account.expiresAt <= Date.now()));

/**
 * Run every sync entry of `viewer`. deps: { svc (twitter-service), getInstagramAccount(clientId), db, nowMs }.
 * Each create/retire is attempted independently; a failure is reported, never thrown, so one bad row cannot stall
 * the due sweep that follows. Returns { viewer, entries: [{ clientId, created, retired, kept, skipped, errors }] }.
 */
export async function runCalendarSync(viewer, { svc, getInstagramAccount, db, nowMs = Date.now(), entries = null } = {}) {
  const service = svc || await import('./twitter-service.js');
  const list = entries ?? await readCalendarSyncs(viewer, { db });
  if (!list.length) return { viewer, entries: [] };
  const getIg = getInstagramAccount || (async (id) => (await import('./social-accounts.js')).getSocialAccount(id, 'instagram'));
  const igAllowed = list.some((e) => e.instagram === 'copy') ? instagramUsable(await getIg(viewer).catch(() => null)) : false;
  const viewerPosts = await service.readSocialQueue(viewer);
  const out = [];
  for (const entry of list) {
    const result = { clientId: entry.clientId, created: 0, retired: 0, kept: 0, skipped: [], errors: [] };
    let sourcePosts;
    try {
      sourcePosts = await service.readSocialQueue(entry.clientId);
    } catch (err) {
      result.errors.push({ stage: 'read', message: err.message || String(err) });
      out.push(result);
      continue;
    }
    const plan = planCalendarSync({ entry, viewer, sourcePosts, viewerPosts, nowMs, igAllowed });
    result.kept = plan.keep.length;
    result.skipped = plan.skipped;
    for (const m of plan.retire) {
      try {
        await retireMirror(service, viewer, m);
        result.retired += 1;
      } catch (err) {
        result.errors.push({ stage: 'retire', postId: m.id, message: err.message || String(err) });
      }
    }
    for (const want of plan.create) {
      try {
        await service.schedulePost(viewer, { ...want.payload, reviewedAt: new Date(nowMs).toISOString() }, {
          by: SOURCE,
          planOverride: { by: SOURCE, reason: `Synced from the ${entry.clientId} calendar` },
        });
        result.created += 1;
      } catch (err) {
        result.errors.push({ stage: 'create', sourcePostId: want.payload.mirrorOf.postId, code: err.code || null, message: err.message || String(err) });
      }
    }
    out.push(result);
  }
  return { viewer, entries: out };
}

// scheduled/queued -> unscheduled -> (unapproved) -> rejected. Only these two statuses ever reach here (RETIRABLE).
async function retireMirror(service, viewer, mirror) {
  const unscheduled = await service.updateSocialPost(viewer, mirror.id, { scheduledAt: null });
  const draft = unscheduled.status === 'approved' ? await service.unapproveDraft(viewer, unscheduled.id) : unscheduled;
  return service.rejectDraft(viewer, draft.id, { reviewedBy: SOURCE });
}

/** Every client with at least one sync entry (client_configs is small; filtered in memory, no index). */
export async function listCalendarSyncViewers({ db } = {}) {
  const snap = await database(db).collection('client_configs').get();
  const out = [];
  for (const doc of snap.docs) {
    const entries = normalizeCalendarSyncs(doc.data()?.calendarSyncs, doc.id);
    if (entries.length) out.push({ viewer: doc.id, entries });
  }
  return out;
}

/** Cron entry: reconcile every viewer. Never throws. */
export async function runCalendarSyncForAllClients(deps = {}) {
  let viewers = [];
  try {
    viewers = await listCalendarSyncViewers(deps);
  } catch (err) {
    return { ok: false, error: err.message || String(err), viewers: [] };
  }
  const results = [];
  for (const { viewer, entries } of viewers) {
    try {
      results.push(await runCalendarSync(viewer, { ...deps, entries }));
    } catch (err) {
      results.push({ viewer, entries: [], error: err.message || String(err) });
    }
  }
  return { ok: true, viewers: results };
}
