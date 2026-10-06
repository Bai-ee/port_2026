// bucket-store.js — Firestore persistence for buckets, folders and entity
// aliases (Content Engine v2 master plan §4).
//
//   content_buckets/{clientId}/buckets/{bucketId}
//   content_buckets/{clientId}/folders/{folderId}   (P1-B evaluates `rule`; we only persist)
//   entity_aliases/{clientId}                       { aliases: { canonical: [alias, ...] } }
//
// Every function takes an optional `db` (Firestore-compatible) so tests inject
// an in-memory fake; omitted, it is the real admin database. Package docs are
// only touched by deleteBucket (count / reassign) via the `bucketId` field.

import { createRequire } from 'node:module';
import { DEFAULT_BUCKETS, bucketIdFromName, validateBucket, mergeBuckets } from './buckets.js';
import { normalizeTerm } from './facets.js';

const require = createRequire(import.meta.url);
const PACKAGES = 'x_content_packages';
const BUCKET_ROOT = 'content_buckets';
const ALIAS_COLLECTION = 'entity_aliases';
const REASSIGN_CHUNK = 400;
const DEFAULT_IDS = new Set(DEFAULT_BUCKETS.map((b) => b.id));

const database = (db) => db || require('../../api/_lib/firebase-admin.cjs').adminDb;
const fail = (message, status = 400, extra = {}) => Object.assign(new Error(message), { status, ...extra });
const clientKey = (clientId) => {
  const k = typeof clientId === 'string' ? clientId.trim() : '';
  if (!k || k.includes('/')) throw fail('clientId is required.');
  return k;
};
const bucketsCol = (db, clientId) => database(db).collection(BUCKET_ROOT).doc(clientKey(clientId)).collection('buckets');
const foldersCol = (db, clientId) => database(db).collection(BUCKET_ROOT).doc(clientKey(clientId)).collection('folders');
const strip = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

async function readStoredBuckets(clientId, db) {
  const snap = await bucketsCol(db, clientId).get();
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
}

/** Defaults merged with stored docs, sorted by order. */
export async function listBuckets(clientId, { db } = {}) {
  return mergeBuckets(await readStoredBuckets(clientId, db));
}

/**
 * Create or update one bucket. A bucket without an id is NEW: its id comes
 * from its name and a duplicate name (case-insensitive, any other bucket) is
 * rejected. With an id it updates that bucket (renames also checked).
 * Returns { bucket, created }.
 */
export async function upsertBucket(clientId, input, { db } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw fail('bucket must be an object.');
  const current = await listBuckets(clientId, { db });
  const name = String(input.name ?? '').trim();
  const providedId = typeof input.id === 'string' ? input.id.trim() : '';
  const id = providedId || bucketIdFromName(name);
  const existing = current.find((b) => b.id === id);
  if (!providedId && existing) throw fail(`A bucket named "${existing.name}" already exists.`, 409);
  const dup = current.find((b) => b.id !== id && normalizeTerm(b.name) === normalizeTerm(name));
  if (dup) throw fail(`A bucket named "${dup.name}" already exists.`, 409);

  const next = strip({
    ...(existing || { color: '#334155', active: true, order: current.length }),
    ...input, id, name,
    share: { ...(existing?.share || {}), ...(input.share || {}) },
  });
  const errors = validateBucket(next);
  if (errors.length) throw fail(errors.join('; '), 400, { errors });
  const { id: _omit, ...doc } = next;
  await bucketsCol(db, clientId).doc(id).set({ ...doc, updatedAt: Date.now() }, { merge: true });
  return { bucket: next, created: !existing };
}

/**
 * Delete a bucket. Items still pointing at it block the delete unless
 * `reassignTo` names another existing bucket, in which case they move there.
 * A default bucket cannot disappear (defaults re-merge on read), so it is
 * deactivated instead. Returns { removed, deactivated?, reassigned }.
 */
export async function deleteBucket(clientId, bucketId, { db, reassignTo } = {}) {
  const id = typeof bucketId === 'string' ? bucketId.trim() : '';
  if (!id) throw fail('bucketId is required.');
  const d = database(db);
  const buckets = await listBuckets(clientId, { db });
  if (!buckets.some((b) => b.id === id)) return { removed: false, reassigned: 0 };
  const target = reassignTo ? String(reassignTo).trim() : '';
  if (target) {
    if (target === id) throw fail('reassignTo must be a different bucket.');
    if (!buckets.some((b) => b.id === target)) throw fail(`Unknown reassignTo bucket: ${target}`);
  }

  const items = await d.collection(PACKAGES).where('bucketId', '==', id).get();
  const refs = items.docs.map((x) => x.id);
  if (refs.length && !target) {
    throw fail(`Bucket has ${refs.length}+ items; pass reassignTo to move them.`, 409, { itemCount: refs.length });
  }
  for (let i = 0; i < refs.length; i += REASSIGN_CHUNK) {
    const batch = d.batch();
    for (const pid of refs.slice(i, i + REASSIGN_CHUNK)) batch.set(d.collection(PACKAGES).doc(pid), { bucketId: target }, { merge: true });
    await batch.commit();
  }
  // Folders of a removed bucket would be orphans; follow the items.
  const folders = await foldersCol(db, clientId).where('bucketId', '==', id).get();
  for (const f of folders.docs) {
    if (target) await foldersCol(db, clientId).doc(f.id).set({ bucketId: target }, { merge: true });
    else await foldersCol(db, clientId).doc(f.id).delete();
  }

  if (DEFAULT_IDS.has(id)) {
    await bucketsCol(db, clientId).doc(id).set({ active: false, updatedAt: Date.now() }, { merge: true });
    return { removed: false, deactivated: true, reassigned: refs.length };
  }
  await bucketsCol(db, clientId).doc(id).delete();
  return { removed: true, reassigned: refs.length };
}

