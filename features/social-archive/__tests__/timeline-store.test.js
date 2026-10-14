import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDb } from './_fakedb.js';
import { sanitizeEntry } from '../schema.js';
import {
  upsertEntries, rebuildDays, getDay, listDays, searchEntries, saveArchive, listArchives, linkEntriesToPackages,
} from '../timeline-store.js';

const C = 'client1';
const mk = (platformId, ts, o = {}) => sanitizeEntry({
  platform: 'facebook', account: 'Housepit CHI', platformId, kind: 'post', ts, tsKind: 'posted',
  tsSource: 'facebook-posts-html', text: `post ${platformId} #house`, ...o,
}, { archiveName: 'fb1' }).entry;

test('upsertEntries writes, keeps existing linked, batches <= 400', async () => {
  const db = makeDb();
  const a = mk('1', '2010-05-01T10:00:00Z');
  assert.deepEqual(await upsertEntries(db, C, [a]), { written: 1 });
  db.cols.get('timeline_entries').get(`${C}__${a.id}`).linked = ['nas-1'];
  await upsertEntries(db, C, [a]);
  assert.deepEqual(db.cols.get('timeline_entries').get(`${C}__${a.id}`).linked, ['nas-1']);
  assert.equal(db.cols.get('timeline_entries').get(`${C}__${a.id}`).clientId, C);

  const many = Array.from({ length: 900 }, (_, i) => mk(`m${i}`, '2011-01-01T00:00:00Z'));
  const db2 = makeDb();
  await upsertEntries(db2, C, many);
  assert.equal(db2.cols.get('timeline_entries').size, 900);
  assert.ok(db2.batches.every((n) => n <= 400));
});

test('rebuildDays recomputes from entries; snippets/entryIds capped; idempotent', async () => {
  const db = makeDb();
  const es = [
    ...Array.from({ length: 8 }, (_, i) => mk(`p${i}`, `2010-05-01T1${i}:00:00Z`)),
    mk('v', '2010-05-01T20:00:00Z', { kind: 'reel', platform: 'instagram', account: 'x' }),
    mk('other', '2010-05-02T10:00:00Z'),
  ];
  await upsertEntries(db, C, es);
  assert.deepEqual(await rebuildDays(db, C, ['2010-05-01', '2010-05-02', 'nope'], { now: 1 }), { rebuilt: 2 });
  const d = db.cols.get('timeline_days').get(`${C}__2010-05-01`);
  assert.equal(d.total, 9); assert.equal(d.counts.post, 8); assert.equal(d.counts.reel, 1);
  assert.deepEqual(d.platforms, { facebook: 8, instagram: 1 });
  assert.equal(d.snippets.length, 5); assert.equal(d.entryIds.length, 9);
  const before = structuredClone(d);
  assert.deepEqual(await rebuildDays(db, C, ['2010-05-01'], { now: 999999 }), { rebuilt: 0 });
  assert.deepEqual(db.cols.get('timeline_days').get(`${C}__2010-05-01`), before);
});

test('getDay sorts by ts; other clients isolated', async () => {
  const db = makeDb();
  await upsertEntries(db, C, [mk('b', '2010-05-01T12:00:00Z'), mk('a', '2010-05-01T08:00:00Z')]);
  await upsertEntries(db, 'other', [mk('z', '2010-05-01T09:00:00Z')]);
  const d = await getDay(db, C, '2010-05-01');
  assert.equal(d.total, 2); assert.deepEqual(d.entries.map((e) => e.platformId), ['a', 'b']);
});

test('listDays: bounded span via doc gets, ascending, skips empty; open-ended uses clientId query', async () => {
  const db = makeDb();
  await upsertEntries(db, C, [mk('a', '2010-05-03T10:00:00Z'), mk('b', '2010-05-01T10:00:00Z')]);
  await rebuildDays(db, C, ['2010-05-01', '2010-05-03']);
  const r = await listDays(db, C, { from: '2010-04-30', to: '2010-05-05' });
  assert.deepEqual(r.map((x) => x.day), ['2010-05-01', '2010-05-03']);
  assert.deepEqual(Object.keys(r[0]).sort(), ['counts', 'day', 'platforms', 'snippets', 'total']);
  assert.deepEqual((await listDays(db, C, {})).map((x) => x.day), ['2010-05-01', '2010-05-03']);
  assert.equal((await listDays(db, C, { from: '2010-04-30', to: '2010-05-05', limit: 1 })).length, 1);
  assert.equal((await listDays(db, C, { from: '2010-01-01', to: '2999-01-01' })).length, 2); // span capped, no throw
});

