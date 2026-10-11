import test from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../store.js';
import { runDispatch } from '../scheduler.js';
import { makeHarness, makePost, T0, HOUR, MIN } from './helpers/fakes.js';

const CLEAR_QUIET = { quietHours: { enabled: false, start: 22, end: 7 } };

async function setup({ settings = {}, post = {}, rows = true, users } = {}) {
  const h = await makeHarness(users ? { users } : undefined);
  await S.saveSettings(h.db, 'c1', { briefingEnabled: false, ...CLEAR_QUIET, ...settings }, { now: T0 });
  const p = h.services.add(makePost(post));
  if (rows) h.calendarRows.push({ id: p.id, status: p.status, scheduledAt: p.scheduledAt, revision: p.revision });
  h.run = (at = h.clock.t) => { h.clock.t = at; return runDispatch(h.ctx, { now: at }); };
  return h;
}
const cardTexts = (h) => h.sent().map((c) => c.args[1]);
const outboxDocs = (h) => [...(h.db._store.get('telegram_outbox')?.values() || [])];
const syncRow = (h, p) => { h.calendarRows.length = 0; h.calendarRows.push({ id: p.id, status: p.status, scheduledAt: p.scheduledAt, revision: p.revision }); };

test('handoff inside the lead window sends media preview + card; same (post,revision,target) is never re-sent', async () => {
  const h = await setup({ post: { mediaUrl: 'https://cdn/v.mp4', mediaType: 'video' } });
  const first = await h.run();
  assert.equal(first.handoffs, 1);
  assert.equal(first.outbox, 1);
  assert.equal(h.sent('sendVideo').length, 1);
  assert.match(cardTexts(h).at(-1), /Post needs your attention/);
  assert.ok(h.button(/Approve & schedule/));
  const second = await h.run(T0 + 5 * MIN);
  assert.deepEqual([second.handoffs, second.outbox], [0, 0]);
  assert.equal(h.sent().length, 1);
  assert.equal(h.sent('sendVideo').length, 1);
});

test('nothing is sent before the lead window opens', async () => {
  const h = await setup({ post: { scheduledAt: new Date(T0 + 90 * MIN).toISOString() } });
  assert.equal((await h.run()).handoffs, 0);
  assert.equal(h.sent().length, 0);
  assert.equal((await h.run(T0 + 61 * MIN)).handoffs, 1); // 29 minutes before target, lead 30
});

test('proposed calendar time (undated draft) triggers a handoff offering Approve & schedule at that time', async () => {
  const h = await setup({ post: { scheduledAt: null }, rows: false });
  h.calendarRows.push({ id: 'p1', status: 'draft', proposed: true, proposedAt: new Date(T0 + 10 * MIN).toISOString(), revision: 1 });
  const c = await h.run();
  assert.equal(c.handoffs, 1);
  assert.match(h.button(/Approve & schedule/).text, /3:10\s?PM/);
});

test('scheduled + approved post gets a status reminder with no approve button', async () => {
  const h = await setup({ post: { status: 'scheduled' } });
  await h.run();
  assert.match(cardTexts(h).at(-1), /Reminder: scheduled post/);
  assert.match(cardTexts(h).at(-1), /no action needed/);
  assert.ok(!h.buttons().some((b) => /Approve/.test(b.text)));
  assert.ok(h.button(/Post myself \(take over\)/));
});

test('a new revision gets its own handoff (dedup is per post,revision,target)', async () => {
  const h = await setup();
  await h.run();
  h.services.posts.get('p1').revision = 2;
  syncRow(h, h.services.posts.get('p1'));
  const c = await h.run(T0 + 5 * MIN);
  assert.equal(c.handoffs, 1);
  assert.match(cardTexts(h).at(-1), /Revision 2/);
});

