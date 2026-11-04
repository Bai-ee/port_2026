import test from 'node:test';
import assert from 'node:assert/strict';
import { formatPostCopy, copyKind, cleanLine, titleLines } from '../copy-format.js';

test('mix: title lines + #mixtapesfromchi, nothing else (owner examples)', () => {
  const mix = { id: 'rv-1', source: { kind: 'rendered-video' }, title: 'Chicago Skyway – Chubby Podcast', story: '[add your memory]' };
  assert.equal(formatPostCopy(mix), 'Chicago Skyway\nChubby Podcast\n#mixtapesfromchi');
  assert.equal(formatPostCopy({ ...mix, title: 'BAI-EE – Love Manifesto V-Day Mix' }), 'BAI-EE\nLove Manifesto V-Day Mix\n#mixtapesfromchi');
});

test('discogs: artists / title / year - catalog# / #baieesdiscogs from the stamped release (owner example)', () => {
  const rec = { id: 'discogs-1', source: { kind: 'discogs' }, title: 'Glenn Underground – House Music Will Never Die', eraYear: 1996,
    release: { artists: ['Glenn Underground', 'Cei-Bei (2)'], title: 'House Music Will Never Die', year: 1996, catno: 'CAJ 261' } };
  assert.equal(formatPostCopy(rec), 'Glenn Underground, Cei-Bei\nHouse Music Will Never Die\n1996 - CAJ 261\n#baieesdiscogs');
  // Missing facts drop their part, never a placeholder: no release => title split + eraYear.
  assert.equal(formatPostCopy({ ...rec, release: undefined }), 'Glenn Underground\nHouse Music Will Never Die\n1996\n#baieesdiscogs');
  assert.equal(formatPostCopy({ ...rec, release: { ...rec.release, catno: 'none' } }).split('\n')[2], '1996');
});

test('any other item: title lines, where, when; placeholders / TODO / em dashes never survive; <= 280', () => {
  const flyer = { id: 'nas-a', title: 'Night Shift — Warehouse', facets: { venues: ['Smart Bar'], eventDate: '1998-03-07' } };
  assert.equal(formatPostCopy(flyer), 'Night Shift\nWarehouse\nSmart Bar\nMarch 7, 1998');
  assert.equal(formatPostCopy({ id: 'todo-1', title: 'TODO' }), 'todo-1');
  assert.equal(formatPostCopy({ id: 'nas-b', title: 'AN EVENING · 1195 W FOLSOM ST | SF · 12/17/14', facets: { eventDate: '2014-12-17' } }),
    'AN EVENING\n1195 W FOLSOM ST | SF\nDecember 17, 2014');
  assert.equal(cleanLine('Great set [add your memory]'), 'Great set');
  assert.deepEqual(titleLines('A – B - C'), ['A', 'B', 'C']);
  assert.ok(formatPostCopy({ id: 'rv-2', title: 'x'.repeat(400) }).length <= 280);
  assert.ok(formatPostCopy({ id: 'rv-2', title: 'x'.repeat(400) }).endsWith('#mixtapesfromchi'));
  assert.deepEqual(['discogs-9', 'rv-9', 'nas-9'].map((id) => copyKind({ id })), ['discogs', 'mix', 'item']);
});
