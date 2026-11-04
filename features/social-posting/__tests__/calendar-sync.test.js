// Calendar sync: pure planner rules + the real social-posting service on a fake Firestore (viewer 'home' mirrors the
// source client 'disc'). Nothing here reaches X or Instagram: mirrors are only ever scheduled, never published.
import assert from 'node:assert/strict';
import test, { beforeEach, afterEach } from 'node:test';
import { createRequire } from 'node:module';
import {
  normalizeCalendarSyncs, desiredMirrors, planCalendarSync, runCalendarSync, mirrorKey, isMirror, instagramUsable, SOURCE,
} from '../calendar-sync.js';

const require = createRequire(import.meta.url);
const fb = require('../../../api/_lib/firebase-admin.cjs');
const { makeFakeContext } = require('../../../api/_lib/__tests__/fake-firestore.cjs');
const svc = await import('../twitter-service.js');

const NOW = Date.parse('2026-11-04T15:00:00.000Z');
const IMG = { mediaUrl: 'https://cdn.example/a.jpg', mediaType: 'image', mediaContentType: 'image/jpeg' };
const IG_ACCOUNT = { accessToken: 't', userId: '1', username: 'hitloop', expiresAt: Date.now() + 86_400_000 };
const entry = (over = {}) => ({ clientId: 'disc', x: 'copy', instagram: 'off', offsetMinutes: 0, ...over });
const srcPost = (over = {}) => ({ id: 'p1', clientId: 'disc', status: 'scheduled', scheduledAt: '2026-11-04T18:00:00.000Z', content: 'Hello', ...over });

// ── config ──────────────────────────────────────────────────────────────────
test('normalizeCalendarSyncs: defaults, caps, dedupes, drops self and all-off rows', () => {
  const out = normalizeCalendarSyncs([
    { clientId: 'disc' },
    { clientId: 'disc', x: 'repost' },
    { clientId: 'home' },
    { clientId: 'ugex', x: 'off', instagram: 'off' },
    { clientId: 'ugex', x: 'repost', instagram: 'copy', offsetMinutes: 99999 },
    'bad',
  ], 'home');
  assert.deepEqual(out, [
    { clientId: 'disc', x: 'copy', instagram: 'off', offsetMinutes: 0 },
    { clientId: 'ugex', x: 'repost', instagram: 'copy', offsetMinutes: 7 * 24 * 60 },
  ]);
  assert.deepEqual(normalizeCalendarSyncs(null), []);
});

// ── desiredMirrors ──────────────────────────────────────────────────────────
test('copy mode: one row per scheduled source post, same text + media, offset applied, never before now+2min', () => {
  const [m] = desiredMirrors(srcPost({ ...IMG, packageId: 'pkg-1', engine: 'record' }), entry({ offsetMinutes: 30 }), { viewer: 'home', nowMs: NOW });
  assert.equal(m.key, mirrorKey('disc', 'p1', 'x'));
  assert.equal(m.payload.scheduledAt, '2026-11-04T18:30:00.000Z');
  assert.equal(m.payload.content, 'Hello');
  assert.equal(m.payload.mediaUrl, IMG.mediaUrl);
  assert.equal(m.payload.packageId, 'pkg-1');
  assert.deepEqual(m.payload.targets, { x: true, instagram: false });
  assert.equal(m.payload.source, SOURCE);
  assert.equal(m.payload.mirrorOf.postId, 'p1');
  // A source slot already in the past is pushed to the lead floor, not dropped.
  const [late] = desiredMirrors(srcPost({ scheduledAt: '2026-11-04T14:00:00.000Z' }), entry(), { viewer: 'home', nowMs: NOW });
  assert.equal(late.payload.scheduledAt, '2026-11-04T15:02:00.000Z');
});

