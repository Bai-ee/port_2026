// Pilot lifecycle through schedulePost (calendar / Strategy-Builder push / daily-digest entry): pilot clients get
// lifecycle-v2 rows (reviewed + approvedHash) with plan enforcement; non-pilot clients stay legacy.
// Harness copied from pilot-concurrency.test.js. c1 = pilot client, c2 = non-pilot. X is a mock publisher only.
import assert from 'node:assert/strict';
import test, { beforeEach, afterEach } from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const fb = require('../../../api/_lib/firebase-admin.cjs');
const { makeFakeContext } = require('../../../api/_lib/__tests__/fake-firestore.cjs');

const { __setXAdapterDepsForTest } = await import('../adapters/x.js');
const svc = await import('../twitter-service.js');
const { upsertPackage } = await import('../../x-content-inventory/store.js');
const { contentHash } = await import('../lifecycle.js');
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
const mkPkg = (id) => upsertPackage(PKG(id), { returnPackages: false, clientId: 'fixture-pkg-client' });
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


const posts = (clientId) => [...(ctx.adminDb._store.get('social_posts')?.values() || [])].filter((p) => p.clientId === clientId);
const ledgerDocs = () => [...(ctx.adminDb._store.get('x_schedule_ledger')?.keys() || [])];
const resDocs = () => [...(ctx.adminDb._store.get('x_package_reservations')?.keys() || [])];

test('a. pilot schedulePost => v2 row: reviewed, approvedHash===contentHash(row), scheduled, package reservation + ledger slot; non-pilot stays legacy', async () => {
  await mkPkg('pkg-a');
  const day = safeDay();
  const iso = ctIso(day, 9);
  const row = await svc.schedulePost('c1', { content: 'Pilot scheduled copy.', scheduledAt: iso, packageId: 'pkg-a' });
  const stored = raw(row.id);
  assert.equal(stored.lifecycleVersion, 2);
  assert.equal(stored.status, 'scheduled');
  assert.ok(stored.reviewedAt);
  assert.equal(stored.reviewedBy, 'owner-schedule');
  assert.ok(stored.approvedHash);
  assert.equal(stored.approvedHash, contentHash(stored));
  assert.ok(pkgRes('c1', 'pkg-a'), 'package reservation exists');
  assert.equal(slotCount('c1', day), 1, 'ledger slot taken');

  const legacy = await svc.schedulePost('c2', { content: 'Legacy scheduled copy.', scheduledAt: iso });
  const l = raw(legacy.id);
  assert.equal(l.status, 'scheduled');
  assert.equal(l.lifecycleVersion, undefined);
  assert.ok(!l.approvedHash);
  assert.ok(!ledgerDocs().some((k) => k.startsWith('c2__')), 'no ledger doc for a non-pilot client');
  assert.ok(!resDocs().some((k) => k.startsWith('c2__')));
});

test('a2. opts.by is recorded as reviewedBy on the pilot row', async () => {
  const row = await svc.schedulePost('c1', { content: 'Who approved.', scheduledAt: ctIso(safeDay(), 9) }, { by: 'owner-uid' });
  assert.equal(raw(row.id).reviewedBy, 'owner-uid');
  assert.equal(raw(row.id).approvedHash, contentHash(raw(row.id)));
});

test('b. pilot: schedulePost with replyTo is refused (reply-threading-unsupported), nothing written; non-pilot is allowed (legacy parity)', async () => {
  const replyTo = { url: 'https://x.com/someone/status/1', author: 'someone', text: 'original' };
  const day = safeDay();
  await assert.rejects(
    svc.schedulePost('c1', { content: 'A reply.', scheduledAt: ctIso(day, 9), replyTo }),
    (e) => e.code === 'reply-threading-unsupported' && e.status === 409,
  );
  assert.equal(posts('c1').length, 0);
  assert.equal(slotCount('c1', day), 0);
  const ok = await svc.schedulePost('c2', { content: 'A legacy reply.', scheduledAt: ctIso(day, 9), replyTo });
  assert.equal(raw(ok.id).status, 'scheduled');
  assert.equal(raw(ok.id).lifecycleVersion, undefined);
});

