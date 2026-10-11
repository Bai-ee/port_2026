// Manual delivery (Telegram "Post myself" / "I've posted it") and explicit post-now against the shared lifecycle.
// Same harness as pilot-concurrency.test.js (copied: that file keeps its helpers module-private).
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


const { buildMonthCalendar } = await import('../../x-content-inventory/month-calendar.js');
const { buildPostResults } = await import('../../x-content-inventory/results.js');
const FUT = (h = 30 * 24) => new Date(Date.now() + h * HOUR).toISOString();
const makeDue = (id) => ctx.adminDb._patch('social_posts', id, { scheduledAt: PAST(0.1), status: 'queued' });

test('M1. Post myself on a scheduled post: status manual, keeps its slot and package, and the sweeper never publishes it', async () => {
  await mkPkg('pkg-m1');
  const day = safeDay();
  const p = await scheduled('c1', 'Manual one.', ctIso(day, 10), { packageId: 'pkg-m1' });
  const claimed = await svc.claimManualDelivery('c1', p.id, { by: 'telegram:1:owner-uid', expectedRevision: p.revision });
  assert.equal(claimed.status, 'manual');
  assert.equal(claimed.deliveryMode, 'manual');
  assert.equal(claimed.scheduledAt, ctIso(day, 10), 'target time kept');
  assert.equal(slotCount('c1', day), 1, 'slot still held');
  assert.equal(pkgRes('c1', 'pkg-m1').postId, p.id);
  // A second copy of the package still can't be scheduled while the owner posts it.
  const other = await approved('c1', 'Same package.', { packageId: 'pkg-m1' });
  await assert.rejects(svc.updateSocialPost('c1', other.id, { scheduledAt: ctIso(day, 16) }), { code: 'package-already-pending' });
  // Time passes: the sweeper must not claim it.
  ctx.adminDb._patch('social_posts', p.id, { scheduledAt: PAST(0.1) });
  await svc.processDuePosts('c1');
  assert.equal(tweets.length, 0);
  assert.equal(raw(p.id).status, 'manual');
  // Repeated tap returns the same row.
  assert.equal((await svc.claimManualDelivery('c1', p.id, { by: 'x' })).status, 'manual');
});

test('M2. manual claim vs sweeper claim on a due post: never both, never neither', async () => {
  for (let i = 0; i < 6; i += 1) {
    const p = await scheduled('c2', `Race ${i}.`, FUT());
    makeDue(p.id);
    const before = tweets.length;
    const [m] = await Promise.allSettled([
      svc.claimManualDelivery('c2', p.id, { by: 'tg' }),
      svc.processDuePosts('c2'),
    ]);
    const published = tweets.length - before;
    const row = raw(p.id);
    if (m.status === 'fulfilled') {
      assert.equal(published, 0, 'manual won: X never called');
      assert.equal(row.status, 'manual');
    } else {
      assert.equal(m.reason.code, 'auto-delivery-started');
      assert.equal(published, 1);
      assert.equal(row.status, 'posted');
    }
  }
});

test('M3. takeover refused once automatic delivery has begun, after posting, and on held rows', async () => {
  const p = await scheduled('c2', 'Claimed by sweeper.', FUT());
  ctx.adminDb._patch('social_posts', p.id, { status: 'posting', claimedAt: new Date().toISOString() });
  await assert.rejects(svc.claimManualDelivery('c2', p.id, {}), { code: 'auto-delivery-started' });
  await assert.rejects(svc.recordManualPosted('c2', p.id, {}), { code: 'auto-delivery-started' });
  ctx.adminDb._patch('social_posts', p.id, { status: 'posted', twitterId: '1234567' });
  await assert.rejects(svc.claimManualDelivery('c2', p.id, {}), { code: 'already-posted' });
  ctx.adminDb._patch('social_posts', p.id, { status: 'needs_review' });
  await assert.rejects(svc.claimManualDelivery('c2', p.id, {}), { code: 'needs-review-reconcile' });
});

test("M4. I've posted it: self-reported, unverified, no faked twitterId; permalink validated; idempotent; package counted once", async () => {
  await mkPkg('pkg-m4');
  const p = await approved('c1', 'Posted by hand.', { packageId: 'pkg-m4' });
  await svc.claimManualDelivery('c1', p.id, { by: 'tg' });
  const done = await svc.recordManualPosted('c1', p.id, { by: 'telegram:1:owner-uid', permalink: 'https://twitter.com/bai_ee/status/1845000000000000001?s=20' });
  assert.equal(done.status, 'posted');
  assert.equal(done.deliveryMode, 'manual');
  assert.equal(done.deliveryVerified, false);
  assert.equal(done.twitterId, null);
  assert.equal(done.permalink, 'https://x.com/bai_ee/status/1845000000000000001');
  assert.equal(done.reportedPlatformId, '1845000000000000001');
  const again = await svc.recordManualPosted('c1', p.id, { by: 'tg' });
  assert.equal(again.revision, done.revision, 'repeat is a no-op');
  const pkg = ctx.adminDb._raw('x_content_packages', 'pkg-m4');
  assert.equal(pkg.postCount, (Number(PKG('pkg-m4').postCount) || 0) + 1);
  assert.equal(pkg.lastTwitterId ?? null, PKG('pkg-m4').lastTwitterId ?? null, 'never written as a verified tweet id');

  const q = await approved('c2', 'Bad link.');
  const bad = await svc.recordManualPosted('c2', q.id, { permalink: 'https://evil.example/status/123456' });
  assert.equal(bad.permalink, null);
  assert.equal(bad.reportedPlatformId, null);
});