test('copy mode: Instagram rides on the same row only with media and a usable account', () => {
  const both = desiredMirrors(srcPost(IMG), entry({ instagram: 'copy' }), { viewer: 'home', nowMs: NOW, igAllowed: true });
  assert.equal(both.length, 1);
  assert.deepEqual(both[0].payload.targets, { x: true, instagram: true });
  const noMedia = desiredMirrors(srcPost(), entry({ instagram: 'copy' }), { viewer: 'home', nowMs: NOW, igAllowed: true });
  assert.deepEqual(noMedia[0].payload.targets, { x: true, instagram: false });
  const noAccount = desiredMirrors(srcPost(IMG), entry({ instagram: 'copy' }), { viewer: 'home', nowMs: NOW, igAllowed: false });
  assert.deepEqual(noAccount[0].payload.targets, { x: true, instagram: false });
  // The hash changes with the Instagram leg, so flipping Instagram on re-creates the mirror.
  assert.notEqual(both[0].hash, noAccount[0].hash);
});

test('repost mode: only a posted source tweet within 48h; Instagram becomes its own row', () => {
  const posted = srcPost({ ...IMG, status: 'posted', twitterId: '555', postedAt: '2026-11-04T14:00:00.000Z' });
  const rows = desiredMirrors(posted, entry({ x: 'repost', instagram: 'copy', offsetMinutes: 15 }), { viewer: 'home', nowMs: NOW, igAllowed: true });
  assert.equal(rows.length, 1); // posted source: repost only (its schedule is gone)
  assert.equal(rows[0].payload.kind, 'repost');
  assert.deepEqual(rows[0].payload.repostOf, { tweetId: '555' });
  assert.equal(rows[0].payload.scheduledAt, '2026-11-04T15:02:00.000Z');
  const scheduled = desiredMirrors(srcPost(IMG), entry({ x: 'repost', instagram: 'copy' }), { viewer: 'home', nowMs: NOW, igAllowed: true });
  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0].key, mirrorKey('disc', 'p1', 'ig'));
  assert.deepEqual(scheduled[0].payload.targets, { x: false, instagram: true });
  const old = desiredMirrors(srcPost({ status: 'posted', twitterId: '1', postedAt: '2026-11-01T00:00:00.000Z' }), entry({ x: 'repost' }), { viewer: 'home', nowMs: NOW });
  assert.deepEqual(old, []);
});

test('never mirrors a mirror, a reply, a manual row, a repost (copy mode) or an unscheduled source', () => {
  const ctx = { viewer: 'home', nowMs: NOW };
  assert.deepEqual(desiredMirrors(srcPost({ mirrorOf: { clientId: 'ugex', postId: 'z', key: 'k', hash: 'h' } }), entry(), ctx), []);
  assert.deepEqual(desiredMirrors(srcPost({ replyTo: { url: 'https://x.com/a/status/1' } }), entry(), ctx), []);
  assert.deepEqual(desiredMirrors(srcPost({ status: 'manual' }), entry(), ctx), []);
  assert.deepEqual(desiredMirrors(srcPost({ kind: 'repost', repostOf: { tweetId: '9' } }), entry(), ctx), []);
  assert.deepEqual(desiredMirrors(srcPost({ status: 'approved', scheduledAt: null }), entry(), ctx), []);
});

// ── planCalendarSync ────────────────────────────────────────────────────────
const mirrorRow = (want, over = {}) => ({ id: `m-${want.hash}`, clientId: 'home', status: 'scheduled', mirrorOf: want.payload.mirrorOf, ...over });

test('plan: creates missing mirrors, keeps matching ones, replaces a stale copy, retires orphans', () => {
  const e = entry();
  const [wantA] = desiredMirrors(srcPost({ id: 'a' }), e, { viewer: 'home', nowMs: NOW });
  const [wantB] = desiredMirrors(srcPost({ id: 'b', content: 'B v2' }), e, { viewer: 'home', nowMs: NOW });
  const [wantBOld] = desiredMirrors(srcPost({ id: 'b', content: 'B v1' }), e, { viewer: 'home', nowMs: NOW });
  const orphan = { id: 'm-orphan', clientId: 'home', status: 'scheduled', mirrorOf: { clientId: 'disc', postId: 'gone', key: mirrorKey('disc', 'gone', 'x'), hash: 'x' } };
  const plan = planCalendarSync({
    entry: e, viewer: 'home', nowMs: NOW,
    sourcePosts: [srcPost({ id: 'a' }), srcPost({ id: 'b', content: 'B v2' }), srcPost({ id: 'c', status: 'rejected' })],
    viewerPosts: [mirrorRow(wantA), mirrorRow(wantBOld), orphan, { id: 'own', clientId: 'home', status: 'scheduled' }],
  });
  assert.deepEqual(plan.create.map((c) => c.key), [wantB.key]);
  assert.deepEqual(plan.keep.map((k) => k.id), [mirrorRow(wantA).id]);
  assert.deepEqual(plan.retire.map((r) => r.id).sort(), [mirrorRow(wantBOld).id, 'm-orphan'].sort());
  assert.deepEqual(plan.skipped, []);
});

