#!/usr/bin/env node
// One-shot: move content items (`x_content_packages`) and their not-yet-posted drafts (`social_posts`) from one
// client to another (e.g. Discogs records / rendered DJ mixes out of the home client into a channel client).
// DRY RUN BY DEFAULT: reads, prints the plan, writes nothing.
//
//   node scripts/x-content/move-content-client.mjs --from <clientId> --to <clientId> --source discogs
//   node scripts/x-content/move-content-client.mjs --from A --to B --series C4 --engine ue --bucket ue
//   node scripts/x-content/move-content-client.mjs --from A --to B --source discogs --write --backup /path/backup.json
//
// ⚠️ SANCTIONED BYPASS: `upsertPackage` (features/x-content-inventory/store.js) deliberately refuses to change a
// package's clientId (409 package-client-mismatch). This script writes the docs DIRECTLY (batch.update on the
// package + post docs) because moving ownership is exactly the thing that guard forbids. Use it only for a
// deliberate, owner-approved move, and keep the --backup file (scratchpad, never the repo).
//
// Filters (AND-ed, at least one required): --source (package.source.kind, or the string `source`; `discogs` also
// matches `discogs-ingest`), --engine, --series, --bucket. `--no-posts` moves packages only.
//
// What moves
//   - every matching package of --from: `clientId` -> --to (+ updatedAt). Nothing else on the package changes.
//   - social_posts of --from linked to a moved package (post.packageId, or a discogs-ingest post whose
//     sourceRef.releaseId maps to `discogs-<id>`) in status draft | approved | awaiting_approval | needs_review.
//     approved / awaiting_approval are reset to `draft` with the approval cleared (reviewedAt, reviewedBy,
//     approvedHash, approval-token fields), mirroring `unapproveDraft`; `revision` +1 as every transition does.
// What stays (reported, never moved)
//   - history: posted / rejected / failed / expired / queued / posting / manual rows stay with --from.
//   - BLOCKING: a linked post that is scheduled/queued/posting/manual, has a scheduledAt, or a needs_review row that
//     may already be live (twitterId/postedAt/claimedAt) holds its whole PACKAGE back (and that package's other
//     posts), so no row is orphaned from its package. Unschedule / resolve it, then re-run.
// Other collections (read from the code, nothing to write):
//   - x_schedule_ledger / x_package_reservations (features/social-posting/reservations.js): keyed
//     `<clientId>__<day|packageId>`, written ONLY while a post is scheduled/queued/posting/manual. Moved rows are never
//     in those states, so they hold no entry; leftovers for old posted rows are stale by design (packageBlock).
//   - content_buckets/{clientId}/buckets: per-client; a moved package's `bucketId` must exist for --to or it falls back
//     to the default bucket (buckets.js). The script reports which bucketIds the target lacks; it does not create them.
//   - search tokens / facets live on the package doc itself and are not client-keyed: they move with it.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PACKAGES = 'x_content_packages';
export const POSTS = 'social_posts';
export const BATCH_MAX = 400;
const PAGE = 1000;
const SAMPLE = 8;
const CLIENT_ID_RE = /^[A-Za-z0-9_-]{3,80}$/;

/** Statuses a post may be moved in; the first two (+ awaiting_approval) are reset to draft. */
export const MOVABLE_STATUSES = Object.freeze(['draft', 'approved', 'awaiting_approval', 'needs_review']);
const RESET_TO_DRAFT = Object.freeze(['approved', 'awaiting_approval']);
/** Live-queue statuses: the post is (or may be) in flight, so its package cannot move. */
const IN_FLIGHT = Object.freeze(['scheduled', 'queued', 'posting', 'manual']);

const norm = (v) => (typeof v === 'string' ? v.trim().toLowerCase() : '');
const sourceKindOf = (pkg) => norm(typeof pkg?.source === 'string' ? pkg.source : pkg?.source?.kind);

/** Pure: does this package match every given filter? `discogs` also matches `discogs-ingest`. */
export function matchesFilters(pkg, f = {}) {
  if (f.source) {
    const want = norm(f.source);
    const got = sourceKindOf(pkg);
    if (got !== want && !(want === 'discogs' && got === 'discogs-ingest')) return false;
  }
  if (f.engine && norm(pkg?.engine) !== norm(f.engine)) return false;
  if (f.series && norm(pkg?.series) !== norm(f.series)) return false;
  if (f.bucket && norm(pkg?.bucketId) !== norm(f.bucket)) return false;
  return true;
}

/** The package id a post belongs to (own packageId, else a discogs-ingest post's release). */
export function postPackageId(post) {
  if (post?.packageId) return String(post.packageId);
  const rel = post?.sourceRef?.releaseId;
  if (post?.source === 'discogs-ingest' && rel != null && rel !== '') return `discogs-${rel}`;
  return '';
}

