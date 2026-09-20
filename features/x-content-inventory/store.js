// store.js — Firestore persistence for the content inventory.
//
// Layout:
//
//   x_content_packages/{packageId}   → one ContentPackage per document
//
// ⚠️ THIS WAS A FIELD ON `dashboard_state/{clientId}.marketingBrief`, and the
// reasoning for that was sound while the inventory was hand-curated: bounded,
// always read whole, never queried by anything but clientId. The Archive
// changes the premise. A confirmed archive asset becomes a package
// automatically (`archive-ingest.js`), so the row count is now set by how much
// of a 30-year archive gets reviewed, not by how much one person types. A
// 1MB document with a 200-row cap fails exactly when the archive starts
// delivering, and it fails by refusing saves.
//
// It is also no longer per-client. The inventory feeds ONE account's posting
// plan; `buildDayPlan` is @bai_ee's regardless of which dashboard is open, so
// scoping the rows by clientId while the plan ignored it was an inconsistency,
// not a feature.
//
// One document per package also means the Archive Inbox can write a single
// story without reading, rewriting and re-saving the whole array.
//
// Pure-ish: this module is the ONLY place in the inventory feature that touches
// Firestore. schema.js / match.js / plan-day.js stay pure so the local scripts
// (scripts/x-content/day-view.mjs) can keep running off the repo file with no
// credentials at all.

import { createRequire } from 'node:module';
import { validatePackage } from './schema.js';
import { mergeInventory } from './archive-ingest.js';
// Static import so Next bundles the seed rows — same reason as the route's
// bundledCalendar: a runtime fs read of a repo path is fragile on serverless.
import seedRows from './content-packages.json' with { type: 'json' };

const require = createRequire(import.meta.url);
const fb = require('../../api/_lib/firebase-admin.cjs');

export const COLLECTION = 'x_content_packages';

/** Still a cap, just a far larger one, and no longer a document-size limit —
 * it bounds one read, so the card cannot be made to pull the whole archive. */
export const PACKAGE_CAP = 2000;

/** Marks that the inventory has been written at least once. Lives in its own
 * collection rather than as a `__meta` document inside the package collection,
 * because a sentinel row in the same collection is one forgotten filter away
 * from being rendered as a package. */
const META_COLLECTION = 'x_content_inventory_meta';
const META_DOC = 'state';

const ID_SLUG_MAX = 48;

/** The bundled JSON is a module singleton. Handing it out by reference means the
 * first caller that mutates a row corrupts the seed for every later request in
 * the same warm lambda — copy before it leaves this file. */
function freshSeed() {
  return structuredClone(seedRows);
}

async function readMeta() {
  try {
    const snap = await fb.adminDb.collection(META_COLLECTION).doc(META_DOC).get();
    return snap.exists ? (snap.data() || {}) : {};
  } catch {
    return {};
  }
}

/**
 * Read the inventory, falling back to the repo seed.
 *
 * ⚠️ `updatedAt` is the marker, NOT emptiness. Seeding on any empty collection
 * means deleting your last row resurrects three example rows you already threw
 * away — so an inventory that has been written and then emptied stays empty.
 * Only a never-written inventory falls back to the repo seed.
 *
 * ⚠️ NEVER WRITES. A read that persists its own fallback turns "look at the
 * card" into "you now own three example rows", and there is no way for the next
 * reader to tell a seeded doc from a curated one. The seed materializes on the
 * first real save instead (see upsertPackage).
 *
 * Stored rows are merged OVER the seed rather than replacing it, so a row the
 * Archive Inbox has only written a story against still carries the series,
 * rights and media the seed describes (see mergeInventory).
 *
 * @returns {Promise<{ packages: object[], updatedAt: number|null, seeded: boolean }>}
 */
export async function readInventory() {
  const [snap, meta] = await Promise.all([
    fb.adminDb.collection(COLLECTION).limit(PACKAGE_CAP).get(),
    readMeta(),
  ]);
  const stored = snap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
  const updatedAt = Number.isFinite(meta.updatedAt) ? meta.updatedAt : null;

  if (!stored.length && !updatedAt) {
    return { packages: freshSeed(), updatedAt: null, seeded: true };
  }
  return { packages: mergeInventory(freshSeed(), stored), updatedAt, seeded: false };
}

async function touchMeta() {
  const updatedAt = Date.now();
  await fb.adminDb.collection(META_COLLECTION).doc(META_DOC).set({
    updatedAt,
    touchedAt: fb.FieldValue.serverTimestamp(),
  }, { merge: true });
  return updatedAt;
}