test("M5. I've posted it straight from a scheduled post claims atomically: the sweeper can't publish it afterwards", async () => {
  const p = await scheduled('c2', 'Posted without claiming first.', FUT());
  await svc.recordManualPosted('c2', p.id, { by: 'tg' });
  makeDue(p.id);
  ctx.adminDb._patch('social_posts', p.id, { status: 'posted' });
  await svc.processDuePosts('c2');
  assert.equal(tweets.length, 0);
  assert.equal(raw(p.id).deliveryMode, 'manual');
});

test('M6. release hands it back: approved (hash intact), unscheduled, slot freed; then it can be re-scheduled', async () => {
  const day = safeDay();
  const p = await scheduled('c1', 'Release me.', ctIso(day, 11));
  await svc.claimManualDelivery('c1', p.id, {});
  const back = await svc.releaseManualClaim('c1', p.id, { by: 'tg' });
  assert.equal(back.status, 'approved');
  assert.equal(back.scheduledAt, null);
  assert.equal(slotCount('c1', day), 0);
  const re = await svc.approveAndSchedule('c1', p.id, { scheduledAt: ctIso(day, 13) });
  assert.equal(re.status, 'scheduled');
  await assert.rejects(svc.releaseManualClaim('c1', p.id, {}), { code: 'not-manual' });
});

test('M7. a manual row cannot be edited, and stale revisions are refused', async () => {
  const p = await approved('c2', 'Stale.');
  const cur = raw(p.id);
  await assert.rejects(svc.claimManualDelivery('c2', p.id, { expectedRevision: (cur.revision || 0) - 1 }), { code: 'revision-conflict' });
  await svc.claimManualDelivery('c2', p.id, { expectedRevision: cur.revision });
  await assert.rejects(svc.updateSocialPost('c2', p.id, { content: 'Changed.' }), { code: 'manual-claimed' });
});

test('M8. manual takeover of an already-held slot passes even if the plan got stricter since (not a new decision)', async () => {
  const day = safeDay();
  const a = await scheduled('c1', 'Slot A.', ctIso(day, 10));
  await scheduled('c1', 'Slot B.', ctIso(day, 13));
  await setPlan({ capPerDay: 1, targetPerDay: 1, minSpacingMin: 600 });
  const m = await svc.claimManualDelivery('c1', a.id, {});
  assert.equal(m.status, 'manual');
});

test('M9. Approve & post now: one publish, duplicate request returns the existing result', async () => {
  const p = await v2('c2', 'Post this now.');
  const r = await svc.approveAndPostNow('c2', p.id, { reviewedBy: 'telegram:1:owner-uid', expectedRevision: raw(p.id).revision });
  assert.equal(r.outcome, 'posted');
  assert.equal(raw(p.id).status, 'posted');
  assert.equal(raw(p.id).reviewedBy, 'telegram:1:owner-uid');
  const r2 = await svc.approveAndPostNow('c2', p.id, {});
  assert.equal(r2.outcome, 'already-posted');
  assert.equal(tweets.length, 1);
});

test('M10. Approve & post now twice concurrently publishes once', async () => {
  const p = await v2('c2', 'Double tap.');
  const rs = await Promise.allSettled([svc.approveAndPostNow('c2', p.id, {}), svc.approveAndPostNow('c2', p.id, {})]);
  assert.equal(tweets.length, 1);
  assert.ok(rs.some((r) => r.status === 'fulfilled' && r.value.outcome === 'posted'));
});

test('M11. Approve & post now refuses a v2 reply (unsupported threading) and a manual row; X never called', async () => {
  const reply = await v2('c2', 'A reply.', { replyTo: { url: 'https://x.com/a/status/123456789', id: '123456789' } });
  await assert.rejects(svc.approveAndPostNow('c2', reply.id, {}), (e) => e.status === 409);
  const m = await approved('c2', 'Manual.');
  await svc.claimManualDelivery('c2', m.id, {});
  await assert.rejects(svc.approveAndPostNow('c2', m.id, {}), { code: 'not-postable' });
  assert.equal(tweets.length, 0);
});

test('M12. calendar and results label manual and self-reported rows honestly', async () => {
  const a = await scheduled('c2', 'Cal manual.', FUT(48));
  await svc.claimManualDelivery('c2', a.id, {});
  const b = await approved('c2', 'Cal reported.');
  await svc.recordManualPosted('c2', b.id, {});
  const posts = [raw(a.id), raw(b.id)];
  const month = new Date(Date.now() + 48 * HOUR).toISOString().slice(0, 7);
  const cal = buildMonthCalendar({ posts, month, now: Date.now() });
  const rows = cal.weeks.flat().flatMap((d) => d.posts);
  assert.equal(rows.find((r) => r.id === a.id)?.state, 'manual');
  const res = buildPostResults({ posts, now: Date.now() });
  const flat = JSON.stringify(res);
  assert.ok(flat.includes('"selfReported":true'));
});