test('plan: an owner-declined mirror stays gone; a sync-retired one does not block; a posted mirror is never replaced', () => {
  const e = entry();
  const [want] = desiredMirrors(srcPost(), e, { viewer: 'home', nowMs: NOW });
  const declined = planCalendarSync({ entry: e, viewer: 'home', nowMs: NOW, sourcePosts: [srcPost()], viewerPosts: [mirrorRow(want, { status: 'rejected', reviewedBy: 'owner@x' })] });
  assert.equal(declined.create.length, 0);
  assert.deepEqual(declined.skipped, [{ postId: 'p1', reason: 'declined' }]);
  const unscheduledByOwner = planCalendarSync({ entry: e, viewer: 'home', nowMs: NOW, sourcePosts: [srcPost()], viewerPosts: [mirrorRow(want, { status: 'approved' })] });
  assert.equal(unscheduledByOwner.create.length, 0);
  const retiredBySync = planCalendarSync({ entry: e, viewer: 'home', nowMs: NOW, sourcePosts: [srcPost()], viewerPosts: [mirrorRow(want, { status: 'rejected', reviewedBy: SOURCE })] });
  assert.equal(retiredBySync.create.length, 1);
  const [edited] = desiredMirrors(srcPost({ content: 'edited' }), e, { viewer: 'home', nowMs: NOW });
  const live = planCalendarSync({ entry: e, viewer: 'home', nowMs: NOW, sourcePosts: [srcPost({ content: 'edited' })], viewerPosts: [mirrorRow(want, { status: 'posted' })] });
  assert.equal(live.create.length, 0);
  assert.equal(live.retire.length, 0);
  assert.deepEqual(live.skipped, [{ postId: 'p1', reason: 'already-live' }]);
  assert.notEqual(edited.hash, want.hash);
});

test('instagramUsable: connected and unexpired only', () => {
  assert.equal(instagramUsable(IG_ACCOUNT), true);
  assert.equal(instagramUsable(null), false);
  assert.equal(instagramUsable({ ...IG_ACCOUNT, expiresAt: Date.now() - 1 }), false);
  assert.equal(isMirror({ mirrorOf: { postId: 'p' } }), true);
  assert.equal(isMirror({}), false);
});

// ── through the real service ────────────────────────────────────────────────
let ctx;
let originalDb;
const ENV_KEYS = ['PILOT_CLIENT_IDS', 'PILOT_OWNER_UIDS'];
let savedEnv;
beforeEach(() => {
  originalDb = Object.getOwnPropertyDescriptor(fb, 'adminDb');
  ctx = makeFakeContext();
  Object.defineProperty(fb, 'adminDb', { configurable: true, get: () => ctx.adminDb });
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  process.env.PILOT_CLIENT_IDS = 'home,disc';
});
afterEach(() => {
  Object.defineProperty(fb, 'adminDb', originalDb);
  for (const k of ENV_KEYS) { if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k]; }
});

const inOneHour = () => new Date(Date.now() + 3_600_000).toISOString();
const deps = () => ({ svc, getInstagramAccount: async () => IG_ACCOUNT });
const homeQueue = async () => (await svc.readSocialQueue('home')).filter(isMirror);

