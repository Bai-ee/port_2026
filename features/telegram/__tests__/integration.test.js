// End-to-end: real bot + store + scheduler + shared post lifecycle (twitter-service) over the fake Firestore and the
// fake Telegram transport. Proves web and Telegram act on the same social_posts rows. X is a mock publisher.
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

const { __setXAdapterDepsForTest } = await import('../../social-posting/adapters/x.js');
const svc = await import('../../social-posting/twitter-service.js');
const store = await import('../store.js');
const { createFakeTransport } = await import('../transport.js');
const { createTelegramRuntime } = await import('../runtime.js');

let ctx;
let tweets;
let tweetImpl;
let restoreDeps;
let originalDbDescriptor;
const savedEnv = {};
const ENV_KEYS = ['PILOT_CLIENT_IDS', 'PILOT_OWNER_UIDS'];

const raw = (id) => ctx.adminDb._raw('social_posts', id);
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
  process.env.PILOT_CLIENT_IDS = 'c2';
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


const TG = 111;
let tx;
let rt;
let upd = 1;
const env = () => ({ ...process.env, TELEGRAM_BOT_TOKEN: 'test-token', TELEGRAM_BOT_USERNAME: 'hitloop_test_bot' });
const send = (message) => rt.bot.handleUpdate({ update_id: upd++, message: { message_id: upd, chat: { id: TG, type: 'private' }, from: { id: TG, username: 'owner' }, ...message } });
const tap = (data) => rt.bot.handleUpdate({ update_id: upd++, callback_query: { id: `cq${upd}`, from: { id: TG }, data, message: { message_id: 1, chat: { id: TG } } } });
const buttons = () => tx.calls.flatMap((c) => (c.args?.[2]?.replyMarkup?.inline_keyboard || []).flat());
const button = (re) => [...buttons()].reverse().find((b) => re.test(b.text));
const texts = () => tx.calls.filter((c) => c.method === 'sendMessage').map((c) => c.args[1]);

async function link() {
  tx = createFakeTransport();
  Object.defineProperty(fb, 'adminStorage', { configurable: true, get: () => ({ bucket: () => ({ file: () => ({ save: async () => {} }) }) }) });
  rt = createTelegramRuntime({ env: env(), db: ctx.adminDb, transport: tx });
  const { code } = await store.createLinkChallenge(ctx.adminDb, { uid: 'owner-uid', clientId: 'c2' });
  await send({ text: `/start ${code}` });
  await store.confirmLink(ctx.adminDb, { uid: 'owner-uid', clientId: 'c2' });
  await store.saveSettings(ctx.adminDb, 'c2', { quietHours: { enabled: false }, briefingEnabled: false, leadMinutes: 30, timezone: 'America/Chicago' });
}
const scheduledSoon = async (content, mins = 20) => {
  const p = await svc.createSocialPost('c2', { content, lifecycleVersion: 2 });
  await svc.approveDraft('c2', p.id);
  return svc.updateSocialPost('c2', p.id, { scheduledAt: new Date(Date.now() + mins * MIN).toISOString() });
};

test('E1. linking: /start alone does not bind; only the web confirm does; strangers get linking help only', async () => {
  tx = createFakeTransport();
  rt = createTelegramRuntime({ env: env(), db: ctx.adminDb, transport: tx });
  const { code } = await store.createLinkChallenge(ctx.adminDb, { uid: 'owner-uid', clientId: 'c2' });
  await send({ text: `/start ${code}` });
  assert.equal(await store.getBinding(ctx.adminDb, TG), null, 'not bound before web confirmation');
  await send({ text: "What's happening?" });
  assert.ok(!texts().some((t) => /Market insights|Brief/i.test(t)), 'no data before linking');
  await store.confirmLink(ctx.adminDb, { uid: 'owner-uid', clientId: 'c2' });
  assert.equal((await store.getBinding(ctx.adminDb, TG)).status, 'active');
});

test('E2. due handoff card → Post myself claims BEFORE copy is sent → sweeper never publishes → I\'ve posted it records self-report', async () => {
  await link();
  const post = await scheduledSoon('Studio day: new mix coming Friday.');
  const r1 = await rt.dispatch({ now: Date.now() });
  assert.ok(r1.handoffs >= 1, 'handoff queued');
  assert.ok(r1.outbox >= 1, 'handoff delivered');
  const take = button(/Post myself/);
  assert.ok(take, 'Post myself button on the card');
  await tap(take.callback_data);
  assert.equal(raw(post.id).status, 'manual');
  const copyMsg = tx.calls.find((c) => c.method === 'sendMessage' && c.args[1] === 'Studio day: new mix coming Friday.');
  assert.ok(copyMsg, 'exact copy sent as its own message');
  assert.ok(!copyMsg.args[2]?.parseMode, 'copy has no parse mode, so it is byte-exact');
  // The slot comes due: the shared sweeper must not publish a manual row.
  ctx.adminDb._patch('social_posts', post.id, { scheduledAt: PAST(0.1) });
  await svc.processDuePosts('c2');
  assert.equal(tweets.length, 0);
  const done = button(/posted it/i);
  await tap(done.callback_data);
  await send({ text: 'https://x.com/bai_ee/status/1845000000000000009' });
  const row = raw(post.id);
  assert.equal(row.status, 'posted');
  assert.equal(row.deliveryMode, 'manual');
  assert.equal(row.deliveryVerified, false);
  assert.equal(row.twitterId, null);
  assert.equal(row.reportedPlatformId, '1845000000000000009');
  assert.ok(texts().some((t) => /self-reported/i.test(t)));
  // Re-dispatch: no duplicate card for the same post/revision.
  const r2 = await rt.dispatch({ now: Date.now() });
  assert.equal(r2.handoffs, 0);
});

