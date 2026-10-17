import test from 'node:test';
import assert from 'node:assert/strict';
import { postNeedsMemory, fallbackMemoryLine, normalizeMemoryLine, applyMemoryLine, planMemorySuggestions } from '../memory-suggest.js';
import { planMediaTasks, taskIdFor, createContentTaskStore, itemHasMedia } from '../content-tasks.js';
import { buildMonthCalendar } from '../month-calendar.js';

const draft = (o = {}) => ({ id: 'p1', status: 'draft', content: 'Dec 17, 2014 · Tom Waits\n\n[add your memory]', packageId: 'k1', updatedAt: 'u1', needsStory: true, ...o });
const pkg = { id: 'k1', title: 'Tom Waits', facets: { eventDate: '1949-12-07' } };

test('postNeedsMemory: only an unapproved draft that still has a placeholder', () => {
  assert.equal(postNeedsMemory(draft()), true);
  assert.equal(postNeedsMemory(draft({ content: 'x [add your take]' })), true);
  assert.equal(postNeedsMemory(draft({ content: 'done' })), false);
  assert.equal(postNeedsMemory(draft({ status: 'approved' })), false);
});

test('fallback line is facts only (title + year) and null without a title', () => {
  assert.equal(fallbackMemoryLine(pkg), 'Still one I come back to: Tom Waits, 1949.');
  assert.equal(fallbackMemoryLine({ id: 'x' }), null);
});

test('applyMemoryLine replaces the placeholder, refuses placeholders, empty lines and >280 chars', () => {
  const a = applyMemoryLine('Head\n\n[add your memory]', 'Great night.');
  assert.deepEqual(a, { ok: true, content: 'Head\n\nGreat night.' });
  assert.equal(applyMemoryLine('Head', 'x').ok, false);
  assert.equal(normalizeMemoryLine('  ').ok, false);
  assert.equal(normalizeMemoryLine('fill [add your take]').ok, false);
  assert.equal(applyMemoryLine(`${'h'.repeat(200)}\n[add your memory]`, 'y'.repeat(100)).ok, false);
});

test('planMemorySuggestions: agent line wins over facts; posts without facts or a placeholder become problems', () => {
  const out = planMemorySuggestions({ posts: [draft(), draft({ id: 'p2', packageId: 'none' }), draft({ id: 'p3', content: 'filled' })], packages: [pkg], suggestions: { p2: 'Saw them live.' } });
  assert.deepEqual(out.rows.map((r) => [r.postId, r.source]), [['p1', 'facts'], ['p2', 'agent']]);
  assert.equal(out.problems.length, 1);
  assert.match(out.problems[0], /^p3/);
});

const TODAY = '2026-10-17';
test('planMediaTasks: calendar items without media, due 3 days before, idempotent, clamped to today', () => {
  const posts = [
    draft({ id: 'a', reviewOn: '2026-10-30' }),
    draft({ id: 'b', reviewOn: '2026-10-18' }),
    draft({ id: 'c', reviewOn: '2026-10-30', packageId: 'vid' }),
    draft({ id: 'd', reviewOn: '2026-10-01' }),
    draft({ id: 'e', mediaUrl: 'https://m', reviewOn: '2026-10-30' }),
    draft({ id: 'f', reviewOn: undefined }),
  ];
  const packages = [pkg, { id: 'vid', assetRefs: ['publish-staging/x.mp4'] }];
  const out = planMediaTasks({ posts, packages, today: TODAY, existingTaskIds: new Set([taskIdFor('b')]) });
  assert.deepEqual(out.rows.map((r) => [r.postId, r.dueOn, r.existing]), [['b', TODAY, true], ['a', '2026-10-27', false]]);
  assert.deepEqual(out.skipped, { 'has-media': 2, past: 1, 'no-date': 1 });
  assert.equal(itemHasMedia({ nas: { sha256: 'x' } }, {}), true);
  const ranged = planMediaTasks({ posts, packages, today: TODAY, filter: { from: '2026-10-25' } });
  assert.deepEqual(ranged.rows.map((r) => r.postId), ['a']);
});

function fakeDb() {
  const docs = new Map();
  const doc = (path) => ({
    id: path.split('/').pop(),
    async create(d) { if (docs.has(path)) throw Object.assign(new Error('ALREADY_EXISTS'), { code: 6 }); docs.set(path, d); },
    async get() { return { exists: docs.has(path), id: path.split('/').pop(), data: () => docs.get(path) }; },
    async set(d) { docs.set(path, { ...docs.get(path), ...d }); },
    collection: (n) => coll(`${path}/${n}`),
  });
  const coll = (path) => ({ doc: (id) => doc(`${path}/${id}`), where: () => coll(path), async get() { return { docs: [...docs.entries()].filter(([k]) => k.startsWith(`${path}/`)).map(([k, v]) => ({ id: k.split('/').pop(), data: () => v })) }; }, select: () => coll(path) });
  return { collection: (n) => coll(n), docs };
}

test('content task store: create is idempotent per post; setStatus toggles done', async () => {
  const db = fakeDb();
  const store = createContentTaskStore(db, { clock: () => 0 });
  const rows = [{ postId: 'a', packageId: 'k1', title: 'T', kind: 'film', dueOn: '2026-10-27' }];
  assert.deepEqual(await store.create('c1', rows), { created: 1, existing: 0 });
  assert.deepEqual(await store.create('c1', rows), { created: 0, existing: 1 });
  assert.equal((await store.list('c1')).length, 1);
  assert.equal((await store.setStatus('c1', taskIdFor('a'), 'done')).status, 'done');
  assert.equal(await store.setStatus('c1', 'nope', 'done'), null);
  await assert.rejects(() => store.setStatus('c1', taskIdFor('a'), 'weird'));
});

test('month calendar: open tasks land on their dueOn day with a "To film" badge', () => {
  const now = Date.parse('2026-10-17T15:00:00Z');
  const tasks = [{ id: 'media-a', kind: 'film', title: 'Tom Waits', dueOn: '2026-10-27', status: 'open', postId: 'a' }, { id: 'media-b', kind: 'film', title: 'Done one', dueOn: '2026-10-28', status: 'done' }];
  const cal = buildMonthCalendar({ posts: [], month: '2026-10', now, tasks });
  const day = cal.weeks.flat().find((d) => d.date === '2026-10-27');
  assert.equal(day.tasks.length, 1);
  assert.equal(day.tasks[0].badge, 'To film');
  assert.equal(cal.totals.tasksOpen, 1);
  assert.equal(cal.weeks.flat().find((d) => d.date === '2026-10-28').tasks[0].status, 'done');
  assert.deepEqual(buildMonthCalendar({ posts: [], month: '2026-10', now }).weeks.flat()[0].tasks, []);
});
