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
// SCALING (plan §3c): writes touch ONLY the target doc + the meta doc (which
// carries an approximate `count` maintained with FieldValue.increment). Reads
// that feed the planner go through `readCandidates` — an indexed, bounded
// query — not a full collection scan. `readInventory` stays for the card's
// whole-inventory view and can be paginated.
//
// Every function takes an optional `db` (a Firestore-compatible object) so the
// tests inject an in-memory fake; omitted, it is the real admin database.
//
// Pure-ish: this module is the ONLY place in the inventory feature that touches
// Firestore. schema.js / match.js / plan-day.js stay pure so the local scripts
// (scripts/x-content/day-view.mjs) can keep running off the repo file with no
// credentials at all.

import { createRequire } from 'node:module';
import { validatePackage } from './schema.js';
import { mergeInventory } from './archive-ingest.js';
import { resolveEngine, isEngine } from './engines.js';
import { buildSearchTokens, FACET_VERSION } from './facets.js';
// Static import so Next bundles the seed rows — same reason as the route's
// bundledCalendar: a runtime fs read of a repo path is fragile on serverless.
import seedRows from './content-packages.json' with { type: 'json' };

const require = createRequire(import.meta.url);
const fb = require('../../api/_lib/firebase-admin.cjs');

export const COLLECTION = 'x_content_packages';

/** Sanity guard on the number of package docs, not a read limit. Creating a row
 * past it is refused with a clear error; it is high enough that it only trips on
 * a runaway ingest loop. The count it checks is approximate (see touch below). */
export const PACKAGE_CAP = 50000;

/** Bound on ONE un-paginated `readInventory()` — the card's whole view. Callers
 * that need more pass `pageSize` and follow `nextCursor`. */
export const READ_LIMIT = 2000;

export const CANDIDATE_LIMIT = 50;

/** Marks that the inventory has been written at least once. Lives in its own
 * collection rather than as a `__meta` document inside the package collection,
 * because a sentinel row in the same collection is one forgotten filter away
 * from being rendered as a package. */
const META_COLLECTION = 'x_content_inventory_meta';
const META_DOC = 'state';

const ID_SLUG_MAX = 48;
const BATCH_CHUNK = 400;

const database = (db) => db || fb.adminDb;
const fieldValue = (db) => db?.FieldValue || fb.FieldValue;

/** The bundled JSON is a module singleton. Handing it out by reference means the
 * first caller that mutates a row corrupts the seed for every later request in
 * the same warm lambda — copy before it leaves this file. */
function freshSeed() {
  return structuredClone(seedRows);
}

async function readMeta(db) {
  try {
    const snap = await database(db).collection(META_COLLECTION).doc(META_DOC).get();
    return snap.exists ? (snap.data() || {}) : {};
  } catch {
    return {};
  }
}

/** Never-written inventory: `updatedAt` is the marker, NOT emptiness (see
 * readInventory). */
const neverWritten = (meta) => !Number.isFinite(meta.updatedAt);

/**
 * Fields the candidate query depends on.
 *
 * `engine` — stamped from resolveEngine so legacy rows (series-only) match
 * `where('engine','==',…)`. An explicit valid engine always wins.
 *
 * `lastPostedAt` — Firestore silently EXCLUDES docs missing the orderBy field,
 * so a never-posted row must carry an explicit `null`, which sorts before every
 * number. Only defaulted when absent: a write-back from the publish loop must
 * never be clobbered by a later edit that did not carry the field.
 */
