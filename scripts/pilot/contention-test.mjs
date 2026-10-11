#!/usr/bin/env node
// REAL-Firestore contention test for the social_posts scheduling reservations (features/social-posting/reservations.js).
// The unit suite (pilot-concurrency.test.js) uses a fully serialized in-memory fake, so true optimistic-concurrency
// contention is untested there. This script runs concurrent transactions (Promise.all, >= 8 contenders per scenario)
// through the REAL reserveInTx / commit / approveDraft / updateSocialPost code.
//
//   node scripts/pilot/contention-test.mjs                  real Firestore (orchestrator runs this)
//   node scripts/pilot/contention-test.mjs --dry            same scenarios on the in-memory fake (no network)
//   node scripts/pilot/contention-test.mjs --cleanup-only   delete leftovers for the throwaway client, then exit
//
// Safety: hard-coded throwaway client `zz-contention-test`; every social_posts id starts `zzct_`; ledger/reservation
// docs are keyed `zz-contention-test__...`. X is never called (no publish path is invoked). The plan/engine config
// is injected in memory: no x_strategy_plans / client_configs writes.
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../');
const CLIENT = 'zz-contention-test';
const ID_PREFIX = 'zzct_';
const N = 8;
const MIN = 60_000;
const argv = new Set(process.argv.slice(2));
const DRY = argv.has('--dry');
const CLEANUP_ONLY = argv.has('--cleanup-only');

function assertClient(id) {
  if (id !== CLIENT || id !== 'zz-contention-test') throw new Error(`refusing to run for client id "${id}"`);
}
assertClient(CLIENT);

const require = createRequire(import.meta.url);
process.env.PILOT_CLIENT_IDS = CLIENT; // makes isPilotClient(CLIENT) true (plan enforcement path) in the real service

let db;
let fb;
let restoreDb = () => {};
if (DRY) {
  fb = require(path.join(REPO, 'api/_lib/firebase-admin.cjs'));
  const { makeFakeContext } = require(path.join(REPO, 'api/_lib/__tests__/fake-firestore.cjs'));
  const ctx = makeFakeContext();
  const orig = Object.getOwnPropertyDescriptor(fb, 'adminDb');
  Object.defineProperty(fb, 'adminDb', { configurable: true, get: () => ctx.adminDb });
  restoreDb = () => Object.defineProperty(fb, 'adminDb', orig);
  db = ctx.adminDb;
} else {
  require(path.join(REPO, 'features/not-the-rug-brief/load-env'));
  fb = require(path.join(REPO, 'api/_lib/firebase-admin.cjs'));
  db = fb.adminDb;
}

const { reserveInTx, LEDGER_COLLECTION, PACKAGE_COLLECTION, dayKeyOf } = await import(path.join(REPO, 'features/social-posting/reservations.js'));
const POSTS = 'social_posts';
const COLLECTIONS = [POSTS, LEDGER_COLLECTION, PACKAGE_COLLECTION];

// ---- cleanup ------------------------------------------------------------------------------------------------------
async function cleanup() {
  assertClient(CLIENT);
  const counts = {};
  for (const col of COLLECTIONS) {
    const snap = await db.collection(col).where('clientId', '==', CLIENT).get();
    let n = 0;
    for (const d of snap.docs) {
      const id = d.id;
      // belt and braces: only ever delete docs visibly namespaced to the throwaway client
      if (col === POSTS ? !id.startsWith(ID_PREFIX) : !id.startsWith(`${CLIENT}__`)) continue;
      await db.collection(col).doc(id).delete();
      n += 1;
    }
    counts[col] = n;
  }
  return counts;
}

// ---- helpers ------------------------------------------------------------------------------------------------------
const isAbort = (e) => e && (e.code === 10 || e.code === 'aborted' || /aborted|too much contention|contention/i.test(String(e.message)));
let abortRetries = 0;
/** Run one contender; absorb Firestore ABORTED (retry exhaustion under heavy contention) with an outer retry, counted. */
async function settle(fn) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try { return { ok: true, value: await fn() }; } catch (e) {
      if (isAbort(e) && attempt < 5) { abortRetries += 1; await new Promise((r) => setTimeout(r, 25 * (attempt + 1) + Math.random() * 50)); continue; }
      return { ok: false, code: e?.code || 'error', message: e?.message || String(e) };
    }
  }
  return { ok: false, code: 'aborted', message: 'retries exhausted' };
}

