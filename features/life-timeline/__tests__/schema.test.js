import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeLifeItem, monthKey, dayKey, toMediaDoc, buildMonthPacks, MONTH_PART_MAX } from '../schema.js';
import { rawItem, sha } from './_fixtures.js';

const reason = (o) => sanitizeLifeItem(o).reason;

test('valid item passes and trims', () => {
  const r = sanitizeLifeItem(rawItem(1));
  assert.equal(r.ok, true);
  assert.equal(r.item.title, 't');
});
test('rejections', () => {
  assert.equal(reason(null), 'not-an-object');
  assert.equal(reason(rawItem(1, { sha256: 'ABC' })), 'bad-sha256');
  assert.equal(reason(rawItem(1, { id: '0000000000000000' })), 'id-mismatch');
  assert.equal(reason(rawItem(1, { kind: 'audio' })), 'bad-kind');
  assert.equal(reason(rawItem(1, { takenLocal: '2010-05-01 10:00' })), 'bad-takenLocal');
  assert.equal(reason(rawItem(1, { tz: '0500' })), 'bad-tz');
  assert.equal(reason(rawItem(1, { gps: { lat: 91, lon: 0 } })), 'bad-gps');
  assert.equal(reason(rawItem(1, { thumbs: { s: 'life-thumbs/x_s.jpg', m: 'life-thumbs/x_m.jpg' } })), 'thumbs-path-mismatch');
  assert.equal(reason(rawItem(1, { canonicalPath: 'elsewhere/x.jpg' })), 'bad-canonicalPath');
  assert.equal(reason(rawItem(1, { canonicalPath: 'HITLOOP-ARCHIVE/timeline/../x.jpg' })), 'bad-canonicalPath');
  for (const p of ['/abs/x.jpg', 'a/../b.jpg', 'Volumes/x/y.jpg', '/Volumes/x']) {
    assert.equal(reason(rawItem(1, { locations: [{ sourceId: 's', relativePath: p, originalFileName: 'x' }] })), 'bad-relativePath', p);
  }
});
test('caps', () => {
  assert.equal(reason(rawItem(1, { albums: Array(101).fill('a') })), 'too-many-albums');
  assert.equal(reason(rawItem(1, { keywords: Array(201).fill('a') })), 'too-many-keywords');
  assert.equal(reason(rawItem(1, { locations: Array(51).fill({ relativePath: 'a' }) })), 'too-many-locations');
  assert.equal(sanitizeLifeItem(rawItem(1, { title: 'x'.repeat(500) })).item.title.length, 300);
  assert.equal(sanitizeLifeItem(rawItem(1, { description: 'x'.repeat(3000) })).item.description.length, 2000);
});
test('month/day keys', () => {
  assert.equal(monthKey('2010-05-01T10:00:00'), '2010-05');
  assert.equal(monthKey(null), 'unknown');
  assert.equal(monthKey('garbage'), 'unknown');
  assert.equal(dayKey('2010-05-01T10:00:00'), '2010-05-01');
  assert.equal(dayKey(null), null);
});
test('toMediaDoc merges', () => {
  const a = sanitizeLifeItem(rawItem(1)).item;
  const first = toMediaDoc(a, null, '2026-01-01T00:00:00Z', 'src');
  assert.equal(first.ym, '2010-05');
  assert.equal(first.day, '2010-05-01');
  assert.equal(first.schema, 'life.media/1');
  const b = sanitizeLifeItem(rawItem(1, { albums: ['B'], locations: [{ sourceId: 'src2', relativePath: 'c.jpg', originalFileName: 'c.jpg' }, { sourceId: 'src', relativePath: 'a/b.jpg', originalFileName: 'b.jpg' }], title: 'new' })).item;
  const second = toMediaDoc(b, first, '2026-02-01T00:00:00Z', 'src2');
  assert.deepEqual(second.albums, ['A', 'B']);
  assert.deepEqual(second.sourceIds, ['src', 'src2']);
  assert.equal(second.locations.length, 2);
  assert.equal(second.createdAt, '2026-01-01T00:00:00Z');
  assert.equal(second.updatedAt, '2026-02-01T00:00:00Z');
  assert.equal(second.title, 'new');
});
test('month packs: sort, entry shape, unknown', () => {
  const mk = (n, t, over = {}) => toMediaDoc(sanitizeLifeItem(rawItem(n, { takenLocal: t, ...over })).item, null, 'now', 's');
  const docs = [mk(3, '2010-05-02T00:00:00'), mk(1, '2010-05-01T00:00:00', { kind: 'video', durationSec: 5, motion: { sha256: sha('m'), durationSec: 1 } }), mk(2, '2010-05-01T00:00:00')];
  const { monthDoc, partDocs } = buildMonthPacks('2010-05', docs, 'now');
  assert.equal(partDocs.length, 0);
  assert.equal(monthDoc.count, 3);
  assert.equal(monthDoc.partCount, 1);
  const ts = monthDoc.items.map((e) => e.t);
  assert.deepEqual(ts, [...ts].sort());
  const ids = monthDoc.items.slice(0, 2).map((e) => e.id);
  assert.deepEqual(ids, [...ids].sort());
  const v = monthDoc.items.find((e) => e.k === 'v');
  assert.deepEqual(Object.keys(v), ['id', 't', 'k', 'w', 'h', 'm', 'd']);
  assert.equal(v.m, true);
  assert.equal(v.d, 5);
  const u = buildMonthPacks('unknown', [mk(9, null)], 'now');
  assert.equal(u.monthDoc.items[0].t, null);
});
test('month packs split over MONTH_PART_MAX', () => {
  const docs = Array.from({ length: MONTH_PART_MAX + 5 }, (_, i) => ({ id: String(i).padStart(16, '0'), takenLocal: '2010-05-01T00:00:00', kind: 'image', width: 1, height: 1 }));
  const { monthDoc, partDocs } = buildMonthPacks('2010-05', docs, 'now');
  assert.equal(monthDoc.partCount, 2);
  assert.equal(monthDoc.items.length, MONTH_PART_MAX);
  assert.equal(partDocs.length, 1);
  assert.equal(partDocs[0].part, 1);
  assert.equal(partDocs[0].items.length, 5);
  assert.equal(monthDoc.count, MONTH_PART_MAX + 5);
});
