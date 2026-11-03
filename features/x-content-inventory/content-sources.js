// content-sources.js — clients whose content another client may READ (cross-client content sources).
//
//   client_configs/{clientId}.contentSources = ['undergroundexistence-0CsKkpaq', 'bai-ees-discogs-TP37NQG0']
//
// Every package still belongs to exactly one client (store.js). A source grant only widens what the viewer READS:
// rows from a source client come back marked `readOnly: true, sharedFrom: <owner clientId>`, and every write path
// (upsertPackage / deletePackage) keeps refusing them with `package-client-mismatch`. Set by the owner with
// scripts/x-content/content-sources.mjs; no UI writes this field.

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const CLIENT_ID_RE = /^[A-Za-z0-9_-]{3,80}$/;
export const MAX_CONTENT_SOURCES = 10;
const CONFIGS = 'client_configs';

const database = (db) => db || require('../../api/_lib/firebase-admin.cjs').adminDb;

/** Pure. A clean list of source client ids: valid ids only, trimmed, de-duplicated, never the viewer itself, capped. */
export function normalizeContentSources(raw, selfId = null) {
  if (!Array.isArray(raw)) return [];
  const self = typeof selfId === 'string' ? selfId.trim() : '';
  const out = [];
  for (const v of raw) {
    const id = typeof v === 'string' ? v.trim() : '';
    if (!CLIENT_ID_RE.test(id) || id === self || out.includes(id)) continue;
    out.push(id);
    if (out.length >= MAX_CONTENT_SOURCES) break;
  }
  return out;
}

/** The source clients `clientId` may read, from its client_configs doc. Missing doc / field => []. */
export async function readContentSources(clientId, { db } = {}) {
  const id = typeof clientId === 'string' ? clientId.trim() : '';
  if (!CLIENT_ID_RE.test(id)) return [];
  const snap = await database(db).collection(CONFIGS).doc(id).get();
  return snap.exists ? normalizeContentSources(snap.data()?.contentSources, id) : [];
}

/**
 * Pure. The viewer's own rows plus source rows, each source row marked read-only with its owner. A row the viewer
 * owns wins on an id clash (ids are content hashes, so the same file can exist under two clients).
 */
export function mergeSourceRows(ownRows, sourceRows) {
  const own = Array.isArray(ownRows) ? ownRows : [];
  const seen = new Set(own.map((r) => r?.id));
  const shared = [];
  for (const r of Array.isArray(sourceRows) ? sourceRows : []) {
    if (!r?.id || seen.has(r.id)) continue;
    seen.add(r.id);
    shared.push({ ...r, readOnly: true, sharedFrom: r.clientId || null });
  }
  return [...own, ...shared];
}