test('searchEntries: substring over text/album/hashtags, filters, newest first', async () => {
  const db = makeDb();
  await upsertEntries(db, C, [
    mk('a', '2010-05-01T10:00:00Z', { text: 'Warehouse night' }),
    mk('b', '2012-05-01T10:00:00Z', { text: 'nothing', album: 'Warehouse Pics' }),
    mk('c', '2011-05-01T10:00:00Z', { text: 'x #warehouse', platform: 'x', account: 'bai' }),
    mk('d', '2011-06-01T10:00:00Z', { text: 'unrelated' }),
  ]);
  const r = await searchEntries(db, C, { q: 'WAREHOUSE' });
  assert.deepEqual(r.map((e) => e.platformId), ['b', 'c', 'a']);
  assert.deepEqual((await searchEntries(db, C, { q: 'warehouse', platform: 'facebook' })).map((e) => e.platformId), ['b', 'a']);
  assert.deepEqual((await searchEntries(db, C, { q: 'warehouse', from: '2011-01-01', to: '2011-12-31' })).map((e) => e.platformId), ['c']);
  assert.equal((await searchEntries(db, C, { limit: 2 })).length, 2);
});

test('saveArchive / listArchives use the contract doc id', async () => {
  const db = makeDb();
  await saveArchive(db, C, { platform: 'facebook', account: 'Housepit CHI', archiveName: 'FB 1', entries: 3, ingestedAt: '2026-01-01T00:00:00.000Z' });
  assert.ok(db.cols.get('social_archives').has(`${C}__facebook__housepit-chi__fb-1`));
  const l = await listArchives(db, C);
  assert.equal(l.length, 1); assert.equal(l[0].entries, 3);
  assert.deepEqual(await listArchives(db, 'nobody'), []);
});

test('linkEntriesToPackages merges post/postIds/dates/linked only; skips missing; idempotent', async () => {
  const db = makeDb();
  const a = mk('a', '2010-05-01T10:00:00Z', { text: 't'.repeat(500), album: 'Alb' });
  const b = mk('b', '2011-01-01T10:00:00Z', { tsKind: 'taken', tsSource: 'facebook-album-html' });
  await upsertEntries(db, C, [a, b]);
  const owner = { clientId: C, status: 'drafted', story: 'mine', lastPostedAt: '2020-01-01', title: 'T', postIds: ['old'], dates: [{ kind: 'event', date: '1999-01-01', source: 'x', platform: 'facebook' }] };
  db.cols.set('x_content_packages', new Map([['nas-1', structuredClone(owner)]]));
  const byId = { [a.id]: a, [b.id]: b };
  const links = [
    { entryId: a.id, packageId: 'nas-1', relPath: 'p' }, { entryId: b.id, packageId: 'nas-1', relPath: 'q' },
    { entryId: a.id, packageId: 'nas-missing', relPath: 'p' },
  ];
  assert.deepEqual(await linkEntriesToPackages(db, C, links, byId), { packagesUpdated: 1 });
  const p = db.cols.get('x_content_packages').get('nas-1');
  for (const k of ['status', 'story', 'lastPostedAt', 'title']) assert.equal(p[k], owner[k]);
  assert.equal(p.post.entryId, a.id); assert.equal(p.post.text.length, 300); assert.equal(p.post.album, 'Alb'); assert.equal(p.post.day, '2010-05-01');
  assert.deepEqual(p.postIds, ['old', a.id, b.id]);
  assert.deepEqual(p.dates.map((d) => `${d.kind}:${d.date}`), ['event:1999-01-01', 'posted:2010-05-01', 'taken:2011-01-01']);
  assert.equal(db.cols.has('x_content_packages') && db.cols.get('x_content_packages').has('nas-missing'), false);
  assert.deepEqual(db.cols.get('timeline_entries').get(`${C}__${a.id}`).linked, ['nas-1']);

  const snapshot = structuredClone([...db.cols.get('x_content_packages')]);
  const n = db.writes.length;
  assert.deepEqual(await linkEntriesToPackages(db, C, links, byId), { packagesUpdated: 0 });
  assert.deepEqual([...db.cols.get('x_content_packages')], snapshot);
  assert.ok(db.writes.slice(n).every((w) => w.col !== 'x_content_packages'));
});

test('postIds cap at 20', async () => {
  const db = makeDb();
  const es = Array.from({ length: 30 }, (_, i) => mk(`e${i}`, `2010-05-${String(i + 1).padStart(2, '0')}T10:00:00Z`));
  db.cols.set('x_content_packages', new Map([['nas-1', { clientId: C }]]));
  await linkEntriesToPackages(db, C, es.map((e) => ({ entryId: e.id, packageId: 'nas-1', relPath: 'p' })), Object.fromEntries(es.map((e) => [e.id, e])));
  assert.equal(db.cols.get('x_content_packages').get('nas-1').postIds.length, 20);
});

test('linkEntriesToPackages never writes into another client\'s package', async () => {
  const db = makeDb();
  const e = mk('x', '2010-05-01T10:00:00Z');
  await upsertEntries(db, C, [e]);
  db.cols.set('x_content_packages', new Map([['nas-9', { clientId: 'someone-else', title: 'theirs' }]]));
  await linkEntriesToPackages(db, C, [{ entryId: e.id, packageId: 'nas-9', relPath: 'p' }], { [e.id]: e });
  assert.deepEqual(db.cols.get('x_content_packages').get('nas-9'), { clientId: 'someone-else', title: 'theirs' });
});