test('quiet hours defer the notification only: queued for quiet end, post schedule untouched, no service writes', async () => {
  const at = Date.parse('2026-10-15T04:00:00Z'); // 23:00 CDT
  const h = await setup({
    settings: { quietHours: { enabled: true, start: 22, end: 7 } },
    post: { status: 'scheduled', scheduledAt: new Date(at + 20 * MIN).toISOString() },
  });
  const before = JSON.stringify(h.services.posts.get('p1'));
  const c = await h.run(at);
  assert.deepEqual([c.handoffs, c.outbox], [1, 0]);
  assert.equal(h.sent().length, 0);
  assert.equal(outboxDocs(h)[0].nextAttemptAt, '2026-10-15T12:00:00.000Z'); // 07:00 CDT
  assert.equal(JSON.stringify(h.services.posts.get('p1')), before);
  assert.deepEqual(h.services.writes, []);
});

test('revision changes between enqueue and send: outbox superseded, nothing sent', async () => {
  const at = Date.parse('2026-10-15T04:00:00Z');
  const h = await setup({
    settings: { quietHours: { enabled: true, start: 22, end: 7 } },
    post: { status: 'scheduled', scheduledAt: new Date(at + 20 * MIN).toISOString() },
  });
  await h.run(at);
  h.services.posts.get('p1').revision = 2; // edited in web while the notice was deferred
  const c = await h.run(Date.parse('2026-10-15T12:01:00Z'));
  assert.equal(c.outbox, 0);
  assert.equal(outboxDocs(h)[0].status, 'superseded');
  assert.equal(h.sent().length, 0);
});

test('post turned terminal before the deferred send is superseded too', async () => {
  const at = Date.parse('2026-10-15T04:00:00Z');
  const h = await setup({ settings: { quietHours: { enabled: true, start: 22, end: 7 } }, post: { status: 'scheduled', scheduledAt: new Date(at + 20 * MIN).toISOString() } });
  await h.run(at);
  h.services.posts.get('p1').status = 'posted';
  await h.run(Date.parse('2026-10-15T12:01:00Z'));
  assert.equal(outboxDocs(h)[0].status, 'superseded');
  assert.equal(h.sent().length, 0);
});

test('notifications paused: nothing enqueued or sent, posts untouched', async () => {
  const h = await setup({ settings: { notificationsPaused: true } });
  const c = await h.run();
  assert.deepEqual(c, { inbox: 0, handoffs: 0, briefings: 0, failures: 0, outbox: 0 });
  assert.equal(h.sent().length, 0);
  assert.equal(outboxDocs(h).length, 0);
  assert.deepEqual(h.services.writes, []);
});

test('daily briefing: once per local date at briefingHour, again the next day', async () => {
  const h = await setup({ settings: { briefingEnabled: true, briefingHour: 8 }, rows: false });
  assert.equal((await h.run(Date.parse('2026-10-14T12:30:00Z'))).briefings, 0); // 07:30 CDT
  assert.equal((await h.run(Date.parse('2026-10-14T13:05:00Z'))).briefings, 1); // 08:05 CDT
  assert.equal(h.lastText(), '<b>Overview</b>');
  assert.equal((await h.run(Date.parse('2026-10-14T18:00:00Z'))).briefings, 0);
  assert.equal(h.sent().length, 1);
  assert.equal((await h.run(Date.parse('2026-10-15T13:05:00Z'))).briefings, 1);
  assert.equal(h.sent().length, 2);
});

test('briefing disabled: none', async () => {
  const h = await setup({ rows: false });
  assert.equal((await h.run()).briefings, 0);
});

test('actionable failure alerts once per (post,revision,status); a new status alerts again; notifyFailures off silences', async () => {
  const h = await setup({ post: { status: 'failed', error: 'X said no' }, rows: false });
  h.queue.failed.push({ id: 'p1', status: 'failed', revision: 1 });
  assert.equal((await h.run()).failures, 1);
  assert.match(cardTexts(h).at(-1), /X said no/);
  assert.equal((await h.run(T0 + 5 * MIN)).failures, 0);
  h.services.posts.get('p1').status = 'needs_review';
  h.queue.failed.length = 0; h.queue.needsReview.push({ id: 'p1', status: 'needs_review', revision: 1 });
  assert.equal((await h.run(T0 + 10 * MIN)).failures, 1);
  const quiet = await setup({ settings: { notifyFailures: false }, post: { status: 'failed' }, rows: false });
  quiet.queue.failed.push({ id: 'p1', status: 'failed', revision: 1 });
  assert.equal((await quiet.run()).failures, 0);
});