test('end to end: a scheduled source post lands as a scheduled mirror on the viewer; re-runs are idempotent', async () => {
  await ctx.adminDb.collection('client_configs').doc('home').set({ calendarSyncs: [{ clientId: 'disc', x: 'copy', instagram: 'copy' }] });
  const src = await svc.schedulePost('disc', { content: 'Record of the day', scheduledAt: inOneHour(), packageId: 'pkg-1', engine: 'record', ...IMG });
  const run = await runCalendarSync('home', deps());
  assert.deepEqual(run.entries.map((e) => [e.clientId, e.created, e.errors]), [['disc', 1, []]]);
  const [m] = await homeQueue();
  assert.equal(m.clientId, 'home');
  assert.equal(m.status, 'scheduled');
  assert.equal(m.content, 'Record of the day');
  assert.equal(m.mediaUrl, IMG.mediaUrl);
  assert.equal(m.packageId, 'pkg-1');
  assert.equal(m.source, SOURCE);
  assert.deepEqual(m.targets, { x: true, instagram: true });
  assert.equal(m.mirrorOf.postId, src.id);
  assert.equal(m.reviewedBy, SOURCE);
  assert.ok(m.scheduledAt >= src.scheduledAt);
  const again = await runCalendarSync('home', deps());
  assert.deepEqual(again.entries.map((e) => [e.created, e.kept, e.retired]), [[0, 1, 0]]);
  assert.equal((await homeQueue()).length, 1);
});

test('end to end: unscheduling the source retires the mirror; rescheduling it brings a fresh one; an owner reject sticks', async () => {
  await ctx.adminDb.collection('client_configs').doc('home').set({ calendarSyncs: [{ clientId: 'disc', x: 'copy' }] });
  const at = inOneHour();
  const src = await svc.schedulePost('disc', { content: 'One', scheduledAt: at });
  await runCalendarSync('home', deps());
  await svc.updateSocialPost('disc', src.id, { scheduledAt: null });
  const retired = await runCalendarSync('home', deps());
  assert.equal(retired.entries[0].retired, 1);
  const [m1] = await homeQueue();
  assert.equal(m1.status, 'rejected');
  assert.equal(m1.reviewedBy, SOURCE);
  // Same content + time again: the sync's own retirement is not an owner decision, so a new mirror is created.
  await svc.updateSocialPost('disc', src.id, { scheduledAt: at });
  const back = await runCalendarSync('home', deps());
  assert.equal(back.entries[0].created, 1);
  const open = (await homeQueue()).filter((p) => p.status === 'scheduled');
  assert.equal(open.length, 1);
  // The owner takes the mirror off the calendar: it stays off.
  await svc.updateSocialPost('home', open[0].id, { scheduledAt: null });
  const held = await runCalendarSync('home', deps());
  assert.equal(held.entries[0].created, 0);
  assert.deepEqual(held.entries[0].skipped, [{ postId: src.id, reason: 'declined' }]);
});

test('end to end: the viewer\'s own open copy of the package blocks the mirror (reported, not thrown)', async () => {
  await ctx.adminDb.collection('client_configs').doc('home').set({ calendarSyncs: [{ clientId: 'disc', x: 'copy' }] });
  await svc.schedulePost('home', { content: 'My own take', scheduledAt: inOneHour(), packageId: 'pkg-dup' });
  await svc.schedulePost('disc', { content: 'Their take', scheduledAt: new Date(Date.now() + 2 * 3_600_000).toISOString(), packageId: 'pkg-dup' });
  const run = await runCalendarSync('home', deps());
  assert.equal(run.entries[0].created, 0);
  assert.equal(run.entries[0].errors[0].code, 'package-already-pending');
  assert.equal((await homeQueue()).length, 0);
});

test('end to end: no config means nothing happens; a mirror is never re-mirrored by a third client', async () => {
  assert.deepEqual(await runCalendarSync('home', deps()), { viewer: 'home', entries: [] });
  await ctx.adminDb.collection('client_configs').doc('home').set({ calendarSyncs: [{ clientId: 'disc', x: 'copy' }] });
  await ctx.adminDb.collection('client_configs').doc('ugex').set({ calendarSyncs: [{ clientId: 'home', x: 'copy' }] });
  await svc.schedulePost('disc', { content: 'Chain?', scheduledAt: inOneHour() });
  await runCalendarSync('home', deps());
  process.env.PILOT_CLIENT_IDS = 'home,disc,ugex';
  const third = await runCalendarSync('ugex', deps());
  assert.equal(third.entries[0].created, 0);
  assert.deepEqual(third.entries[0].skipped, [{ postId: (await homeQueue())[0].id, reason: 'is-a-mirror' }]);
});