const seedRow = async (id, extra = {}) => {
  const now = new Date().toISOString();
  const row = { id, clientId: CLIENT, platform: 'x', content: `Contention test ${id}`, status: 'approved', lifecycleVersion: 2, reviewedAt: now, reviewedBy: 'contention-test', revision: 1, scheduledAt: null, createdAt: now, updatedAt: now, ...extra };
  await db.collection(POSTS).doc(id).set(row);
  return row;
};
const readRow = async (id) => (await db.collection(POSTS).doc(id).get()).data();

/** Mirrors twitter-service commitPostTransition (revision check + reserveInTx + row write in ONE transaction), config injected. */
async function commitSchedule(snapshot, scheduledAt, config) {
  const next = { ...snapshot, status: 'scheduled', scheduledAt, updatedAt: new Date().toISOString() };
  const ref = db.collection(POSTS).doc(next.id);
  return db.runTransaction(async (tx) => {
    const curSnap = await tx.get(ref);
    const cur = curSnap.data();
    if ((cur.revision || 0) !== (snapshot.revision || 0) || cur.status !== snapshot.status) {
      throw Object.assign(new Error('revision conflict'), { code: 'revision-conflict' });
    }
    const { writes } = await reserveInTx(db, tx, { clientId: CLIENT, previous: snapshot, next, config, enforcePlan: true, override: false });
    writes.forEach((w) => w());
    tx.set(ref, { ...next, revision: (cur.revision || 0) + 1 });
  });
}

const iso = (ms) => new Date(ms).toISOString();
/** Distinct far-future base per scenario: 12:00 UTC (6-7am CT) at +N days, so slots up to ~+11h stay in one CT day. */
const baseFor = (daysOut) => { const d = new Date(Date.now() + daysOut * 86_400_000); d.setUTCHours(12, 0, 0, 0); return d.getTime(); };

/** Cross-check the ledger against the rows: every scheduled row has exactly its slot, no ghost slots, spacing/cap hold. */
async function ledgerInvariants({ minSpacingMin = 0, capPerDay = null } = {}) {
  const problems = [];
  const rows = (await db.collection(POSTS).where('clientId', '==', CLIENT).get()).docs.map((d) => d.data())
    .filter((r) => r.id.startsWith(ID_PREFIX) && (r.status === 'scheduled' || r.status === 'queued'));
  const slots = new Map();
  for (const d of (await db.collection(LEDGER_COLLECTION).where('clientId', '==', CLIENT).get()).docs) {
    for (const [pid, s] of Object.entries(d.data().slots || {})) {
      if (slots.has(pid)) problems.push(`post ${pid} in two ledger days`);
      slots.set(pid, { ms: s.ms });
    }
  }
  for (const r of rows) {
    const s = slots.get(r.id);
    if (!s) problems.push(`scheduled row ${r.id} has no ledger slot`);
    else if (s.ms !== Date.parse(r.scheduledAt)) problems.push(`row ${r.id} ledger ms != scheduledAt`);
  }
  for (const pid of slots.keys()) if (!rows.some((r) => r.id === pid)) problems.push(`ghost ledger slot ${pid}`);
  const ms = rows.map((r) => Date.parse(r.scheduledAt)).sort((a, b) => a - b);
  if (minSpacingMin > 0) for (let i = 1; i < ms.length; i += 1) if (ms[i] - ms[i - 1] < minSpacingMin * MIN) problems.push(`spacing violated: ${(ms[i] - ms[i - 1]) / MIN}min`);
  if (capPerDay != null) {
    const perDay = {};
    for (const m of ms) perDay[dayKeyOf(m)] = (perDay[dayKeyOf(m)] || 0) + 1;
    for (const [d, c] of Object.entries(perDay)) if (c > capPerDay) problems.push(`cap violated on ${d}: ${c} > ${capPerDay}`);
  }
  return { problems, rows };
}

const results = [];
const record = (name, fn) => async () => {
  const t0 = Date.now();
  try { const detail = await fn(); results.push({ name, pass: true, detail: detail || '', ms: Date.now() - t0 }); } catch (e) {
    results.push({ name, pass: false, detail: String(e?.message || e).split('\n')[0], ms: Date.now() - t0 });
  }
};
const codes = (rs) => rs.filter((r) => !r.ok).map((r) => r.code);