test('overdue unapproved draft: one "missed, not sent" card, never auto-sent or approved', async () => {
  const h = await setup({ post: { scheduledAt: new Date(T0 - 10 * MIN).toISOString() } });
  const c = await h.run();
  assert.equal(c.handoffs, 1);
  assert.match(cardTexts(h).at(-1), /Missed: not sent/);
  assert.match(cardTexts(h).at(-1), /NOT sent/);
  assert.ok(h.button(/Approve & pick time/), 'scheduling an unapproved draft is labelled as approval');
  assert.ok(!h.buttons().some((b) => /Approve & schedule/.test(b.text)), 'a past time cannot be approved');
  assert.equal((await h.run(T0 + 5 * MIN)).handoffs, 0);
  assert.equal(h.sent().length, 1);
  assert.deepEqual(h.services.writes, []);
  assert.equal(h.services.posts.get('p1').status, 'draft');
});

test('outbox honors 429 retry_after and leaves the post untouched; sends after the wait', async () => {
  const h = await setup();
  h.transport.failNext('sendMessage', Object.assign(new Error('slow down'), { code: 'rate-limited', retryAfter: 600, retryable: true }));
  const before = JSON.stringify(h.services.posts.get('p1'));
  const c = await h.run();
  assert.equal(c.outbox, 0);
  const doc = outboxDocs(h)[0];
  assert.equal(doc.status, 'queued');
  assert.ok(Date.parse(doc.nextAttemptAt) >= T0 + 600000);
  assert.equal(JSON.stringify(h.services.posts.get('p1')), before);
  assert.deepEqual(h.services.writes, []);
  assert.equal((await h.run(T0 + 5 * MIN)).outbox, 0); // still waiting
  assert.equal((await h.run(T0 + 11 * MIN)).outbox, 1);
});

test('permanent telegram failure (blocked bot) fails the outbox item, never the post', async () => {
  const h = await setup();
  h.transport.failNext('sendMessage', Object.assign(new Error('blocked'), { code: 'forbidden' }));
  await h.run();
  assert.equal(outboxDocs(h)[0].status, 'failed');
  assert.deepEqual(h.services.writes, []);
  assert.equal(h.services.posts.get('p1').status, 'draft');
});

test('access is re-checked on every scheduled send: revoked or de-allowlisted after enqueue sends nothing', async () => {
  const at = Date.parse('2026-10-15T04:00:00Z');
  const h = await setup({ settings: { quietHours: { enabled: true, start: 22, end: 7 } }, post: { status: 'scheduled', scheduledAt: new Date(at + 20 * MIN).toISOString() } });
  await h.run(at);
  h.env.PILOT_OWNER_UIDS = 'nobody';
  await h.run(Date.parse('2026-10-15T12:01:00Z'));
  assert.equal(h.sent().length, 0);
  const h2 = await setup();
  h2.env.PILOT_OWNER_UIDS = 'nobody';
  assert.equal((await h2.run()).handoffs, 0);
  const h3 = await setup();
  await S.revokeBinding(h3.db, { clientId: 'c1', uid: 'u1', now: T0 });
  assert.equal((await h3.run()).handoffs, 0);
  assert.equal(h3.sent().length, 0);
});

test('inbox recovery: an unprocessed stored update is replayed through the bot and completed', async () => {
  const h = await setup({ rows: false });
  await S.recordUpdate(h.db, { update_id: 77, message: { message_id: 1, chat: { id: 111, type: 'private' }, from: { id: 111 }, text: 'Settings' } }, { now: T0 });
  const c = await h.run();
  assert.equal(c.inbox, 1);
  assert.match(h.lastText(), /Settings/);
  assert.equal((await h.run(T0 + MIN)).inbox, 0);
});
