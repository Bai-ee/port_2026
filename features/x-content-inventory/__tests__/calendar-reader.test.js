import test from 'node:test';
import assert from 'node:assert/strict';
import { readUnifiedCalendar, readCalendarQuoteTargets, quotePostsOnDay } from '../calendar-reader.js';
import { assignQuoteSlots } from '../../x-quote-targets/hot-calendar.js';
import { buildMonthCalendar } from '../month-calendar.js';
import { resolveCalendarEngineConfig } from '../../content-context/load-content-context.js';
import { bucketOfPost } from '../bucket-colors.js';
import { runReadTool, READ_TOOL_NAMES, serializeResult, LIMITS } from '../../x-strategy/agent/tools.js';

const NOW = Date.parse('2026-10-17T15:00:00Z'); // 10:00 CT, Sat Oct 17
const db = { collection: () => ({ doc: () => ({ get: async () => ({ exists: false }) }) }) };
const posts = [
  { id: 'd1', status: 'draft', scheduledAt: null, engine: 'identity', content: 'Back in 2011 [add your memory] we shipped it', createdAt: '2026-10-01T00:00:00Z', packageId: 'pk1' },
  { id: 's1', status: 'scheduled', scheduledAt: '2026-10-18T14:00:00Z', engine: 'identity', content: 'scheduled one' },
  { id: 'a1', status: 'approved', scheduledAt: '2026-10-17T20:00:00Z', engine: 'identity', content: 'approved one' },
  { id: 'p1', status: 'posted', postedAt: '2026-10-16T14:00:00Z', scheduledAt: '2026-10-16T14:00:00Z', engine: 'identity', content: 'posted one' },
];
const suggestions = [{ id: 'sg1', date: '2026-10-17', slot: { letter: 'A', timeCT: '11:00' }, type: 'original', text: 'a suggestion', runId: 'r', expiresAt: null }];
const quoteTargets = [{ id: 'qt1', url: 'https://x.com/bob/status/123456', text: 'target text', handle: 'bob', createdAt: '2026-10-17T10:00:00Z' }];
const deps = {
  readQueue: async () => posts, listBuckets: async () => [], readPackages: async () => new Map([['pk1', { id: 'pk1' }]]),
  listTasks: async () => [], readSuggestions: async () => suggestions, readQuoteTargets: async () => quoteTargets, readPlanDoc: async () => null,
};

test('parity: month shape equals the pre-extraction handler composition on the same inputs', async () => {
  const { calendar } = await readUnifiedCalendar(db, 'c1', { month: '2026-10', now: NOW, deps });
  const config = resolveCalendarEngineConfig({ planDoc: null, legacyOverrides: null });
  const withBuckets = posts.map((p) => (p.bucketId || !new Map([['pk1', { id: 'pk1' }]]).has(p.packageId) ? p : { ...p, bucketId: bucketOfPost(p, { id: 'pk1' }) }));
  const old = buildMonthCalendar({ posts: withBuckets, month: '2026-10', now: NOW, config, buckets: [], tasks: [], suggestions, quoteTargets: assignQuoteSlots(quoteTargets, { left: 4 }) });
  assert.deepEqual(calendar, old);
  // Invalid / missing month falls back to the current CT month like the route did.
  assert.equal((await readUnifiedCalendar(db, 'c1', { month: 'nope', now: NOW, deps })).calendar.month, '2026-10');
});

test('range: days inside [from,to], one row per date, capped at 31 days, crosses a month boundary', async () => {
  const r = await readUnifiedCalendar(db, 'c1', { from: '2026-10-30', to: '2026-11-02', now: NOW, deps });
  assert.deepEqual(r.days.map((d) => d.date), ['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']);
  const big = await readUnifiedCalendar(db, 'c1', { from: '2026-10-01', to: '2027-03-01', now: NOW, deps });
  assert.equal(big.days.length, 31);
});

const rangeDeps = { ...deps };
const readCalendar = async (opts) => readUnifiedCalendar(db, 'c1', { ...opts, now: NOW, deps: rangeDeps });