/** Why a linked post stops its package from moving ('' = it does not). */
function blockReason(post) {
  if (IN_FLIGHT.includes(post.status)) return `status ${post.status}`;
  if (post.scheduledAt && MOVABLE_STATUSES.includes(post.status)) return `has scheduledAt (${post.status})`;
  if (post.status === 'needs_review' && (post.twitterId || post.postedAt || post.claimedAt)) return 'needs_review may already be live';
  return '';
}

/** Pure: the field patch that moves one post (approval cleared when it was approved/awaiting). */
export function postPatch(post, to, now = new Date().toISOString()) {
  const patch = { clientId: to, revision: (Number(post.revision) || 0) + 1, updatedAt: now };
  if (RESET_TO_DRAFT.includes(post.status)) {
    Object.assign(patch, { status: 'draft', scheduledAt: null, reviewedAt: null, reviewedBy: null, approvedHash: null });
    for (const k of ['approvalToken', 'approvalTokenHash', 'approvalExpiresAt', 'approvalSource']) if (k in post) patch[k] = null;
  }
  return patch;
}

/**
 * Pure planner.
 * @param {object[]} packages every package of the FROM client (`id` + fields)
 * @param {object[]} posts    every social_post of the FROM client
 * @param {{from:string,to:string,source?:string,engine?:string,series?:string,bucket?:string,includePosts?:boolean,now?:string}} opts
 */
export function planMove(packages, posts, opts) {
  const { from, to, includePosts = true, now } = opts;
  const matched = (packages || []).filter((p) => (p.clientId || '') === from && matchesFilters(p, opts));
  const postsByPkg = new Map();
  for (const p of posts || []) {
    if ((p.clientId || '') !== from) continue;
    const pid = postPackageId(p);
    if (!pid) continue;
    if (!postsByPkg.has(pid)) postsByPkg.set(pid, []);
    postsByPkg.get(pid).push(p);
  }
  const blocked = [];
  const movePackages = [];
  for (const pkg of matched) {
    const linked = includePosts ? postsByPkg.get(pkg.id) || [] : [];
    const blockers = linked.map((p) => ({ postId: p.id, packageId: pkg.id, reason: blockReason(p) })).filter((b) => b.reason);
    if (blockers.length) blocked.push(...blockers);
    else movePackages.push(pkg);
  }
  const heldPackageIds = [...new Set(blocked.map((b) => b.packageId))];
  const moveIds = new Set(movePackages.map((p) => p.id));
  const movePosts = [];
  const resetPostIds = [];
  const leftBehind = {};
  if (includePosts) {
    for (const [pid, linked] of postsByPkg) {
      if (!moveIds.has(pid)) continue;
      for (const p of linked) {
        if (MOVABLE_STATUSES.includes(p.status)) {
          movePosts.push({ id: p.id, before: p, patch: postPatch(p, to, now) });
          if (RESET_TO_DRAFT.includes(p.status)) resetPostIds.push(p.id);
        } else leftBehind[p.status || 'unknown'] = (leftBehind[p.status || 'unknown'] || 0) + 1;
      }
    }
  }
  const postsByStatus = {};
  for (const m of movePosts) postsByStatus[m.before.status] = (postsByStatus[m.before.status] || 0) + 1;
  const buckets = [...new Set(movePackages.map((p) => p.bucketId).filter(Boolean))];
  return {
    matched: matched.length,
    movePackages: movePackages.map((p) => ({ id: p.id, before: p, patch: { clientId: to } })),
    movePosts, resetPostIds, postsByStatus, leftBehind, blocked, heldPackageIds, buckets,
    batches: chunkWrites(movePackages.length, movePosts.length),
  };
}

function chunkWrites(pkgCount, postCount) {
  return Math.ceil(pkgCount / BATCH_MAX) + Math.ceil(postCount / BATCH_MAX);
}

/** Reads every doc of a collection owned by `clientId` (single-field equality: no composite index). */
export async function readOwned(db, collection, clientId) {
  const out = [];
  let last = null;
  for (;;) {
    let q = db.collection(collection).where('clientId', '==', clientId).orderBy('__name__').limit(PAGE);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    for (const d of snap.docs) out.push({ id: d.id, ...d.data() });
    if (snap.docs.length < PAGE) break;
    last = snap.docs[snap.docs.length - 1];
  }
  return out;
}