// ---- scenarios ----------------------------------------------------------------------------------------------------
const scenarios = [
  record('1. same exact slot, N schedulers -> exactly one wins', async () => {
    const config = { authored: { minSpacingMin: 60 } };
    const slot = iso(baseFor(20));
    const rows = await Promise.all(Array.from({ length: N }, (_, i) => seedRow(`${ID_PREFIX}s1_${i}`)));
    const rs = await Promise.all(rows.map((r) => settle(() => commitSchedule(r, slot, config))));
    const wins = rs.filter((r) => r.ok).length;
    assert.equal(wins, 1, `expected 1 winner, got ${wins} (loser codes ${[...new Set(codes(rs))]})`);
    assert.ok(codes(rs).every((c) => c === 'plan-spacing'), `losers should fail plan-spacing, got ${[...new Set(codes(rs))]}`);
    const inv = await ledgerInvariants({ minSpacingMin: 60 });
    assert.deepEqual(inv.problems, []);
    return `${wins} winner / ${N - wins} plan-spacing`;
  }),

  record('2a. different slots inside spacing window -> spacing holds', async () => {
    const config = { authored: { minSpacingMin: 60 } };
    const base = baseFor(30);
    const rows = await Promise.all(Array.from({ length: 12 }, (_, i) => seedRow(`${ID_PREFIX}s2a_${i}`)));
    const rs = await Promise.all(rows.map((r, i) => settle(() => commitSchedule(r, iso(base + i * 10 * MIN), config))));
    const wins = rs.filter((r) => r.ok).length;
    assert.ok(wins >= 1, 'at least one scheduler must win');
    assert.ok(wins <= 2, `110-minute span with 60-min spacing admits at most 2 posts, got ${wins}`);
    assert.ok(codes(rs).every((c) => c === 'plan-spacing'), `unexpected loser codes ${[...new Set(codes(rs))]}`);
    const inv = await ledgerInvariants({ minSpacingMin: 60 });
    assert.deepEqual(inv.problems, []);
    return `${wins} accepted of 12`;
  }),

  record('2b. same day, distinct spaced slots -> day cap holds', async () => {
    const config = { authored: { minSpacingMin: 0, capPerDay: 3 } };
    const base = baseFor(40);
    const rows = await Promise.all(Array.from({ length: N }, (_, i) => seedRow(`${ID_PREFIX}s2b_${i}`)));
    const rs = await Promise.all(rows.map((r, i) => settle(() => commitSchedule(r, iso(base + i * 90 * MIN), config))));
    const wins = rs.filter((r) => r.ok).length;
    assert.equal(wins, 3, `cap 3 -> exactly 3 winners, got ${wins} (loser codes ${[...new Set(codes(rs))]})`);
    assert.ok(codes(rs).every((c) => c === 'plan-day-cap'), `unexpected loser codes ${[...new Set(codes(rs))]}`);
    const inv = await ledgerInvariants({ capPerDay: 3 });
    assert.deepEqual(inv.problems, []);
    return `${wins} accepted / ${N - wins} plan-day-cap`;
  }),

  record('3. same package from N rows -> one reservation', async () => {
    const config = { authored: { minSpacingMin: 0 } };
    const pkg = `${ID_PREFIX}pkg_1`;
    const base = baseFor(50);
    const rows = await Promise.all(Array.from({ length: N }, (_, i) => seedRow(`${ID_PREFIX}s3_${i}`, { packageId: pkg })));
    const rs = await Promise.all(rows.map((r, i) => settle(() => commitSchedule(r, iso(base + i * 24 * 60 * MIN), config))));
    const winners = rows.filter((_, i) => rs[i].ok);
    assert.equal(winners.length, 1, `expected 1 winner, got ${winners.length}`);
    assert.ok(codes(rs).every((c) => c === 'package-already-pending'), `losers must fail package-already-pending, got ${[...new Set(codes(rs))]}`);
    const res = (await db.collection(PACKAGE_COLLECTION).doc(`${CLIENT}__${pkg}`).get()).data();
    assert.equal(res?.state, 'active');
    assert.equal(res.postId, winners[0].id, 'reservation must point at the winner');
    const inv = await ledgerInvariants();
    assert.deepEqual(inv.problems, []);
    assert.equal(inv.rows.filter((r) => r.packageId === pkg).length, 1, 'exactly one scheduled row for the package');
    return `winner ${winners[0].id.slice(ID_PREFIX.length)}`;
  }),

  record('4. reschedule + concurrent schedule into released slot -> consistent ledger', async () => {
    const config = { authored: { minSpacingMin: 60 } };
    const base = baseFor(60);
    const S = iso(base);
    const T = iso(base + 5 * 60 * MIN);
    const a0 = await seedRow(`${ID_PREFIX}s4_A`);
    await commitSchedule(a0, S, config);
    const a1 = await readRow(a0.id);
    const bs = await Promise.all(Array.from({ length: N }, (_, i) => seedRow(`${ID_PREFIX}s4_B${i}`)));
    const rs = await Promise.all([
      settle(() => commitSchedule(a1, T, config)), // A leaves S
      ...bs.map((b) => settle(() => commitSchedule(b, S, config))), // everyone else wants S
    ]);
    const bWins = rs.slice(1).filter((r) => r.ok).length;
    assert.ok(rs[0].ok, `reschedule of A should succeed (${rs[0].code}: ${rs[0].message})`);
    assert.ok(bWins <= 1, `at most one B may take S, got ${bWins}`);
    assert.ok(codes(rs.slice(1)).every((c) => c === 'plan-spacing'), `unexpected loser codes ${[...new Set(codes(rs))]}`);
    assert.equal((await readRow(a0.id)).scheduledAt, T);
    const inv = await ledgerInvariants({ minSpacingMin: 60 });
    assert.deepEqual(inv.problems, []);
    return `A moved; ${bWins} B took the released slot`;
  }),

  record('5. concurrent edit vs approve (revision) -> one wins, rest revision-conflict', async () => {
    const svc = await import(path.join(REPO, 'features/social-posting/twitter-service.js'));
    const row = await seedRow(`${ID_PREFIX}s5`, { status: 'draft', reviewedAt: null, reviewedBy: null, content: 'Original copy.' });
    const rev = row.revision;
    const ops = [];
    for (let i = 0; i < N / 2; i += 1) {
      ops.push({ kind: 'edit', text: `Edited copy ${i}.`, run: () => svc.updateSocialPost(CLIENT, row.id, { content: `Edited copy ${i}.` }, { expectedRevision: rev }) });
      ops.push({ kind: 'approve', run: () => svc.approveDraft(CLIENT, row.id, { reviewedBy: 'contention-test', expectedRevision: rev }) });
    }
    const rs = await Promise.all(ops.map((o) => settle(o.run)));
    const winIdx = rs.map((r, i) => (r.ok ? i : -1)).filter((i) => i >= 0);
    assert.equal(winIdx.length, 1, `expected exactly 1 success, got ${winIdx.length} (loser codes ${[...new Set(codes(rs))]})`);
    assert.ok(codes(rs).every((c) => c === 'revision-conflict'), `losers must fail revision-conflict, got ${[...new Set(codes(rs))]}`);
    const final = await readRow(row.id);
    assert.equal(final.revision, rev + 1, 'exactly one revision bump');
    const w = ops[winIdx[0]];
    if (w.kind === 'edit') assert.ok(final.content === w.text && final.status !== 'approved', 'edit won: its text persisted, no approval leaked');
    else assert.ok(final.status === 'approved' && final.content === 'Original copy.', 'approve won: original text approved, no edit leaked');
    return `${w.kind} won; ${rs.length - 1} revision-conflict`;
  }),
];

