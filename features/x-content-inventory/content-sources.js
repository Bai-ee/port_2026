// content-sources.js — clients whose content another client may use (cross-client content sources).
//
//   client_configs/{clientId}.contentSources = [
//     { clientId: 'undergroundexistence-0CsKkpaq', bucketId: 'ue',     access: 'full' },
//     { clientId: 'bai-ees-discogs-TP37NQG0',      bucketId: 'record', access: 'full' },
//   ]
//
// Every package still belongs to exactly one client (store.js). A source grant lets the viewer read the source's
// rows and, with access 'full', edit them (upsertPackage keeps the row's owner; deletePackage still refuses).
// Rows read through a grant come back as a VIEW: `sharedFrom` = owner, `sharedWith` = viewer, and `bucketId` = the
// viewer's bucket for that source (the owner's own bucketId is kept in `ownerBucketId`). stripViewFields undoes the
// view before a write, so the owner's row never stores the viewer's bucket. A legacy string entry reads as
// { clientId, bucketId: null, access: 'read' }. Set by the owner with scripts/x-content/content-sources.mjs.

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const CLIENT_ID_RE = /^[A-Za-z0-9_-]{3,80}$/;
const BUCKET_ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
export const MAX_CONTENT_SOURCES = 10;
export const SOURCE_ACCESS = ['read', 'full'];
const VIEW_FIELDS = ['sharedFrom', 'sharedWith', 'ownerBucketId', 'readOnly'];
const CONFIGS = 'client_configs';

const database = (db) => db || require('../../api/_lib/firebase-admin.cjs').adminDb;

function normalizeEntry(v) {
  const o = typeof v === 'string' ? { clientId: v, access: 'read' } : v && typeof v === 'object' ? v : null;
  const clientId = typeof o?.clientId === 'string' ? o.clientId.trim() : '';
  if (!CLIENT_ID_RE.test(clientId)) return null;
  const bucketId = typeof o.bucketId === 'string' && BUCKET_ID_RE.test(o.bucketId.trim()) ? o.bucketId.trim() : null;
  const access = SOURCE_ACCESS.includes(o.access) ? o.access : 'full';
  return { clientId, bucketId, access };
}

/** Pure. Clean source entries: valid client ids, de-duplicated (first wins), never the viewer itself, capped. */
export function normalizeContentSources(raw, selfId = null) {
  if (!Array.isArray(raw)) return [];
  const self = typeof selfId === 'string' ? selfId.trim() : '';
  const out = [];
  for (const v of raw) {
    const e = normalizeEntry(v);
    if (!e || e.clientId === self || out.some((x) => x.clientId === e.clientId)) continue;
    out.push(e);
    if (out.length >= MAX_CONTENT_SOURCES) break;
  }
  return out;
}

/** The source entries of `clientId`, from its client_configs doc. Missing doc / field => []. */
export async function readContentSources(clientId, { db } = {}) {
  const id = typeof clientId === 'string' ? clientId.trim() : '';
  if (!CLIENT_ID_RE.test(id)) return [];
  const snap = await database(db).collection(CONFIGS).doc(id).get();
  return snap.exists ? normalizeContentSources(snap.data()?.contentSources, id) : [];
}

/** May `viewer` edit rows owned by `owner`? (a source entry with access 'full'). */
export async function canWriteFor(viewer, owner, { db } = {}) {
  if (!viewer || !owner || viewer === owner) return false;
  return (await readContentSources(viewer, { db })).some((e) => e.clientId === owner && e.access === 'full');
}

/**
 * Posting lifecycle fields are PER CLIENT on a shared row: each client schedules and posts on its own calendar and X
 * account, so one client's use must not recycle, retire or re-rank the row for another. The owner keeps them at the
 * top level; every other client keeps its own copy in `usage.{clientId}`.
 */
export const USAGE_FIELDS = ['status', 'lastPostedAt', 'postCount', 'lastTwitterId', 'lastManualPostId', 'lastPostedSelfReported'];

/** Pure. One source row as `viewer` sees it (see header): its bucket, and its own usage in place of the owner's. */
export function viewSourceRow(row, entry, viewer) {
  const mine = (row.usage && typeof row.usage === 'object' && row.usage[viewer]) || {};
  const out = { ...row, sharedFrom: row.clientId || entry.clientId, sharedWith: viewer, ownerBucketId: row.bucketId ?? null };
  delete out.usage; // other clients' usage is not this viewer's business
  for (const f of USAGE_FIELDS) delete out[f];
  // The owner retiring a row removes it for everyone; otherwise an unused row is a fresh idea for the viewer.
  out.status = row.status === 'retired' ? 'retired' : (mine.status || 'idea');
  out.lastPostedAt = mine.lastPostedAt ?? null;
  out.postCount = Number(mine.postCount) || 0;
  for (const f of ['lastTwitterId', 'lastManualPostId', 'lastPostedSelfReported']) if (mine[f] !== undefined) out[f] = mine[f];
  if (entry.bucketId) out.bucketId = entry.bucketId;
  if (entry.access !== 'full') out.readOnly = true;
  return out;
}

/**
 * Pure. A package about to be written. For its owner (`viewer` null) only stray view fields and `usage` are dropped. For a viewer
 * writing through a grant: view fields dropped, the owner's bucketId and lifecycle fields kept as stored, and the
 * viewer's lifecycle fields moved to `usage.{viewer}` (a merge write leaves other clients' usage alone).
 */
export function stripViewFields(pkg, existing, viewer = null) {
  const out = { ...pkg };
  for (const k of VIEW_FIELDS) delete out[k];
  // `usage` is only ever written below, for the writing viewer: a row read and saved back (by its owner or anyone)
  // must never replay another client's usage over newer values.
  delete out.usage;
  if (!viewer) return out;
  if (existing?.bucketId == null) delete out.bucketId; else out.bucketId = existing.bucketId;
  // Only the viewer's own VIEW carries its usage; a raw owner row passed through (e.g. a media-link patch) carries
  // the owner's lifecycle, which must not be copied into the viewer's usage.
  const isView = pkg.sharedWith === viewer;
  const use = {};
  for (const f of USAGE_FIELDS) {
    if (isView && pkg[f] !== undefined) use[f] = pkg[f];
    if (existing?.[f] === undefined) delete out[f]; else out[f] = existing[f];
  }
  if (Object.keys(use).length) out.usage = { [viewer]: use };
  return out;
}

/** Pure. May `clientId` use this package (its own row, or a row read for it through a source grant)? */
export const usableBy = (pkg, clientId) => Boolean(pkg && clientId && (pkg.clientId === clientId || pkg.sharedWith === clientId));

/**
 * Pure. The viewer's own rows plus source rows (`groups` = [{ entry, rows }]), each source row viewed for `viewer`.
 * A row the viewer owns wins on an id clash (ids are content hashes, so the same file can exist under two clients).
 */
export function mergeSourceRows(ownRows, groups, viewer) {
  const own = Array.isArray(ownRows) ? ownRows : [];
  const seen = new Set(own.map((r) => r?.id));
  const shared = [];
  for (const { entry, rows } of Array.isArray(groups) ? groups : []) {
    for (const r of Array.isArray(rows) ? rows : []) {
      if (!r?.id || seen.has(r.id)) continue;
      seen.add(r.id);
      shared.push(viewSourceRow(r, entry, viewer));
    }
  }
  return [...own, ...shared];
}
