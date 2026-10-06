// Live sync: EditVideos renders -> rv-<jobId> ContentPackages (Content Engine v2 §5.2).
//
// Backs the `sync-rendered-videos` route action. All I/O is injected so tests use
// fakes; the route wires the real bridge + Firestore.
//
// PRESERVATION RULES (a sync may refresh machine fields only):
//   refreshed : title, facets (genres/eraYear kept when the source can't supply
//               them), source, assetRefs, posterRef, tags (human-added tags kept),
//               entities, renderedAt, mediaState, format, variants.x.suggestedStory,
//               rights ONLY while `rightsSetBy !== 'human'`.
//   NEVER     : story, humanEdits, approval, status, lastPostedAt, postCount,
//               bucketId, thumbRef, rightsSetBy/At, any other field.
// A package whose machine-field hash (`syncHash`) is unchanged is skipped with no write.

import { createHash } from 'node:crypto';
import { mapRenderedVideos } from './adapter.js';
import { normalizeFacets, buildSearchTokens } from '../x-content-inventory/facets.js';

export const SYNC_THROTTLE_MS = 10 * 60 * 1000;
const MACHINE_TAGS = new Set(['rendered-video', 'auto-daily', 'deliberate', 'origin-unknown', 'mix-unknown', 'artist-unknown', 'rights:third-party-unconfirmed']);
const ORIGIN_TAGS = ['auto-daily', 'deliberate', 'origin-unknown'];

const stable = (v) => JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x)
  ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x));
export const hashOf = (v) => createHash('sha1').update(stable(v)).digest('hex').slice(0, 16);

/** The machine-owned slice of a freshly mapped package, merged against what is stored. */
export function machineFields(fresh, existing) {
  let tags = fresh.tags;
  if (existing) {
    // Origin is decided at first sight (media_jobs join is skipped for known rows).
    const keptOrigin = (existing.tags || []).find((t) => ORIGIN_TAGS.includes(t));
    if (keptOrigin) tags = [...new Set([...tags.filter((t) => !ORIGIN_TAGS.includes(t)), keptOrigin])];
    tags = [...new Set([...tags, ...(existing.tags || []).filter((t) => !MACHINE_TAGS.has(t))])];
  }
  tags = [...new Set(tags)].sort();
  const facets = { ...(fresh.facets || {}) };
  let eraYear = fresh.eraYear;
  if (existing) {
    if (!(facets.genres || []).length && (existing.facets?.genres || []).length) facets.genres = existing.facets.genres;
    if (eraYear == null && existing.eraYear != null) eraYear = existing.eraYear;
    if (facets.eraYear == null && existing.facets?.eraYear != null) facets.eraYear = existing.facets.eraYear;
  }
  const humanRights = existing?.rightsSetBy === 'human';
  return {
    title: fresh.title,
    facets: normalizeFacets(facets),
    source: fresh.source,
    assetRefs: fresh.assetRefs,
    ...(fresh.posterRef ? { posterRef: fresh.posterRef } : {}),
    tags,
    entities: fresh.entities,
    renderedAt: fresh.renderedAt,
    mediaState: fresh.mediaState,
    format: fresh.format,
    eraYear: eraYear ?? null,
    suggestedStory: fresh.variants?.x?.suggestedStory ?? null,
    ...(humanRights ? {} : { rights: fresh.rights }),
  };
}

function applyMachine(existing, m) {
  const { suggestedStory, ...rest } = m;
  const next = { ...existing, ...rest };
  if (suggestedStory) next.variants = { ...(existing.variants || {}), x: { ...(existing.variants?.x || {}), suggestedStory } };
  next.searchTokens = buildSearchTokens(next);
  return next;
}

async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const item = items[i++]; await fn(item); }
  }));
}

/**
 * deps: {
 *  listVideos(): Promise<videoDoc[]>,
 *  listMediaJobs(editJobIds[]): Promise<Map<string,object>>,   // only called for NEW ids
 *  readExisting(ids[]): Promise<Map<string,object>>,           // bulk, no seed overlay
 *  upsert(pkg): Promise<any>,
 *  readMeta(): Promise<object|null>, writeMeta(obj): Promise<void>,
 *  now(): number, ueArtists?: object[], concurrency?: number }
 */
export async function syncRenderedVideos(deps, { force = false } = {}) {
  const now = deps.now ? deps.now() : Date.now();
  const meta = (await deps.readMeta()) || {};
  if (!force && Number.isFinite(meta.lastSyncAtMs) && now - meta.lastSyncAtMs < SYNC_THROTTLE_MS) {
    const c = meta.counts || {};
    return { ok: true, throttled: true, created: c.created ?? 0, updated: c.updated ?? 0, unchanged: c.unchanged ?? 0, total: c.total ?? 0, lastSyncAt: meta.lastSyncAt ?? null };
  }

  const videos = await deps.listVideos();
  const ids = [...new Set(videos.map((v) => `rv-${String(v.jobId || v.videoId || v.id || '').trim()}`))].filter((x) => x !== 'rv-');
  const existingMap = await deps.readExisting(ids);
  const newJobIds = ids.filter((id) => !existingMap.has(id)).map((id) => id.slice(3));
  const mediaJobsByEditJobId = newJobIds.length ? await deps.listMediaJobs(newJobIds) : new Map();

  const { packages } = mapRenderedVideos(videos, { ueArtists: deps.ueArtists || [], mediaJobsByEditJobId, now });
  const counts = { created: 0, updated: 0, unchanged: 0, total: packages.length };
  const writes = [];

  for (const fresh of packages) {
    const existing = existingMap.get(fresh.id) || null;
    if (!existing) {
      const m = machineFields(fresh, null);
      writes.push({ kind: 'created', pkg: { ...fresh, syncHash: hashOf(m) } });
      continue;
    }
    const m = machineFields(fresh, existing);
    const h = hashOf(m);
    if (existing.syncHash === h) { counts.unchanged += 1; continue; }
    writes.push({ kind: 'updated', pkg: { ...applyMachine({ ...existing, id: fresh.id }, m), syncHash: h } });
  }

  await pool(writes, deps.concurrency || 8, async (w) => { await deps.upsert(w.pkg); counts[w.kind] += 1; });

  const lastSyncAt = new Date(now).toISOString();
  await deps.writeMeta({ lastSyncAt, lastSyncAtMs: now, counts });
  return { ok: true, created: counts.created, updated: counts.updated, unchanged: counts.unchanged, total: counts.total, lastSyncAt };
}
