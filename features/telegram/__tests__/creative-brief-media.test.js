import test from 'node:test';
import assert from 'node:assert/strict';
import { runDispatch } from '../scheduler.js';
import { sendCreativeBriefPart, planCreativeBriefMedia, resolveCreativeBriefTarget, CBM_KIND } from '../creative-brief-media.js';
import { makeHarness, makePost, T0 } from './helpers/fakes.js';

const frames = [{ label: 'Open', url: 'https://img/1.png', note: 'wide' }, { label: 'Hit', url: 'https://img/2.png' }];
const cqPost = (over = {}) => makePost({
  id: 'cq1', clientId: 'cq', reviewOn: '2026-11-22', status: 'draft',
  videoBriefMeta: { briefVersion: 2, v2: { title: 'Keeps moving' }, storyboard: { status: 'ready', updatedAt: 'S1', frames } },
  mediaUrl: 'https://firebasestorage.googleapis.com/v0/b/b/o/ep-v02.mp4?alt=media&token=t', mediaType: 'video', mediaStoragePath: 'clients/cq/ep-v02.mp4', mediaMetadata: { outlineHash: 'oh' },
  ...over,
});
async function setup(post = cqPost()) {
  const h = await makeHarness(); // binding: client c1, uid u1, chat 111
  h.services.add(post);
  const deps = { db: h.db, store: h.store, transport: h.transport, readPost: h.services.getSocialPost, now: () => h.clock.t };
  const send = (part, over = {}) => sendCreativeBriefPart(deps, { clientId: 'cq', post, part, requesterUid: 'u1', requesterIsAdmin: true, ...over });
  return { h, deps, send, post };
}

test('target: own client binding first; else only the requesting ADMIN\'s own binding', async () => {
  const { h } = await setup();
  assert.equal((await resolveCreativeBriefTarget({ store: h.store, db: h.db, clientId: 'c1' })).fallback, false);
  assert.equal((await resolveCreativeBriefTarget({ store: h.store, db: h.db, clientId: 'cq', requesterUid: 'u1', requesterIsAdmin: true })).fallback, true);
  assert.equal(await resolveCreativeBriefTarget({ store: h.store, db: h.db, clientId: 'cq', requesterUid: 'u1', requesterIsAdmin: false }), null, 'non-admin: no fallback');
  assert.equal(await resolveCreativeBriefTarget({ store: h.store, db: h.db, clientId: 'cq', requesterUid: 'someone-else', requesterIsAdmin: true }), null, 'other uid binding ignored');
});

test('frames go as ONE album with captions; a repeat is already-sent', async () => {
  const { h, send } = await setup();
  const r = await send('frames');
  assert.equal(r.status, 'sent');
  const album = h.sent('sendMediaGroup');
  assert.equal(album.length, 1);
  assert.equal(album[0].args[1].length, 2);
  assert.match(album[0].args[1][0].caption, /Storyboard: Keeps moving · 2026-11-22[\s\S]*Frame 1 · Open — wide/);
  assert.equal((await send('frames')).status, 'already-sent');
  assert.equal(h.sent('sendMediaGroup').length, 1);
});

test('video: sendVideo by the post URL; bad-request falls back to a link; timeout stays queued (no fallback)', async () => {
  const a = await setup();
  assert.equal((await a.send('video')).status, 'sent');
  assert.equal(a.h.sent('sendVideo')[0].args[1], cqPost().mediaUrl);

  const b = await setup();
  b.h.transport.failNext('sendVideo', Object.assign(new Error('too big'), { code: 'bad-request' }));
  assert.equal((await b.send('video')).status, 'sent');
  assert.match(b.h.sent().at(-1).args[1], /Download: https:\/\/firebasestorage/);

  const c = await setup();
  c.h.transport.failNext('sendVideo', Object.assign(new Error('slow'), { code: 'timeout', retryable: true }));
  assert.equal((await c.send('video')).status, 'queued');
  assert.equal(c.h.sent().length, 0, 'no link fallback on an ambiguous timeout');
});

test('the drain re-sends a queued item once, and only while the version still matches', async () => {
  const { h, send, post } = await setup();
  h.transport.failNext('sendMediaGroup', Object.assign(new Error('down'), { code: 'server', retryable: true }));
  assert.equal((await send('frames')).status, 'queued');
  h.clock.t = T0 + 10 * 60_000;
  await runDispatch(h.ctx, { now: h.clock.t });
  assert.equal(h.sent('sendMediaGroup').length, 1);
  // A changed storyboard supersedes instead of sending the old one.
  const { h: h2, send: send2 } = await setup();
  h2.transport.failNext('sendMediaGroup', Object.assign(new Error('down'), { code: 'server', retryable: true }));
  await send2('frames');
  h2.services.posts.get('cq1').videoBriefMeta.storyboard.updatedAt = 'S2';
  h2.clock.t = T0 + 10 * 60_000;
  await runDispatch(h2.ctx, { now: h2.clock.t });
  assert.equal(h2.sent('sendMediaGroup').length, 0);
  void post;
});

test('claim race: an item the cron already holds is not sent again by the route', async () => {
  const { h, deps, post } = await setup();
  const realClaim = h.store.claimOutboxItem;
  const store = { ...h.store, claimOutboxItem: async () => null };
  const r = await sendCreativeBriefPart({ ...deps, store }, { clientId: 'cq', post, part: 'frames', requesterUid: 'u1', requesterIsAdmin: true });
  assert.equal(r.status, 'queued');
  assert.equal(h.sent('sendMediaGroup').length, 0);
  void realClaim;
});

test('pause is honoured for the automatic video send', async () => {
  const { h, send } = await setup();
  await h.store.saveSettings(h.db, 'c1', { notificationsPaused: true }, { now: T0 });
  assert.equal((await send('video', { honorPause: true })).status, 'paused');
  assert.equal((await send('video')).status, 'sent', 'an explicit request ignores pause');
});

test('plan: terminal posts and missing media are skipped', () => {
  const p = { kind: CBM_KIND, part: 'video', expect: { outlineHash: 'oh', storagePath: 'clients/cq/ep-v02.mp4' } };
  assert.equal(planCreativeBriefMedia(cqPost({ status: 'posted' }), p).reason, 'post-posted');
  assert.equal(planCreativeBriefMedia(cqPost({ mediaUrl: null }), p).reason, 'video-changed');
  assert.equal(planCreativeBriefMedia(null, p).reason, 'post-gone');
});

test('the drain fails an unknown outbox kind instead of marking it sent', async () => {
  const { h } = await setup();
  const b = await h.store.getActiveBindingForClient(h.db, 'c1');
  const { id } = await h.store.enqueueMessage(h.db, { clientId: 'c1', chatId: b.chatId, dedupKey: 'weird', kind: 'weird', payload: { kind: 'weird' }, now: T0 });
  await runDispatch(h.ctx, { now: T0 });
  const doc = h.db._raw('telegram_outbox', id);
  assert.equal(doc.status, 'failed');
});
