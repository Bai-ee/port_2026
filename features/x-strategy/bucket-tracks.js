// bucket-tracks.js — content tracks follow Content Center buckets (docs/source-of-truth/CONTENT-TRACKS.md § Bucket tracks).
// Every active bucket is exactly one track: same name, `buckets: [bucketId]`, and the engine of the same id when the
// bucket is one of the built-in engine buckets (record, ue, client, identity). Nobody adds or removes tracks by hand;
// bucket create / rename / delete and every Strategy load run syncBucketTracks, and a second run changes nothing.
//
// The first sync of a plan with grouped tracks migrates it: each bucket inherits benchmarks, lists, topics and the
// promotions of its own engine from the grouped track that held its items, and that track's share is split evenly
// across its buckets. Settings of an existing bucket track are never touched here, only its name and engine.

import { ENGINE_IDS, isEngine } from '../x-content-inventory/engines.js';
import { MAX_TRACKS, isBucketId, normalizeContentTracks } from './content-tracks.js';

const TRACK_ID_MAX = 32;

/** The bucket a track stands for (a bucket track lists exactly one bucket), else null (a grouped/legacy track). */
export const trackBucketOf = (t) => (Array.isArray(t?.buckets) && t.buckets.length === 1 ? t.buckets[0] : null);

function uniqueId(base, used) {
  let id = base;
  for (let n = 2; used.has(id); n += 1) id = `${base.slice(0, TRACK_ID_MAX - String(n).length - 1)}-${n}`;
  used.add(id);
  return id;
}

/**
 * Pure. The bucket tracks for `buckets` (listBuckets() rows, in order), given the plan's stored tracks.
 * `engineHints` = { bucketId: engine } for buckets that are not engine ids (e.g. `nas`): the engine of one of its
 * items, used only to find the grouped track it migrates from. At most MAX_TRACKS buckets become tracks.
 * An engine whose built-in bucket is inactive joins the first track (every engine must belong to a track).
 */
export function bucketTracks(existing, buckets, { engineHints = {} } = {}) {
  const active = (buckets || []).filter((b) => b && b.active !== false && isBucketId(b.id)).slice(0, MAX_TRACKS);
  if (!active.length) return [];
  const prior = Array.isArray(existing) ? existing : [];
  const own = new Map();
  for (const t of prior) {
    const b = trackBucketOf(t);
    if (b && !own.has(b)) own.set(b, t);
  }
  const legacy = prior.filter((t) => !trackBucketOf(t));
  const sourceOf = (b) => {
    const listed = legacy.find((t) => (t.buckets || []).includes(b.id));
    if (listed) return listed;
    const engine = isEngine(b.id) ? b.id : engineHints[b.id];
    return engine ? legacy.find((t) => (t.engines || []).includes(engine)) || null : null;
  };

  const rows = active.map((b) => ({ b, kept: own.get(b.id) || null, source: own.has(b.id) ? null : sourceOf(b) }));
  const heirs = new Map();
  for (const r of rows) if (r.source) heirs.set(r.source, (heirs.get(r.source) || 0) + 1);
  const used = new Set(rows.filter((r) => r.kept).map((r) => r.kept.id));

  const tracks = rows.map(({ b, kept, source }) => {
    const label = String(b.name || b.id).trim().slice(0, 60) || b.id;
    const engines = isEngine(b.id) ? [b.id] : [];
    if (kept) return { ...kept, label, engines, buckets: [b.id] };
    return {
      id: uniqueId(b.id.slice(0, TRACK_ID_MAX), used),
      label, engines, buckets: [b.id],
      benchmarks: [...(source?.benchmarks || [])],
      lists: (source?.lists || []).map((l) => ({ ...l })),
      topics: [...(source?.topics || [])],
      promotions: (source?.promotions || []).map((p) => ({ ...p })),
      share: source ? (Number(source.share) || 0) / heirs.get(source) : 0,
    };
  });

  const owned = new Set(tracks.flatMap((t) => t.engines));
  const orphans = ENGINE_IDS.filter((e) => !owned.has(e));
  if (orphans.length) tracks[0] = { ...tracks[0], engines: [...tracks[0].engines, ...orphans] };
  for (let i = 0; i < tracks.length; i += 1) {
    tracks[i] = { ...tracks[i], promotions: (tracks[i].promotions || []).filter((p) => tracks[i].engines.includes(p.engine)) };
  }
  if (tracks.reduce((s, t) => s + (Number(t.share) || 0), 0) <= 0) tracks.forEach((t) => { t.share = 1 / tracks.length; });
  return tracks;
}

const normalizedJson = (tracks) => {
  try { return JSON.stringify(normalizeContentTracks(tracks)); } catch { return null; }
};

/**
 * Bring a client's saved plan in step with its buckets. Only a client with a saved plan (version > 0) is synced; a
 * client without one is left alone (its first plan save is the owner's call). Writes through `planStore.apply`
 * (versioned, so Revert works) only when the normalized tracks differ.
 * readBuckets(clientId) -> listBuckets() rows | null; readBucketEngine(clientId, bucketId) -> engine of one item | null.
 * Returns the apply result, or { changed:false, skipped? }.
 */
export async function syncBucketTracks(clientId, { planStore, readBuckets, readBucketEngine = null, by = 'content-center', now } = {}) {
  const doc = await planStore.get(clientId);
  if (!doc?.version) return { changed: false, skipped: 'no-plan' };
  const buckets = await readBuckets(clientId);
  if (!Array.isArray(buckets)) return { changed: false, skipped: 'no-buckets' };
  const existing = Array.isArray(doc.plan?.contentTracks) ? doc.plan.contentTracks : [];
  const engineHints = {};
  if (typeof readBucketEngine === 'function' && existing.some((t) => !trackBucketOf(t))) {
    for (const b of buckets) {
      if (b?.active === false || !isBucketId(b?.id) || isEngine(b.id) || existing.some((t) => trackBucketOf(t) === b.id)) continue;
      const engine = await Promise.resolve(readBucketEngine(clientId, b.id)).catch(() => null);
      if (isEngine(engine)) engineHints[b.id] = engine;
    }
  }
  const next = bucketTracks(existing, buckets, { engineHints });
  if (normalizedJson(existing) === normalizedJson(next)) return { changed: false };
  return planStore.apply(clientId, {
    changes: { contentTracks: next }, expectedVersion: doc.version, by, source: 'manual',
    reason: 'Content tracks follow Content Center buckets', ...(now != null ? { now } : {}),
  });
}
