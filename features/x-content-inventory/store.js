// store.js — Firestore persistence for the content inventory.
//
// Layout:
//
//   dashboard_state/{clientId}.marketingBrief.contentInventory
//     { packages: ContentPackage[], updatedAt: epoch ms }
//
// ONE FIELD ON THE EXISTING STATE DOC, not a new collection. The inventory is
// bounded (PACKAGE_CAP rows), is always read whole, and is never queried by
// anything but clientId — a collection would buy nothing and would introduce a
// query surface that eventually wants a composite index, which this repo does
// not allow. Same reasoning as marketingBrief.quoteTargets next door.
//
// Pure-ish: this module is the ONLY place in the inventory feature that touches
// Firestore. schema.js / match.js / plan-day.js stay pure so the local scripts
// (scripts/x-content/day-view.mjs) can keep running off the repo file with no
// credentials at all.

import { createRequire } from 'node:module';
import { validatePackage } from './schema.js';
// Static import so Next bundles the seed rows — same reason as the route's
// bundledCalendar: a runtime fs read of a repo path is fragile on serverless.
import seedRows from './content-packages.json' with { type: 'json' };

const require = createRequire(import.meta.url);
const fb = require('../../api/_lib/firebase-admin.cjs');

/** A Firestore doc caps at 1MB and this field shares dashboard_state with
 * everything else the client owns. 200 rows of prose is ~200KB — comfortably
 * inside, and far past the point where a human is still curating by hand. */
export const PACKAGE_CAP = 200;

const ID_SLUG_MAX = 48;

function stateRef(clientId) {
  const id = String(clientId ?? '').trim();
  if (!id) throw Object.assign(new Error('clientId is required.'), { status: 400 });
  return fb.adminDb.collection('dashboard_state').doc(id);
}

/** The bundled JSON is a module singleton. Handing it out by reference means the
 * first caller that mutates a row corrupts the seed for every later request in
 * the same warm lambda — copy before it leaves this file. */
function freshSeed() {
  return structuredClone(seedRows);
}

/**
 * Decide whether a stored blob counts as "the client has an inventory".
 *
 * ⚠️ `updatedAt` is the marker, NOT emptiness. Seeding on any empty array means
 * deleting your last row resurrects three example rows you already threw away —
 * so an inventory that has been written and then emptied stays empty. Only a
 * never-written field falls back to the repo seed.
 */
function resolveStored(stored) {
  const packages = Array.isArray(stored?.packages) ? stored.packages : null;
  if (packages && (packages.length || stored.updatedAt)) {
    return { packages, updatedAt: stored.updatedAt ?? null, seeded: false };
  }
  return { packages: freshSeed(), updatedAt: null, seeded: true };
}

/**
 * Read a client's inventory, falling back to the repo seed.
 *
 * ⚠️ NEVER WRITES. A read that persists its own fallback turns "look at the
 * card" into "you now own three example rows", and there is no way for the next
 * reader to tell a seeded doc from a curated one. The seed materializes on the
 * first real save instead (see mutateInventory).
 *
 * @returns {Promise<{ packages: object[], updatedAt: number|null, seeded: boolean }>}
 */
export async function readInventory(clientId) {
  const snap = await stateRef(clientId).get();
  const stored = snap.exists ? snap.data()?.marketingBrief?.contentInventory : null;
  return resolveStored(stored);
}

/**
 * Read-modify-write the packages array under a transaction.
 *
 * A transaction rather than a bare merge because every mutation here is
 * read-modify-write on a single array: two tabs saving at once would otherwise
 * silently drop one of the two edits. Mirrors handleDismiss in
 * app/api/dashboard/quote-targets/route.js.
 *
 * The seed is what a first write starts FROM, because that is what the caller
 * was just shown — starting from `[]` would delete the other seed rows the
 * moment someone edits one of them.
 */
async function mutateInventory(clientId, mutate) {
  const ref = stateRef(clientId);
  return fb.adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const current = resolveStored(snap.exists ? snap.data()?.marketingBrief?.contentInventory : null).packages;
    const { packages, result } = mutate(current);
    const updatedAt = Date.now();
    tx.set(
      ref,
      {
        marketingBrief: { contentInventory: { packages, updatedAt } },
        updatedAt: fb.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    return { ...result, packages, updatedAt };
  });
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
 * Validation is structural only — `validatePackage` warnings are returned, not
 * enforced, because a row that will underperform is still a row the owner is
 * allowed to keep. Errors mean the matcher cannot use it at all, so they reject.
 *
 * @param {string} clientId
 * @param {object} pkg
 * @returns {Promise<{ pkg: object, packages: object[], warnings: string[], created: boolean, updatedAt: number }>}
 */
export async function upsertPackage(clientId, pkg) {
  if (!pkg || typeof pkg !== 'object' || Array.isArray(pkg)) {
    throw Object.assign(new Error('pkg must be an object.'), { status: 400 });
  }

  return mutateInventory(clientId, (current) => {
    const taken = new Set(current.map((p) => p?.id).filter(Boolean));
    const providedId = typeof pkg.id === 'string' ? pkg.id.trim() : '';
    // ⚠️ Mint BEFORE validating: `id` is in REQUIRED_FIELDS, so a new row with
    // no id yet would otherwise fail validation for a field only this function
    // is supposed to supply.
    const id = providedId || mintId(pkg, taken);

    const candidate = stripUndefined({ ...pkg, id, updatedAt: Date.now() });
    const verdict = validatePackage(candidate);
    if (!verdict.ok) {
      throw Object.assign(new Error(verdict.errors.join('; ')), { status: 400, errors: verdict.errors });
    }

    const idx = current.findIndex((p) => p?.id === id);
    const packages = idx === -1 ? [...current, candidate] : current.map((p, i) => (i === idx ? candidate : p));

    // Reject rather than trim. Dropping the oldest row to make room is fine for
    // a dismissed-ids list; here every row is something a human wrote by hand,
    // and losing one silently is worse than refusing the save.
    if (packages.length > PACKAGE_CAP) {
      throw Object.assign(
        new Error(`Inventory is full (${PACKAGE_CAP} packages). Retire or delete a row before adding another.`),
        { status: 409 },
      );
    }

    return { packages, result: { pkg: candidate, warnings: verdict.warnings, created: idx === -1 } };
  });
}

/**
 * Remove one package by id.
 *
 * `removed:false` for an unknown id is a normal answer, not an error — a second
 * click on a delete button should be a no-op, not a 404 toast.
 *
 * @returns {Promise<{ removed: boolean, packages: object[], updatedAt: number }>}
 */
export async function deletePackage(clientId, id) {
  const key = typeof id === 'string' ? id.trim() : '';
  if (!key) throw Object.assign(new Error('id is required.'), { status: 400 });

  return mutateInventory(clientId, (current) => {
    const packages = current.filter((p) => p?.id !== key);
    return { packages, result: { removed: packages.length !== current.length } };
  });
}
