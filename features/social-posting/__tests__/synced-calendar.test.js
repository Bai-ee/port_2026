import test from 'node:test';
import assert from 'node:assert/strict';

import {
  mergeSyncedCalendars, toSyncedRow, isSyncedId, shownEntries, bodyTargetsSyncedRow, SYNCED_ID_PREFIX,
} from '../synced-calendar.js';
import { copyingEntries } from '../calendar-sync.js';

const day = (date, posts = [], extra = {}) => ({ date, inMonth: true, counts: { pending: posts.length }, flags: [], posts, tasks: [], ...extra });
const cal = (days, extra = {}) => ({ month: '2026-11', weeks: [days], totals: { pending: 1 }, reviewQueue: ['own1'], ...extra });
const post = (id, iso, extra = {}) => ({ kind: 'post', id, state: 'pending', approval: 'unapproved', scheduledAt: null, proposedAt: iso, title: id, ...extra });

test('shownEntries vs copyingEntries: draft (show only) is shown, schedule is copied, never both', () => {
  const list = [{ clientId: 'disc', mode: 'draft' }, { clientId: 'ue', mode: 'schedule' }, { clientId: 'x' }];
  assert.deepEqual(shownEntries(list).map((e) => e.clientId), ['disc', 'x']);
  assert.deepEqual(copyingEntries(list).map((e) => e.clientId), ['ue']);
  assert.deepEqual(shownEntries(null), []);
  assert.deepEqual(copyingEntries(undefined), []);
});

test('toSyncedRow: re-keyed, read-only, tagged with the source', () => {
  const r = toSyncedRow(post('p1', '2026-11-20T15:00:00.000Z'), { clientId: 'disc', name: 'Discogs' });
  assert.equal(r.id, 'synced:disc:p1');
  assert.equal(r.readOnly, true);
  assert.deepEqual(r.synced, { clientId: 'disc', name: 'Discogs', postId: 'p1' });
  assert.ok(isSyncedId(r.id));
  assert.equal(isSyncedId('p1'), false);
  assert.equal(isSyncedId(null), false);
});

test('merge: every source post row lands on its own day, sorted by time with the viewer\'s rows; others skipped', () => {
  const viewer = cal([
    day('2026-11-20', [post('own1', '2026-11-20T16:00:00.000Z')]),
    day('2026-11-21'),
  ]);
  const source = cal([
    day('2026-11-20', [
      post('d1', '2026-11-20T14:00:00.000Z'),
      { kind: 'suggestion', id: 'suggestion:s1', state: 'suggested' },
      { kind: 'requote', id: 'requote:q1', state: 'suggested' },
    ]),
    day('2026-11-21', [post('posted1', null, { state: 'posted', postedAt: '2026-11-21T12:00:00.000Z', scheduledAt: '2026-11-21T12:00:00.000Z' })]),
    day('2026-11-22', [post('outside', '2026-11-22T12:00:00.000Z')]),
  ]);
  const out = mergeSyncedCalendars(viewer, [{ clientId: 'disc', name: 'Discogs', calendar: source }]);
  const [d20, d21] = out.weeks[0];
  assert.deepEqual(d20.posts.map((r) => r.id), ['synced:disc:d1', 'own1']);
  assert.equal(d20.syncedCount, 1);
  assert.deepEqual(d21.posts.map((r) => r.id), ['synced:disc:posted1']);
  assert.deepEqual(out.synced, [{ clientId: 'disc', name: 'Discogs', rows: 3 }]);
  // The viewer's own numbers are untouched.
  assert.deepEqual(out.totals, viewer.totals);
  assert.deepEqual(out.reviewQueue, ['own1']);
  assert.deepEqual(d20.counts, { pending: 1 });
});

test('merge: input not mutated; a failed source is reported, not thrown; no sources = same calendar', () => {
  const viewer = cal([day('2026-11-20', [post('own1', '2026-11-20T16:00:00.000Z')])]);
  const before = JSON.stringify(viewer);
  const out = mergeSyncedCalendars(viewer, [{ clientId: 'ue', error: 'boom' }]);
  assert.equal(JSON.stringify(viewer), before);
  assert.deepEqual(out.synced, [{ clientId: 'ue', name: 'ue', error: 'boom' }]);
  assert.deepEqual(out.weeks[0][0].posts.map((r) => r.id), ['own1']);
  assert.equal(mergeSyncedCalendars(null, []), null);
});

