import test from 'node:test';
import assert from 'node:assert/strict';
import { itemsInFolder, folderCounts, suggestFolders, validateFolderRule, matchesRule } from '../folders.js';

const mk = (id, over = {}) => ({ id, title: id, bucketId: 'record', ...over });
const items = [
  mk('a', { facets: { gear: ['TB-303'], eraYear: 1997, vibe: { time: 'night', kind: 'flyer' } }, tags: ['Acid'] }),
  mk('b', { facets: { gear: ['909'], eraYear: 2004 } }),
  mk('c', { bucketId: 'ue', facets: { gear: ['tb303'] } }),
  mk('d', { humanEdits: { gear: ['Roland 909'] }, facets: { gear: ['808'] } }),
];

test('contains canonicalizes gear aliases', () => {
  const r = { field: 'gear', op: 'contains', value: '909' };
  assert.deepEqual(itemsInFolder({ id: 'f', bucketId: 'record', rule: r }, items).map((i) => i.id), ['b', 'd']);
  assert.ok(matchesRule({ field: 'gear', op: 'contains', value: 'tr-909' }, items[1]));
});

test('between, vibe, tag, equals', () => {
  assert.ok(matchesRule({ field: 'eraYear', op: 'between', value: [1990, 1999] }, items[0]));
  assert.ok(!matchesRule({ field: 'eraYear', op: 'between', value: [1990, 1999] }, items[1]));
  assert.ok(matchesRule({ field: 'vibe.time', op: 'vibe', value: 'night' }, items[0]));
  assert.ok(matchesRule({ field: 'time', op: 'vibe', value: 'night' }, items[0]));
  assert.ok(matchesRule({ field: 'tags', op: 'tag', value: 'acid' }, items[0]));
  assert.ok(matchesRule({ field: 'decade', op: 'equals', value: '2000s' }, items[1]));
});

test('manual ∪ rule, restricted to bucket', () => {
  const f = { id: 'f', bucketId: 'record', itemIds: ['c', 'd'], rule: { field: 'gear', op: 'contains', value: '303' } };
  // c is in bucket ue -> excluded even though manual + rule match
  assert.deepEqual(itemsInFolder(f, items).map((i) => i.id), ['a', 'd']);
  assert.deepEqual(folderCounts([f, { id: 'g', bucketId: 'ue', itemIds: ['c'] }], items), { f: 2, g: 1 });
});

test('validateFolderRule', () => {
  assert.deepEqual(validateFolderRule({ field: 'gear', op: 'contains', value: '303' }), []);
  assert.ok(validateFolderRule({ field: 'gear', op: 'nope', value: 1 }).length);
  assert.ok(validateFolderRule({ field: 'eraYear', op: 'between', value: [2000, 1990] }).length);
  assert.ok(validateFolderRule({ field: 'dateText', op: 'contains', value: 'x' }).length);
  assert.ok(!matchesRule({ op: 'bad' }, items[0]));
});

test('suggestFolders from frequent facets', () => {
  const many = Array.from({ length: 12 }, (_, i) => mk(`x${i}`, { facets: { gear: ['TB-303'], eraYear: 1995 } }));
  many.push(mk('y', { facets: { gear: ['909'] } }));
  const s = suggestFolders(many, { minCount: 5, bucketId: 'record' });
  const g = s.find((x) => x.rule.field === 'gear');
  assert.equal(g.name, '303');
  assert.equal(g.count, 12);
  assert.deepEqual(g.rule, { field: 'gear', op: 'contains', value: 'tb-303' });
  assert.ok(s.find((x) => x.rule.field === 'decade' && x.rule.value === '1990s'));
  assert.ok(!s.find((x) => x.rule.value === 'tr-909'));
  const again = suggestFolders(many, { existing: [{ rule: g.rule }] });
  assert.ok(!again.find((x) => x.rule.field === 'gear'));
});