function withIndexFields(row, existing) {
  const out = { ...row };
  if (!isEngine(out.engine)) {
    out.engine = isEngine(existing?.engine) ? existing.engine : resolveEngine(out);
  }
  if (out.lastPostedAt === undefined && existing?.lastPostedAt === undefined) out.lastPostedAt = null;
  // Search index: derived on every write from facets/humanEdits/title/story/tags
  // (pure, no extra reads). Only when the row carries something searchable.
  if (out.facets || out.humanEdits || out.title || out.story) {
    out.searchTokens = buildSearchTokens({ ...(existing || {}), ...out });
    out.facetVersion = FACET_VERSION;
  }
  return out;
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
 * Pagination: with `pageSize`, rows come back in document-id order and
 * `nextCursor` is the last id (pass it as `startAfter`; null = no more). With no
 * options the call and return shape are unchanged, bounded by READ_LIMIT.
 *
 * @param {{ pageSize?: number, startAfter?: string, db?: object }} [opts]
 * @returns {Promise<{ packages: object[], updatedAt: number|null, seeded: boolean, nextCursor?: string|null }>}
 */
export async function readInventory(opts = {}) {
  const db = database(opts.db);
  const paged = Number.isInteger(opts.pageSize) && opts.pageSize > 0;
  const limit = paged ? opts.pageSize : READ_LIMIT;

  let query = db.collection(COLLECTION);
  if (paged) {
    query = query.orderBy('__name__');
    if (opts.startAfter) query = query.startAfter(opts.startAfter);
  }
  const [snap, meta] = await Promise.all([query.limit(limit).get(), readMeta(opts.db)]);
  const stored = snap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
  const updatedAt = Number.isFinite(meta.updatedAt) ? meta.updatedAt : null;

  if (!stored.length && !updatedAt) {
    return { packages: freshSeed(), updatedAt: null, seeded: true, ...(paged ? { nextCursor: null } : {}) };
  }

  // ⚠️ Once the inventory has been written, the seed is only an OVERLAY for rows
  // that exist (a story-only doc still inherits series/rights/media). Folding in
  // seed rows that have no document would resurrect a seed row the owner
  // deleted — materialization wrote every seed row as a real doc already. The
  // same filter keeps a page from repeating seed rows it does not contain.
  let seed = freshSeed();
  if (updatedAt) {
    const onPage = new Set(stored.map((r) => r.id));
    seed = seed.filter((r) => onPage.has(r.id));
  }
  const result = { packages: mergeInventory(seed, stored), updatedAt, seeded: false };
  if (paged) result.nextCursor = stored.length === limit ? stored[stored.length - 1].id : null;
  return result;
}

/** One package by id, or null. One read — use this instead of scanning
 * `readInventory().packages` for a single row. Seed-only rows (never
 * materialized) are returned from the seed. */
export async function getPackage(id, opts = {}) {
  const key = typeof id === 'string' ? id.trim() : '';
  if (!key) return null;
  const snap = await database(opts.db).collection(COLLECTION).doc(key).get();
  const seed = freshSeed().find((r) => r.id === key);
  if (snap.exists) return mergeInventory(seed ? [seed] : [], [{ id: key, ...(snap.data() || {}) }])[0];
  if (seed) {
    const meta = await readMeta(opts.db);
    if (neverWritten(meta)) return seed;
  }
  return null;
}

/**
 * Bounded candidate pool for one engine — the planner's read path.
 *
 * Query: engine == X, status in [...], orderBy lastPostedAt asc, limit N.
 * Never-posted rows are stored with `lastPostedAt: null` (see withIndexFields),
 * and Firestore sorts null first, so they lead the pool; then the longest-rested.
 * Rows written before this change have no `lastPostedAt` / `engine` and are
 * invisible to the query until rewritten or run through `backfillIndexFields`.
 *
 * Needs the composite index in firestore.indexes.json (engine, status,
 * lastPostedAt). `status in` accepts at most 30 values.
 *
 * If the inventory was never written, the repo seed is filtered the same way
 * (in memory) so a fresh environment behaves like readInventory.
 *
 * @param {{ engine: string, statuses: string[], limit?: number, db?: object }} opts
 * @returns {Promise<object[]>}
 */
export async function readCandidates({ engine, statuses, limit = CANDIDATE_LIMIT, db } = {}) {
  if (!isEngine(engine)) throw Object.assign(new Error('engine is required.'), { status: 400 });
  const wanted = Array.isArray(statuses) ? statuses.filter(Boolean) : [];
  if (!wanted.length) throw Object.assign(new Error('statuses must be a non-empty array.'), { status: 400 });
  const cap = Number.isInteger(limit) && limit > 0 ? limit : CANDIDATE_LIMIT;

  const snap = await database(db).collection(COLLECTION)
    .where('engine', '==', engine)
    .where('status', 'in', wanted)
    .orderBy('lastPostedAt', 'asc')
    .limit(cap)
    .get();
  const stored = snap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
  if (stored.length) return stored;

  const meta = await readMeta(db);
  if (!neverWritten(meta)) return [];
  return freshSeed()
    .filter((r) => resolveEngine(r) === engine && wanted.includes(r.status))
    .slice(0, cap);
}

/**
 * One-off migration for rows written before the index fields existed: stamps
 * `engine` and `lastPostedAt:null` where missing. Reads the collection once, in
 * pages; writes only the rows that need it. Owner-run, never called implicitly.
 *
 * @returns {Promise<{ scanned: number, updated: number }>}
 */
export async function backfillIndexFields({ pageSize = 500, db } = {}) {
  const d = database(db);
  let scanned = 0;
  let updated = 0;
  let cursor = null;
  for (;;) {
    let q = d.collection(COLLECTION).orderBy('__name__');
    if (cursor) q = q.startAfter(cursor);
    const snap = await q.limit(pageSize).get();
    if (!snap.docs.length) break;
    const batch = d.batch();
    let ops = 0;
    for (const doc of snap.docs) {
      scanned += 1;
      const row = doc.data() || {};
      const patch = {};
      if (!isEngine(row.engine)) patch.engine = resolveEngine(row);
      if (row.lastPostedAt === undefined) patch.lastPostedAt = null;
      if (Object.keys(patch).length) {
        batch.set(d.collection(COLLECTION).doc(doc.id), patch, { merge: true });
        ops += 1;
        updated += 1;
      }
    }
    if (ops) await batch.commit();
    cursor = snap.docs[snap.docs.length - 1].id;
    if (snap.docs.length < pageSize) break;
  }
  return { scanned, updated };
}

/** Queue a meta write on `batch`: stamps updatedAt and moves the approximate doc
 * count by `delta` with an atomic increment (no read). */
function queueMetaTouch(db, batch, delta) {
  const FV = fieldValue(db);
  const updatedAt = Date.now();
  const patch = { updatedAt, touchedAt: FV.serverTimestamp() };
  if (delta) patch.count = FV.increment(delta);
  batch.set(database(db).collection(META_COLLECTION).doc(META_DOC), patch, { merge: true });
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
 * overwrite the first one on save. Collisions are checked per candidate with a
 * single-doc read rather than against a full id list. */
async function mintId(pkg, db, seedIds) {
  const base = slugify(pkg?.title) || 'package';
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const candidate = `${base}-${Math.random().toString(36).slice(2, 6)}`;
    if (seedIds.has(candidate)) continue;
    const snap = await database(db).collection(COLLECTION).doc(candidate).get();
    if (!snap.exists) return candidate;
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
 * Cost: 2 reads (the target doc + the meta doc) and one batched write,
 * independent of inventory size. `returnPackages` (default true, for the existing
 * route) adds ONE full `readInventory` afterwards; pass `false` to skip it.
 *
 * No transaction over the whole array: one package is one document, so two tabs
 * editing two different rows no longer contend at all, and two tabs editing the
 * SAME row is a last-write-wins on that row.
 *
 * Validation is structural only — `validatePackage` warnings are returned, not
 * enforced, because a row that will underperform is still a row the owner is
 * allowed to keep. Errors mean the matcher cannot use it at all, so they reject.
 *
 * @param {object} pkg
 * @param {{ db?: object, returnPackages?: boolean }} [opts]
 * @returns {Promise<{ pkg, packages?, warnings, created, updatedAt }>}
 */
export async function upsertPackage(pkg, opts = {}) {
  if (!pkg || typeof pkg !== 'object' || Array.isArray(pkg)) {
    throw Object.assign(new Error('pkg must be an object.'), { status: 400 });
  }
  const { db, returnPackages = true } = opts;
  const d = database(db);

  const seed = freshSeed();
  const seedIds = new Set(seed.map((r) => r?.id).filter(Boolean));
  const providedId = typeof pkg.id === 'string' ? pkg.id.trim() : '';
  // ⚠️ Mint BEFORE validating: `id` is in REQUIRED_FIELDS, so a new row with no
  // id yet would otherwise fail validation for a field only this function is
  // supposed to supply.
  const id = providedId || await mintId(pkg, db, seedIds);

  const [snap, meta] = await Promise.all([
    d.collection(COLLECTION).doc(id).get(),
    readMeta(db),
  ]);
  const seeded = neverWritten(meta);
  const existing = snap.exists ? (snap.data() || {}) : null;
  const created = !existing && !(seeded && seedIds.has(id));

  const base = stripUndefined({ ...pkg, id, updatedAt: Date.now() });
  const verdict = validatePackage(base);
  if (!verdict.ok) {
    throw Object.assign(new Error(verdict.errors.join('; ')), { status: 400, errors: verdict.errors });
  }
  const candidate = withIndexFields(base, existing);

  // A first write materializes the seed, because that is what the caller was
  // just shown — writing only the edited row would leave the other seed rows
  // with no document, and the next read would still call them seed.
  // ⚠️ Keyed on the meta marker, never on emptiness (resurrection trap).
  const seedOthers = seeded ? seed.filter((r) => r?.id && r.id !== id) : [];
  const newDocs = (existing ? 0 : 1) + seedOthers.length;

  // Reject rather than trim: every row is something a human wrote or confirmed,
  // and losing one silently is worse than refusing the save. `count` is
  // approximate (increments, no recount) — a sanity guard, not an exact quota.
  if (newDocs > 0 && Number.isFinite(meta.count) && meta.count + newDocs > PACKAGE_CAP) {
    throw Object.assign(
      new Error(`Inventory is full (${PACKAGE_CAP} packages). Retire or delete a row before adding another.`),
      { status: 409 },
    );
  }

  const batch = d.batch();
  for (const row of seedOthers) {
    batch.set(d.collection(COLLECTION).doc(row.id), withIndexFields(row, null), { merge: true });
  }
  batch.set(d.collection(COLLECTION).doc(id), candidate, { merge: true });
  const updatedAt = queueMetaTouch(db, batch, newDocs);
  await batch.commit();

  const result = { pkg: candidate, warnings: verdict.warnings, created, updatedAt };
  if (returnPackages) result.packages = (await readInventory({ db })).packages;
  return result;
}

/**
 * Remove one package by id.
 *
 * `removed:false` for an unknown id is a normal answer, not an error — a second
 * click on a delete button should be a no-op, not a 404 toast.
 *
 * Cost: 2 reads (target doc + meta). `returnPackages` as in upsertPackage.
 *
 * @returns {Promise<{ removed: boolean, packages?: object[], updatedAt: number }>}
 */
export async function deletePackage(id, opts = {}) {
  const key = typeof id === 'string' ? id.trim() : '';
  if (!key) throw Object.assign(new Error('id is required.'), { status: 400 });
  const { db, returnPackages = true } = opts;
  const d = database(db);

  const [snap, meta] = await Promise.all([
    d.collection(COLLECTION).doc(key).get(),
    readMeta(db),
  ]);
  const seeded = neverWritten(meta);
  const seed = seeded ? freshSeed().filter((r) => r?.id) : [];
  const existed = snap.exists || seed.some((r) => r.id === key);

  // Materialize the seed on a delete too, or deleting one seed row leaves the
  // inventory still "never written" and the row comes straight back.
  const seedOthers = seed.filter((r) => r.id !== key);
  const delta = seedOthers.length - (snap.exists ? 1 : 0);

  const batch = d.batch();
  for (const row of seedOthers) {
    batch.set(d.collection(COLLECTION).doc(row.id), withIndexFields(row, null), { merge: true });
  }
  batch.delete(d.collection(COLLECTION).doc(key));
  const updatedAt = queueMetaTouch(db, batch, delta);
  await batch.commit();

  const result = { removed: existed, updatedAt };
  if (returnPackages) result.packages = (await readInventory({ db })).packages;
  return result;
}
