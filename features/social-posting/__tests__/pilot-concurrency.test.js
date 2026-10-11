// Pilot concurrency / crash-recovery / plan-enforcement tests for the social_posts lifecycle.
// Harness mirrors lifecycle-phase2.test.js. The fake Firestore fully SERIALIZES transaction bodies, so races are
// produced with Promise.all: both callers read their snapshot outside the transaction, then commit one after the
// other and the second must lose to the first's committed revision / reservation. (Real Firestore retries; out of scope.)
// Client 'c1' (and 'c3') are PILOT clients with plan enforcement; 'c2' is a non-pilot client. X is a mock publisher only.
import assert from 'node:assert/strict';
import test, { beforeEach, afterEach } from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const fb = require('../../../api/_lib/firebase-admin.cjs');
const { makeFakeContext } = require('../../../api/_lib/__tests__/fake-firestore.cjs');

const { __setXAdapterDepsForTest } = await import('../adapters/x.js');
const svc = await import('../twitter-service.js');
const { upsertPackage } = await import('../../x-content-inventory/store.js');
const { default: seedRows } = await import('../../x-content-inventory/content-packages.json', { with: { type: 'json' } });

let ctx;
let tweets;
let tweetImpl;
let restoreDeps;
let originalDbDescriptor;
const savedEnv = {};
const ENV_KEYS = ['PILOT_CLIENT_IDS', 'PILOT_OWNER_UIDS'];

const raw = (id) => ctx.adminDb._raw('social_posts', id);
const PKG = (id, extra = {}) => ({ ...seedRows[1], id, status: 'idea', rights: 'owned', ...extra });
const mkPkg = (id) => upsertPackage(PKG(id), { returnPackages: false });
const MIN = 60_000;
const HOUR = 60 * MIN;
const PAST = (h = 1) => new Date(Date.now() - h * HOUR).toISOString();

