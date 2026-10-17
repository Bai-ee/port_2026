import test from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../store.js';
import { runDispatch } from '../scheduler.js';
import { enqueueCreativeFollowup, resolveCreativeMedia, hasPlaceholder, creativeFilename } from '../creative.js';
import { attachStagedHires, useHiresMedia } from '../../x-content-inventory/hires-media.js';
import { makeHarness, makePost, T0, MIN } from './helpers/fakes.js';

const IMG = { url: 'https://cdn/orig.jpg', path: 'publish-staging/nas/a/orig.jpg', type: 'image', size: 2_000_000 };
const THUMB = { url: 'https://cdn/thumb.jpg', path: 'publish-staging/t.jpg', type: 'image' };

function fakeCreative(over = {}) {
  const calls = { useHires: [], findHires: 0 };
  return {
    calls,
    findHires: async () => { calls.findHires += 1; return { ok: true, target: { isThumbnail: false }, candidates: [] }; },
    candidateMedia: async () => IMG,
    currentMedia: async () => THUMB,
    useHires: async (a) => { calls.useHires.push(a); return { status: 'staging', workerOnline: true }; },
    ...over,
  };
}
const hiresFound = (staged) => ({ ok: true, target: { isThumbnail: true }, bestId: 'cand1', candidates: [{ id: 'cand1', title: 'Big original', staged }] });

async function setup({ post = {}, creative = fakeCreative() } = {}) {
  const h = await makeHarness();
  h.services.add(makePost({ packageId: 'pkg1', mediaUrl: 'https://cdn/thumb.jpg', mediaStoragePath: 'publish-staging/t.jpg', ...post }));
  h.services.creative = creative;
  h.calendarRows.push({ id: 'p1', status: 'draft', scheduledAt: new Date(T0 + 20 * MIN).toISOString(), revision: 1, content: 'Exact copy' });
  return h;
}
const texts = (h) => h.sent().map((c) => c.args[1]);

test('every post card carries a "Copy + high-res" button bound to a read-only ticket', async () => {
  const h = await setup();
  await h.card('p1');
  const b = h.button(/Copy \+ high-res/);
  assert.ok(b);
  const tk = await h.store.claimTicket(h.db, b.ticket, { telegramUserId: 111, now: T0 });
  assert.equal(tk.ticket.action, 'creative');
  assert.equal(tk.ticket.postId, 'p1');
  assert.equal(tk.ticket.bindingVersion, h.bindings[111].bindingVersion);
});

test('button sends exact copy as plain messages, then the original as a document with URL; nothing is written', async () => {
  const h = await setup({ post: { selfReply: { text: 'Source: example.com' } }, creative: fakeCreative({ findHires: async () => hiresFound(true) }) });
  await h.card('p1');
  await h.pressLabel(/Copy \+ high-res/);
  const msgs = h.sent();
  const copy = msgs.find((c) => c.args[1] === makePost().content);
  assert.ok(copy);
  assert.equal(copy.args[2].parseMode, undefined);
  assert.ok(msgs.some((c) => c.args[1] === 'Source: example.com' && c.args[2].parseMode === undefined));
  const docs = h.sent('sendDocument');
  assert.equal(docs.length, 1);
  assert.equal(docs[0].args[1], IMG.url);
  assert.match(docs[0].args[2].caption, /^2026-10-14-exact-copy-line-one-quotes-b\.jpg$|^\d{4}-\d{2}-\d{2}-.*\.jpg$/);
  assert.deepEqual(h.writeCalls(), []);
});

test('a placeholder is sent as-is after a separate short note', async () => {
  const h = await setup({ post: { content: 'I made this [add your memory]' } });
  await h.card('p1');
  await h.pressLabel(/Copy \+ high-res/);
  const t = texts(h);
  const i = t.indexOf('Placeholder still in the text');
  assert.ok(i >= 0);
  assert.equal(t[i + 1], 'I made this [add your memory]');
  assert.equal(hasPlaceholder('x [add your take] y'), true);
});

test('a post with only a current picture sends that as a document', async () => {
  const h = await setup({ post: { packageId: null } });
  await h.card('p1');
  await h.pressLabel(/Copy \+ high-res/);
  assert.equal(h.sent('sendDocument')[0].args[1], THUMB.url);
});

