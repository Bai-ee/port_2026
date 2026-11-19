import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setCuration, listCurationCandidates } from '../curation.js';

const NOW = Date.parse('2026-11-18T12:00:00Z');
const DEL = Symbol('delete');
const iso = (daysAgo) => new Date(NOW - daysAgo * 86400000).toISOString();

function makeDeps(docs) {
  const merges = [];
  return { merges, getDoc: async (id) => docs[id] ?? null, mergeDoc: async (id, patch) => { merges.push({ id, patch }); }, deleteField: () => DEL };
}
const good = { clientId: 'c1', source: { kind: 'rendered-video' } };

test('setCuration refuses non-rv id, missing doc, foreign client, wrong source kind, bad state', async () => {
  const d = makeDeps({ 'rv-a': good, 'rv-b': { ...good, clientId: 'c2' }, 'rv-c': { ...good, source: { kind: 'nas' } }, 'x-1': good });
  const base = { clientId: 'c1', state: 'approved', by: 'me', now: NOW };
  await assert.rejects(setCuration(d, { ...base, id: 'x-1' }), { code: 'curation-bad-id' });
  await assert.rejects(setCuration(d, { ...base, id: 'rv-zzz' }), { code: 'curation-not-found' });
  await assert.rejects(setCuration(d, { ...base, id: 'rv-b' }), { code: 'curation-client-mismatch' });
  await assert.rejects(setCuration(d, { ...base, id: 'rv-c' }), { code: 'curation-bad-source' });
  await assert.rejects(setCuration(d, { ...base, id: 'rv-a', state: 'maybe' }), { code: 'curation-bad-state' });
  assert.equal(d.merges.length, 0);
});

test('setCuration approve/reject writes only curation + updatedAt', async () => {
  const d = makeDeps({ 'rv-a': good });
  const r = await setCuration(d, { clientId: 'c1', id: 'rv-a', state: 'approved', by: 'me@x.com', now: NOW });
  assert.deepEqual(Object.keys(d.merges[0].patch).sort(), ['curation', 'updatedAt']);
  assert.deepEqual(d.merges[0].patch.curation, { state: 'approved', at: iso(0), by: 'me@x.com' });
  assert.equal(r.curation.state, 'approved');
  await setCuration(d, { clientId: 'c1', id: 'rv-a', state: 'rejected', by: 'me@x.com', now: NOW });
  assert.equal(d.merges[1].patch.curation.state, 'rejected');
});

test('setCuration pending deletes the field (undo)', async () => {
  const d = makeDeps({ 'rv-a': good });
  const r = await setCuration(d, { clientId: 'c1', id: 'rv-a', state: 'pending', by: 'me', now: NOW });
  assert.equal(d.merges[0].patch.curation, DEL);
  assert.equal(r.curation, null);
});

test('listCurationCandidates: window, newest first, counts, retired excluded, slim rows', () => {
  const row = (id, daysAgo, extra = {}) => ({ id, title: id, renderedAt: iso(daysAgo), durationSec: 60, rights: 'x', story: 'big', ...extra });
  const rows = [
    row('rv-old', 30, { curation: { state: 'approved' } }),
    row('rv-new', 1), row('rv-mid', 5, { curation: { state: 'approved' } }), row('rv-rej', 9, { curation: { state: 'rejected' } }),
    row('rv-gone', 2, { status: 'retired', curation: { state: 'approved' } }),
    { id: 'rv-nodate' },
  ];
  const r = listCurationCandidates(rows, { days: 10, now: NOW });
  assert.deepEqual(r.items.map((i) => i.id), ['rv-new', 'rv-mid', 'rv-rej']);
  assert.deepEqual(r.counts, { pending: 1, approved: 1, rejected: 1 });
  assert.equal(r.approvedTotal, 2); // rv-old + rv-mid; retired excluded
  assert.deepEqual(Object.keys(r.items[0]).sort(), ['curation', 'durationSec', 'feedsCalendar', 'id', 'renderedAt', 'rights', 'title']);
  assert.equal(listCurationCandidates(rows, { days: 40, now: NOW }).items.length, 4);
});

test('listCurationCandidates: feedsCalendar = BAI-EE video, or any non-retired video with postable rights', () => {
  const row = (id, extra = {}) => ({ id, renderedAt: iso(1), mediaState: 'video', entities: ['BAI-EE'], ...extra });
  const r = listCurationCandidates([row('rv-ok'), row('rv-other', { entities: ['Someone'] }), row('rv-none', { entities: [] }), row('rv-still', { mediaState: 'still', entities: ['Someone'] }), row('rv-blocked', { entities: ['Someone'], rights: 'never-public' }), row('rv-client', { entities: ['Someone'], rights: 'client-approval-needed' })], { days: 10, now: NOW });
  assert.deepEqual(Object.fromEntries(r.items.map((i) => [i.id, i.feedsCalendar])), { 'rv-ok': true, 'rv-other': true, 'rv-none': true, 'rv-still': false, 'rv-blocked': false, 'rv-client': false });
});

test('listCurationCandidates caps at 200', () => {
  const rows = Array.from({ length: 250 }, (_, i) => ({ id: `rv-${i}`, renderedAt: iso(1) }));
  const r = listCurationCandidates(rows, { days: 10, now: NOW });
  assert.equal(r.items.length, 200);
  assert.equal(r.counts.pending, 250);
  assert.equal(r.truncated, true);
});