// ---- main ---------------------------------------------------------------------------------------------------------
function printTable() {
  const w = Math.max(...results.map((r) => r.name.length), 8);
  console.log(`\n${'SCENARIO'.padEnd(w)}  RESULT  MS      DETAIL`);
  for (const r of results) console.log(`${r.name.padEnd(w)}  ${(r.pass ? 'PASS' : 'FAIL').padEnd(6)}  ${String(r.ms).padEnd(6)}  ${r.detail}`);
}

let failed = false;
try {
  console.log(`mode: ${DRY ? 'DRY (in-memory fake)' : 'REAL FIRESTORE'}  client: ${CLIENT}  contenders: ${N}+`);
  const pre = await cleanup(); // clean slate in case a prior run died
  if (Object.values(pre).some(Boolean)) console.log('pre-run leftovers removed:', JSON.stringify(pre));
  if (!CLEANUP_ONLY) {
    for (const s of scenarios) await s();
    printTable();
    console.log(`transient abort retries absorbed: ${abortRetries}`);
    failed = results.some((r) => !r.pass);
  }
} catch (e) {
  console.error('fatal:', e?.stack || e);
  failed = true;
} finally {
  try {
    console.log('cleanup deleted:', JSON.stringify(await cleanup()));
  } catch (e) {
    console.error('CLEANUP FAILED (re-run with --cleanup-only):', e?.message || e);
    failed = true;
  }
  restoreDb();
}
process.exit(failed ? 1 : 0);