test('oversize file and failed document send fall back to a link', async () => {
  const big = fakeCreative({ currentMedia: async () => ({ ...THUMB, size: 30 * 1048576 }) });
  const h = await setup({ post: { packageId: null }, creative: big });
  await h.card('p1');
  await h.pressLabel(/Copy \+ high-res/);
  assert.equal(h.sent('sendDocument').length, 0);
  assert.match(texts(h).at(-1), /Too large for Telegram.*https:\/\/cdn\/thumb\.jpg/);
  const h2 = await setup({ post: { packageId: null } });
  h2.transport.failNext('sendDocument', new Error('boom'));
  await h2.card('p1');
  await h2.pressLabel(/Copy \+ high-res/);
  assert.match(texts(h2).at(-1), /Download .*https:\/\/cdn\/thumb\.jpg/);
});

test('no media: says so and mentions a library suggestion if the finder has one', async () => {
  const h = await setup({ post: { mediaUrl: null, mediaStoragePath: null, packageId: null } });
  await h.card('p1');
  await h.pressLabel(/Copy \+ high-res/);
  assert.equal(texts(h).at(-1), 'No creative on this post.');
  assert.equal(h.sent('sendDocument').length, 0);
  const r = await resolveCreativeMedia(fakeCreative({ findHires: async () => hiresFound(false), useHires: async () => { throw new Error('nope'); } }), { id: 'p1', packageId: 'k', clientId: 'c1' });
  assert.equal(r.state, 'none');
  assert.equal(r.suggestion, 'Big original');
});

test('unstaged original: queues staging with the waiting chat, replies once; COMPLETE enqueues a follow-up that sends the document', async () => {
  const creative = fakeCreative({ findHires: async () => hiresFound(false) });
  const h = await setup({ creative });
  await h.card('p1');
  await h.pressLabel(/Copy \+ high-res/);
  assert.equal(creative.calls.useHires.length, 1);
  assert.deepEqual(creative.calls.useHires[0].notify, { telegramUserId: '111', chatId: '111', bindingVersion: h.bindings[111].bindingVersion });
  assert.match(texts(h).at(-1), /Copying the original from the drive \(usually under a minute\)\. I'll send it when it's ready\./);
  assert.equal(h.sent('sendDocument').length, 0);

  // The worker reports COMPLETE: attachStagedHires runs the hook with the stored entry.
  const waiting = { postId: 'p1', targetId: 'pkg1', clientId: 'c1', at: 'T', notify: creative.calls.useHires[0].notify };
  const cand = { id: 'cand1', assetRefs: ['publish-staging/nas/a/orig.jpg'], hiresPending: [waiting] };
  let pkgs = { cand1: cand, pkg1: { id: 'pkg1', assetRefs: [] } };
  await attachStagedHires({
    getPackage: async (id) => pkgs[id], upsertPackage: async (p) => { pkgs[p.id] = p; },
    getPost: async () => ({ id: 'p1', clientId: 'c1', status: 'draft' }), pickMedia: async () => ({ mediaUrl: IMG.url }),
    applyPostMedia: async () => true, now: () => T0,
    onAttached: (w, o) => enqueueCreativeFollowup({ db: h.db, store: S, now: T0 }, w, o),
  }, { candidateId: 'cand1' });
  const box = [...(h.db._store.get('telegram_outbox')?.values() || [])];
  assert.equal(box.length, 1);
  assert.equal(box[0].payload.kind, 'creative');
  h.services.creative.findHires = async () => hiresFound(true);
  h.calendarRows.length = 0; // no handoff noise: only the creative follow-up is queued
  await runDispatch(h.ctx, { now: T0 });
  assert.equal([...(h.db._store.get('telegram_outbox')?.values() || [])].find((x) => x.kind === 'creative').status, 'sent');
  const docs = h.sent('sendDocument');
  assert.equal(docs.length, 1);
  assert.equal(docs[0].args[1], IMG.url);
  assert.equal(texts(h).filter((t) => t === makePost().content).length, 1); // follow-up: document only, no second copy message
  assert.equal(creative.calls.useHires.length, 1); // never re-queues staging
});

