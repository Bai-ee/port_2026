import test from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex, search, parseQuery } from '../search-index.js';

const items = [
  { id: '1', title: 'Ron Trent live', bucketId: 'record', facets: { people: ['Ron Trent'], gear: ['909'], eraYear: 1997, venues: ['Zanzibar'], vibe: { time: 'night' } } },
  { id: '2', title: 'House flyer', bucketId: 'nas', facets: { people: ['Ron Hardy'], eraYear: 1985 } },
  { id: '3', title: 'Acid 303', bucketId: 'record', facets: { gear: ['tb303'], eraYear: 1995 } },
  { id: '4', title: 'Ronald notes', bucketId: 'record', facets: { crews: ['Trent Crew'] } },
];
const idx = buildIndex(items);

test('index is serializable', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(idx)), idx);
  assert.equal(idx.docs[1].bucketId, 'nas');
});

test('parseQuery multi-word field', () => {
  assert.deepEqual(parseQuery('people:ron trent gear:909'), {
    words: [], filters: [{ field: 'people', value: 'ron trent' }, { field: 'gear', value: '909' }],
  });
});

test('single-word fields leave free words', () => {
  const p = parseQuery('gear:909 house year:1997');
  assert.deepEqual(p.words, ['house']);
  assert.deepEqual(p.filters, [{ field: 'gear', value: '909' }, { field: 'year', value: '1997' }]);
  assert.deepEqual(parseQuery('people:"ron trent" house').words, ['house']);
});

test('free words AND + prefix', () => {
  assert.deepEqual(search(idx, 'ron').map((h) => h.id).sort(), ['1', '2', '4']);
  assert.deepEqual(search(idx, 'ron trent').map((h) => h.id).sort(), ['1', '4']);
  assert.deepEqual(search(idx, 'zzz'), []);
});

test('field filters + gear canonicalization', () => {
  assert.deepEqual(search(idx, 'gear:909').map((h) => h.id), ['1']);
  assert.deepEqual(search(idx, 'gear:tr-909').map((h) => h.id), ['1']);
  assert.deepEqual(search(idx, '303').map((h) => h.id), ['3']);
  assert.deepEqual(search(idx, 'year:1997').map((h) => h.id), ['1']);
  assert.deepEqual(search(idx, 'decade:1990s').map((h) => h.id).sort(), ['1', '3']);
  assert.deepEqual(search(idx, 'venue:zanz').map((h) => h.id), ['1']);
  assert.deepEqual(search(idx, 'vibe:night').map((h) => h.id), ['1']);
  assert.deepEqual(search(idx, 'bucket:nas').map((h) => h.id), ['2']);
  assert.deepEqual(search(idx, '', { filters: { gear: '909' } }).map((h) => h.id), ['1']);
});

test('ranking: exact facet beats partial, deterministic ties', () => {
  const h = search(idx, 'people:ron trent');
  assert.equal(h[0].id, '1');
  assert.deepEqual(h[0].matched, ['people']);
  const r = search(idx, 'ron');
  assert.equal(r[0].id, '1'); // facet-prefix + title match outranks the rest
  assert.deepEqual(search(idx, 'ron').map((x) => x.id), search(idx, 'ron').map((x) => x.id));
});

test('bucket filter + limit', () => {
  assert.deepEqual(search(idx, 'ron', { bucketId: 'record' }).map((h) => h.id).sort(), ['1', '4']);
  assert.equal(search(idx, 'ron', { limit: 1 }).length, 1);
});

test('performance soft check: 10k docs', () => {
  const names = ['ron', 'larry', 'frankie', 'kerri', 'david', 'derrick'];
  const big = Array.from({ length: 10000 }, (_, i) => ({
    id: `d${i}`, title: `Item ${i} ${names[i % 6]}`, bucketId: i % 2 ? 'record' : 'nas',
    facets: { people: [`${names[i % 6]} person${i % 300}`], gear: [['909', '808', '303'][i % 3]], eraYear: 1980 + (i % 40), venues: [`venue ${i % 50}`] },
  }));
  const bi = buildIndex(big);
  search(bi, 'warm');
  const qs = ['ron', 'people:larry gear:909', 'item 12', 'year:1997 venue:venue', 'decade:1990s'];
  const t0 = performance.now();
  for (const q of qs) search(bi, q);
  const per = (performance.now() - t0) / qs.length;
  console.log(`perf: ${per.toFixed(2)}ms/query`);
  assert.ok(per < 50, `slow: ${per}ms`);
});

const dated = buildIndex([
  { id: 'a', title: 'Thursday party', bucketId: 'nas', facets: { eventDate: '2018-11-15', eventMonthDay: '11-15', eventYear: 2018 } },
  { id: 'b', title: 'Unknown year', bucketId: 'nas', facets: { eventMonthDay: '11-15', eventYearCandidates: [2012, 2018] } },
  { id: 'c', title: 'Other month', bucketId: 'nas', facets: { eventDate: '2018-12-01', eventMonthDay: '12-01', eventYear: 2018 } },
  { id: 'd', title: 'Multi', bucketId: 'nas', facets: { eventDates: [{ monthDay: '11-15', year: 2019, yearSource: 'printed' }, { monthDay: '11-16', year: null }] } },
  { id: 'e', title: 'No dates', bucketId: 'nas', facets: { eraYear: 1997 }, capturedAt: '2018-11-15' },
]);
const ids = (q) => search(dated, q).map((h) => h.id).sort();

test('date: exact / month / year / month-day', () => {
  assert.deepEqual(ids('date:2018-11-15'), ['a']);
  assert.deepEqual(ids('date:2018-11'), ['a']);
  assert.deepEqual(ids('date:2018'), ['a', 'c']);
  assert.deepEqual(ids('date:2019-11-15'), ['d']);
  assert.deepEqual(ids('date:11-15'), ['a', 'b', 'd']);
  assert.deepEqual(ids('date:11-16'), ['d']);
  assert.deepEqual(ids('date:nov15'), []);
  assert.deepEqual(ids('date:2012'), []);
});

test('free text event-date tokens find items; capturedAt is never indexed', () => {
  assert.deepEqual(ids('2018-11-15'), ['a']);
  assert.deepEqual(ids('11-15'), ['a', 'b', 'd']);
  assert.equal(ids('date:11-15 party').join(), 'a');
});