test('E3. web edit after the card went out: old Approve button is out of date and applies nothing', async () => {
  await link();
  const p = await svc.createSocialPost('c2', { content: 'Draft for review.', lifecycleVersion: 2, scheduledAt: null });
  await rt.bot.sendCard(await store.getBinding(ctx.adminDb, TG), raw(p.id), { headline: 'Review' });
  const approve = button(/Approve & post now/);
  assert.ok(approve, 'unapproved draft offers explicit post-now');
  await svc.updateSocialPost('c2', p.id, { content: 'Draft for review, edited on the web.' });
  const before = raw(p.id).revision;
  await tap(approve.callback_data);
  assert.equal(raw(p.id).status, 'draft');
  assert.equal(raw(p.id).revision, before, 'no write from a stale card');
  assert.equal(tweets.length, 0);
  // Duplicate tap of a fresh card: one publish.
  await rt.bot.sendCard(await store.getBinding(ctx.adminDb, TG), raw(p.id), { headline: 'Review' });
  const fresh = button(/Approve & post now/);
  await Promise.all([tap(fresh.callback_data), tap(fresh.callback_data)]);
  assert.equal(tweets.length, 1);
  assert.equal(raw(p.id).status, 'posted');
});

test('E4. revoked binding: buttons and reads stop working immediately', async () => {
  await link();
  const p = await svc.createSocialPost('c2', { content: 'Revocation test.', lifecycleVersion: 2 });
  await rt.bot.sendCard(await store.getBinding(ctx.adminDb, TG), raw(p.id), { headline: 'Review' });
  const take = button(/Post myself/);
  await store.revokeBinding(ctx.adminDb, { clientId: 'c2', uid: 'owner-uid' });
  await tap(take.callback_data);
  assert.equal(raw(p.id).status, 'draft');
});

test('E5. non-pilot owner (allowlist changed) loses access even with an active binding', async () => {
  await link();
  process.env.PILOT_OWNER_UIDS = 'someone-else';
  rt = createTelegramRuntime({ env: env(), db: ctx.adminDb, transport: tx });
  const p = await svc.createSocialPost('c2', { content: 'Allowlist test.', lifecycleVersion: 2 });
  const r = await rt.dispatch({ now: Date.now() });
  assert.equal(r.handoffs, 0);
  await send({ text: "Today's posts" });
  assert.equal(raw(p.id).status, 'draft');
});

test('E6. cards only offer actions the shared services accept (no refusal loops)', async () => {
  await link();
  const { buildHandoffBundle } = await import('../handoff.js');
  const ids = (post) => buildHandoffBundle({ post, tz: 'America/Chicago', now: Date.now(), targetAt: Date.now() + HOUR }).actions.map((a) => a.action);
  assert.deepEqual(ids({ id: 'a', status: 'awaiting_approval', content: 'x', lifecycleVersion: 2 }), ['post-myself']);
  assert.deepEqual(ids({ id: 'b', status: 'failed', content: 'x', errorClass: 'rate-limited' }), ['post-myself']);
  assert.deepEqual(ids({ id: 'c', status: 'failed', content: 'x', errorClass: 'network-ambiguous' }), []);
  assert.ok(!ids({ id: 'd', status: 'scheduled', content: 'x' }).includes('revise'), 'legacy scheduled rows: no in-chat revise');
  // A refused action reports the reason instead of looping on "out of date".
  const p = await svc.createSocialPost('c2', { content: 'Awaiting via email.', lifecycleVersion: 2, status: 'awaiting_approval' });
  ctx.adminDb._patch('social_posts', p.id, { status: 'awaiting_approval' });
  await rt.bot.sendCard(await store.getBinding(ctx.adminDb, TG), raw(p.id), { headline: 'Review' });
  await tap(button(/Post myself/).callback_data);
  assert.equal(raw(p.id).status, 'manual');
  const amb = await svc.createSocialPost('c2', { content: 'Ambiguous.', lifecycleVersion: 2 });
  ctx.adminDb._patch('social_posts', amb.id, { status: 'failed', errorClass: 'network-ambiguous', retryable: false });
  await assert.rejects(svc.claimManualDelivery('c2', amb.id, {}), { code: 'needs-review-reconcile' });
});
