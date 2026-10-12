// Live sync: EditVideos renders -> rv-<jobId> ContentPackages (Content Engine v2 §5.2).
//
// Backs the `sync-rendered-videos` route action. All I/O is injected so tests use
// fakes; the route wires the real bridge + Firestore.
//
// PRESERVATION RULES (a sync may refresh machine fields only):
//   refreshed : title, facets (genres/eraYear kept when the source can't supply
//               them), source, assetRefs, posterRef, tags (human-added tags kept),
//               entities, renderedAt, mediaState, format, variants.x.suggestedStory,
//               rights + rightsSource (+ approval, only while it is still none/needed)
//               ONLY while `rightsSetBy !== 'human'` (owner decision D1).
//   NEVER     : story, humanEdits, a human/approved approval, lastPostedAt, postCount,
//               bucketId, thumbRef, rightsSetBy/At, any other field.
//   RETIRE    : a stored rv- row missing from a COMPLETE, non-empty upstream listing
//               gets status 'retired' + retiredReason 'source-missing' (never deleted).
//               Only when `listVideos` reports `complete:true`; a bare array = unknown
//               completeness = no invalidation. If the row reappears it is restored.
// A package whose machine-field hash (`syncHash`) is unchanged is skipped with no write.

import { createHash } from 'node:crypto';
import { mapRenderedVideos } from './adapter.js';
import { normalizeFacets, buildSearchTokens } from '../x-content-inventory/facets.js';

export const SYNC_THROTTLE_MS = 10 * 60 * 1000;
const MACHINE_TAGS = new Set(['rendered-video', 'auto-daily', 'deliberate', 'origin-unknown', 'mix-unknown', 'artist-unknown', 'rights:third-party-unconfirmed', 'rights:ue-hosted-cleared']);
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
    ...(fresh.durationSec ? { durationSec: fresh.durationSec } : {}),
    mediaState: fresh.mediaState,
    format: fresh.format,
    eraYear: eraYear ?? null,
    suggestedStory: fresh.variants?.x?.suggestedStory ?? null,
    ...(humanRights ? {} : rightsFields(fresh, existing)),
  };
}

// D1 policy fields; approval is only touched while no human/approved decision is on it.
function rightsFields(fresh, existing) {
  const out = { rights: fresh.rights, rightsSource: fresh.rightsSource ?? null };
  const state = existing?.approval?.state;
  if (!existing || !state || state === 'none' || state === 'needed') out.approval = fresh.approval;
  return out;
}

function applyMachine(existing, m) {
  const { suggestedStory, rightsSource, ...rest } = m;
  const next = { ...existing, ...rest };
  if (rightsSource) next.rightsSource = rightsSource;
  else if ('rightsSource' in m) delete next.rightsSource;
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
 *  listVideos(): Promise<videoDoc[] | {videos: videoDoc[], complete: boolean}>,
 *  listStored?(): Promise<storedPkg[]>,                        // rv- rows; enables retire-on-missing
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

  const listed = await deps.listVideos();
  // Array = legacy shape (completeness unknown); {videos, complete} = explicit.
  const videos = Array.isArray(listed) ? listed : (listed?.videos || []);
  const complete = !Array.isArray(listed) && listed?.complete === true && videos.length > 0;
  const ids = [...new Set(videos.map((v) => `rv-${String(v.jobId || v.videoId || v.id || '').trim()}`))].filter((x) => x !== 'rv-');
  const existingMap = await deps.readExisting(ids);
  const newJobIds = ids.filter((id) => !existingMap.has(id)).map((id) => id.slice(3));
  const mediaJobsByEditJobId = newJobIds.length ? await deps.listMediaJobs(newJobIds) : new Map();

  const { packages } = mapRenderedVideos(videos, { ueArtists: deps.ueArtists || [], mediaJobsByEditJobId, now });
  const counts = { created: 0, updated: 0, unchanged: 0, retired: 0, restored: 0, total: packages.length };
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
    const comeback = existing.status === 'retired' && existing.retiredReason === 'source-missing';
    if (existing.syncHash === h && !comeback) { counts.unchanged += 1; continue; }
    const next = { ...applyMachine({ ...existing, id: fresh.id }, m), syncHash: h };
    if (comeback) { next.status = existing.retiredFromStatus || 'idea'; delete next.retiredReason; delete next.retiredAt; delete next.retiredFromStatus; }
    writes.push({ kind: comeback ? 'restored' : 'updated', pkg: next });
  }

  if (complete && deps.listStored) {
    const present = new Set(packages.map((p) => p.id));
    const iso = new Date(now).toISOString();
    for (const row of (await deps.listStored()) || []) {
      if (!row?.id || !String(row.id).startsWith('rv-') || present.has(row.id) || row.status === 'retired') continue;
      writes.push({ kind: 'retired', pkg: { ...row, retiredFromStatus: row.status || 'idea', status: 'retired', retiredReason: 'source-missing', retiredAt: iso } });
    }
  }

  await pool(writes, deps.concurrency || 8, async (w) => { await deps.upsert(w.pkg); counts[w.kind] += 1; });

  const lastSyncAt = new Date(now).toISOString();
  await deps.writeMeta({ lastSyncAt, lastSyncAtMs: now, counts });
  return { ok: true, created: counts.created, updated: counts.updated, unchanged: counts.unchanged, retired: counts.retired, restored: counts.restored, total: counts.total, lastSyncAt };
}