function slugify(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, ID_SLUG_MAX)
    .replace(/-+$/g, '');
}

/** Slug + a short random suffix. The suffix is not decoration: two posts about
 * the same night legitimately share a title, and a collision would silently
 * overwrite the first one on save. */
function mintId(pkg, taken) {
  const base = slugify(pkg?.title) || 'package';
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const candidate = `${base}-${Math.random().toString(36).slice(2, 6)}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
}

/** firebase-admin throws on an `undefined` value rather than skipping it (this
 * app never set ignoreUndefinedProperties). A JSON body cannot carry one, but a
 * script calling this directly can. */
function stripUndefined(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
}

/**
 * Insert or replace one package, by id.
 *
 * No transaction over the whole array any more: one package is one document, so
 * two tabs editing two different rows no longer contend at all, and two tabs
 * editing the SAME row is a last-write-wins on that row rather than one of them
 * silently losing the other's unrelated edits.
 *
 * Validation is structural only — `validatePackage` warnings are returned, not
 * enforced, because a row that will underperform is still a row the owner is
 * allowed to keep. Errors mean the matcher cannot use it at all, so they reject.
 *
 * @returns {Promise<{ pkg, packages, warnings, created, updatedAt }>}
 */
export async function upsertPackage(pkg) {
  if (!pkg || typeof pkg !== 'object' || Array.isArray(pkg)) {
    throw Object.assign(new Error('pkg must be an object.'), { status: 400 });
  }

  const before = await readInventory();
  const taken = new Set(before.packages.map((p) => p?.id).filter(Boolean));
  const providedId = typeof pkg.id === 'string' ? pkg.id.trim() : '';
  // ⚠️ Mint BEFORE validating: `id` is in REQUIRED_FIELDS, so a new row with no
  // id yet would otherwise fail validation for a field only this function is
  // supposed to supply.
  const id = providedId || mintId(pkg, taken);
  const created = !taken.has(id);

  const candidate = stripUndefined({ ...pkg, id, updatedAt: Date.now() });
  const verdict = validatePackage(candidate);
  if (!verdict.ok) {
    throw Object.assign(new Error(verdict.errors.join('; ')), { status: 400, errors: verdict.errors });
  }

  // Reject rather than trim. Dropping the oldest row to make room is fine for a
  // dismissed-ids list; here every row is something a human wrote or confirmed,
  // and losing one silently is worse than refusing the save.
  if (created && before.packages.length >= PACKAGE_CAP) {
    throw Object.assign(
      new Error(`Inventory is full (${PACKAGE_CAP} packages). Retire or delete a row before adding another.`),
      { status: 409 },
    );
  }

  // A first write materializes the seed, because that is what the caller was
  // just shown — writing only the edited row would leave the other seed rows
  // with no document, and the next read would still call them seed.
  const batch = fb.adminDb.batch();
  if (before.seeded) {
    for (const row of before.packages) {
      if (row?.id && row.id !== id) batch.set(fb.adminDb.collection(COLLECTION).doc(row.id), row, { merge: true });
    }
  }
  batch.set(fb.adminDb.collection(COLLECTION).doc(id), candidate, { merge: true });
  await batch.commit();
  const updatedAt = await touchMeta();

  const after = await readInventory();
  return { pkg: candidate, packages: after.packages, warnings: verdict.warnings, created, updatedAt };
}

/**
 * Remove one package by id.
 *
 * `removed:false` for an unknown id is a normal answer, not an error — a second
 * click on a delete button should be a no-op, not a 404 toast.
 *
 * @returns {Promise<{ removed: boolean, packages: object[], updatedAt: number }>}
 */
export async function deletePackage(id) {
  const key = typeof id === 'string' ? id.trim() : '';
  if (!key) throw Object.assign(new Error('id is required.'), { status: 400 });

  const before = await readInventory();
  const existed = before.packages.some((p) => p?.id === key);

  // Materialize the seed on a delete too, or deleting one seed row leaves the
  // inventory still "never written" and the row comes straight back.
  const batch = fb.adminDb.batch();
  if (before.seeded) {
    for (const row of before.packages) {
      if (row?.id && row.id !== key) batch.set(fb.adminDb.collection(COLLECTION).doc(row.id), row, { merge: true });
    }
  }
  batch.delete(fb.adminDb.collection(COLLECTION).doc(key));
  await batch.commit();
  const updatedAt = await touchMeta();

  const after = await readInventory();
  return { removed: existed, packages: after.packages, updatedAt };
}