// ---- America/Chicago wall-clock helpers (Intl, no hard-coded offsets) ------------------------------------------
const ctParts = (ms) => Object.fromEntries(
  new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .formatToParts(new Date(ms)).filter((p) => p.type !== 'literal').map((p) => [p.type, Number(p.value)]),
);
const ctOffsetMs = (ms) => { const p = ctParts(ms); return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000; };
/** UTC ISO for a CT wall-clock time on calendar day `day` (YYYY-MM-DD). Only valid away from DST transitions. */
function ctIso(day, hh, mm = 0) {
  const guess = Date.parse(`${day}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00Z`);
  return new Date(guess - ctOffsetMs(guess)).toISOString();
}
/** A CT calendar day >= 5 days out whose surrounding 4 days share one UTC offset (no DST edge). */
function safeDay() {
  for (let n = 5; n < 400; n += 1) {
    const base = Date.now() + n * 86_400_000;
    const offs = new Set([-2, -1, 0, 1, 2, 3].map((d) => ctOffsetMs(base + d * 86_400_000)));
    if (offs.size === 1) {
      const p = ctParts(base);
      return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
    }
  }
  throw new Error('no DST-safe day found');
}
const addDay = (day, n) => new Date(Date.parse(`${day}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const ledger = (clientId, day) => ctx.adminDb._raw('x_schedule_ledger', `${clientId}__${day}`);
const slotCount = (clientId, day) => Object.keys(ledger(clientId, day)?.slots || {}).length;
const pkgRes = (clientId, pkgId) => ctx.adminDb._raw('x_package_reservations', `${clientId}__${pkgId}`);

beforeEach(() => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  process.env.PILOT_CLIENT_IDS = 'c1,c3';
  process.env.PILOT_OWNER_UIDS = 'owner-uid';
  tweets = [];
  tweetImpl = null;
  originalDbDescriptor = Object.getOwnPropertyDescriptor(fb, 'adminDb');
  ctx = makeFakeContext();
  ctx.adminDb.batch = () => {
    const ops = [];
    return { set: (ref, data, o) => ops.push(() => ref.set(data, o)), delete: (ref) => ops.push(() => ref.delete()), commit: async () => { for (const op of ops) await op(); } };
  };
  // Firestore DocumentReference.create() semantics (6 = ALREADY_EXISTS), as in lifecycle-phase2.test.js.
  const origCollection = ctx.adminDb.collection.bind(ctx.adminDb);
  ctx.adminDb.collection = (name) => {
    const col = origCollection(name);
    const origDoc = col.doc.bind(col);
    col.doc = (docId) => {
      const ref = origDoc(docId);
      ref.create = async (data) => {
        if ((await ref.get()).exists) throw Object.assign(new Error('already exists'), { code: 6 });
        await ref.set(data);
      };
      return ref;
    };
    return col;
  };
  Object.defineProperty(fb, 'adminDb', { configurable: true, get: () => ctx.adminDb });
  restoreDeps = __setXAdapterDepsForTest({
    getClient: async () => ({
      authMode: 'oauth2',
      client: {
        v1: { uploadMedia: async () => 'm1' },
        v2: {
          tweet: async (payload) => {
            tweets.push(payload);
            if (tweetImpl) return tweetImpl(payload);
            return { data: { id: `main-${tweets.length}` } };
          },
        },
      },
    }),
    fetchMedia: async () => { throw new Error('no media'); },
  });
});

afterEach(() => {
  restoreDeps();
  Object.defineProperty(fb, 'adminDb', originalDbDescriptor);
  for (const k of ENV_KEYS) { if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k]; }
});

const v2 = (clientId, content, extra = {}) => svc.createSocialPost(clientId, { content, lifecycleVersion: 2, ...extra });
/** v2 draft -> approved (not scheduled). */
async function approved(clientId, content, extra = {}) {
  const p = await v2(clientId, content, extra);
  await svc.approveDraft(clientId, p.id);
  return p;
}
/** v2 post scheduled at `iso` through the normal edit path. */
async function scheduled(clientId, content, iso, extra = {}) {
  const p = await approved(clientId, content, extra);
  return svc.updateSocialPost(clientId, p.id, { scheduledAt: iso });
}
const setPlan = (authored) => ctx.adminDb.collection('content_system_config').doc('x').set({ authored });

// ---------------------------------------------------------------------------------------------------------------
// 1. Two schedulers, same package
// ---------------------------------------------------------------------------------------------------------------

test('1. concurrent schedulers on ONE package (pilot): exactly one wins, loser gets package-already-pending, reservation points at winner', async () => {
  await mkPkg('pkg-race');
  const a = await approved('c1', 'Copy A.', { packageId: 'pkg-race' });
  const b = await approved('c1', 'Copy B.', { packageId: 'pkg-race' });
  const day = safeDay();
  const results = await Promise.allSettled([
    svc.updateSocialPost('c1', a.id, { scheduledAt: ctIso(day, 9) }),
    svc.updateSocialPost('c1', b.id, { scheduledAt: ctIso(day, 15) }),
  ]);
  const ok = results.filter((r) => r.status === 'fulfilled');
  const bad = results.filter((r) => r.status === 'rejected');
  assert.equal(ok.length, 1);
  assert.equal(bad.length, 1);
  assert.equal(bad[0].reason.code, 'package-already-pending');
  assert.equal(bad[0].reason.status, 409);
  const winnerId = ok[0].value.id;
  const loserId = winnerId === a.id ? b.id : a.id;
  assert.equal(raw(winnerId).status, 'scheduled');
  assert.equal(raw(loserId).status, 'approved', 'loser stays approved, untouched');
  assert.equal(raw(loserId).scheduledAt, null);
  assert.equal([a.id, b.id].filter((id) => raw(id).status === 'scheduled').length, 1);
  assert.equal(pkgRes('c1', 'pkg-race').postId, winnerId);
  assert.equal(pkgRes('c1', 'pkg-race').state, 'active');
  assert.equal(slotCount('c1', day), 1, 'only the winner holds a ledger slot');
});

test('1b. the in-transaction reservation (not only the pre-check) stops the second scheduler', async () => {
  // Simulate the pre-check having passed for both: call the transition twice from stale snapshots.
  await mkPkg('pkg-tx');
  const a = await approved('c1', 'Tx A.', { packageId: 'pkg-tx' });
  const b = await approved('c1', 'Tx B.', { packageId: 'pkg-tx' });
  const day = safeDay();
  const [ra, rb] = await Promise.allSettled([
    svc.approveAndSchedule('c1', a.id, { scheduledAt: ctIso(day, 10) }),
    svc.approveAndSchedule('c1', b.id, { scheduledAt: ctIso(day, 16) }),
  ]);
  const rejected = [ra, rb].filter((r) => r.status === 'rejected');
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].reason.code, 'package-already-pending');
});

// ---------------------------------------------------------------------------------------------------------------
// 2. Spacing (plan default 120 min) incl. midnight crossing
// ---------------------------------------------------------------------------------------------------------------

test('2. concurrent schedulers, different packages 30 min apart: exactly one wins, loser gets plan-spacing', async () => {
  await mkPkg('pkg-s1'); await mkPkg('pkg-s2');
  const a = await approved('c1', 'Spacing A.', { packageId: 'pkg-s1' });
  const b = await approved('c1', 'Spacing B.', { packageId: 'pkg-s2' });
  const day = safeDay();
  const results = await Promise.allSettled([
    svc.updateSocialPost('c1', a.id, { scheduledAt: ctIso(day, 10, 0) }),
    svc.updateSocialPost('c1', b.id, { scheduledAt: ctIso(day, 10, 30) }),
  ]);
  const bad = results.filter((r) => r.status === 'rejected');
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(bad.length, 1);
  assert.equal(bad[0].reason.code, 'plan-spacing');
  assert.equal([a.id, b.id].filter((id) => raw(id).status === 'scheduled').length, 1);
  assert.equal(slotCount('c1', day), 1);
});

test('2b. two posts 3h apart both schedule concurrently', async () => {
  const a = await approved('c1', 'Far A.');
  const b = await approved('c1', 'Far B.');
  const day = safeDay();
  const results = await Promise.allSettled([
    svc.updateSocialPost('c1', a.id, { scheduledAt: ctIso(day, 9) }),
    svc.updateSocialPost('c1', b.id, { scheduledAt: ctIso(day, 12) }),
  ]);
  assert.deepEqual(results.map((r) => r.status), ['fulfilled', 'fulfilled']);
  assert.equal(slotCount('c1', day), 2);
});

test('2c. midnight crossing: 23:30 CT and 00:15 CT next day (different ledger docs) are refused by spacing', async () => {
  const day = safeDay();
  const next = addDay(day, 1);
  const a = await scheduled('c1', 'Late night.', ctIso(day, 23, 30));
  const b = await approved('c1', 'Just after midnight.');
  await assert.rejects(svc.updateSocialPost('c1', b.id, { scheduledAt: ctIso(next, 0, 15) }), { code: 'plan-spacing' });
  assert.equal(raw(b.id).status, 'approved');
  assert.equal(slotCount('c1', day), 1);
  assert.equal(ledger('c1', next), undefined, 'no slot was written for the refused post');
  // and the reverse direction: the earlier-day slot is checked from the later day too
  const c = await approved('c1', 'Early next day, far enough.');
  assert.equal((await svc.updateSocialPost('c1', c.id, { scheduledAt: ctIso(next, 2, 0) })).status, 'scheduled');
  assert.equal(raw(a.id).status, 'scheduled');
});

test('2d. midnight crossing, concurrent', async () => {
  const day = safeDay();
  const next = addDay(day, 1);
  const a = await approved('c1', 'Race late.');
  const b = await approved('c1', 'Race early.');
  const results = await Promise.allSettled([
    svc.updateSocialPost('c1', a.id, { scheduledAt: ctIso(day, 23, 30) }),
    svc.updateSocialPost('c1', b.id, { scheduledAt: ctIso(next, 0, 15) }),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(results.find((r) => r.status === 'rejected').reason.code, 'plan-spacing');
});

// ---------------------------------------------------------------------------------------------------------------
// 3. Day cap
// ---------------------------------------------------------------------------------------------------------------

test('3. day cap: with capPerDay 2 / spacing 60 a third post on the same CT day is refused with plan-day-cap', async () => {
  await setPlan({ capPerDay: 2, minSpacingMin: 60 });
  const day = safeDay();
  await scheduled('c1', 'Cap 1.', ctIso(day, 9));
  await scheduled('c1', 'Cap 2.', ctIso(day, 11));
  const third = await approved('c1', 'Cap 3.');
  await assert.rejects(svc.updateSocialPost('c1', third.id, { scheduledAt: ctIso(day, 14) }), { code: 'plan-day-cap', status: 409 });
  assert.equal(raw(third.id).status, 'approved');
  assert.equal(slotCount('c1', day), 2);
  // the next CT day is a different cap bucket
  assert.equal((await svc.updateSocialPost('c1', third.id, { scheduledAt: ctIso(addDay(day, 1), 14) })).status, 'scheduled');
});

test('3b. default plan (cap 6, spacing 120): six posts 3h apart (01:00-16:00 CT) fit; a seventh is refused by the cap', async () => {
  const day = safeDay();
  for (const h of [1, 4, 7, 10, 13, 16]) await scheduled('c1', `Default ${h}.`, ctIso(day, h));
  assert.equal(slotCount('c1', day), 6);
  const seventh = await approved('c1', 'Seventh.');
  await assert.rejects(svc.updateSocialPost('c1', seventh.id, { scheduledAt: ctIso(day, 19) }), { code: 'plan-day-cap' });
});

test('3c. concurrent last-slot race: cap 1 leaves exactly one winner', async () => {
  await setPlan({ capPerDay: 1, minSpacingMin: 0 });
  const day = safeDay();
  const a = await approved('c1', 'Cap race A.');
  const b = await approved('c1', 'Cap race B.');
  const results = await Promise.allSettled([
    svc.updateSocialPost('c1', a.id, { scheduledAt: ctIso(day, 9) }),
    svc.updateSocialPost('c1', b.id, { scheduledAt: ctIso(day, 15) }),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(results.find((r) => r.status === 'rejected').reason.code, 'plan-day-cap');
});

// ---------------------------------------------------------------------------------------------------------------
// 4. Web edit during approval
// ---------------------------------------------------------------------------------------------------------------

test('4. stale approval after a concurrent web edit: revision-conflict, edit survives, fresh revision succeeds', async () => {
  const p = await v2('c1', 'Original text.');
  const staleRev = raw(p.id).revision || 0;
  const edited = await svc.updateSocialPost('c1', p.id, { content: 'Edited on the web.' });
  assert.ok((edited.revision || 0) > staleRev);
  await assert.rejects(
    svc.approveAndSchedule('c1', p.id, { scheduledAt: ctIso(safeDay(), 10), expectedRevision: staleRev }),
    { code: 'revision-conflict', status: 409 },
  );
  assert.equal(raw(p.id).content, 'Edited on the web.');
  assert.equal(raw(p.id).status, 'draft');
  const ok = await svc.approveAndSchedule('c1', p.id, { scheduledAt: ctIso(safeDay(), 10), expectedRevision: raw(p.id).revision || 0 });
  assert.equal(ok.status, 'scheduled');
  assert.equal(ok.content, 'Edited on the web.');
});

test('4b. true race: edit and approveAndSchedule from the same snapshot: one wins, loser is revision-conflict, no whole-document restore', async () => {
  const p = await v2('c1', 'Race original.');
  const results = await Promise.allSettled([
    svc.updateSocialPost('c1', p.id, { content: 'Race edit.' }),
    svc.approveAndSchedule('c1', p.id, { scheduledAt: ctIso(safeDay(), 10) }),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(results.find((r) => r.status === 'rejected').reason.code, 'revision-conflict');
  const row = raw(p.id);
  if (row.status === 'scheduled') assert.equal(row.content, 'Race original.');
  else assert.equal(row.content, 'Race edit.');
});

test('4c. stale approveDraft / rejectDraft with an old expectedRevision are revision-conflict', async () => {
  const p = await v2('c1', 'Rev check.');
  const rev = raw(p.id).revision || 0;
  await svc.updateSocialPost('c1', p.id, { content: 'Rev check edited.' });
  await assert.rejects(svc.approveDraft('c1', p.id, { expectedRevision: rev }), { code: 'revision-conflict' });
  await assert.rejects(svc.rejectDraft('c1', p.id, { expectedRevision: rev }), { code: 'revision-conflict' });
  assert.equal(raw(p.id).status, 'draft');
});

// ---------------------------------------------------------------------------------------------------------------
// 5. Reschedule / unschedule / reject release the slot
// ---------------------------------------------------------------------------------------------------------------

test('5. reschedule releases the old slot: B can then take the slot A vacated', async () => {
  const day = safeDay();
  const a = await scheduled('c1', 'Move me.', ctIso(day, 9));
  const b = await approved('c1', 'Take the slot.');
  await assert.rejects(svc.updateSocialPost('c1', b.id, { scheduledAt: ctIso(day, 9, 30) }), { code: 'plan-spacing' });
  await svc.updateSocialPost('c1', a.id, { scheduledAt: ctIso(day, 15) });
  assert.deepEqual(Object.keys(ledger('c1', day).slots), [a.id]);
  assert.equal(ledger('c1', day).slots[a.id].ms, Date.parse(ctIso(day, 15)));
  assert.equal((await svc.updateSocialPost('c1', b.id, { scheduledAt: ctIso(day, 9) })).status, 'scheduled');
  assert.equal(slotCount('c1', day), 2);
});

test('5b. unschedule (scheduledAt "") and reject free the package for another post', async () => {
  await mkPkg('pkg-free');
  const day = safeDay();
  const a = await scheduled('c1', 'Holds package.', ctIso(day, 9), { packageId: 'pkg-free' });
  const b = await approved('c1', 'Wants package.', { packageId: 'pkg-free' });
  await assert.rejects(svc.updateSocialPost('c1', b.id, { scheduledAt: ctIso(day, 15) }), { code: 'package-already-pending' });
  // a scheduled row cannot simply be rejected (409), and keeps its slot
  await assert.rejects(svc.rejectDraft('c1', a.id), { code: 'not-draft' });
  assert.equal(pkgRes('c1', 'pkg-free').state, 'active');
  // unschedule
  const un = await svc.updateSocialPost('c1', a.id, { scheduledAt: '' });
  assert.equal(un.status, 'approved');
  assert.equal(un.scheduledAt, null);
  assert.equal(pkgRes('c1', 'pkg-free').state, 'released');
  assert.equal(slotCount('c1', day), 0);
  assert.equal((await svc.updateSocialPost('c1', b.id, { scheduledAt: ctIso(day, 15) })).status, 'scheduled');
  assert.equal(pkgRes('c1', 'pkg-free').postId, b.id);
  // reject the now-unscheduled a; it must not disturb b's reservation, and a can no longer claim anything
  assert.equal((await svc.rejectDraft('c1', a.id)).status, 'rejected');
  assert.equal(pkgRes('c1', 'pkg-free').postId, b.id);
});

test('5c. rejecting an unscheduled approved row leaves the package free for a third copy after the holder is unscheduled', async () => {
  await mkPkg('pkg-rej');
  const day = safeDay();
  const a = await approved('c1', 'Rejected copy.', { packageId: 'pkg-rej' });
  await svc.rejectDraft('c1', a.id);
  const c = await approved('c1', 'Next copy.', { packageId: 'pkg-rej' });
  assert.equal((await svc.updateSocialPost('c1', c.id, { scheduledAt: ctIso(day, 12) })).status, 'scheduled');
});

// ---------------------------------------------------------------------------------------------------------------
// 6. Repeated actions
// ---------------------------------------------------------------------------------------------------------------

test('6. approveAndSchedule twice with the same time returns the same row: revision unchanged, one slot, one row', async () => {
  const day = safeDay();
  const p = await v2('c1', 'Twice.');
  const iso = ctIso(day, 10);
  const first = await svc.approveAndSchedule('c1', p.id, { scheduledAt: iso, reviewedBy: 'owner' });
  const second = await svc.approveAndSchedule('c1', p.id, { scheduledAt: iso, reviewedBy: 'owner' });
  assert.equal(first.status, 'scheduled');
  assert.equal(second.status, 'scheduled');
  assert.equal(second.id, first.id);
  assert.equal(second.revision, first.revision);
  assert.equal(raw(p.id).revision, first.revision);
  assert.equal(slotCount('c1', day), 1);
  assert.equal((await svc.readSocialQueue('c1')).length, 1);
});

test('6b. approveDraft twice is idempotent (same revision, same approvedHash)', async () => {
  const p = await v2('c1', 'Approve twice.');
  const a = await svc.approveDraft('c1', p.id);
  const b = await svc.approveDraft('c1', p.id);
  assert.equal(b.status, 'approved');
  assert.equal(b.revision, a.revision);
  assert.equal(b.approvedHash, a.approvedHash);
  assert.ok(a.approvedHash);
});

test('6c. concurrent approveAndSchedule of the same draft: one commit wins, the other is revision-conflict; one slot', async () => {
  const day = safeDay();
  const p = await v2('c1', 'Double click.');
  const iso = ctIso(day, 10);
  const results = await Promise.allSettled([
    svc.approveAndSchedule('c1', p.id, { scheduledAt: iso }),
    svc.approveAndSchedule('c1', p.id, { scheduledAt: iso }),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(results.find((r) => r.status === 'rejected').reason.code, 'revision-conflict');
  assert.equal(slotCount('c1', day), 1);
  assert.equal(raw(p.id).status, 'scheduled');
});

test('6d. two concurrent publishApprovedPost on one awaiting_approval row publish exactly ONE tweet; loser is not-pending', async () => {
  const p = await v2('c1', 'Email approval double click.', { status: 'awaiting_approval' });
  const results = await Promise.allSettled([
    svc.publishApprovedPost('c1', p.id),
    svc.publishApprovedPost('c1', p.id),
  ]);
  assert.equal(tweets.length, 1);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  const bad = results.find((r) => r.status === 'rejected');
  assert.equal(bad.reason.code, 'not-pending');
  assert.equal(bad.reason.status, 409);
  assert.equal(raw(p.id).status, 'posted');
  // a third, later click also cannot double-post
  await assert.rejects(svc.publishApprovedPost('c1', p.id), { code: 'not-pending' });
  assert.equal(tweets.length, 1);
});

// ---------------------------------------------------------------------------------------------------------------
// 7. Stale approval
// ---------------------------------------------------------------------------------------------------------------

test('7. editing text of an approved+scheduled v2 row voids approval and schedule; slot is released', async () => {
  const day = safeDay();
  const s = await scheduled('c1', 'Approved copy.', ctIso(day, 9));
  assert.equal(slotCount('c1', day), 1);
  const out = await svc.updateSocialPost('c1', s.id, { content: 'Changed copy.' });
  assert.equal(out.status, 'draft');
  assert.equal(out.scheduledAt, null);
  assert.equal(out.reviewedAt, null);
  assert.equal(slotCount('c1', day), 0, 'voided schedule frees the ledger slot');
});

test('7b. attachMediaToPost on an approved v2 row voids approval (status draft, reviewedAt null)', async () => {
  const p = await approved('c1', 'Media will change.');
  const out = await svc.attachMediaToPost('c1', p.id, { mediaUrl: 'https://example.com/v.mp4', mediaContentType: 'video/mp4' });
  assert.equal(out.status, 'draft');
  assert.equal(out.reviewedAt, null);
  assert.equal(out.approvedHash, null);
});

test('7c. attachMediaToPost on a scheduled v2 row voids the schedule and releases the slot', async () => {
  const day = safeDay();
  const s = await scheduled('c1', 'Scheduled then media.', ctIso(day, 9));
  const out = await svc.attachMediaToPost('c1', s.id, { mediaUrl: 'https://example.com/v.mp4', mediaContentType: 'video/mp4' });
  assert.equal(out.status, 'draft');
  assert.equal(out.scheduledAt, null);
  assert.equal(slotCount('c1', day), 0);
});

test('7d. tampered content (approvedHash mismatch) is parked needs_review/approval-stale at delivery; nothing published', async () => {
  const s = await scheduled('c1', 'Approved wording.', new Date(Date.now() + 5 * HOUR).toISOString());
  assert.ok(raw(s.id).approvedHash);
  // Bypass the service: change what would be published without voiding approval, and make the row due.
  ctx.adminDb._patch('social_posts', s.id, { content: 'Tampered wording.', scheduledAt: PAST(1) });
  await svc.processDuePosts('c1');
  assert.equal(tweets.length, 0);
  assert.equal(raw(s.id).status, 'needs_review');
  assert.equal(raw(s.id).errorClass, 'approval-stale');
  // a second sweep still publishes nothing
  await svc.processDuePosts('c1');
  assert.equal(tweets.length, 0);
});

// ---------------------------------------------------------------------------------------------------------------
// 8. Failure / crash recovery
// ---------------------------------------------------------------------------------------------------------------

test('8a. a reservation left pointing at a draft or posted post is stale and does not block a new schedule', async () => {
  await mkPkg('pkg-stale-d'); await mkPkg('pkg-stale-p');
  const day = safeDay();
  const draft = await v2('c1', 'Orphan draft.');
  const posted = await v2('c1', 'Orphan posted.');
  ctx.adminDb._patch('social_posts', posted.id, { status: 'posted' });
  const at = ctIso(day, 9);
  await ctx.adminDb.collection('x_package_reservations').doc('c1__pkg-stale-d').set({ clientId: 'c1', packageId: 'pkg-stale-d', postId: draft.id, scheduledAt: at, state: 'active' });
  await ctx.adminDb.collection('x_package_reservations').doc('c1__pkg-stale-p').set({ clientId: 'c1', packageId: 'pkg-stale-p', postId: posted.id, scheduledAt: at, state: 'active' });
  const n1 = await scheduled('c1', 'Fresh for draft-orphan.', ctIso(day, 9), { packageId: 'pkg-stale-d' });
  const n2 = await scheduled('c1', 'Fresh for posted-orphan.', ctIso(day, 14), { packageId: 'pkg-stale-p' });
  assert.equal(n1.status, 'scheduled');
  assert.equal(n2.status, 'scheduled');
  assert.equal(pkgRes('c1', 'pkg-stale-d').postId, n1.id);
  assert.equal(pkgRes('c1', 'pkg-stale-p').postId, n2.id);
});

test('8a2. a mismatched reservation does not weaken the pre-check: a live pending sibling still blocks the package', async () => {
  await mkPkg('pkg-moved');
  const day = safeDay();
  const holder = await v2('c1', 'Holder.', { status: 'scheduled', scheduledAt: ctIso(day, 20), packageId: 'pkg-moved' });
  await ctx.adminDb.collection('x_package_reservations').doc('c1__pkg-moved').set({ clientId: 'c1', packageId: 'pkg-moved', postId: holder.id, scheduledAt: ctIso(day, 8), state: 'active' });
  // The service's pre-check still sees `holder` as a pending copy of the package, so this exercises the tx layer
  // only through a package with no live pending sibling; assert at least that the pre-check protects the package.
  const other = await approved('c1', 'Other.', { packageId: 'pkg-moved' });
  await assert.rejects(svc.updateSocialPost('c1', other.id, { scheduledAt: ctIso(day, 12) }), { code: 'package-already-pending' });
});

test('8b. ambiguous publish outcome on a v2 due row: needs_review, not retryable, NOT retried by a second sweep, one attempt', async () => {
  tweetImpl = async () => { throw Object.assign(new Error('socket timed out'), { code: 'ETIMEDOUT' }); };
  const p = await v2('c1', 'Ambiguous.', { status: 'scheduled', scheduledAt: PAST(1) });
  await svc.processDuePosts('c1');
  assert.equal(raw(p.id).status, 'needs_review');
  assert.equal(raw(p.id).retryable, false);
  assert.equal(raw(p.id).errorClass, 'network-ambiguous');
  assert.equal(tweets.length, 1);
  await svc.processDuePosts('c1');
  await svc.processDuePosts('c1');
  assert.equal(tweets.length, 1, 'never auto-retried');
  assert.equal(raw(p.id).status, 'needs_review');
});

test('8b2. HTTP 503 on a v2 due row is ambiguous too (needs_review, one attempt)', async () => {
  tweetImpl = async () => { throw Object.assign(new Error('bad gateway'), { code: 503 }); };
  const p = await v2('c1', 'Server error.', { status: 'scheduled', scheduledAt: PAST(1) });
  await svc.processDuePosts('c1');
  await svc.processDuePosts('c1');
  assert.equal(raw(p.id).status, 'needs_review');
  assert.equal(raw(p.id).retryable, false);
  assert.equal(raw(p.id).errorClass, 'server-error-ambiguous');
  assert.equal(tweets.length, 1);
});

test('8b3. the same ambiguous failure on a LEGACY row stays failed (compat), non-retryable, never re-sent', async () => {
  tweetImpl = async () => { throw Object.assign(new Error('socket timed out'), { code: 'ETIMEDOUT' }); };
  const p = await svc.createSocialPost('c1', { content: 'Legacy ambiguous.', status: 'scheduled', scheduledAt: PAST(1) });
  await svc.processDuePosts('c1');
  assert.equal(raw(p.id).status, 'failed');
  assert.equal(raw(p.id).retryable, false);
  await svc.processDuePosts('c1');
  assert.equal(tweets.length, 1);
});

test('8b4. a retryable failure (429) is not parked: v2 row stays failed+retryable and is retried by the next sweep', async () => {
  let n = 0;
  tweetImpl = async () => { n += 1; if (n === 1) throw Object.assign(new Error('rate'), { code: 429 }); return { data: { id: 'main-ok' } }; };
  const p = await v2('c1', 'Rate limited once.', { status: 'scheduled', scheduledAt: PAST(1) });
  await svc.processDuePosts('c1');
  assert.equal(raw(p.id).status, 'failed');
  assert.equal(raw(p.id).retryable, true);
  await svc.processDuePosts('c1');
  assert.equal(raw(p.id).status, 'posted');
  assert.equal(tweets.length, 2);
});

test('8c. a needs_review row cannot be rescheduled via updateSocialPost (needs-review-reconcile)', async () => {
  const p = await v2('c1', 'Held.', { status: 'needs_review' });
  await assert.rejects(svc.updateSocialPost('c1', p.id, { scheduledAt: ctIso(safeDay(), 10) }), { code: 'needs-review-reconcile', status: 409 });
  assert.equal(raw(p.id).status, 'needs_review');
});

test('8c2. reconcilePost posted: numeric platform id marks it posted; missing/invalid id is rejected and changes nothing', async () => {
  const p = await v2('c1', 'Held, was live.', { status: 'needs_review' });
  for (const bad of [undefined, '', 'abc', '123', '12ab45678']) {
    await assert.rejects(svc.reconcilePost('c1', p.id, { outcome: 'posted', platformId: bad }), { code: 'platform-id-required', status: 400 });
  }
  assert.equal(raw(p.id).status, 'needs_review');
  const out = await svc.reconcilePost('c1', p.id, { outcome: 'posted', platformId: '1850000000000000001', by: 'owner' });
  assert.equal(out.status, 'posted');
  assert.equal(out.twitterId, '1850000000000000001');
  assert.equal(out.reconciledBy, 'owner');
  assert.equal(tweets.length, 0, 'reconcile never publishes');
  await assert.rejects(svc.reconcilePost('c1', p.id, { outcome: 'posted', platformId: '1850000000000000002' }), { code: 'not-held' });
});

test('8c3. reconcilePost not-posted returns an unscheduled draft and frees the slot and package', async () => {
  await mkPkg('pkg-recon');
  const day = safeDay();
  const s = await scheduled('c1', 'Held then not posted.', ctIso(day, 9), { packageId: 'pkg-recon' });
  // Simulate the post-publish ambiguous park: row is needs_review but its slot is still held.
  ctx.adminDb._patch('social_posts', s.id, { status: 'needs_review', errorClass: 'network-ambiguous' });
  assert.equal(slotCount('c1', day), 1);
  const out = await svc.reconcilePost('c1', s.id, { outcome: 'not-posted', by: 'owner' });
  assert.equal(out.status, 'draft');
  assert.equal(out.scheduledAt, null);
  assert.equal(out.reviewedAt, null);
  assert.equal(out.approvedHash, null);
  assert.equal(slotCount('c1', day), 0);
  const other = await approved('c1', 'Takes the slot and package.', { packageId: 'pkg-recon' });
  assert.equal((await svc.updateSocialPost('c1', other.id, { scheduledAt: ctIso(day, 9) })).status, 'scheduled');
  await assert.rejects(svc.reconcilePost('c1', s.id, { outcome: 'bogus' }), { code: 'not-held' }, 'draft is no longer held');
});

test('8c4. reconcilePost bad outcome on a held row is 400; a non-held row is not-held', async () => {
  const held = await v2('c1', 'Held.', { status: 'needs_review' });
  await assert.rejects(svc.reconcilePost('c1', held.id, { outcome: 'maybe' }), { code: 'bad-outcome', status: 400 });
  const draft = await v2('c1', 'Plain draft.');
  await assert.rejects(svc.reconcilePost('c1', draft.id, { outcome: 'not-posted' }), { code: 'not-held' });
});

test('8d. expired due rows (>2h late) become expired, are not published, and release their ledger slot and package', async () => {
  await mkPkg('pkg-exp');
  const lateMs = Date.now() - 3 * HOUR;
  const lateIso = new Date(lateMs).toISOString();
  const p = await v2('c1', 'Way too late.', { status: 'scheduled', scheduledAt: lateIso, packageId: 'pkg-exp' });
  const p2 = ctParts(lateMs);
  const day = `${p2.year}-${String(p2.month).padStart(2, '0')}-${String(p2.day).padStart(2, '0')}`;
  await ctx.adminDb.collection('x_schedule_ledger').doc(`c1__${day}`).set({ clientId: 'c1', day, slots: { [p.id]: { ms: lateMs, engine: 'untagged' } } });
  await ctx.adminDb.collection('x_package_reservations').doc('c1__pkg-exp').set({ clientId: 'c1', packageId: 'pkg-exp', postId: p.id, scheduledAt: lateIso, state: 'active' });
  await svc.processDuePosts('c1');
  assert.equal(tweets.length, 0);
  assert.equal(raw(p.id).status, 'expired');
  assert.equal(slotCount('c1', day), 0);
  assert.equal(pkgRes('c1', 'pkg-exp').state, 'released');
});

test('8d2. a row 1h late is NOT expired and publishes (boundary is 2h)', async () => {
  const p = await v2('c1', 'Slightly late.', { status: 'scheduled', scheduledAt: PAST(1) });
  await svc.processDuePosts('c1');
  assert.equal(raw(p.id).status, 'posted');
  assert.equal(tweets.length, 1);
});

test('8e. a stale `posting` claim (>15 min) is parked needs_review by the sweep and never re-sent', async () => {
  const p = await v2('c1', 'Died mid-publish.', { status: 'scheduled', scheduledAt: PAST(1) });
  ctx.adminDb._patch('social_posts', p.id, { status: 'posting', claimedAt: new Date(Date.now() - 30 * MIN).toISOString() });
  const out = await svc.processDuePosts('c1');
  assert.equal(raw(p.id).status, 'needs_review');
  assert.equal(out.needsReview.length, 1);
  assert.equal(tweets.length, 0);
});

// ---------------------------------------------------------------------------------------------------------------
// 9. Plan override
// ---------------------------------------------------------------------------------------------------------------

test('9. spacing violation is refused by default; opts.planOverride succeeds and stamps {by, at, reason}', async () => {
  const day = safeDay();
  await scheduled('c1', 'Anchor.', ctIso(day, 10));
  const b = await approved('c1', 'Too close.');
  await assert.rejects(svc.updateSocialPost('c1', b.id, { scheduledAt: ctIso(day, 10, 30) }), { code: 'plan-spacing' });
  const out = await svc.updateSocialPost('c1', b.id, { scheduledAt: ctIso(day, 10, 30) }, { planOverride: { by: 'owner-uid', reason: 'launch tie-in' } });
  assert.equal(out.status, 'scheduled');
  assert.equal(out.planOverride.by, 'owner-uid');
  assert.equal(out.planOverride.reason, 'launch tie-in');
  assert.ok(Number.isFinite(Date.parse(out.planOverride.at)));
  assert.deepEqual(raw(b.id).planOverride, out.planOverride);
});

test('9b. a payload-level planOverride key is ignored (still refused, nothing stamped)', async () => {
  const day = safeDay();
  await scheduled('c1', 'Anchor.', ctIso(day, 10));
  const b = await approved('c1', 'Sneaky.');
  await assert.rejects(
    svc.updateSocialPost('c1', b.id, { scheduledAt: ctIso(day, 10, 30), planOverride: { by: 'me', reason: 'please' } }),
    { code: 'plan-spacing' },
  );
  assert.equal(raw(b.id).planOverride, undefined);
  assert.equal(raw(b.id).status, 'approved');
});

test('9c. override without a reason is not an override; approveAndSchedule honours opts.planOverride', async () => {
  const day = safeDay();
  await scheduled('c1', 'Anchor.', ctIso(day, 10));
  const b = await v2('c1', 'Approve with override.');
  await assert.rejects(
    svc.approveAndSchedule('c1', b.id, { scheduledAt: ctIso(day, 10, 20), planOverride: { by: 'owner-uid', reason: '' } }),
    { code: 'plan-spacing' },
  );
  assert.equal(raw(b.id).status, 'draft', 'refused approval leaves the draft untouched');
  const out = await svc.approveAndSchedule('c1', b.id, { scheduledAt: ctIso(day, 10, 20), planOverride: { by: 'owner-uid', reason: 'ok' } });
  assert.equal(out.status, 'scheduled');
  assert.equal(out.planOverride.reason, 'ok');
});

test('9d. an overridden post still holds a ledger slot, so later posts are checked against it', async () => {
  const day = safeDay();
  await scheduled('c1', 'Anchor.', ctIso(day, 10));
  const b = await approved('c1', 'Overridden.');
  await svc.updateSocialPost('c1', b.id, { scheduledAt: ctIso(day, 10, 30) }, { planOverride: { by: 'o', reason: 'r' } });
  assert.equal(slotCount('c1', day), 2);
  const c = await approved('c1', 'After override.');
  await assert.rejects(svc.updateSocialPost('c1', c.id, { scheduledAt: ctIso(day, 11, 0) }), { code: 'plan-spacing' });
});

// ---------------------------------------------------------------------------------------------------------------
// 10. Wrong client / client isolation
// ---------------------------------------------------------------------------------------------------------------

test('10. another client id gets 404 on update/approveAndSchedule/reconcile/reject and nothing changes', async () => {
  const p = await v2('c1', 'Private.');
  const held = await v2('c1', 'Private held.', { status: 'needs_review' });
  await assert.rejects(svc.updateSocialPost('c2', p.id, { content: 'hijack' }), { status: 404 });
  await assert.rejects(svc.approveAndSchedule('c2', p.id, { scheduledAt: ctIso(safeDay(), 10) }), { status: 404 });
  await assert.rejects(svc.rejectDraft('c2', p.id), { status: 404 });
  await assert.rejects(svc.approveDraft('c2', p.id), { status: 404 });
  await assert.rejects(svc.reconcilePost('c2', held.id, { outcome: 'posted', platformId: '1850000000000000009' }), { status: 404 });
  await assert.rejects(svc.reconcilePost('c3', held.id, { outcome: 'not-posted' }), { status: 404 });
  assert.equal(raw(p.id).content, 'Private.');
  assert.equal(raw(p.id).status, 'draft');
  assert.equal(raw(held.id).status, 'needs_review');
});

test('10b. a c1 reservation / ledger slot never blocks c2 or another pilot client c3 (same package id, same time)', async () => {
  await mkPkg('pkg-shared');
  const day = safeDay();
  const iso = ctIso(day, 9);
  const c1 = await scheduled('c1', 'Client one.', iso, { packageId: 'pkg-shared' });
  const c2 = await svc.schedulePost('c2', { content: 'Client two.', packageId: 'pkg-shared', scheduledAt: iso });
  const c3 = await scheduled('c3', 'Client three.', iso, { packageId: 'pkg-shared' });
  assert.equal(c1.status, 'scheduled');
  assert.equal(c2.status, 'scheduled');
  assert.equal(c3.status, 'scheduled');
  assert.equal(pkgRes('c1', 'pkg-shared').postId, c1.id);
  assert.equal(pkgRes('c3', 'pkg-shared').postId, c3.id);
  assert.equal(slotCount('c1', day), 1);
  assert.equal(slotCount('c3', day), 1);
});

test('10c. concurrent schedulers across two clients do not interfere (both win)', async () => {
  const day = safeDay();
  const a = await approved('c1', 'One.');
  const b = await approved('c3', 'Three.');
  const results = await Promise.allSettled([
    svc.updateSocialPost('c1', a.id, { scheduledAt: ctIso(day, 9) }),
    svc.updateSocialPost('c3', b.id, { scheduledAt: ctIso(day, 9) }),
  ]);
  assert.deepEqual(results.map((r) => r.status), ['fulfilled', 'fulfilled']);
});

// ---------------------------------------------------------------------------------------------------------------
// 11. Non-pilot client: no plan enforcement, package collision still enforced
// ---------------------------------------------------------------------------------------------------------------

test('11. non-pilot c2: posts 10 minutes apart and over the daily cap both schedule; no ledger is written', async () => {
  const day = safeDay();
  const a = await scheduled('c2', 'Non-pilot A.', ctIso(day, 10, 0));
  const b = await scheduled('c2', 'Non-pilot B.', ctIso(day, 10, 10));
  assert.equal(a.status, 'scheduled');
  assert.equal(b.status, 'scheduled');
  for (let i = 0; i < 7; i += 1) await scheduled('c2', `Non-pilot extra ${i}.`, ctIso(day, 11, i * 5));
  assert.equal(ledger('c2', day), undefined, 'plan ledger is pilot-only');
});

test('11b. non-pilot c2 still refuses a second copy of the same package (sequential and concurrent)', async () => {
  await mkPkg('pkg-np');
  const day = safeDay();
  const a = await approved('c2', 'NP copy A.', { packageId: 'pkg-np' });
  const b = await approved('c2', 'NP copy B.', { packageId: 'pkg-np' });
  const results = await Promise.allSettled([
    svc.updateSocialPost('c2', a.id, { scheduledAt: ctIso(day, 10) }),
    svc.updateSocialPost('c2', b.id, { scheduledAt: ctIso(day, 16) }),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(results.find((r) => r.status === 'rejected').reason.code, 'package-already-pending');
  assert.equal(pkgRes('c2', 'pkg-np').state, 'active');
});

test('11c. non-pilot c2 has no plan spacing and stamps no planOverride', async () => {
  const day = safeDay();
  await scheduled('c2', 'NP anchor.', ctIso(day, 10));
  const b = await approved('c2', 'NP close.');
  const out = await svc.updateSocialPost('c2', b.id, { scheduledAt: ctIso(day, 10, 5) });
  assert.equal(out.status, 'scheduled');
  assert.equal(out.planOverride, undefined);
});

// ---------------------------------------------------------------------------------------------------------------
// 12. Review-fix coverage: retryable holds, non-pilot ledger, claim races, delivery hold, live queue, crash recovery
// ---------------------------------------------------------------------------------------------------------------

const dayOfMs = (ms) => { const p = ctParts(ms); return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`; };
/** Seed the ledger slot + package reservation a due row would hold (as if it had been scheduled earlier). */
async function seedHeld(clientId, post, packageId) {
  const ms = Date.parse(post.scheduledAt);
  const day = dayOfMs(ms);
  await ctx.adminDb.collection('x_schedule_ledger').doc(`${clientId}__${day}`).set({ clientId, day, slots: { [post.id]: { ms, engine: 'untagged' } } });
  if (packageId) await ctx.adminDb.collection('x_package_reservations').doc(`${clientId}__${packageId}`).set({ clientId, packageId, postId: post.id, scheduledAt: post.scheduledAt, state: 'active' });
  return day;
}

test('12.1 retryable 429 on a due pilot v2 row keeps its slot + package reservation; both released after MAX_ATTEMPTS sweeps', async () => {
  await mkPkg('pkg-429');
  tweetImpl = async () => { throw Object.assign(new Error('rate'), { code: 429 }); };
  const at = PAST(1);
  const p = await v2('c1', 'Rate limited forever.', { status: 'scheduled', scheduledAt: at, packageId: 'pkg-429' });
  const day = await seedHeld('c1', raw(p.id), 'pkg-429');
  await svc.processDuePosts('c1');
  assert.equal(raw(p.id).status, 'failed');
  assert.equal(raw(p.id).retryable, true);
  assert.equal(raw(p.id).attempts, 1);
  assert.equal(pkgRes('c1', 'pkg-429').state, 'active', 'reservation survives a retryable failure');
  assert.equal(slotCount('c1', day), 1, 'ledger slot survives a retryable failure');
  await svc.processDuePosts('c1');
  assert.equal(raw(p.id).attempts, 2);
  assert.equal(pkgRes('c1', 'pkg-429').state, 'active');
  await svc.processDuePosts('c1');
  assert.equal(raw(p.id).attempts, 3);
  assert.equal(raw(p.id).status, 'failed');
  assert.equal(pkgRes('c1', 'pkg-429').state, 'released', 'released once retries are exhausted');
  assert.equal(slotCount('c1', day), 0);
  await svc.processDuePosts('c1');
  assert.equal(tweets.length, 3, 'no fourth attempt');
});

test('12.2 non-retryable failure and expired row for NON-pilot c2 write no x_schedule_ledger docs', async () => {
  tweetImpl = async () => { throw Object.assign(new Error('bad request'), { code: 400 }); };
  const failing = await v2('c2', 'Hard failure.', { status: 'scheduled', scheduledAt: PAST(1) });
  const lateMs = Date.now() - 3 * HOUR;
  const late = await v2('c2', 'Way late.', { status: 'scheduled', scheduledAt: new Date(lateMs).toISOString() });
  await svc.processDuePosts('c2');
  assert.equal(raw(failing.id).status, 'failed');
  assert.equal(raw(failing.id).retryable, false);
  assert.equal(raw(late.id).status, 'expired');
  for (const ms of [Date.now() - HOUR, lateMs]) assert.equal(ledger('c2', dayOfMs(ms)), undefined);
});

test('12.3 rejectSocialPost vs publishApprovedPost race: at most one tweet, never rejected-with-twitterId', async () => {
  const p = await v2('c1', 'Race approve/reject.', { status: 'awaiting_approval' });
  const [pub, rej] = await Promise.allSettled([svc.publishApprovedPost('c1', p.id), svc.rejectSocialPost('c1', p.id)]);
  assert.ok(tweets.length <= 1);
  const row = raw(p.id);
  if (pub.status === 'fulfilled') {
    assert.equal(tweets.length, 1);
    assert.equal(row.status, 'posted');
    assert.equal(rej.status, 'rejected');
    assert.equal(rej.reason.status, 409);
    assert.ok(['not-pending', 'revision-conflict'].includes(rej.reason.code));
  } else {
    assert.equal(tweets.length, 0);
    assert.equal(row.status, 'rejected');
    assert.equal(rej.status, 'fulfilled');
    assert.ok(!row.twitterId);
  }
  assert.ok(!(row.status === 'rejected' && row.twitterId));
});

test('12.3b reject first then publish: nothing published, publish is not-pending', async () => {
  const p = await v2('c1', 'Rejected first.', { status: 'awaiting_approval' });
  await svc.rejectSocialPost('c1', p.id);
  await assert.rejects(svc.publishApprovedPost('c1', p.id), { code: 'not-pending', status: 409 });
  assert.equal(tweets.length, 0);
  assert.equal(raw(p.id).status, 'rejected');
});

test('12.4 approval remix writers on a claimed (posting) row return 409 and leave it posting', async () => {
  const p = await v2('c1', 'Claimed row.', { status: 'posting' });
  ctx.adminDb._patch('social_posts', p.id, { claimedAt: new Date().toISOString() });
  await assert.rejects(svc.markApprovalRemixPending('c1', p.id, { jobId: 'j1', assetClientId: 'c1' }), { status: 409 });
  await assert.rejects(svc.completeApprovalRemix('c1', p.id, { content: 'New copy.', mediaUrl: 'https://example.com/v.mp4' }), { status: 409 });
  await svc.failApprovalRemix('c1', p.id, 'nope'); // returns the row untouched
  const row = raw(p.id);
  assert.equal(row.status, 'posting');
  assert.ok(!row.remixPending);
  assert.ok(!row.remixCount);
  assert.equal(tweets.length, 0);
});

test('12.5 publishApprovedPost: package approval rejected after creation => clearance-revoked, needs_review, 0 tweets, second call not-pending', async () => {
  await mkPkg('pkg-revoke');
  const p = await v2('c1', 'Approval email copy.', { status: 'awaiting_approval', packageId: 'pkg-revoke' });
  await upsertPackage(PKG('pkg-revoke', { approval: { state: 'rejected' } }), { returnPackages: false });
  await assert.rejects(svc.publishApprovedPost('c1', p.id), { code: 'clearance-revoked', status: 409 });
  assert.equal(tweets.length, 0);
  assert.equal(raw(p.id).status, 'needs_review');
  assert.equal(raw(p.id).errorClass, 'clearance-revoked');
  await assert.rejects(svc.publishApprovedPost('c1', p.id), { code: 'not-pending' });
  assert.equal(tweets.length, 0);
});

test('12.6 live queue: a legacy scheduled row with no ledger/reservation still triggers plan-spacing for a pilot schedule', async () => {
  const day = safeDay();
  const legacy = await svc.createSocialPost('c1', { content: 'Legacy scheduled.', status: 'scheduled', scheduledAt: ctIso(day, 10) });
  assert.equal(raw(legacy.id).status, 'scheduled');
  assert.equal(ledger('c1', day), undefined, 'legacy row has no ledger entry');
  const near = await approved('c1', 'Thirty minutes away.');
  await assert.rejects(svc.updateSocialPost('c1', near.id, { scheduledAt: ctIso(day, 10, 30) }), { code: 'plan-spacing' });
  assert.equal(raw(near.id).status, 'approved');
  const far = await approved('c1', 'Three hours away.');
  assert.equal((await svc.updateSocialPost('c1', far.id, { scheduledAt: ctIso(day, 13) })).status, 'scheduled');
});

test('12.6b live queue: a POSTED row 30 minutes before the slot also counts; a non-pilot-client row does not', async () => {
  const day = safeDay();
  const posted = await svc.createSocialPost('c1', { content: 'Already out.', status: 'scheduled', scheduledAt: ctIso(day, 10) });
  ctx.adminDb._patch('social_posts', posted.id, { status: 'posted', twitterId: '1850000000000000003' });
  await svc.createSocialPost('c3', { content: 'Other client, same time.', status: 'scheduled', scheduledAt: ctIso(day, 12) });
  const next = await approved('c1', 'Thirty minutes after posted.');
  await assert.rejects(svc.updateSocialPost('c1', next.id, { scheduledAt: ctIso(day, 10, 30) }), { code: 'plan-spacing' });
  const other = await approved('c1', 'Next to other client row.');
  assert.equal((await svc.updateSocialPost('c1', other.id, { scheduledAt: ctIso(day, 12, 10) })).status, 'scheduled');
});

test('12.7 crashed approval/post-now publish: posting row with no scheduledAt goes needs_review when claim >15 min old, not at 5 min', async () => {
  const old = await v2('c1', 'Crashed publish.', { status: 'posting' });
  const fresh = await v2('c1', 'In-flight publish.', { status: 'posting' });
  ctx.adminDb._patch('social_posts', old.id, { claimedAt: new Date(Date.now() - 20 * MIN).toISOString(), scheduledAt: null });
  ctx.adminDb._patch('social_posts', fresh.id, { claimedAt: new Date(Date.now() - 5 * MIN).toISOString(), scheduledAt: null });
  const out = await svc.processDuePosts('c1');
  assert.equal(raw(old.id).status, 'needs_review');
  assert.equal(raw(fresh.id).status, 'posting');
  assert.equal(out.needsReview.length, 1);
  assert.equal(tweets.length, 0);
});

test('12.8 isPilotClient: owner client is pilot with the list unset (even in production); c2 is not; a set list is exact', () => {
  const { isPilotClient, OWNER_CLIENT_ID } = require('../../../api/_lib/pilot-access.cjs');
  assert.equal(OWNER_CLIENT_ID, 'bryan-balli-WUoltG84');
  assert.equal(isPilotClient(OWNER_CLIENT_ID, { VERCEL_ENV: 'production' }), true);
  assert.equal(isPilotClient(OWNER_CLIENT_ID, { VERCEL_ENV: 'production', NODE_ENV: 'production' }), true);
  assert.equal(isPilotClient('c2', { VERCEL_ENV: 'production' }), false);
  assert.equal(isPilotClient('c2', {}), false);
  assert.equal(isPilotClient('', {}), false);
  assert.equal(isPilotClient(undefined, {}), false);
  const env = { PILOT_CLIENT_IDS: 'c1, c3' };
  assert.equal(isPilotClient('c1', env), true);
  assert.equal(isPilotClient('c3', env), true);
  assert.equal(isPilotClient('c2', env), false);
  assert.equal(isPilotClient(OWNER_CLIENT_ID, env), false, 'a set list is exact: owner is not implicitly added');
  // and via process.env
  const saved = process.env.PILOT_CLIENT_IDS; const savedV = process.env.VERCEL_ENV;
  try {
    delete process.env.PILOT_CLIENT_IDS; process.env.VERCEL_ENV = 'production';
    assert.equal(isPilotClient(OWNER_CLIENT_ID), true);
    assert.equal(isPilotClient('c2'), false);
  } finally {
    if (saved === undefined) delete process.env.PILOT_CLIENT_IDS; else process.env.PILOT_CLIENT_IDS = saved;
    if (savedV === undefined) delete process.env.VERCEL_ENV; else process.env.VERCEL_ENV = savedV;
  }
});

test('12.9 contentHash ignores object key order and changes with content/media/replyTo/selfReply', async () => {
  const { contentHash } = await import('../lifecycle.js');
  const base = {
    content: 'Hello.',
    selfReply: { text: 'Reply', mediaUrl: 'https://e.com/a.png' },
    mediaUrl: 'https://e.com/v.mp4',
    mediaVariants: { x: { url: 'u1', type: 'video/mp4' }, ig: { url: 'u2', type: 'video/mp4' } },
    replyTo: { url: 'https://x.com/a/status/1', author: 'a' },
  };
  const reordered = {
    replyTo: { author: 'a', url: 'https://x.com/a/status/1' },
    mediaVariants: { ig: { type: 'video/mp4', url: 'u2' }, x: { type: 'video/mp4', url: 'u1' } },
    mediaUrl: 'https://e.com/v.mp4',
    selfReply: { mediaUrl: 'https://e.com/a.png', text: 'Reply' },
    content: 'Hello.',
  };
  assert.equal(contentHash(base), contentHash(reordered));
  const h = contentHash(base);
  assert.notEqual(contentHash({ ...base, content: 'Hello!' }), h);
  assert.notEqual(contentHash({ ...base, mediaUrl: 'https://e.com/other.mp4' }), h);
  assert.notEqual(contentHash({ ...base, replyTo: { ...base.replyTo, author: 'b' } }), h);
  assert.notEqual(contentHash({ ...base, selfReply: { ...base.selfReply, text: 'Reply 2' } }), h);
  assert.notEqual(contentHash({ ...base, mediaVariants: { ...base.mediaVariants, ig: { url: 'u3', type: 'video/mp4' } } }), h);
  assert.notEqual(contentHash({ ...base, selfReply: null }), h);
});

test('12.10 a stale planOverride is cleared on a later reschedule without override, and the plan is enforced again', async () => {
  const day = safeDay();
  await scheduled('c1', 'Anchor.', ctIso(day, 10));
  const b = await approved('c1', 'Overridden then moved.');
  const o = await svc.updateSocialPost('c1', b.id, { scheduledAt: ctIso(day, 10, 30) }, { planOverride: { by: 'owner-uid', reason: 'tie-in' } });
  assert.ok(o.planOverride);
  const moved = await svc.updateSocialPost('c1', b.id, { scheduledAt: ctIso(day, 16) });
  assert.equal(moved.status, 'scheduled');
  assert.equal(moved.planOverride, null);
  assert.equal(raw(b.id).planOverride, null);
  // plan enforced again for this row
  await assert.rejects(svc.updateSocialPost('c1', b.id, { scheduledAt: ctIso(day, 10, 20) }), { code: 'plan-spacing' });
  assert.equal(raw(b.id).scheduledAt, ctIso(day, 16));
});

// BUG (production): reserveInTx/findPackageCollision only treat PENDING_STATUSES (awaiting_approval/scheduled/queued/posting)
// as live holders. A retryable `failed` row (still re-claimed by the next sweep) is not in that list, so its active
// reservation is judged stale and a second copy of the same package schedules fine => a double post of one package.
// Repro: pilot v2 row {status:'scheduled', scheduledAt: past, packageId}, reservation active, 429 sweep => failed+retryable;
// then updateSocialPost(otherCopy, {scheduledAt}) resolves instead of rejecting package-already-pending.
test('12.1b retryable-failed row still blocks another copy of its package (fixed: failed+retryable counts as pending)', async () => {
  await mkPkg('pkg-429b');
  tweetImpl = async () => { throw Object.assign(new Error('rate'), { code: 429 }); };
  const p = await v2('c1', 'Rate limited.', { status: 'scheduled', scheduledAt: PAST(1), packageId: 'pkg-429b' });
  await seedHeld('c1', raw(p.id), 'pkg-429b');
  await svc.processDuePosts('c1');
  assert.equal(raw(p.id).status, 'failed');
  const other = await approved('c1', 'Second copy.', { packageId: 'pkg-429b' });
  await assert.rejects(svc.updateSocialPost('c1', other.id, { scheduledAt: ctIso(safeDay(), 10) }), { code: 'package-already-pending' });
});
