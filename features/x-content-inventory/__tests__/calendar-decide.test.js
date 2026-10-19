// Pass / Delete / Replace for calendar rows (calendar-decide.js) with fake deps; replace runs the real daily-fill planner.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideCalendarItem } from '../calendar-decide.js';
import { runDailyFill } from '../daily-fill.js';
import { normalizeContentTracks } from '../../x-strategy/content-tracks.js';

const TODAY = '2026-10-19';
const NOW = Date.parse('2026-10-19T15:00:00Z');
const tracks = normalizeContentTracks([
  { id: 'record', label: 'Record Collection Videos', engines: ['record'], buckets: ['record'], share: 0.4 },
  { id: 'ue', label: 'Dj Mix Videos', engines: ['ue'], buckets: ['ue'], share: 0.2 },
  { id: 'client', label: 'Video Editing', engines: ['client'], buckets: ['client'], share: 0 },
  { id: 'nas', label: 'Throwback Content', engines: ['identity'], buckets: ['nas'], share: 0 },
]);
const pkg = (id, bucketId) => ({ id, bucketId, engine: bucketId, title: id, mediaState: 'video', effort: 'ready' });

function harness({ posts = {}, packages = [pkg('rec-a', 'record'), pkg('rec-b', 'record'), pkg('ue-a', 'ue')], quotes = [] } = {}) {
  const log = [];
  const store = new Map(Object.entries(posts).map(([id, p]) => [id, { id, revision: 1, ...p }]));
  const fillPosts = () => [...store.values()].filter((p) => p.source === 'daily-fill').map((p) => ({ postId: p.id, status: p.status, reviewOn: p.reviewOn, fillKind: p.fillKind, bucketId: p.bucketId, idempotencyKey: p.idempotencyKey || null }));
  const deps = {
    getPost: async (_c, id) => store.get(id) || null,
    rejectPost: async (_c, id, o) => { log.push(['reject', id, o]); const p = store.get(id); store.set(id, { ...p, status: 'rejected' }); return store.get(id); },
    unschedulePost: async (_c, id, o) => { log.push(['unschedule', id, o]); const p = store.get(id); store.set(id, { ...p, status: 'approved', scheduledAt: null, revision: p.revision + 1 }); return store.get(id); },
    dismissQuoteTarget: async (_c, id) => { log.push(['dismiss-target', id]); },
    dismissSuggestion: async (_c, id) => { log.push(['dismiss-suggestion', id]); },
    rejectPackage: async (_c, id) => { log.push(['reject-package', id]); },
    getPackage: async (_c, id) => packages.find((p) => p.id === id) || null,
    openQuoteTargets: async () => quotes,
    rowOf: async (_c, id) => ({ id, row: true }),
    now: () => NOW,
    fill: (cid, spec, o) => runDailyFill(cid, {
      ...spec, ...o, deps: {
        loadInputs: async () => ({ tracks, packages, fillPosts: fillPosts(), openPosts: new Map(), today: TODAY, nowMs: NOW, quoteTargets: quotes }),
        ensureDraft: async (_c, payload) => { const id = `new-${store.size}`; log.push(['draft', payload.packageId || payload.fillSource?.id, payload.reviewOn]); store.set(id, { id, status: 'draft', source: 'daily-fill', ...payload }); return { post: { id }, existing: false }; },
      },
    }),
  };
  return { deps, log, store };
}
const draft = (extra = {}) => ({ status: 'draft', source: 'daily-fill', fillKind: 'baseline', bucketId: 'record', packageId: 'rec-a', reviewOn: TODAY, idempotencyKey: `daily-fill:${TODAY}:baseline:rec-a`, ...extra });
const run = (h, decision, item) => decideCalendarItem(h.deps, { clientId: 'c1', decision, item, by: 'me@x.com' });

test('validation: bad decision / kind / missing ids', async () => {
  const h = harness();
  await assert.rejects(run(h, 'nope', { kind: 'post', postId: 'a' }), { status: 400, code: 'bad-decision' });
  await assert.rejects(run(h, 'pass', { kind: 'x' }), { status: 400, code: 'bad-kind' });
  await assert.rejects(run(h, 'pass', { kind: 'post' }), { status: 400, code: 'bad-item' });
  await assert.rejects(run(h, 'pass', { kind: 'requote' }), { status: 400, code: 'bad-item' });
  await assert.rejects(run(h, 'pass', { kind: 'suggestion' }), { status: 400, code: 'bad-item' });
  await assert.rejects(run(h, 'pass', { kind: 'post', postId: 'missing' }), { status: 404 });
});

test('post pass: rejects the draft only; package untouched', async () => {
  const h = harness({ posts: { p1: draft() } });
  const r = await run(h, 'pass', { kind: 'post', postId: 'p1', expectedRevision: 1 });
  assert.deepEqual(h.log, [['reject', 'p1', { by: 'me@x.com', expectedRevision: 1 }]]);
  assert.equal(r.ok, true);
  assert.equal(r.replacement, null);
  assert.deepEqual(r.removed, { postId: 'p1', packageId: 'rec-a' });
});

