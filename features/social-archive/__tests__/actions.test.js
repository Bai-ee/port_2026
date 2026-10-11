import test from 'node:test';
import assert from 'node:assert/strict';
import { handleTimelineAction, TIMELINE_ACTIONS } from '../actions.js';

function fakeStore() {
  const calls = [];
  const rec = (name, ret) => async (...a) => { calls.push([name, ...a.slice(1)]); return ret; };
  return {
    calls,
    getDay: rec('getDay', { day: '2012-05-04', counts: {}, platforms: {}, total: 1, entries: [{ id: 'e1' }] }),
    listDays: rec('listDays', [{ day: '2012-05-04', total: 1 }]),
    searchEntries: rec('searchEntries', [{ id: 'e1' }]),
    listArchives: rec('listArchives', [{ platform: 'x' }]),
  };
}
const run = (store, action, body) => handleTimelineAction({ db: 'DB', clientId: 'c1', store }, action, body);
const rejects400 = (p) => assert.rejects(p, (e) => e.status === 400);

test('exports the four actions', () => {
  assert.deepEqual(TIMELINE_ACTIONS, ['timeline-day', 'timeline-days', 'timeline-search', 'timeline-archives']);
});

test('timeline-day validates and forwards', async () => {
  const s = fakeStore();
  const r = await run(s, 'timeline-day', { day: '2012-05-04' });
  assert.equal(r.ok, true);
  assert.equal(r.entries.length, 1);
  assert.deepEqual(s.calls[0], ['getDay', 'c1', '2012-05-04']);
  await rejects400(run(s, 'timeline-day', { day: '2012-02-31' }));
  await rejects400(run(s, 'timeline-day', {}));
});

test('timeline-days validates range', async () => {
  const s = fakeStore();
  const r = await run(s, 'timeline-days', { from: '2012-01-01', to: '2012-12-31' });
  assert.deepEqual(r.days, [{ day: '2012-05-04', total: 1 }]);
  assert.deepEqual(s.calls[0], ['listDays', 'c1', { from: '2012-01-01', to: '2012-12-31' }]);
  await run(s, 'timeline-days', {});
  assert.deepEqual(s.calls[1], ['listDays', 'c1', {}]);
  await rejects400(run(s, 'timeline-days', { from: '2012-12-31', to: '2012-01-01' }));
  await rejects400(run(s, 'timeline-days', { from: 'yesterday' }));
});

test('timeline-search clamps limit, checks platform, trims', async () => {
  const s = fakeStore();
  await run(s, 'timeline-search', { q: '  rooftop ', platform: 'Facebook', limit: 99999 });
  assert.deepEqual(s.calls[0], ['searchEntries', 'c1', { q: 'rooftop', platform: 'facebook', limit: 300 }]);
  await run(s, 'timeline-search', {});
  assert.deepEqual(s.calls[1], ['searchEntries', 'c1', { q: '', limit: 100 }]);
  await rejects400(run(s, 'timeline-search', { platform: 'myspace' }));
  await rejects400(run(s, 'timeline-search', { from: '2012-1-1' }));
});

test('timeline-archives and unknown action', async () => {
  const s = fakeStore();
  assert.deepEqual((await run(s, 'timeline-archives', {})).archives, [{ platform: 'x' }]);
  await rejects400(run(s, 'timeline-nope', {}));
});