/** Folders, optionally only one bucket's. */
export async function listFolders(clientId, { db, bucketId } = {}) {
  const col = foldersCol(db, clientId);
  const snap = await (bucketId ? col.where('bucketId', '==', bucketId) : col).get();
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) })).sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

const FOLDER_OPS = ['eq', 'contains', 'in', 'gte', 'lte', 'gt', 'lt', 'neq'];

export function validateFolder(f) {
  const errors = [];
  if (!f || typeof f !== 'object') return ['folder must be an object'];
  if (!String(f.bucketId ?? '').trim()) errors.push('bucketId is required');
  if (!String(f.name ?? '').trim()) errors.push('name is required');
  if (String(f.name ?? '').length > 60) errors.push('name ≤ 60 chars');
  if (f.rule != null) {
    if (typeof f.rule !== 'object' || !String(f.rule.field ?? '').trim() || f.rule.value === undefined) errors.push('rule needs {field, op, value}');
    else if (f.rule.op !== undefined && typeof f.rule.op !== 'string') errors.push('rule.op must be a string');
  }
  if (f.itemIds != null && !(Array.isArray(f.itemIds) && f.itemIds.every((x) => typeof x === 'string'))) errors.push('itemIds must be an array of strings');
  if (f.rule && f.itemIds) errors.push('a folder is either smart (rule) or manual (itemIds), not both');
  return errors;
}

/** Create/update a folder. No id → minted from the name (unique within bucket). */
export async function upsertFolder(clientId, input, { db } = {}) {
  if (!input || typeof input !== 'object') throw fail('folder must be an object.');
  const buckets = await listBuckets(clientId, { db });
  const folder = strip({ ...input, name: String(input.name ?? '').trim(), bucketId: String(input.bucketId ?? '').trim() });
  const errors = validateFolder(folder);
  if (errors.length) throw fail(errors.join('; '), 400, { errors });
  if (!buckets.some((b) => b.id === folder.bucketId)) throw fail(`Unknown bucket: ${folder.bucketId}`);

  const siblings = await listFolders(clientId, { db, bucketId: folder.bucketId });
  const providedId = typeof folder.id === 'string' ? folder.id.trim() : '';
  const id = providedId || bucketIdFromName(folder.name) || `folder-${Date.now().toString(36)}`;
  const existing = siblings.find((f) => f.id === id);
  if (!providedId && existing) throw fail(`A folder named "${existing.name}" already exists in this bucket.`, 409);
  const dup = siblings.find((f) => f.id !== id && normalizeTerm(f.name) === normalizeTerm(folder.name));
  if (dup) throw fail(`A folder named "${dup.name}" already exists in this bucket.`, 409);

  const { id: _omit, ...doc } = folder;
  // set without merge: a rule<->itemIds switch must not leave the other behind.
  await foldersCol(db, clientId).doc(id).set({ ...doc, updatedAt: Date.now() });
  return { folder: { id, ...doc }, created: !existing };
}

export async function deleteFolder(clientId, folderId, { db } = {}) {
  const id = typeof folderId === 'string' ? folderId.trim() : '';
  if (!id) throw fail('folderId is required.');
  const ref = foldersCol(db, clientId).doc(id);
  const snap = await ref.get();
  if (!snap.exists) return { removed: false };
  await ref.delete();
  return { removed: true };
}

/** Canonical -> aliases map ({} when none stored). */
export async function getAliases(clientId, { db } = {}) {
  const snap = await database(db).collection(ALIAS_COLLECTION).doc(clientKey(clientId)).get();
  return snap.exists ? (snap.data()?.aliases || {}) : {};
}

/** Merge a {canonical:[alias]} map into the stored one (lowercased, deduped). */
export async function upsertAliases(clientId, aliases, { db } = {}) {
  if (!aliases || typeof aliases !== 'object' || Array.isArray(aliases)) throw fail('aliases must be an object of canonical -> [alias].');
  const merged = await getAliases(clientId, { db });
  for (const [canon, list] of Object.entries(aliases)) {
    const key = normalizeTerm(canon);
    if (!key) continue;
    if (!Array.isArray(list)) throw fail(`aliases.${canon} must be an array.`);
    const set = new Set(merged[key] || []);
    for (const a of list) { const t = normalizeTerm(a); if (t && t !== key) set.add(t); }
    merged[key] = [...set];
  }
  await database(db).collection(ALIAS_COLLECTION).doc(clientKey(clientId)).set({ aliases: merged, updatedAt: Date.now() });
  return merged;
}