test('get_calendar: shape, kinds, ids, placeholder flag + approveNote, requote window', async () => {
  assert.ok(READ_TOOL_NAMES.includes('get_calendar'));
  const out = await runReadTool('get_calendar', { from: '2026-10-17', to: '2026-10-18' }, { readCalendar });
  assert.equal(out.days.length, 2);
  const items = out.days.flatMap((d) => d.items);
  const byId = Object.fromEntries(items.map((i) => [`${i.kind}:${i.id}`, i]));
  assert.equal(byId['suggestion:sg1'].approval, 'suggested');
  assert.equal(byId['requote:qt1'].handle, 'bob');
  assert.equal(byId['requote:qt1'].windowOpen, true);
  assert.ok(byId['requote:qt1'].expiresAt);
  assert.equal(byId['post:a1'].approval, 'approved');
  assert.equal(byId['post:s1'].approval, 'scheduled');
  assert.ok(items.every((i) => i.text.length <= LIMITS.calendarTextMax));
  assert.ok(items.every((i) => typeof i.hasPlaceholder === 'boolean'));
  // The undated placeholder draft is proposed onto a day; it carries the note.
  const ph = (await runReadTool('get_calendar', { from: '2026-10-17', to: '2026-10-30' }, { readCalendar })).days.flatMap((d) => d.items).find((i) => i.id === 'd1');
  assert.ok(ph, 'proposed draft shows up');
  assert.equal(ph.hasPlaceholder, true);
  assert.match(ph.approveNote, /never blocks approval/);
  assert.equal(ph.approval, 'unapproved');
  assert.ok(out.totals.posts >= 2 && out.totals.requotes >= 1 && out.totals.suggestions === 1);
  assert.ok(serializeResult(out).length < LIMITS.resultMaxChars);
});

test('get_calendar: filters', async () => {
  const kinds = async (filter) => (await runReadTool('get_calendar', { from: '2026-10-16', to: '2026-10-19', filter }, { readCalendar })).days.flatMap((d) => d.items);
  assert.ok((await kinds('suggestions')).every((i) => i.kind !== 'post'));
  assert.ok((await kinds('approved')).every((i) => ['approved', 'scheduled', 'posted'].includes(i.approval)));
  assert.ok((await kinds('unapproved')).every((i) => ['unapproved', 'held'].includes(i.approval)));
  assert.ok((await kinds('all')).length > (await kinds('approved')).length);
});

test('get_calendar: not available without a reader; truncates instead of overflowing', async () => {
  assert.deepEqual(await runReadTool('get_calendar', {}, {}), { error: 'not available' });
  const many = Array.from({ length: 200 }, (_, i) => ({ kind: 'post', id: `p${i}`, approval: 'approved', status: 'approved', time: '09:00', content: 'x'.repeat(300) }));
  const out = await runReadTool('get_calendar', {}, { readCalendar: async () => [{ date: '2026-10-17', posts: many }] });
  assert.equal(out.truncated, true);
  assert.ok(serializeResult(out).length <= LIMITS.resultMaxChars);
});

test('get_post and find_posts carry approveNote only for placeholder text', async () => {
  const withPh = { id: 'x', status: 'draft', content: 'hello [add your take]' };
  assert.match((await runReadTool('get_post', { postId: 'x' }, { readPost: async () => withPh })).approveNote, /never blocks approval/);
  assert.equal((await runReadTool('get_post', { postId: 'y' }, { readPost: async () => ({ id: 'y', status: 'draft', content: 'plain' }) })).approveNote, undefined);
  const rows = (await runReadTool('find_posts', {}, { readPostsForQuery: async () => [withPh, { id: 'y', status: 'draft', content: 'plain' }] })).rows;
  assert.ok(rows.find((r) => r.id === 'x').approveNote);
  assert.equal(rows.find((r) => r.id === 'y').approveNote, undefined);
});

test('baselineSlots: parsed from a CONFIRMED strategy doc, tracks mapped from the plan; draft / missing / failing doc -> none', async () => {
  const formats = '- Daily slot baseline (Chicago time):\n  - 07:00 Graphic Design: quote-react. [model]\n  - 16:00 Dj Mix Videos: UE mix clip.\n  - All day: 5+ replies in the two lanes.';
  const doc = { confirmed: true, version: 2, sections: { formats } };
  const planDoc = { plan: { contentTracks: [{ id: 'design', label: 'Graphic Design', engines: ['identity'], share: 1 }] } };
  const withDoc = (readStrategyDoc, extra = {}) => ({ ...deps, readStrategyDoc, ...extra });
  const month = await readUnifiedCalendar(db, 'c1', { month: '2026-10', now: NOW, deps: withDoc(async () => doc, { readPlanDoc: async () => planDoc }) });
  assert.deepEqual(month.baselineSlots.slots.map((s) => [s.time, s.track, s.note]), [['07:00', 'Graphic Design', 'quote-react.'], ['16:00', 'Dj Mix Videos', 'UE mix clip.']]);
  assert.equal(month.baselineSlots.replies.min, 5);
  const range = await readUnifiedCalendar(db, 'c1', { from: '2026-10-17', to: '2026-10-18', now: NOW, deps: withDoc(async () => doc) });
  assert.equal(range.baselineSlots.slots.length, 2);
  for (const read of [async () => ({ ...doc, confirmed: false }), async () => null, async () => { throw new Error('down'); }]) {
    const r = await readUnifiedCalendar(db, 'c1', { month: '2026-10', now: NOW, deps: withDoc(read) });
    assert.deepEqual(r.baselineSlots, { slots: [], replies: null, notes: [] });
  }
});