test('post delete: also rejects the library package', async () => {
  const h = harness({ posts: { p1: draft() } });
  const r = await run(h, 'delete', { kind: 'post', postId: 'p1' });
  assert.deepEqual(h.log.map((l) => l[0]), ['reject', 'reject-package']);
  assert.equal(r.removed.packageRejected, true);
});

test('posted / posting / queued posts are refused 409 not-removable and nothing is written', async () => {
  for (const status of ['posted', 'posting', 'queued', 'manual']) {
    const h = harness({ posts: { p1: draft({ status }) } });
    await assert.rejects(run(h, 'delete', { kind: 'post', postId: 'p1' }), { status: 409, code: 'not-removable' });
    assert.deepEqual(h.log, []);
  }
});

test('scheduled post: unschedule first (revision check spent), then reject', async () => {
  const h = harness({ posts: { p1: draft({ status: 'scheduled', scheduledAt: '2026-10-20T15:00:00Z' }) } });
  await run(h, 'pass', { kind: 'post', postId: 'p1', expectedRevision: 1 });
  assert.deepEqual(h.log, [['unschedule', 'p1', { expectedRevision: 1 }], ['reject', 'p1', { by: 'me@x.com', expectedRevision: null }]]);
});

test('a requote draft also dismisses its quote target (so the requote does not reappear)', async () => {
  const h = harness({ posts: {
    q1: draft({ fillKind: 'quote', packageId: undefined, fillSource: { type: 'quote-target', id: 't9' } }),
    q2: draft({ fillKind: 'quote', packageId: undefined, sourceRef: { kind: 'quote-target', id: 't8', url: 'u' } }),
  } });
  assert.deepEqual((await run(h, 'pass', { kind: 'post', postId: 'q1' })).removed, { postId: 'q1', targetId: 't9' });
  await run(h, 'delete', { kind: 'post', postId: 'q2' });
  assert.deepEqual(h.log.filter((l) => l[0] === 'dismiss-target'), [['dismiss-target', 't9'], ['dismiss-target', 't8']]);
});

test('suggestion: pass/delete dismiss; replace is unsupported (400)', async () => {
  const h = harness();
  for (const d of ['pass', 'delete']) {
    const r = await run(h, d, { kind: 'suggestion', suggestionId: 's1', runId: 'r' });
    assert.deepEqual(r.removed, { suggestionId: 's1' });
  }
  assert.equal(h.log.filter((l) => l[0] === 'dismiss-suggestion').length, 2);
  await assert.rejects(run(h, 'replace', { kind: 'suggestion', suggestionId: 's1' }), { status: 400, code: 'replace-unsupported' });
});

test('requote: pass/delete dismiss the target; replace returns the next open candidate', async () => {
  const fresh = new Date(NOW - 3_600_000).toISOString();
  const h = harness({ quotes: [{ id: 't1', createdAt: fresh }, { id: 't2', createdAt: fresh }, { id: 'old', createdAt: new Date(NOW - 72 * 3_600_000).toISOString() }] });
  assert.equal((await run(h, 'pass', { kind: 'requote', targetId: 't1' })).replacement, null);
  await run(h, 'delete', { kind: 'requote', targetId: 't1' });
  const r = await run(h, 'replace', { kind: 'requote', targetId: 't1', date: TODAY });
  assert.deepEqual(r.replacement, { kind: 'requote', targetId: 't2', date: TODAY });
  const none = await run(harness({ quotes: [{ id: 't1', createdAt: fresh }] }), 'replace', { kind: 'requote', targetId: 't1' });
  assert.equal(none.replacement, null);
  assert.equal(none.note, 'no-eligible-item');
});

test('replace: removed package is excluded and the same track/date gets the next item', async () => {
  const h = harness({ posts: { p1: draft() } });
  const r = await run(h, 'replace', { kind: 'post', postId: 'p1', date: TODAY });
  assert.equal(r.replacement.kind, 'post');
  assert.equal(r.replacement.date, TODAY);
  assert.equal(r.replacement.row.row, true);
  const made = h.log.filter((l) => l[0] === 'draft');
  assert.deepEqual(made, [['draft', 'rec-b', TODAY]]); // rec-a excluded, other tracks untouched, exactly one
  assert.equal(h.store.get('p1').status, 'rejected');
  assert.equal(h.log.some((l) => l[0] === 'reject-package'), false);
});

test('replace with nothing eligible: ok, no replacement, note', async () => {
  const h = harness({ posts: { p1: draft() }, packages: [pkg('rec-a', 'record')] });
  const r = await run(h, 'replace', { kind: 'post', postId: 'p1', date: TODAY });
  assert.equal(r.ok, true);
  assert.equal(r.replacement, null);
  assert.equal(r.note, 'no-eligible-item');
});