test('merge: two sources on the same day stay distinct even with the same post id', () => {
  const viewer = cal([day('2026-11-20')]);
  const a = cal([day('2026-11-20', [post('same', '2026-11-20T10:00:00.000Z')])]);
  const b = cal([day('2026-11-20', [post('same', '2026-11-20T09:00:00.000Z')])]);
  const out = mergeSyncedCalendars(viewer, [{ clientId: 'a', calendar: a }, { clientId: 'b', calendar: b }]);
  assert.deepEqual(out.weeks[0][0].posts.map((r) => r.id), [`${SYNCED_ID_PREFIX}b:same`, `${SYNCED_ID_PREFIX}a:same`]);
});

test('bodyTargetsSyncedRow: any id field naming a synced row is refused', () => {
  assert.equal(bodyTargetsSyncedRow({ postId: 'synced:disc:p1' }), true);
  assert.equal(bodyTargetsSyncedRow({ id: 'synced:disc:p1' }), true);
  assert.equal(bodyTargetsSyncedRow({ postId: 'p1' }), false);
  assert.equal(bodyTargetsSyncedRow(null), false);
});

import { parseSyncedId, adoptedKeys, adoptPayload, adoptKey } from '../synced-calendar.js';

test('parseSyncedId: client + post id (post ids may contain colons); junk -> null', () => {
  assert.deepEqual(parseSyncedId('synced:bai-ees-discogs-TP37NQG0:abc'), { clientId: 'bai-ees-discogs-TP37NQG0', postId: 'abc' });
  assert.deepEqual(parseSyncedId('synced:ue:a:b'), { clientId: 'ue', postId: 'a:b' });
  for (const bad of ['abc', 'synced:', 'synced:ue', 'synced:ue:', null]) assert.equal(parseSyncedId(bad), null);
});

test('adoptPayload: the viewer\'s own draft copy (copy, creative, future time, X on); never the source id', () => {
  const future = new Date(Date.now() + 86_400_000).toISOString();
  const src = { id: 'p1', clientId: 'ue', status: 'awaiting_approval', content: 'BAI-EE\nMix\n#mixtapesfromchicago', mediaUrl: 'https://v/1.mp4', mediaType: 'video', scheduledAt: future };
  const out = adoptPayload(src, 'ue');
  assert.deepEqual(out.adoptedFrom, { clientId: 'ue', postId: 'p1' });
  assert.equal(out.idempotencyKey, 'synced-adopt:ue:p1');
  assert.deepEqual(out.targets, { x: true, instagram: false });
  assert.equal(out.plannedAt, future);
  assert.equal(out.mediaUrl, 'https://v/1.mp4');
  assert.equal(out.status, undefined); // ensureDraftPost makes it a draft
  assert.equal(adoptPayload({ ...src, scheduledAt: '2020-01-01T00:00:00Z' }, 'ue').plannedAt, undefined); // past time: not carried
});

test('mergeSyncedCalendars hides source posts the viewer already adopted (its copy shows instead)', () => {
  const src = { weeks: [[{ date: '2026-11-17', posts: [{ id: 'p1', kind: 'post', content: 'x' }, { id: 'p2', kind: 'post', content: 'y' }] }]] };
  const own = { weeks: [[{ date: '2026-11-17', posts: [] }]] };
  const adopted = adoptedKeys([{ id: 'mine', adoptedFrom: { clientId: 'ue', postId: 'p1' } }, { id: 'other' }]);
  assert.equal(adopted.has(adoptKey('ue', 'p1')), true);
  const out = mergeSyncedCalendars(own, [{ clientId: 'ue', name: 'UE', calendar: src }], adopted);
  assert.deepEqual(out.weeks[0][0].posts.map((r) => r.id), ['synced:ue:p2']);
});