test('follow-up after the binding was revoked (or re-linked) sends nothing', async () => {
  for (const mode of ['revoke']) {
    const h = await setup({ creative: fakeCreative({ findHires: async () => hiresFound(true) }) });
    const b = await h.binding();
    await enqueueCreativeFollowup({ db: h.db, store: S, now: T0 }, { postId: 'p1', clientId: 'c1', at: 'x', notify: { telegramUserId: 111, chatId: 111, bindingVersion: b.bindingVersion } }, { candidateId: 'cand1' });
    if (mode === 'revoke') await S.revokeBinding(h.db, { clientId: 'c1', uid: 'u1', now: T0 });
    else {
      await S.revokeBinding(h.db, { clientId: 'c1', uid: 'u1', now: T0 });
      const { code } = await S.createLinkChallenge(h.db, { uid: 'u1', clientId: 'c1', now: T0 });
      await S.attachTelegramToChallenge(h.db, { code, telegramUserId: 111, chatId: 111, telegramUsername: 'u', firstName: 'T', now: T0 });
      await S.confirmLink(h.db, { uid: 'u1', clientId: 'c1', now: T0 });
    }
    await runDispatch(h.ctx, { now: T0 });
    assert.equal(h.sent('sendDocument').length, 0, mode);
    assert.equal(h.sent().length, 0, mode);
  }
});

test('a revoked binding cannot use an old Copy + high-res button', async () => {
  const h = await setup();
  await h.card('p1');
  const b = h.button(/Copy \+ high-res/);
  const before = h.sent().length;
  await S.revokeBinding(h.db, { clientId: 'c1', uid: 'u1', now: T0 });
  await h.press(b.ticket);
  assert.match(h.answers().at(-1), /Not linked/);
  assert.equal(h.sent().length, before);
  assert.equal(h.sent('sendDocument').length, 0);
});

test('/creative and "creative" list today\'s posts with the button; a date lists that day; typing never approves or posts', async () => {
  const h = await setup();
  await h.msg('/creative');
  assert.ok(h.button(/Copy \+ high-res/));
  await h.msg('creative');
  h.readModels.loadDay = async (clientId, date) => (date === '2026-10-15' ? { date, posts: [{ id: 'p1', status: 'draft', scheduledAt: new Date(T0 + 24 * 3600000).toISOString(), content: 'Tomorrow post' }] } : null);
  await h.msg('/creative 2026-10-15');
  assert.match(h.button(/Copy \+ high-res/).text, /Tomorrow post/);
  await h.msg('/creative 2026-10-20');
  assert.match(texts(h).at(-1), /No posts to show for 2026-10-20/);
  assert.deepEqual(h.writeCalls(), []);
  assert.equal(h.sent('sendDocument').length, 0);
});

test('useHiresMedia stores the notify marker on the waiting entry', async () => {
  const C = 'c1';
  const PH = '10217141824798684';
  const target = { id: 'pkg1', clientId: C, title: 'East Room', rights: 'owned', mediaState: 'still', assetRefs: [],
    nas: { sourceId: 's1', sha256: 'a'.repeat(64), relativePath: `Facebook Downloads/fb/photos_and_videos/thumbnails/41027512_${PH}_5428795802665353216_n.jpg`, width: 720, height: 720 } };
  const cand = { id: 'cand1', clientId: C, title: 'East Room', rights: 'owned', mediaState: 'still', assetRefs: [],
    nas: { sourceId: 's1', sha256: 'b'.repeat(64), relativePath: `Facebook Downloads/fb/photos_and_videos/photos/41027512_${PH}_5428795802665353216_o_1.jpg`, width: 2048, height: 2048 } };
  const saved = {};
  const deps = {
    getPost: async () => ({ id: 'p1', status: 'draft', packageId: 'pkg1', clientId: C }),
    getPackage: async (id) => saved[id] || ({ pkg1: target, cand1: cand })[id],
    readPackages: async () => [target, cand], nasStage: async () => ({ commandId: 'cmd1' }), now: () => T0,
    upsertPackage: async (p) => { saved[p.id] = p; },
  };
  const r = await useHiresMedia(deps, { clientId: C, postId: 'p1', candidateId: 'cand1', notify: { telegramUserId: 111, chatId: 222, bindingVersion: 3 } });
  assert.equal(r.status, 'staging');
  assert.deepEqual(saved.cand1.hiresPending[0].notify, { telegramUserId: '111', chatId: '222', bindingVersion: 3 });
  assert.equal(creativeFilename({ content: 'Hi there' }, { path: 'a/b.mp4', type: 'video' }, { dateKey: '2026-10-14' }), '2026-10-14-hi-there.mp4');
});