// ---- hot picks are the ONLY quote source on the calendar ----------------------------------------------------------
const pick = (id, rank, o = {}) => ({ id, lane: 'design', windowHours: 36, url: `https://x.com/h${id}/status/${id}`, author: `h${id}`, authorName: 'N', text: `pick ${id}`, createdAt: '2026-10-17T10:00:00Z', mediaUrl: 'https://pbs.twimg.com/a.jpg', momentum: 'climbing', fit: 0.8, angle: 'craft', why: 'because', rank, ...o });
const stateWith = (hotQuotes, legacy) => async () => ({ rawQuoteTargets: legacy ?? null, listSignals: null, hotQuotes });
const hotDeps = (hotQuotes, legacy, extra = {}) => ({
  readQueue: async () => [], listBuckets: async () => [], readPackages: async () => new Map(), listTasks: async () => [], readSuggestions: async () => [],
  readPlanDoc: async () => null, readQuoteState: stateWith(hotQuotes, legacy), ...extra,
});

test('hot picks: calendar quote targets come only from hotQuotes (legacy watchlist feed ignored), best rank first, passed picks dropped', async () => {
  const hot = { scannedAt: '2026-10-17T12:00:00Z', quotesLeftToday: 3, picks: { design: [pick('1', 0.5), pick('2', 0.9)], music: [pick('3', 0.7, { lane: 'music', windowHours: 72 })] }, dismissed: ['1'] };
  const legacy = { candidates: [{ id: 'L1', url: 'https://x.com/old/status/9', createdAt: '2026-10-17T10:00:00Z', author: 'old', text: 'legacy' }] };
  const t = await readCalendarQuoteTargets(db, 'c1', { readQuoteState: stateWith(hot, legacy), now: () => NOW });
  assert.deepEqual(t.map((x) => x.id), ['2', '3']);
  assert.equal(t[1].windowHours, 72);
  assert.equal(t[0].hot.why, 'because');
  assert.deepEqual(await readCalendarQuoteTargets(db, 'c1', { readQuoteState: stateWith(null, legacy), now: () => NOW }), []);
});

test('hot picks: a music pick stays open past 36h (72h window); a design pick closes at 36h', async () => {
  const old = '2026-10-15T20:00:00Z'; // 41h before NOW
  const hot = { scannedAt: '2026-10-17T12:00:00Z', picks: { design: [pick('d', 0.9, { createdAt: old })], music: [pick('m', 0.5, { lane: 'music', windowHours: 72, createdAt: old })] } };
  const t = await readCalendarQuoteTargets(db, 'c1', { readQuoteState: stateWith(hot), now: () => NOW });
  assert.deepEqual(t.map((x) => x.id), ['m']);
});

test('hot picks: requote rows take the next open baseline quote slot, the rest are extra, quotes-left rides along', async () => {
  const hot = { scannedAt: '2026-10-17T12:00:00Z', quotesLeftToday: 3, picks: { design: [pick('1', 0.9), pick('2', 0.8), pick('3', 0.7)], music: [] } };
  const posted = [{ id: 'q', status: 'posted', fillKind: 'quote', reviewOn: '2026-10-17', scheduledAt: '2026-10-17T13:00:00Z' }];
  const r = await readUnifiedCalendar(db, 'c1', { month: '2026-10', now: NOW, deps: hotDeps(hot, null, { readQueue: async () => posted }) });
  const rows = r.calendar.weeks.flat().find((d) => d.date === '2026-10-17').posts.filter((x) => x.kind === 'requote');
  assert.deepEqual(rows.map((x) => [x.quoteTargetId, x.time, x.slotKind]), [['1', '11:00', 'baseline'], ['2', '', 'extra'], ['3', '', 'extra']]);
  assert.equal(rows[0].quotesLeftToday, 3);
  assert.deepEqual(r.quoteBudget, { left: 3, postedToday: 1, scannedAt: '2026-10-17T12:00:00Z' });
});

test('quotesLeftToday: a scan from an earlier day does not carry over; saved quote posts today cap it', async () => {
  const hot = { scannedAt: '2026-10-16T12:00:00Z', quotesLeftToday: 0, picks: { design: [pick('1', 0.9)], music: [] } };
  const r = await readUnifiedCalendar(db, 'c1', { month: '2026-10', now: NOW, deps: hotDeps(hot, null) });
  assert.equal(r.quoteBudget.left, 4);
  const two = [{ status: 'scheduled', fillKind: 'quote', scheduledAt: '2026-10-17T20:00:00Z' }, { status: 'approved', sourceRef: { kind: 'quote-target' }, reviewOn: '2026-10-17' }, { status: 'draft', fillKind: 'quote', reviewOn: '2026-10-17' }];
  assert.equal(quotePostsOnDay(two, '2026-10-17'), 2);
  const r2 = await readUnifiedCalendar(db, 'c1', { month: '2026-10', now: NOW, deps: hotDeps(hot, null, { readQueue: async () => two }) });
  assert.equal(r2.quoteBudget.left, 2);
});