test('c. Strategy-Builder-like batch at +30/+150/+160/+400 min: 1,2 ok; 3 plan-spacing; 4 ok; failed item leaves no row/reservation/slot', async () => {
  const day = safeDay();
  const base = Date.parse(ctIso(day, 9));
  const at = (m) => new Date(base + m * MIN).toISOString();
  for (const id of ['pkg-1', 'pkg-2', 'pkg-3', 'pkg-4']) await mkPkg(id);
  const plan = [[30, 'pkg-1'], [150, 'pkg-2'], [160, 'pkg-3'], [400, 'pkg-4']];
  const results = [];
  for (const [m, pkg] of plan) {
    results.push(await svc.schedulePost('c1', { content: `Batch item for ${pkg}.`, scheduledAt: at(m), packageId: pkg, source: 'strategy-builder' }).then((v) => ({ ok: true, v }), (e) => ({ ok: false, e })));
  }
  assert.deepEqual(results.map((r) => r.ok), [true, true, false, true]);
  assert.equal(results[2].e.code, 'plan-spacing');
  assert.equal(results[2].e.status, 409);
  for (const i of [0, 1, 3]) {
    const r = raw(results[i].v.id);
    assert.equal(r.lifecycleVersion, 2);
    assert.equal(r.approvedHash, contentHash(r));
  }
  assert.equal(posts('c1').length, 3, 'no row for the refused item');
  assert.ok(!posts('c1').some((p) => p.packageId === 'pkg-3'));
  assert.equal(pkgRes('c1', 'pkg-3'), undefined, 'no reservation for the refused item');
  assert.ok(pkgRes('c1', 'pkg-1') && pkgRes('c1', 'pkg-2') && pkgRes('c1', 'pkg-4'));
  assert.equal(slotCount('c1', day), 3, 'exactly the three accepted slots');
  // the refused package is still free to schedule elsewhere
  const retry = await svc.schedulePost('c1', { content: 'Batch item for pkg-3.', scheduledAt: at(600), packageId: 'pkg-3' }).catch((e) => e);
  assert.ok(retry.id, `retry after the failure succeeds: ${retry.code || ''}`);
});

test('d. daily-digest-like schedulePost twice ~35 min out: first is v2, second is refused plan-spacing', async () => {
  const t1 = Date.now() + 35 * MIN;
  const a = await svc.schedulePost('c1', { content: 'Digest suggested post one.', scheduledAt: new Date(t1).toISOString(), source: 'daily-digest:2026-10-12:suggested-post' });
  assert.equal(raw(a.id).lifecycleVersion, 2);
  assert.equal(raw(a.id).status, 'scheduled');
  await assert.rejects(
    svc.schedulePost('c1', { content: 'Digest suggested post two, different.', scheduledAt: new Date(t1 + 5 * MIN).toISOString(), source: 'daily-digest:2026-10-12:suggested-post' }),
    (e) => e.code === 'plan-spacing',
  );
  assert.equal(posts('c1').length, 1);
});

test('e. editing a pilot-scheduled post voids approval + schedule and frees the slot; re-approve+schedule re-binds approvedHash', async () => {
  const day = safeDay();
  const iso = ctIso(day, 9);
  const row = await svc.schedulePost('c1', { content: 'Original wording.', scheduledAt: iso });
  const firstHash = raw(row.id).approvedHash;
  assert.equal(slotCount('c1', day), 1);

  const edited = await svc.updateSocialPost('c1', row.id, { content: 'Edited wording.' });
  assert.equal(edited.status, 'draft');
  assert.equal(edited.scheduledAt, null);
  assert.equal(edited.reviewedAt, null);
  assert.ok(!edited.reviewedAt && edited.status === 'draft');
  assert.equal(slotCount('c1', day), 0, 'slot freed');

  const again = await svc.approveAndSchedule('c1', row.id, { scheduledAt: iso });
  const r = raw(again.id);
  assert.equal(r.status, 'scheduled');
  assert.equal(r.content, 'Edited wording.');
  assert.ok(r.approvedHash);
  assert.notEqual(r.approvedHash, firstHash, 'hash re-bound to the new wording');
  assert.equal(r.approvedHash, contentHash(r));
  assert.equal(slotCount('c1', day), 1);
});

test('f. tampering with a pilot-scheduled row (no void) then making it due: parked needs_review/approval-stale, nothing published', async () => {
  const row = await svc.schedulePost('c1', { content: 'Approved wording.', scheduledAt: new Date(Date.now() + 5 * HOUR).toISOString() });
  assert.ok(raw(row.id).approvedHash);
  ctx.adminDb._patch('social_posts', row.id, { content: 'Tampered wording.', scheduledAt: PAST(1) });
  await svc.processDuePosts('c1');
  assert.equal(tweets.length, 0);
  assert.equal(raw(row.id).status, 'needs_review');
  assert.equal(raw(row.id).errorClass, 'approval-stale');
  await svc.processDuePosts('c1');
  assert.equal(tweets.length, 0, 'a second sweep still publishes nothing');
});

test('f2. control: an untampered pilot-scheduled row that becomes due IS published once', async () => {
  const row = await svc.schedulePost('c1', { content: 'Untouched wording.', scheduledAt: new Date(Date.now() + 5 * HOUR).toISOString() });
  ctx.adminDb._patch('social_posts', row.id, { scheduledAt: PAST(1) });
  await svc.processDuePosts('c1');
  assert.equal(tweets.length, 1);
  assert.equal(raw(row.id).status, 'posted');
});

test('e2. edit that voids a scheduled pilot post clears approvedHash like attachMediaToPost does', async () => {
  const row = await svc.schedulePost('c1', { content: 'Original wording.', scheduledAt: ctIso(safeDay(), 9) });
  const edited = await svc.updateSocialPost('c1', row.id, { content: 'Edited wording.' });
  assert.ok(!edited.approvedHash);
});