/** Writes the plan with `update` (a doc deleted since the read fails its batch rather than reappearing). Packages first. */
export async function applyMove(db, plan, now = Date.now()) {
  const writes = [
    ...plan.movePackages.map((m) => ({ ref: db.collection(PACKAGES).doc(m.id), data: { ...m.patch, updatedAt: now } })),
    ...plan.movePosts.map((m) => ({ ref: db.collection(POSTS).doc(m.id), data: m.patch })),
  ];
  let written = 0;
  for (let i = 0; i < writes.length; i += BATCH_MAX) {
    const batch = db.batch();
    for (const w of writes.slice(i, i + BATCH_MAX)) batch.update(w.ref, w.data);
    await batch.commit();
    written += Math.min(BATCH_MAX, writes.length - i);
  }
  return written;
}

function arg(name) {
  const i = process.argv.indexOf(name);
  return i > -1 ? String(process.argv[i + 1] || '').trim() : '';
}

async function main() {
  const write = process.argv.includes('--write');
  const opts = {
    from: arg('--from'), to: arg('--to'),
    source: arg('--source'), engine: arg('--engine'), series: arg('--series'), bucket: arg('--bucket'),
    includePosts: !process.argv.includes('--no-posts'),
  };
  const backup = arg('--backup');
  if (!CLIENT_ID_RE.test(opts.from) || !CLIENT_ID_RE.test(opts.to)) throw new Error('--from <clientId> and --to <clientId> are required.');
  if (opts.from === opts.to) throw new Error('--from and --to are the same client.');
  if (!opts.source && !opts.engine && !opts.series && !opts.bucket) throw new Error('At least one filter is required: --source | --engine | --series | --bucket.');
  if (write && !backup) throw new Error('--write requires --backup <path> (JSON of every doc that will change).');

  const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const require = createRequire(import.meta.url);
  require(path.join(REPO, 'features/not-the-rug-brief/load-env'));
  const db = require(path.join(REPO, 'api/_lib/firebase-admin.cjs')).adminDb;

  for (const id of [opts.from, opts.to]) {
    if (!(await db.collection('clients').doc(id).get()).exists) throw new Error(`clients/${id} does not exist.`);
  }
  const [packages, posts, toPackages] = await Promise.all([
    readOwned(db, PACKAGES, opts.from), opts.includePosts ? readOwned(db, POSTS, opts.from) : [], readOwned(db, PACKAGES, opts.to),
  ]);
  const plan = planMove(packages, posts, opts);

  let missingBuckets = [];
  if (plan.buckets.length) {
    const { listBuckets } = await import(path.join(REPO, 'features/x-content-inventory/bucket-store.js'));
    const have = new Set((await listBuckets(opts.to, { db })).map((b) => b.id));
    missingBuckets = plan.buckets.filter((b) => !have.has(b));
  }
  console.log(JSON.stringify({
    mode: write ? 'WRITE' : 'DRY RUN (nothing written)',
    from: opts.from, to: opts.to,
    filters: { source: opts.source || null, engine: opts.engine || null, series: opts.series || null, bucket: opts.bucket || null },
    packages: { fromTotal: packages.length, toTotalBefore: toPackages.length, matched: plan.matched, willMove: plan.movePackages.length, heldBackByBlockingPosts: plan.heldPackageIds.length },
    posts: opts.includePosts
      ? { fromTotal: posts.length, willMove: plan.movePosts.length, byStatus: plan.postsByStatus, resetToDraft: plan.resetPostIds.length, historyLeftBehind: plan.leftBehind }
      : 'skipped (--no-posts)',
    blocking: plan.blocked.slice(0, 20),
    bucketsOfMovedPackages: plan.buckets,
    bucketsMissingOnTarget: missingBuckets,
    batches: plan.batches,
    samplePackageIds: plan.movePackages.slice(0, SAMPLE).map((m) => m.id),
    samplePostIds: plan.movePosts.slice(0, SAMPLE).map((m) => m.id),
  }, null, 2));
  if (!write) {
    console.log(`\nTo apply: re-run with --write --backup <path>  (would update ${plan.movePackages.length} packages + ${plan.movePosts.length} posts)`);
    return;
  }
  fs.writeFileSync(backup, JSON.stringify({
    at: new Date().toISOString(), from: opts.from, to: opts.to,
    packages: plan.movePackages.map((m) => m.before), posts: plan.movePosts.map((m) => m.before),
  }, null, 2));
  console.log(`backup written: ${backup}`);
  const written = await applyMove(db, plan);
  const [afterFrom, afterTo] = await Promise.all([readOwned(db, PACKAGES, opts.from), readOwned(db, PACKAGES, opts.to)]);
  console.log(`\nwrote ${written} docs; packages ${opts.from}: ${packages.length} -> ${afterFrom.length}, ${opts.to}: ${toPackages.length} -> ${afterTo.length}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(() => process.exit(0)).catch((e) => { console.error(e?.message || e); process.exit(1); });
}
