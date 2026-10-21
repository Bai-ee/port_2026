import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bookmarkFromBird, upsertBookmarks, listBookmarks, setDecision, selectBookmarkPicks, buildBookmarkPicksPayload,
  effectiveRespond, writeBookmarkPicks, PICKS_MAX,
} from '../store.js';

const NOW = Date.parse('2026-10-21T12:00:00Z');
const hoursAgo = (h) => new Date(NOW - h * 3_600_000).toISOString();

/** Minimal in-memory Firestore: collection/doc/collection/doc, get, set (merge / mergeFields). */
function fakeDb() {
  const store = new Map();
  const ref = (path) => ({
    get: async () => ({ exists: store.has(path), data: () => store.get(path) }),
    set: async (v, opt) => {
      if (opt?.mergeFields) { store.set(path, { ...(store.get(path) || {}), ...v }); return; }
      store.set(path, opt?.merge ? { ...(store.get(path) || {}), ...v } : v);
    },
    collection: (n) => col(`${path}/${n}`),
  });
  const col = (path) => ({
    doc: (id) => ref(`${path}/${id}`),
    get: async () => ({ docs: [...store.entries()].filter(([k]) => k.startsWith(`${path}/`) && !k.slice(path.length + 1).includes('/')).map(([, v]) => ({ data: () => v })) }),
  });
  return { collection: (n) => col(n), store };
}

const tweet = (id, over = {}) => ({
  id, text: 't', createdAt: 'Tue Oct 20 16:08:24 +0000 2026', replyCount: 1, retweetCount: 2, likeCount: 3,
  conversationId: id, author: { username: 'diip3sh', name: 'diip3sh' }, media: [{ type: 'video' }], ...over,
});

test('bookmarkFromBird: maps bird shape, derives url/media/thread, rejects unusable rows', () => {
  const r = bookmarkFromBird(tweet('2112576679218696242'), NOW);
  assert.equal(r.url, 'https://x.com/diip3sh/status/2112576679218696242');
  assert.equal(r.media, 'video');
  assert.equal(r.likes, 3);
  assert.equal(r.isThread, false);
  assert.equal(r.createdAt, '2026-10-20T16:08:24.000Z');
  assert.equal(bookmarkFromBird(tweet('5', { media: undefined }), NOW).media, 'none');
  assert.equal(bookmarkFromBird(tweet('5', { media: [{ type: 'photo' }] }), NOW).media, 'image');
  assert.equal(bookmarkFromBird(tweet('5', { conversationId: '4' }), NOW).isThread, true);
  assert.equal(bookmarkFromBird({ id: 'x' }, NOW), null);
});

test('upsertBookmarks never overwrites judge, decision or firstSeenAt; counts new rows', async () => {
  const db = fakeDb();
  const row = bookmarkFromBird(tweet('10'), NOW);
  assert.deepEqual(await upsertBookmarks(db, 'c1', [row], NOW), { total: 1, newCount: 1, newIds: ['10'] });
  const path = 'x_bookmarks/c1/items/10';
  db.store.set(path, { ...db.store.get(path), judge: { fit: 0.9, respond: 'quote' }, decision: { kind: 'quoted' } });
  const later = NOW + 3_600_000;
  const r2 = await upsertBookmarks(db, 'c1', [{ ...row, likes: 99 }, bookmarkFromBird(tweet('11'), later)], later);
  assert.equal(r2.newCount, 1);
  const kept = db.store.get(path);
  assert.equal(kept.likes, 99);
  assert.equal(kept.judge.fit, 0.9);
  assert.equal(kept.decision.kind, 'quoted');
  assert.equal(kept.firstSeenAt, new Date(NOW).toISOString());
  assert.equal(kept.lastSeenAt, new Date(later).toISOString());
});

test('listBookmarks filters and sorts; setDecision records and 404s on unknown', async () => {
  const db = fakeDb();
  await upsertBookmarks(db, 'c1', [
    bookmarkFromBird(tweet('1', { createdAt: 'Mon Oct 19 10:00:00 +0000 2026' }), NOW),
    bookmarkFromBird(tweet('2', { createdAt: 'Tue Oct 20 10:00:00 +0000 2026' }), NOW),
  ], NOW);
  assert.deepEqual((await listBookmarks(db, 'c1')).map((x) => x.id), ['2', '1']);
  const d = await setDecision(db, 'c1', '2', { kind: 'dismissed', now: NOW });
  assert.equal(d.kind, 'dismissed');
  assert.deepEqual((await listBookmarks(db, 'c1', { onlyOpen: true })).map((x) => x.id), ['1']);
  assert.deepEqual((await listBookmarks(db, 'c1', { onlyUnjudged: true, limit: 1 })).length, 1);
  await assert.rejects(() => setDecision(db, 'c1', '999', { kind: 'quoted' }), /not found/);
  await assert.rejects(() => setDecision(db, 'c1', '1', { kind: 'bogus' }), /decision kind/);
});

test('picks: open + judged + quote|reply|swipe only, fit desc, capped; old quote is shown as swipe', () => {
  const mk = (id, respond, fit, over = {}) => ({ id, url: `u${id}`, author: 'a', text: 'x'.repeat(400), media: 'image', likes: 1, createdAt: hoursAgo(2), judge: { respond, fit, lane: 'design', angle: 'craft', how: 'h', why: 'w' }, ...over });
  const items = [
    mk('a', 'reply', 0.7), mk('b', 'skip', 0.99), mk('c', 'quote', 0.9), mk('d', 'swipe', 0.8, { decision: { kind: 'dismissed' } }),
    mk('e', 'quote', 0.85, { createdAt: hoursAgo(100) }), { id: 'f', createdAt: hoursAgo(1), judge: null },
  ];
  const picks = selectBookmarkPicks(items, NOW);
  assert.deepEqual(picks.map((p) => p.id), ['c', 'e', 'a']);
  assert.equal(picks.find((p) => p.id === 'e').respond, 'swipe');
  assert.equal(picks[0].text.length, 280);
  assert.equal(effectiveRespond(items[4], NOW), 'swipe');
  const many = Array.from({ length: 20 }, (_, i) => mk(`m${i}`, 'reply', 0.5 + i / 100));
  assert.equal(selectBookmarkPicks(many, NOW).length, PICKS_MAX);
});

test('payload shape + writeBookmarkPicks target', async () => {
  const db = fakeDb();
  const p = buildBookmarkPicksPayload({ items: [], now: NOW, newThisRun: 3, judged: 2, costUsd: 0.0012345678, notes: ['n'] });
  assert.deepEqual(Object.keys(p).sort(), ['costUsd', 'judged', 'newThisRun', 'notes', 'picks', 'scannedAt', 'total']);
  assert.equal(p.costUsd, 0.00123);
  await writeBookmarkPicks(db, 'c1', p);
  assert.equal(db.store.get('dashboard_state/c1').marketingBrief.bookmarkPicks.newThisRun, 3);
});
